# DDS original Unreal → Three.js — source-witnessed checkpoint (2026-10-25)

Scope: `jessicacarter9955/SketchbookAI`, branch `chatgpt/ue2three-dds`, original `VIPExtractionKitDDS`. This document records **verified extraction/compiler outputs**, not full runtime or Play 1:1 parity. Green for a player feature requires working Three.js behavior, not an exported file alone.

## Newly verified (2026-10-25)

| Subsystem | Previously certified | New evidence | Interpretation |
| --- | ---: | ---: | --- |
| Original material graph recovery | 5 trial graphs; full batch unconfirmed | **182/182 recovered, 0 blocked, 0 pending** | **Graph extraction green**, **Three.js shader execution not certified** |
| Material graph topology | Not certified | **6,764 nodes, 6,228 connections** across 182 graphs | Local report validated against all 182 original inventory source hashes; no missing source or hash mismatches |
| Blueprint compiler | 436/1,957 translated; 1,521 blocked | **440/1,957 translated; 1,517 blocked** | Clean replay from branch commit `310a028a200b0a82c559d21ce5f7d1327a416098`; 276 source packages matched prior report, 0 missing cached packages; 21.7 s |
| Original inventory | 4,617 registry assets | Registry **4,617**, inventoried entries **4,651**, inventory files **4,662** | Different inventories, **not** a +34 conversion claim; complete registry and source verification confirmed |
| Witnessed material GLSL batch | 0 complete source batch | **714 translated roots, 2,052 blocked roots; 5 fully lowered graphs; 3 Three PBR adapter candidates** across the 182 recovered originals | Local source-bound compiler completed with exit 0; `shader_execution: not_integrated`, no texture/lighting/Play 1:1 acceptance |

The four additional translated Blueprint functions are localized to two original packages: `/Game/Blueprints/AC_PreCMCTick` (+1) and `/Game/Fixers/Core/Blueprints/Characters/CBP_Fixers_Mover_ABP` (+3). Package source witnesses matched across 436 and 440 reports. A fresh, isolated Git worktree at branch head reproduced **440 translated / 1,517 blocked**, without changing existing user worktrees or Unreal originals. This is compiler-level evidence, **not** full gameplay execution.

The material report at `material-graph-recovery-20261024/material-graphs.json` was found in the local verified workspace and validated: all 182 entries recovered, all matched the inventoried original source SHA-256, zero missing sources, zero mismatched hashes, zero missing graph objects. This establishes **native graph connectivity recovery only**; Material Instances, functions, shader translation, textures, lighting and visual 1:1 still require separate work.

The source-bound GLSL report was executed against all **182 original material graphs**, with original source hashes and graph topology checked. Of 2,052 blocked roots, **1,731** require separate vertex/lighting support; common remaining reachable node blockers include native MaterialFunctionCall (65), TextureSample (56), ParticleColor (43), TextureSampleParameter2D (27), and EyeAdaptationInverse (23). These are blocked rather than approximated. The source-bound Three PBR adapter is opt-in and covered by regression tests, but runtime visual parity is not certified.

## Bridge and CI

- Private bridge issue #2: **RESTORED at 2026-10-25 13:19 UTC** using a separate non-destructive local sidecar, with an authenticated ping response and a `job_start` → `job_tail` Python verification finishing exit 0. Workspaces `main`, `dds`, `migrator` available. Sidecar PID 23436 observed running; `ChatLocalBridgeIssue2` Windows logon task created successfully, but **reboot recovery has not been tested**. Original bridge #1 configuration and original user files were not changed. Old issue #2 commands were pre-marked as superseded to avoid replay of a `git restore` command that could overwrite user edits. The old queued material job ID was not found in the new relay; it was **not** restarted because independent source reports already certify all 182 recovered graphs.
- Private bridge issue #1 remains functional as a separate original process; it supplied the isolated original material and Blueprint reports without altering the Unreal source.
- The older sample material job returned exit code 3 because it was intentionally limited to 10/182, leaving 172 pending *at that earlier checkpoint*. It does not contradict the later verified 182/182 report.
- Latest CI at SHA `df011608c06f11d8c27312c85bad0c1441b598d3`: [40195017433](https://github.com/jessicacarter9955/SketchbookAI/actions/runs/40195017433), **4/4 jobs successful**, 345 Python + 140 JavaScript tests (485 total) and editor/player build successful. A separate local original-source GLSL batch test run passed 5/5.
- Latest Netlify deployment [40195017432](https://github.com/jessicacarter9955/SketchbookAI/actions/runs/40195017432) **failed after successful build**: `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` were empty, so deployment was not attempted. Build success does not imply deployment.
- **No original Play 1:1 validation** has been certified.

## Player-facing feature traffic lights

| Feature | State | Certified evidence / remaining gap |
| --- | --- | --- |
| Maps | 🟡 | 8/10 original GLB maps; runtime parity unverified |
| Character | 🟡 | Original exports present; full player integration unverified |
| Weapons | 🟡 | Original exports present; equip/combat parity unverified |
| Animations | 🟡 | Original clips exported; state transitions and Play unverified |
| Materials | 🟡 | **182/182 native graphs recovered**; **714 GLSL roots translated / 2,052 blocked**, 5 fully lowered graphs, 3 PBR adapter candidates; shader execution and visual parity unverified |
| Lighting | 🔴 | Original lighting parity not certified |
| Audio | 🟡 | **481/481 original SoundWave WAV**; in-game timing/routing unverified |
| HUD/UI | 🟡 | 8 widgets inventoried, 1 hierarchy; full runtime UI unverified |
| Inventory | 🟡 | Original gameplay logic incomplete |
| Blueprint | 🔴 | **440/1,957 translated; 1,517 blocked**; full runtime integration missing |
| Niagara | 🟡 | 109 original sources inventoried; runtime effects not certified |
| Collisions/physics | 🟡 | Full source behavior not Play-certified |
| Original gameplay 1:1 | 🔴 | Integration and manual Play acceptance missing |

## Next conversion gates

1. Extend source-witnessed material lowering beyond the 714 supported roots, starting with original texture/function/particle bindings and separate vertex/lighting semantics; integrate and compare actual rendered Three.js shaders with Unreal.
2. Complete the 2 missing map GLBs and 17 missing Gallery entries without substituting unrelated geometry.
3. Continue source-matched Blueprint migration from 440 while preventing regressions; connect the translated programs to real character, weapons, UI and inventory runtime.
4. Complete Niagara/UI/physics integrations and validate manual Play 1:1; fix deploy credentials without exposing secrets.

**Evidence categories:** extraction and compiler reports = verified; local clean replay and material GLSL batch = executed; CI build/tests = successful at cited SHA; local issue #2 sidecar = ping + job verified, logon recovery not yet tested; this checkpoint file = documentation only; deploy and original Three.js Play 1:1 = **not verified**.
