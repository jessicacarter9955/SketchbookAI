# Accelerating the original game migration · 2026-10-14

The largest opportunity is extending the reusable Blueprint runtime by shared
capability. Converting source game functions individually would duplicate work.
DDS remains the test project, and successful primitive tests do not establish
complete game fidelity.

## Measured local scope

The current cache has 13 parsed Blueprint/widget packages, about 167 MiB of raw
JSON, 38 translated functions and 462 blocked functions. Parsing that JSON alone
took 1.787 seconds in one local observation. Translation semantics and native
runtime dependencies are the current engineering bottleneck.

| Shared capability | First blocker | Functions involving it |
|---|---:|---:|
| Event dispatch and persistent frames | 173 | 243 |
| Object references / Context calls | 69 | 146 |
| Structs and containers | 23 | 84 |

232 blocked functions call shared ExecuteUbergraph entry points. This is about
50% of the blocked functions in the parsed subset. Candidate counts overlap,
and removing one blocker can expose another. These are neither guaranteed unlock
counts nor a percentage of the complete game. Another 263 packages are uncached.

## Best next operations

1. Translate reachable event paths while preserving the original persistent
   frame and Kismet offsets. Use UAssetAPI Visit implementations as the layout
   reference. A native operation in an unrelated event should not block an
   otherwise supported entry. Unknown reachable effects must still block it.
2. Build one typed object/native adapter registry. Prioritize the actual source
   dependencies of CanFire: component lookup, object validity and game time.
   Keep exact engine/class identity and explicit missing dependencies.
3. Implement struct/container semantics as a separate module. This supports
   inventory, weapon data and UI bindings without recreating their game rules.
4. Read only missing packages reached from the selected playable scene and its
   dependencies. Keep source checksums, converted outputs and verification caches.
5. Reuse equivalent meshes/textures across maps by identity/checksum. Keep the
   full source quality; geometry reduction and lossy texture shortcuts would
   conflict with the 1:1 target.

UAssetAPI is the public .NET asset reader used by the existing extraction path:
https://github.com/atenfyr/UAssetAPI
It supplies asset/bytecode access, rather than a complete browser game runtime.

## Work that can be handed to separate GLM / ChatGPT chats

The tool creates three standalone Markdown packets with bounded complete source
examples, relevant properties/imports, hashes, scope and acceptance requirements:

- `work-packets/events.md`: event entry dispatch and persistent memory.
- `work-packets/objects.md`: references, Context, nulls and component calls.
- `work-packets/data.md`: source structs and containers.

Assign one packet per chat. Ask for a separate reusable module, its IR contract,
integration points and independently explained test fixtures. Bring the returned
files here for integration and local/browser verification. Avoid several chats
editing the same compiler/interpreter dispatcher concurrently. No packets are
uploaded automatically and no paid API is configured.

Three workers can theoretically reduce calendar time by 40% if 60% of the work
is independent: speedup = 1 / (0.4 + 0.6 / 3) = 1.67. This is a planning scenario,
not a measured prediction for DDS. Review, integration and new dependencies reduce
the gain; we need completed module measurements before estimating the full clone.

## Optimizations already implemented

The cached blocker planner regenerates only when program/compiler inputs or its
outputs change. One local comparison measured 5.660 seconds for a fresh plan and
0.532 seconds for cache reuse: 90.6% less time for this planning step. This figure
does not apply to the whole migration. The three packets total about 85 KB instead
of requiring the raw 167 MiB cache as each chat's starting input; they contain
selected examples, not the entire project.

The plan is generated automatically by migrate-blueprints and can be refreshed
by plan-blueprints. Its output is blueprint-plan.html next to progress.html.

## External machines

Another Windows machine is useful for future expensive engine exports/bakes and
can return checksummed outputs to the same cache. A VPS or notebook can run pure
asset validation, hashing and independent module tests. Their value depends on
measured jobs and transfer time. A GPU notebook would have little effect on the
current 1.8-second JSON parse or the missing Blueprint/native semantics.

For now, the best parallel resource is independent work on the three runtime
modules. Keep the current laptop as the integration and visual verification site.
