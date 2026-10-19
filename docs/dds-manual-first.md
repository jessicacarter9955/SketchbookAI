# DDS · manual playtest BEFORE automated regression suites

## Baseline and isolation

Source branch: `chatgpt/ue2three-dds`; immutable baseline commit
`1cf9cbfde8df5a42b7026beab488bcb841112231`.
This work is on `codex/dds-parallel-manual-first` only.
No DDS source assets, incomplete Google Drive folders, personal credentials, 
or converted GLBs are invented or committed.

## New order of operations

1. Finish a small visible feature and publish a browser preview via the existing
   Netlify deployment process (build is required; this is **not** a test suite).
2. User opens `dds-manual-playtest.html` and launches available scene links,
   tries mechanics, and copies/downloads its manual feedback JSON.
3. If something is missing, user marks **Blocked** or **Needs fixes**; fix the
   indicated area and deploy a newer preview. **Do not** auto-run all suites yet.
4. User explicitly confirms **Approved** for one exact deployed commit SHA.
5. Trigger `.github/workflows/ue2three-parallel-after-manual.yml` for the 
   same revision. Its eight jobs run independently (max four simultaneous runners)
   and upload scoped JSON test reports.
6. A green job is only a proof of its **existing unit and fixture checks**, not a
   playable DDS Unreal system. Retest important fixes manually in the browser.

### Branch/workflow limitations

- The older `ue2three-ci.yml` only has a push trigger for the original Codex DDS
  branch. This new preview branch is excluded from that push trigger.
- GitHub Actions `workflow_dispatch` visibility may require the workflow to
  exist on the repository's default branch. Do not claim it is dispatchable
  until available. A pull request can use the `manual-qa-approved` label
  after the user has approved; do not label one before actual user feedback.
- Netlify currently builds and deploys on every branch push; building a preview
  is necessary, and **does not run unit tests**. Do not represent a successful
  build as passing the gameplay tests.
- Some original DDS exports only exist in ignored local directories. The QA
  page preflights these and displays a clear missing-asset status rather than
  pretending the mannequin is playable.
- This DDS baseline lacks the newer Realistic City world from
  `codex/ue2three-realistic-districts`. Integrating that city is a separate,
  source-aware merge task. Do not claim the QA page is already Realistic City.

## Parallel areas and scoped verifiers

`python tools/ue2three/dds_parallel_lanes.py --lane <name> --report result.json`

Eight jobs cover: character-weapons, animations, blueprints-inventory,
maps-materials, shop-dialogues, physics-fx-audio, multiplayer and lighting.
The multiplayer job tests **local object/Blueprint state contracts**, not
networking. Source actor lifecycle, original sessions, RPC transport, material
fidelity, Unreal physics and MetaHuman binary content remain pending.

## Publishing a manual QA link

After the branch deployment reports success, visit:

`https://<verified-netlify-deploy>/dds-manual-playtest.html?revision=<deployed-commit-sha>`

The revision SHA must be from the same deploy. Record the user's feedback
before opening a PR or starting parallel CI. Never invent a successful preview.
