# Durable local ue2three automation

`tools/ue2three/dds_automation.py` supervises the source-aware agent independently
of an open ChatGPT response. It uses the existing authenticated Codex CLI; no API
key is copied into configuration. Use a clean integration checkout, preserving
the user's dirty checkout. Parsed source inputs can be reused as immutable
hardlinks; outputs and compiled caches must be separate.

## Configuration (local, ignored)

Create `.local/ue2three/automation/config.json` with `project` (existing
`.uproject`), `workspace` (verified cache inside this checkout), `publish_dir`
(inside this checkout), `session_seconds` (default 7200), `push` (boolean), and
`branch` (explicit existing destination). Optionally supply `codex_executable`.
Do not put credentials in this file. `push` never uses force.

Run a tick with `python tools/ue2three/dds_automation.py --config PATH --once`;
inspect with `--status`. `install_dds_automation.ps1 -ConfigPath PATH -StartNow`
registers a Windows task every five minutes. Overlapping instances are ignored.
It runs as the logged-in user; the PC must remain powered on. The two-hour
session budget stops new agent attempts; the task remains registered for status.
To stop work, disable the Windows task. To begin another session after reviewing
its checkpoint, update `started_epoch` in its local supervisor state.

## What a tick actually does

1. Recover checkpoints and retry a pending push before doing more work.
2. Detect changes across all ue2three Python modules, runtime modules and package
   manifests; compile from the verified package cache only when needed.
3. Check the real CLI authentication, then choose a source-witnessed native
   blocker family. Run Codex in a detached worktree, with a 15-minute bound.
4. Keep JSON events, stderr and the final message under that worker's ignored
   `.local/dds-agent`. Chat disconnection does not own this process.
5. Require focused Python/JavaScript tests. Replay the same cached source with
   candidate code. Preserve all previously translated function identities,
   preserve package source hashes, increase translated functions and decrease
   blocked functions. Retain unsuccessful patches for diagnosis.
6. Fast-forward only the clean integration checkout, checkpoint the commit,
   refresh its compiled output, and optionally push to the configured branch.
7. Persist failure diagnostics and retry backoff; continue eligible families on
   later ticks. No unbounded retries, source rescans or Unreal launch.

Progress is visible in `automation.html` / `automation-state.json` in the
configured publish directory. State lists unsupported stages explicitly.

## Asset export and deployment

Optional `asset_export_command` and `deploy_command` stages are objects with
`argv` (explicit argument array, no shell), `inputs`, `outputs`, and optional
`timeout` (maximum 900 seconds). Input/output files must be inside the isolated
checkout. Commands are cached by input hashes and require real nonempty output
files. A successful command is **not** visual/gameplay acceptance. Do not
configure a heavy Unreal export blindly or put licensed assets on a public host
without the appropriate rights. Deployment credentials belong in the platform's
secret store. Existing GitHub deploy configuration does not upload ignored local
GLBs by itself.

## Acceptance boundaries

This runner supports the seven native Blueprint planning families. It is not yet
a solver for every unsupported opcode or an automated visual gameplay judge.
Conversion gains and passing tests do not mark a whole game area green.
Animations retain their deferred 1:1 acceptance status. Export, deployment and
browser acceptance remain visibly incomplete until corresponding evidence exists.

The runner protects local work from a disconnected response; it cannot repair
the ChatGPT service or prove a client connection issue is fixed.
