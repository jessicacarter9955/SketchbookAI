# TruthLab — Multichannel Social (no Render, no fabricated posts)

This extension is separate from the historical *fictional Backrooms* experiment.
The original 100–500 turn Qwen reconstruction is unaffected.

## Actual source files
- `social_hub.py`: provider-specific official API dispatch, immutable per-network
  approval, real receipts, strict no-retry after ambiguous responses.
- `social_cli.py`: private command-line runner (uses only R2-stored draft IDs,
  never inline private content in a public GitHub workflow).
- `world_interface.py`: genuine web research by Ari and independent Noor
  verification; automatically queues **text-only** drafts for X, Threads,
  Facebook Pages, and optionally a specifically selected Reddit community.
- `.github/workflows/truthlab-world.yml` (on default branch `main`):
  periodic research and human-only `social-publish` dispatch.

## Official networks and required account connection

| Network | Official publication path | Required private settings | Honest completion condition |
| --- | --- | --- | --- |
| X | `POST api.x.com/2/tweets` | X OAuth user access/refresh/client | API returns ID |
| Facebook Pages | `POST graph.facebook.com/{page}/feed` | `TRUTHLAB_FB_PAGE_ID`, `TRUTHLAB_FB_PAGE_TOKEN` with Page role and `pages_manage_posts` | Page post ID |
| Threads | `POST graph.threads.net/{id}/threads`, then `threads_publish` | `TRUTHLAB_THREADS_USER_ID`, `TRUTHLAB_THREADS_ACCESS_TOKEN`, `TRUTHLAB_THREADS_USERNAME`; `threads_basic`, `threads_content_publish` | Published thread ID |
| Instagram | `POST {ig-user}/media` and `media_publish` | `TRUTHLAB_IG_USER_ID`, `TRUTHLAB_IG_ACCESS_TOKEN`; professional account and public media URL | Published IG media ID |
| Reddit | OAuth `POST oauth.reddit.com/api/submit` | `TRUTHLAB_REDDIT_USER_TOKEN`, `TRUTHLAB_REDDIT_USERNAME`; exact subreddit approved by operator | `t3_...` submission ID |
| TikTok | Official Content Posting API `video/init` or `content/init`; then `status/fetch` | `TRUTHLAB_TIKTOK_USER_TOKEN`; `video.publish` scope, verified media URL/domain and TikTok app audit for PUBLIC posting | `PUBLISH_COMPLETE` status, public visibility only with public post IDs |
| YouTube | Data API `videos.insert` resumable upload of a REAL video from private R2 | `TRUTHLAB_YOUTUBE_ACCESS_TOKEN` with `youtube.upload`; real `media_key` | Video ID returned by API |
| Snapchat | Public Profile API `/stories` or `/spotlights` | `TRUTHLAB_SNAP_PUBLIC_PROFILE_ID`, `TRUTHLAB_SNAP_USER_TOKEN`; Snap allowlist and previously encrypted/uploaded `media_id` | Spotlights: ID; Stories may require separate reconciliation after request ID |

The social module does not produce images or videos on its own and does not
fabricate them. Instagram/TikTok/YouTube/Snapchat therefore need **real media**
first. Snapchat media encryption and multipart upload are NOT implemented in
the current module. This is an explicit remaining blocker, not a green feature.
No provider OAuth application/account is connected merely by committing code.

## Operator gates and confidentiality

- All social content lives in R2 keys under `truthlab-world/v1/`.
  Every post must be queued with source-linked research, its immutable ID and
  an exact platform target. No scheduled job ever publishes automatically.
- GitHub workflow dispatch `social-publish` requires the configured
  `TRUTHLAB_APPROVER_GITHUB_LOGIN` actor and an existing exact draft ID.
- A `sending` checkpoint is saved BEFORE the external request; if an API
  call times out, publishing is blocked until reconciliation, avoiding
  accidental duplicate posts. Receipts are kept only if returned by a real API.
- TikTok `processing` is not misrepresented as a public post; the dedicated
  status action reconciles it.
- **Critical storage boundary:** this GitHub worker's BYO-R2/S3 bucket is NOT
  automatically the same R2 namespace as the existing private ChatGPT Site
  `truthlab-pair-permanent.dvd2pe.chatgpt.site`. It must be connected by
  authorized storage integration. The existing Site's 100 real Qwen turns,
  100 memories and 25 archives are not automatically copied by this code.
- The repository is PUBLIC; NEVER put API tokens, private transcript bodies,
  OAuth codes, or social post text into code, Actions input, commit messages,
  or logs. Configuration is via GitHub Actions Secrets/Variables.
- Platform account reviews, TikTok app audit, Snap allowlisting, Media APIs,
  operational rate limits and terms of service remain hard requirements.

## Validation

`python -m unittest discover -s truthlab-live -p 'test_*.py' -v`

Test doubles are used ONLY for CI's authorization and response handling tests;
no test fixture is ever passed to production as "published content". Separate
live authenticated account round trips are mandatory before a provider may be
reported green.

### Official documentation
- https://developers.facebook.com/docs/pages-api/posts
- https://developers.facebook.com/docs/threads
- https://developers.facebook.com/docs/instagram-platform/content-publishing
- https://developers.tiktok.com/docs/en/content-posting-api-get-started
- https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki
- https://developers.snap.com/api/marketing-api/Public-Profile-API/Introduction
