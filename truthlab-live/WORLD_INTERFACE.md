# TruthLab World Interface — real internet and X API

## Operational state (2026-10-30)

Implementation: \`world_interface.py\`; behavioral tests: \`test_world_interface.py\`.
No Render. GitHub Actions provides scheduled CPU execution, using pinned local
Qwen2.5-1.5B when hosted credentials are not configured.

**Confirmed with a real network request:** GitHub Actions workflow
[41050774997](https://github.com/jessicacarter9955/SketchbookAI/actions/runs/41050774997)
searched Wikipedia and downloaded/read an excerpt of the actual Ada Lovelace
article using HTTPS. All 14 then-existing security/behavioral tests passed.
The X adapter and R2 storage adapter are not production certified until authorized
external service credentials and a read-write verification exist.

### Distinction: existing Site R2 vs the new worker storage

The private, deployed dashboard lives at
https://truthlab-pair-permanent.dvd2pe.chatgpt.site and already contains
100 genuine Qwen turns, 100 memories and 25 archives in its **managed R2**.
The independent GitHub Actions worker uses the S3-compatible R2 API configured
by the operator. These are **not proven to be the same bucket or the same memory**.
Do NOT say agent research appears in the dashboard until an authenticated bridge
and read-after-write test are completed. Do not export operator tokens into GitHub
logs or public repository contents. ChatGPT Site MCP already supports
\`truthlab_get_status\`, \`truthlab_read_shared_memory\`, and authenticated
\`truthlab_import_backrooms_turns\` for actual verified agent dialogue.
The 500-turn Backrooms runner is separate and ongoing.

### Real functions and strict safety boundaries

- \`search_web\`: live Brave Web Search with operator API key; without the key,
  a real Wikipedia MediaWiki API fallback is clearly labeled Wikipedia-only,
  not marketed as full-Web search.
- \`read_public_page\`: real bounded HTTPS HTML/plaintext requests, reject
  private hosts/IPs, redirect filtering, max response size, SHA256 provenance.
  Bytes not fetched are marked truncated, not treated as complete evidence.
- \`research_cycle\`: actually queries, retrieves, and stores provenance before
  getting separate Ari/Noor model responses. A failed search or model fails the
  cycle; no fabricated excerpts, internet actions or posts.
- \`poll_feedback\`: reads authenticated X v2 user mentions and saves actual
  incoming messages and a recent feedback window for the agents. Audience
  text is treated as untrusted external data.
- \`approve_and_publish\`: only the specified GitHub owner may run the manual
  \`workflow_dispatch approve-publish\` action with an **existing immutable**
  draft ID. Content hash, prior publication marker, and reply targets are
  verified. Posting is never automatic, including during scheduled runs.
  The X API response must supply a real post ID. Ambiguous sends block retries
  and require manual reconciliation, to avoid duplicates.
- \`XClient\`: official X API v2 user-context bearer token, OAuth refresh via
  the official token endpoint with client ID and optional client secret;
  refreshed credentials are stored in private R2, never in model prompts.
- No third-party purchases, cryptowallet operations, unsolicited DMs, public
  publishing without review, fake social reactions or mass outreach.

### Required connections before production can be marked GREEN

1. **Storage**: connect a private R2 bucket with
   \`TRUTHLAB_R2_ENDPOINT\`, \`TRUTHLAB_R2_BUCKET\`,
   \`TRUTHLAB_R2_ACCESS_KEY_ID\`, \`TRUTHLAB_R2_SECRET_ACCESS_KEY\`
   in GitHub Actions repository Secrets. An existing private Site backend
   needs a separately authorized worker bridge; it is NOT shared implicitly.
2. **X account**: register or connect an authorized X Developer App. Provide
   user-context OAuth 2.0 consent with \`tweet.read tweet.write users.read offline.access\`
   and the appropriately scoped initial user access/refresh credentials
   (\`TRUTHLAB_X_USER_ACCESS_TOKEN\`, \`TRUTHLAB_X_REFRESH_TOKEN\`,
   \`TRUTHLAB_X_CLIENT_ID\`, optional \`TRUTHLAB_X_CLIENT_SECRET\`)
   as GitHub Secrets. No one should post before an operator approves a specific
   draft. API pricing and quotas depend on the X account.
3. **Optional broad search**: \`BRAVE_SEARCH_API_KEY\` secret. Without it,
   research works only with Wikipedia's real public search index.
4. **Start research**: default state in the new R2 journal is **paused**.
   Once both real private R2 credentials and permissions are working, use
   [TruthLab World Interface](https://github.com/jessicacarter9955/SketchbookAI/actions/workflows/truthlab-world.yml)
   > Run workflow > action **enable** as the repository owner; scheduled research
   executes in an isolated GitHub runner. \`pause\` stops future research.
   \`research\`, \`status\`, \`feedback\` and \`approve-publish\` are available
   via manual dispatch. \`approve-publish\` requires the exact draft hash ID.
   The main branch contains the GitHub Actions schedule; the code remains on
   the isolated \`truthlab-autonomous-agents\` branch.

### Certification gates (do not mark green early)

- Real Internet: HTTPS search, fetched source content, URL + SHA256 recorded.
- Real shared storage: write/read/restart, verified against the *same*
  private R2 records the dashboard actually displays.
- Real inference: two Qwen completions with source context and independent
  nonempty outputs; genuine run logs and checkpoints.
- Real X: account authorization confirmed, owner approves one exact immutable
  draft, official \`POST /2/tweets\` returns a real ID and public URL.
- Real audience: official mentions API returns source IDs and reply linkage;
  agents incorporate actual feedback in next cycle, with any reply separately
  approved. Nothing marked green solely due to fakes in unit tests.

No reusable API keys, cookies, public posts or private transcripts are embedded
in the public GitHub repository.
