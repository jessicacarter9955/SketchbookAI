import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const request = JSON.parse(readFileSync(".rea-bridge/request.json", "utf8"));
if (request.sourceGithubRepo) {
  const repoUrl = new URL(request.sourceGithubRepo);
  if (repoUrl.protocol !== "https:" || repoUrl.hostname !== "github.com" ||
      repoUrl.username || repoUrl.password || repoUrl.search || repoUrl.hash ||
      repoUrl.pathname.split('/').filter(Boolean).length !== 2) {
    throw new Error("Only simple public https://github.com/owner/repository URLs are supported");
  }
  const targetRoot = mkdtempSync(join(tmpdir(), "rea-target-"));
  const cloned = spawnSync("git", ["clone", "--depth", "1", "--", repoUrl.href, targetRoot], {
    encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024
  });
  if (cloned.status !== 0) throw new Error("Target clone failed: " + (cloned.stderr ?? "").slice(-1600));
  const relativePath = request.sourceRelativePath ?? ".";
  const targetPath = resolve(targetRoot, relativePath);
  if (targetPath !== targetRoot && !targetPath.startsWith(targetRoot + sep)) throw new Error("Target path outside clone");
  const parameter = request.targetParameter ?? "input_path";
  if (!["input_path", "path"].includes(parameter)) throw new Error("Unsupported target parameter");
  request.arguments = { ...(request.arguments ?? {}), [parameter]: targetPath };
  console.log("REA target cloned:", repoUrl.href, "relative path:", relativePath);
}
const child = spawn("rea", ["mcp"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, REA_MCP_MAX_RESPONSE_BYTES: "10485760" }
});

let nextId = 0;
const pending = new Map();
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString().slice(0, 4096); });
child.on("error", (err) => {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(err); }
  pending.clear();
});
child.on("exit", (code) => {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("REA exited: " + code + " " + stderr.slice(-1000))); }
  pending.clear();
});
const lines = createInterface({ input: child.stdout });
lines.on("line", line => {
  let value;
  try { value = JSON.parse(line); } catch { return; }
  if (value.id == null) return;
  const item = pending.get(value.id);
  if (!item) return;
  pending.delete(value.id);
  clearTimeout(item.timer);
  if (value.error) item.reject(new Error(JSON.stringify(value.error)));
  else item.resolve(value.result);
});
function rpc(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Timed out waiting for MCP: " + method));
    }, 90000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params, id }) + "\n");
  });
}

try {
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "chatgpt-github-rea-bridge", version: "0.1.0" }
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  let inventory = [];
  let cursor;
  do {
    const catalog = await rpc("tools/list", cursor ? { cursor } : {});
    inventory.push(...(catalog.tools ?? []));
    cursor = catalog.nextCursor;
  } while (cursor);

  const summary = {
    protocolVersion: init.protocolVersion,
    serverInfo: init.serverInfo,
    count: inventory.length,
    tools: inventory.map(({ name, description, annotations, inputSchema }) => ({ name, description, annotations, inputSchema }))
  };
  writeFileSync("rea-mcp-tools.json", JSON.stringify(summary, null, 2));
  console.log("REA MCP handshake OK; server:", JSON.stringify(init.serverInfo));
  console.log("REA MCP tool count:", inventory.length);
  console.log("REA MCP tool names:", inventory.map(x => x.name).join(", "));

  if (request.tool) {
    if (!inventory.some(x => x.name === request.tool)) {
      throw new Error("Requested MCP tool does not exist: " + request.tool);
    }
    const result = await rpc("tools/call", {
      name: request.tool,
      arguments: request.arguments ?? {}
    });
    writeFileSync("rea-mcp-result.json", JSON.stringify({
      requestId: request.requestId,
      tool: request.tool,
      result
    }, null, 2));
    console.log("REA MCP tools/call completed", JSON.stringify({
      requestId: request.requestId, tool: request.tool, isError: result.isError ?? false
    }));
    if (result.isError) process.exitCode = 1;
  }
} catch (error) {
  console.error("REA MCP bridge failure:", String(error));
  if (stderr) console.error("REA MCP stderr:", stderr.slice(-3000));
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
}
