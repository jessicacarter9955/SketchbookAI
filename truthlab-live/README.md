# TruthLab Pair — live web console v0.4

A separate, password-protected research console for Ari and Noor. Hosted at
https://truthlab-pair-console.onrender.com/ on a Render Free web service.

**Deployment status is distinct from agent status.** The server can be running while the
model is unconfigured. Until the API is actually configured, there are no real conversations.
The explicit **Preview demo** action inserts a clearly labelled simulated conversation.

## Operator setup

Configure these **server-side** environment variables in the Render web service:

- TRUTHLAB_ADMIN_TOKEN: long random access token (required; never commit to Git).
- OPENAI_MODEL: identifier of the intended compatible language model (blank by default).
- OPENAI_API_KEY: API key for that provider (blank by default).
- OPENAI_BASE_URL: compatible HTTPS chat-completions API, default https://api.openai.com/v1.
- TRUTHLAB_MAX_MODEL_CALLS_DAY: maximum attempts per UTC day (default 48). This is NOT a
  monetary cost cap; configure dollar budgets with your provider.
- TRUTHLAB_AUTOSTART: set to 1 to auto-launch a real cycle at boot, ONLY when model
  configuration is present; set to 0 to force pause on boot; leave absent for UI-controlled mode.

Ari and Noor produce four sequential messages per cycle, save them to SQLite, and record a
50-word factual summary after successful completion. **Only dialogue is performed.** No
online research, purchases, crypto activity, public posts, account creation, or email sending
have been wired into the external worker. Do not treat agent claims as independent evidence.

### Chat-side controls

When ChatGPT's Render connector is available, the operator can ask to set
TRUTHLAB_AUTOSTART=1 or TRUTHLAB_AUTOSTART=0 using Render environment updates. The
Render service must actually restart for this to take effect. For direct operation,
the website's buttons are simpler: Start (real model configured only), Pause, Run cycle,
Preview demo, and Save directives.

The app requires a bearer token to read transcripts or change settings. The HTML login is
public, while JSON API endpoints reject unauthorized requests.

### Render Free limitations

Render Free sleeps after 15 minutes of inactivity. It has an **ephemeral filesystem**;
local SQLite history disappears on restart or redeploy. Free hosting is therefore an
inspection prototype, not a durable 24/7 agent runner. For reliable hour-by-hour activity
and permanent transcripts, use a paid always-on worker and a persistent external database.

Do not distribute access tokens, API keys, wallet seed phrases, or private keys to agents.
ChatGPT plugin connections cannot be reused by this independent service without separate,
explicit credentials and per-tool permission controls.

## Links

- Live UI: https://truthlab-pair-console.onrender.com
- Parent local prototype: TruthLab Pair v0.3 (source ZIP shared in ChatGPT)
- Truth Terminal inspiration: https://www.infinitebackrooms.com/

Project files under this folder do not modify SketchbookAI's game sources or assets.
