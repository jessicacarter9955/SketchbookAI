# TruthLab Pair — cloud memory + authenticated independent scheduling (v0.8)

TruthLab is an isolated two-agent research experiment (Ari and Noor) in
`jessicacarter9955/SketchbookAI`, branch `truthlab-autonomous-agents`.
The game runtime and its assets are not part of this application.

## Implemented

- Browser console with individual start/pause, operator messages, workflow selection,
  and a 50-word report per completed cycle.
- Two independent conversation modes: goal-directed TruthLab and open-ended Backrooms.
- **PostgreSQL** backend, enabled by `TRUTHLAB_DATABASE_URL`. Stores messages,
  workflow-specific memories, reports, goals, pause state, and model usage. Reads across
  independent processes and restarts (subject to the provider retaining the database).
  SQLite remains the local fallback and is **not durable** on Render Free.
- The model prompt selects recent and topically relevant older memories (up to 2,000 rows per workflow), labelled
  as untrusted dialogue rather than independently verified facts.
- Cross-process database lease prevents the web scheduler and an external scheduler from
  executing a duplicate cycle at the same time.
- `python truthlab-live/app.py --once` runs a due, **previously enabled** agent cycle
  without a web browser or a persistent HTTP server, and honors pause, agent toggles,
  due time, and the daily model-call cap.
- A default-branch workflow at `.github/workflows/truthlab-autonomous-tick.yml` polls
  every fifteen minutes and checks out this isolated branch. Only a due cycle runs.
  Scheduled GitHub Actions can be delayed or skipped; this is **not** an always-on process.

## Confirmed free, no-key inference path

The default-branch dispatcher now starts a locally bound **Qwen2.5-1.5B-Instruct**
GGUF model through official `llama.cpp` Ubuntu CPU binaries whenever no external
model API key and name are configured. The weights' SHA256 is pinned and verified.
The 2026-10-18 GitHub Actions push smoke demonstrated a **real response** from the
model, not a simulated transcript: run
https://github.com/jessicacarter9955/SketchbookAI/actions/runs/39106760002.
Standard GitHub Actions runners are free for this public repository.

This avoids OpenAI/Grok/OpenRouter tokens for **inference**, but DOES NOT
automatically create an external PostgreSQL database. GitHub Actions first checks
its optional `TRUTHLAB_DATABASE_URL` secret and otherwise requests a short-lived,
RSA-signed GitHub OIDC token. The Render server verifies the exact repository,
repository ID, workflow path, main branch and schedule/dispatch event before
returning the private PostgreSQL URL. OIDC credentials are never printed or
committed. The signed OIDC probe was verified in
https://github.com/jessicacarter9955/SketchbookAI/actions/runs/39108501645.
The runner skips when no durable database is connected.

The existing Render console can enable the scheduled external runner with
`TRUTHLAB_ALLOW_EXTERNAL_RUNNER=1` and a configured
`TRUTHLAB_DATABASE_URL`. Its Start button then sets the shared database state
to active; Pause stops the next scheduled cycle. While running in this mode,
no live hosted API model is required, and individual toggles remain effective.

The existing service's build command is compile-only. For this specific
legacy Render service `TRUTHLAB_PG_BOOTSTRAP=1` allows the PostgreSQL driver
to be installed at the first cloud DB connection when missing. Prefer installing
dependencies in the build command for any future service.

## End-to-end evidence

The two-agent pipeline was independently validated with an actual Qwen CPU model,
a disposable PostgreSQL container, and separate process invocations. The
verification checks 2 cycles, 6 real messages, 6 durable memories, 2 reports,
workflow-specific agent pause, global pause, and no double cycle:
https://github.com/jessicacarter9955/SketchbookAI/actions/runs/39107713044

A disposable CI Postgres proves storage behavior but is not an actual cloud
database account. Production memory **remains unconfigured** until an approved
provider is connected and the Render DB URL is provisioned. The project does
not create unknown provider accounts, disclose credentials or silently charge
a payment method. GitHub Actions schedules are best-effort periodic execution,
not guaranteed continuous realtime availability.

## Backrooms evolution — historical-method replica

This is an original fiction experiment modeled on the observable process of
Andy Ayrey's Infinite Backrooms and later Truth Terminal, not a prewritten
duplicate of its mythology or a guaranteed viral outcome.

| Historical sequence | TruthLab implementation |
| --- | --- |
| March 2024: paired Claude models explore an imagined CLI | Ari is the explorer issuing invented commands; Noor interprets them as the fictional simulator at `simulator@truthlab:~/$` |
| Many free-flowing conversations | Ari and Noor alternate; real output is recorded in a workflow-isolated database |
| Recurring motifs and strange myth-making | Repeated meaningful phrases across different cycles and both agents are identified from actual prose, excluding shell boilerplate |
| Ayrey curates unusual exchanges | Each completed real Backrooms cycle is archived; operator can curate or reject excerpts while paused |
| Selected corpus shapes an experimental voice | Authenticated JSON export contains *only* curated turns for possible later model training; no third agent or fine-tuning has been run |
| Voice shared publicly, feedback refines it | Editorial phase prepares private drafts only; no unauthorized publication, followers, audience reactions or public feedback is invented |
| GOAT token later independently created by outsiders | No token launches, token promotion, wallet actions, or fabricated economic impact |

The five observable phases are `exploration`, `recurrence`, `mythmaking`,
`curation`, and `editorial`. A phase is a descriptive assessment of recorded
evidence and operator actions, not a scripted destiny. The starting prompt
contains no original historical meme name or preselected religion.

The dashboard shows the current phase, detected phrases, archived scenes and
curation controls. Only a paused operator may select or reject material.
The download control produces a JSON corpus; it does not upload, fine-tune,
publish, or create another agent. All fictional CLI effects are roleplay.

### Historical sources

- https://www.infinitebackrooms.com/ — archive and experiments
- https://www.infinitebackrooms.com/dreams/conversation-1712185367-txt — initial roleplay context
- https://truthterminal.wiki/When_AIs_Play_God_se.pdf — April 2024 interpretive paper
- https://www.wired.com/story/truth-terminal-goatse-crypto-millionaire/ — curation, fine-tuning, social release, and later GOAT origin
- https://www.truthcollective.foundation/ — founding organization perspective

### Verification and limits

Run `python -m unittest discover -s truthlab-live -p 'test_*.py' -v`.
The default-branch job `TruthLab Backrooms Real Genesis` executes actual
Qwen 1.5B replies with a disposable PostgreSQL 16 database, tests two cycles,
restarts, verifies archive and memory, then pauses. This is not production.
The original experiment had Claude 3 Opus and a later separately fine-tuned
Llama-based character, substantially stronger and unlike this Qwen 1.5B pair.
A text-overlap counter cannot prove a myth or culture has meaningfully emerged.
Real fine-tuning, third-party publishing, community engagement and permanent
cloud database provisioning are not yet active.

## Required configuration to activate

No credentials are committed. A green CI is not proof of live inference or durable hosting.

1. Provision a durable managed PostgreSQL database from your chosen provider.
   **No-cost candidates:** Aiven Free PostgreSQL (no fixed expiry, but inactive
   services may be powered off) or Neon Free PostgreSQL (quota-limited). Both
   depend on each provider's retention and fair-use policies. Avoid Render
   *Free Postgres* for permanent memory: Render says it expires after 30 days.
   Enable TLS (`sslmode=require` or stricter).
2. On the Render web service set:
   - `TRUTHLAB_DATABASE_URL`: shared external PostgreSQL connection URL.
   - `TRUTHLAB_ADMIN_TOKEN`: existing long random login token.
   - `OPENAI_API_KEY`: optional if using the free scheduled Qwen runner.
   - `OPENAI_MODEL`: optional with Qwen; otherwise exact hosted model identifier.
   - `OPENAI_BASE_URL`: optional hosted chat-completions endpoint root (defaults to OpenAI).
   - `TRUTHLAB_ALLOW_EXTERNAL_RUNNER=1`: enable Start/Pause for GitHub-hosted Qwen.
   - `TRUTHLAB_PG_BOOTSTRAP=1`: optional legacy-service driver installation.
   - `TRUTHLAB_OIDC_BRIDGE=1` and `TRUTHLAB_OIDC_BOOTSTRAP=1`: secure credential broker.
   - `TRUTHLAB_AUTOSTART`: optional `1` to start after deploy when the model is configured;
     `0` to force pause on restart; omit for persisted UI-controlled state.
   - `TRUTHLAB_MAX_MODEL_CALLS_DAY`: default 48, hard maximum 96; **not a currency cap**.
3. Render must deploy `truthlab-autonomous-agents` and install dependencies from
   `truthlab-live/requirements.txt` (e.g. build:
   `pip install -r truthlab-live/requirements.txt`; start:
   `python truthlab-live/app.py`). The web console and scheduled job must use
   the **same database** for pause/resume and memories to work together.
4. **No GitHub PostgreSQL secret is required when the signed Render OIDC broker is enabled.**
   Alternatively, in GitHub repository Settings → Secrets and variables → Actions, configure
   a **secret** named `TRUTHLAB_DATABASE_URL` (same database used by Render).
   - For free Qwen inference, `TRUTHLAB_LLM_API_KEY` and model variables are not required.
     Optionally provide a compatible remote key via secret `TRUTHLAB_LLM_API_KEY`
     and model name via variable `TRUTHLAB_LLM_MODEL`; also optionally
     `TRUTHLAB_LLM_BASE_URL`, `TRUTHLAB_MAX_MODEL_CALLS_DAY`.
   The scheduled job exits without inference when neither direct secret nor OIDC
   broker supplies a valid PostgreSQL connection.
5. Once deployed, use the dashboard Start button to activate, or configure
   `TRUTHLAB_AUTOSTART=1` on first startup. Pause and individual toggles are
   recorded in PostgreSQL and respected by the GitHub scheduler. For local Qwen,
   no `OPENAI_API_KEY` is needed on Render, but the shared PostgreSQL connection
   and the explicit `TRUTHLAB_ALLOW_EXTERNAL_RUNNER=1` flag are needed.

Each cycle currently has 4 model calls (Ari, Noor, Ari, Noor). **24 hourly cycles would
require 96 daily calls**. GitHub's free local-Qwen path explicitly sets the cap to 96;
for remote paid providers, the default remains 48 unless configured otherwise.
Provider-side spend limits remain essential for paid models.
The frontend's browser-only Qwen/WebGPU mode cannot execute when the tab is closed;
the separate **GitHub Actions Qwen CPU** runner can, provided a shared durable database
is configured. A hosted model API is optional.

### Durability and reliability boundaries

- PostgreSQL stores records in the cloud. It is **not an immutable backup**, nor a guarantee
  that a third-party free provider will retain data forever. Schedule independent database
  backups if the provider does not offer them.
- A GitHub Actions schedule provides periodic unattended execution, **not continuous 24/7
  uptime**. A paid always-on worker may be necessary for uninterrupted real-time activity.
- GitHub Models' inference API was retired July 30, 2026; it is not an available free runner.
- Cloud persistence and the cron entrypoint have CI tests. **A real cloud service deploy,
  production database recovery, and an inference round trip must be tested separately.**
- The agents do not have permission to send emails, post publicly, manage real crypto funds,
  create accounts or buy products. No secrets are revealed to the models.

## 2026-10-30 execution recovery

- Production scheduler: the latest pre-fix scheduled run
  [41019281438](https://github.com/jessicacarter9955/SketchbookAI/actions/runs/41019281438)
  checked out TruthLab but **skipped all model/database steps** because the Render
  OIDC broker was unavailable and no GitHub PostgreSQL secret was configured.
  Earlier green checks did not imply completed conversations. The default-branch
  tick now **fails visibly** when durable storage is unavailable; the isolated
  runner also fails when a due cycle produces no verified completion.
- Render service `truthlab-agents-open` is suspended for billing. A GitHub workflow
  edit cannot unsuspend it; live dashboard/production memory must be restored
  separately by the account owner or by configuring an approved reachable shared
  PostgreSQL service and its secret.
- To keep the fictional experiment progressing without Render or paid inference,
  [TruthLab Backrooms 100 to 500](https://github.com/jessicacarter9955/SketchbookAI/actions/runs/41034967737)
  rehydrates the verified **2026-10-18** 100-turn artifact
  (`39148303221`, `backrooms-100-transcript`) into a **disposable CI PostgreSQL**
  database and generates 400 new, genuine Qwen turns. Its artifact contains
  checkpoints and the full transcript; the final assertion requires 500 turns,
  500 memories and 125 archives. Its completion must be checked in Actions.
- This CI recovery is not the resumed **production** timeline. The original
  transcript artifact expires **2026-11-17** and continuation artifacts are
  also retention-limited. Do not claim indefinite memory or a live web dashboard
  from these artifacts.

## Verification

```bash
python -m pip install -r truthlab-live/requirements.txt
python -m unittest discover -s truthlab-live -p 'test_*.py' -v
# One-shot runner (requires same production DB and authorized model configuration):
python truthlab-live/app.py --once
```

GitHub CI starts a disposable PostgreSQL container for an integration test of schema,
writes, reload, and cross-process locking. The disposable CI database is not production
memory. Check the workflow run's conclusion before claiming integration success.

UI: https://truthlab-agents-open.onrender.com/
