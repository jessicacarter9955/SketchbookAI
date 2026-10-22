# Durable local ue2three automation

`tools/ue2three/dds_automation.py` supervises the source-aware agent independently
of an open ChatGPT response. It uses the existing authenticated Codex CLI; no API
key is copied into configuration. Use a clean integration checkout, preserving
the user's dirty checkout. Parsed source inputs can be reused as immutable
hardlinks; outputs and compiled caches must be separate.

## Configuration (local, ignored)

Create `.local/ue2three/automation/config.json` with `project` (existing
`.uproject`), `workspace` (verified cache inside this checkout), `publish_dir`
(inside this checkout), `session_seconds` (default 0: no session expiry), `push` (boolean), and
`branch` (explicit existing destination). Optionally supply `codex_executable`.
`parallel_workers` defaults to **4** (allowed range: 1–4). Each slot handles a
different source-witnessed native family in its own detached Git worktree;
the configured Codex account still determines actual request capacity.
Do not put credentials in this file. `push` never uses force.

Run a tick with `python tools/ue2three/dds_automation.py --config PATH --once`;
inspect with `--status`. `install_dds_automation.ps1 -ConfigPath PATH -StartNow`
registers a Windows task every five minutes. Overlapping instances are ignored.
It runs as the logged-in user; the PC must remain powered on and awake.
By default there is no session, agent-job or Windows-task wall-clock expiry.
An explicit positive `session_seconds` opts into a session budget.
Disable the Windows task to prevent new attempts; this does not cancel an
already-running Codex process. Network and deterministic validation operations
retain bounded retries/timeouts so a failed operation can be retried later.

## What a tick actually does

1. Recover checkpoints and retry a pending push before doing more work.
2. Detect changes across all ue2three Python modules, runtime modules and package
   manifests; compile from the verified package cache only when needed.
3. Check the real CLI authentication, then assign up to four **distinct**
   source-witnessed blocker families in one batch. Start independent Codex
   processes concurrently in detached worktrees, without a wall-clock expiry.
4. Keep JSON events, stderr and the final message under that worker's ignored
   `.local/dds-agent`. Chat disconnection does not own this process.
5. Require focused Python/JavaScript tests. Replay the same cached source with
   candidate code. Preserve all previously translated function identities,
   preserve package source hashes, increase translated functions and decrease
   blocked functions. Retain unsuccessful patches for diagnosis.
6. Integrate sequentially into the clean integration checkout. When a later
   parallel patch was based on an older head, cherry-pick into a separate
   staging worktree, re-run tests and cached source replay, and fast-forward
   only on a real conversion gain. Conflicts are marked `needs_review` while
   retaining the original patch; no force push or discarded edits.
   Checkpoint the commit,
   refresh its compiled output, and optionally push to the configured branch.
7. Persist failure diagnostics and retry backoff; continue eligible families on
   later ticks. No unbounded retries, source rescans or Unreal launch.

When the integration HEAD advances, families previously marked `needs_review`
for `no_proven_conversion_gain` may receive **one fresh attempt** on that new
revision. Their historical attempts and patches remain available, and retries
on the same HEAD are not repeated indefinitely. Conflicts and integrated
families remain excluded until separately resolved or new source evidence arrives.

Progress is visible in `automation.html` / `automation-state.json` in the
configured publish directory. The live loopback dashboard at `127.0.0.1:8401`
shows four lanes, each with its own source family, heartbeat timestamp and
`running`/`stale`/`patch_ready_for_review`/`integrated` state. A lane is marked
active only if its actual process heartbeat is recent. A GitHub CI job or a
published web page alone cannot establish that the Windows conversion process
is running. State lists unsupported stages explicitly.

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

## Private relay recovery

`bridge_recovery.py --bridge-dir PATH` wraps the existing installed
`bridge_pro.py`. It preserves author/path/program allowlists and existing
credentials, handles truncated HTTP reads, saves replies in a durable outbox,
reconciles ambiguous POST delivery, and polls incrementally using GitHub
comment update timestamps. A singleton lock prevents duplicate relay instances.
Its connection health is recorded in `~/.chat-local-bridge/connection-health.json`.
This repairs local relay failure modes; it does not control the ChatGPT UI
message-delivery timeout.

## Live web dashboard and controls

`automation_web.py --config PATH --port 8401` serves the existing local preview
and the live dashboard at the project's `automation.html`. It binds only to
127.0.0.1. `/__ue2three/status` reads bounded local checkpoints and log tails;
private dot-directories are not served. The same-origin `start` control returns
HTTP 202 immediately and starts the Windows task; it does not hold the request
open for the agent's lifetime. `pause` prevents new batches and preserves an
already-running batch. No chat message is required to monitor or resume work.

The eight area percentages count explicitly listed acceptance criteria with
uniform weights. They are not estimates of overall game fidelity or elapsed
work. Blueprint function coverage has its own translated/(translated+blocked)
denominator. An area is green only when all its listed criteria have evidence.
The animation 1:1 acceptance remains deferred. Additional export/deploy stages
remain visibly unconfigured until actually connected and verified.

## Account and connection recovery

Model usage limits, authentication errors and interrupted model connections are
classified separately from adapter failures. They do not consume the family's
source-implementation attempts. Usage limits pause the entire queue for 30
minutes, then retry automatically; connection/authentication failures wait ten
minutes. No purchase, new model or account change is performed automatically.
Family attempt budgets apply per verified source plan. Logs and failed patches
remain on disk. A reset of temporary account limits does not require a new user
message.

Large source packets are reduced to complete structured records under 48,000
characters. The primary parsed source witness is copied and checksum-verified
inside the worker for targeted read-only queries. Original source/cache files
remain untouched. New workers use sparse checkouts to avoid copying unrelated
assets. Conversion/replay tests still use the complete verified package cache.
