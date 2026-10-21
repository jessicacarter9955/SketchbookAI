# DDS porting: 18 independent concurrent workstreams

Baseline: Codex commit `1cf9cbf`; no reimplementation from scratch.
Branch: `codex/dds-parallel-manual-first`.

**User interaction is Play only.** No upload or tooling actions are
required. No unsupported claims of 1:1 Unreal equivalence.

## How the GitHub jobs operate

Workflow `.github/workflows/dds-port-parallel.yml` schedules **18 matrix
jobs** independently on every change to the manifest or runner. Each
produces a source-provenance packet (JSON+Markdown) and a specific next
engineering action. Up to 18 runners can work concurrently, subject to
GitHub account availability. One job's failure does not cancel the others.

The jobs prepare independent work areas; they are **not autonomous coding
agents** and do not magically convert missing Unreal binary content.
Those porting implementations require code changes in their modules.
No new original gameplay/visual tests are run until after the user's Play
feedback, according to the manual-first agreement. The older eight-lane
regression workflow remains manual-approval-gated.

**Inputs:** original Blueprint/asset repo and CodeX source checks. Original
DDS mesh/animation source files are still missing from the connected Drive
folders inspected and GitHub checkout. Unity/Three placeholder characters
are explicitly forbidden as replacements masquerading as original DDS.

Status dashboard: `dds-parallel-status.html` links to the matrix job
run and exposes separate runner/result and fidelity columns.

## Source-adapter work on isolated branch (2026-10-21)

Branch `chatgpt/dds-native-state-20261021` adds strict source-witnessed
`KismetSystemLibrary.IsValid` translation for directly typed source Actor
references (both `EX_CallMath` and `EX_FinalFunction`).
`None` is false, registered standalone source actors are true, and unknown,
foreign, destroyed/unwitnessed or network contexts remain unsupported.
This is **not** a full UE UObject lifecycle conversion.

The browser Blueprint runtime additionally supports versioned, project/source
SHA/SCS-identified checkpoints, with pre-restore validation and explicit
rejection of incompatible source revisions. This does **not** read/write
Unreal SaveGame files, automatically store to disk, or implement replication.
Tests were added for both adapters, but passing unit tests cannot turn
the entire Blueprint or save area green. Manual Play and 1:1 source comparison
remain acceptance gates.

## Traffic light meanings

- Green (feature): original sources AND runtime behavior validated 1:1
  (not yet achieved).
- Yellow: partial code present but parity not verified.
- Red: critically missing source or unimplemented system.
- A green GitHub job means its source/preparation task succeeded, **not**
  a green 1:1 gameplay subsystem.

The independent `tool-verifier` lane is green solely for the source-data
comparison harness supported by Codex's previously reported source cases.
It does not claim a 1:1 playable Unreal game or replace user Play.
