import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";

const request = JSON.parse(readFileSync(".rea-bridge/request.json", "utf8"));
const child = spawn("rea", ["mcp"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, REA_MCP_MAX_RESPONSE_BYTES: "5242880" }
});

let nextId = 0;
const pending = new Map();
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString().slice(0, 4096); });
child.on("error", (err) => {
  for (const item of pending.values()) item.reject(err);
  pending.clear();
});
child.on("exit", (code) => {
  for (const item of pending.values()) item.reject(new Error("REA exited: " + code + " " + stderr.slice(-1000)));
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
