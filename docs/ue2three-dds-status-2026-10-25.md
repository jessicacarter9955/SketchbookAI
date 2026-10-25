# DDS original Unreal → Three.js — source-witnessed checkpoint (2026-10-25)

Scope: `jessicacarter9955/SketchbookAI`, branch `chatgpt/ue2three-dds`, original `VIPExtractionKitDDS`. This document records **verified extraction/compiler outputs**, not full runtime or Play 1:1 parity. Green for a player feature requires working Three.js behavior, not an exported file alone.

## Newly verified (2026-10-25)

| Subsystem | Previously certified | New evidence | Interpretation |
| --- | ---: | ---: | --- |
| Original material graph recovery | 5 trial graphs; full batch unconfirmed | **182/182 recovered, 0 blocked, 0 pending** | **Graph extraction green**, **Three.js shader execution not certified** |
| Material graph topology | Not certified | **6,764 nodes, 6,228 connections** across 182 graphs | Local report validated against all 182 original inventory source hashes; no missing source or hash mismatches |
| Blueprint compiler | 436/1,957 translated; 1,521 blocked | **440/1,957 translated; 1,517 blocked** | Clean replay from branch commit `310a028a200b0a82c559d21ce5f7d1327a416098`; 276 source packages matched prior report, 0 missing cached packages; 21.7 s |
| Original inventory | 4,617 registry assets | Registry **4,617**, inventoried entries **4,651**, inventory files **4,662** | Different inventories, **not** a +34 conversion claim; complete registry and source verification confirmed |

The four additional translated Blueprint functions are localized to two original packages: `/Game/Blueprints/AC_PreCMCTick` (+1) and `/Game/Fixers/Core/Blueprints/Characters/CBP_Fixers_Mover_ABP` (+3). Package source witnesses matched across 436 and 440 reports. A fresh, isolated Git worktree at branch head reproduced **440 translated / 1,517 blocked**, without changing existing user worktrees or Unreal originals. This is compiler-level evidence, **not** full gameplay execution.

The material report at `material-graph-recovery-20261024/material-graphs.json` was found in the local verified workspace and validated: all 182 entries recovered, all matched the inventoried original source SHA-256, zero missing sources, zero mismatched hashes, zero missing graph objects. This establishes **native graph connectivity recovery only**; Material Instances, functions, shader translation, textures, lighting and visual 1:1 still require separate work.

## Bridge and CI

- Private bridge issue #2: **10 commands, 0 Windows responses** after a fresh 2026-10-25 ping. Its queued full-material command was not acknowledged there.
- Private bridge issue #1: **responded** to a fresh ping at 2026-10-25 12:07 UTC; available workspaces `main`, `dds`, `migrator`. Used only for non-destructive verification and an isolated clean compiler replay.
- The older sample material job returned exit code 3 because it was intentionally limited to 10/182, leaving 172 pending *at that earlier checkpoint*. It does not contradict the later verified 182/182 report.
- Last GitHub Actions migration run before this checkpoint: [40100797329](https://github.com/jessicacarter9955/SketchbookAI/actions/runs/40100797329), **4/4 jobs successful**, 331 Python + 136 JavaScript tests (467 total) and editor/player build successful.
- Last Netlify deploy before this checkpoint: [40100797314](https://github.com/jessicacarter9955/SketchbookAI/actions/runs/40100797314), failed for missing deployment credentials. Build success does not imply deployment.
- **No original Play 1:1 validation** has been certified.

## Player-facing feature traffic lights

| Feature | State | Certified evidence / remaining gap |
| --- | --- | --- |
| Maps | 🟡 | 8/10 original GLB maps; runtime parity unverified |
| Character | 🟡 | Original exports present; full player integration unverified |
| Weapons | 🟡 | Original exports present; equip/combat parity unverified |
| Animations | 🟡 | Original clips exported; state transitions and Play unverified |
| Materials | 🟡 | **182/182 native graphs recovered**; shader execution and visual parity unverified |
| Lighting | 🔴 | Original lighting parity not certified |
| Audio | 🟡 | **481/481 original SoundWave WAV**; in-game timing/routing unverified |
| HUD/UI | 🟡 | 8 widgets inventoried, 1 hierarchy; full runtime UI unverified |
| Inventory | 🟡 | Original gameplay logic incomplete |
| Blueprint | 🔴 | **440/1,957 translated; 1,517 blocked**; full runtime integration missing |
| Niagara | 🟡 | 109 original sources inventoried; runtime effects not certified |
| Collisions/physics | 🟡 | Full source behavior not Play-certified |
| Original gameplay 1:1 | 🔴 | Integration and manual Play acceptance missing |

## Next conversion gates

1. Translate the 182 recovered native material graphs to source-witnessed Three.js materials/shaders and compare original visual output.
2. Complete the 2 missing map GLBs and 17 missing Gallery entries without substituting unrelated geometry.
3. Continue source-matched Blueprint migration from 440 while preventing regressions; connect the translated programs to real character, weapons, UI and inventory runtime.
4. Complete Niagara/UI/physics integrations and validate manual Play 1:1; fix deploy credentials without exposing secrets.

**Evidence categories:** extraction and compiler reports = verified; local clean replay = executed; GitHub Actions build/tests = successful at cited SHA; this checkpoint file = documentation only; original Three.js Play 1:1 = **not verified**.
