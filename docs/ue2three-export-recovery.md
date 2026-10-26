# Export retries and recovered source assemblies

The asset supervisor delegates character and map conversion to `ue2three`.
It never changes the original project. Output counters describe verified GLB
files, not completed gameplay or visual parity.

## Durable retry checkpoint

`dds_asset_export.py --once` and `--loop` retain per-lane retry state in
`STATE_DIR/retry.json`. Restarting the process does not reset the delay.
Unchanged partial results wait 300, 600, 1,200, 2,400 and then at most 3,600
seconds by default. The interval and cap are configurable.

Deferred ticks preserve the last verified output hashes, counts and issues.
They compare output size and modification time against the verified proof;
they do not hash every large GLB again. A changed output, source snapshot,
known source file's metadata, exporter implementation, recipe or engine
invalidates the wait on the next tick. Full source verification remains the
conversion CLI's responsibility. The supervisor stats only files already
listed by the verified snapshot and does not search the PC for new files.

Useful fields in `progress.json`:

- `jobs[].attempts`: actual subprocess launches, rather than scheduler ticks.
- `jobs[].retry_deferred`: this tick preserved outputs without launching Unreal.
- `jobs[].next_retry_at`: Unix timestamp; zero for a completed cached lane.
- `jobs[].skipped_duplicate_launches`: count of deferred launches for that lane.

A regression fixture creates 20 independent supervisors at two-minute intervals.
It retains the same verified output on every tick and launches four conversions
instead of 20. This measures retry suppression, not DDS conversion throughput.

## Publish an existing partial assembly

`recovered_maps.py` accepts explicit paths; it performs no Unreal launch or scan:

```text
python tools/ue2three/recovered_maps.py --project ORIGINAL.uproject --workspace VERIFIED_WORKSPACE --source-manifest ASSEMBLY.source.json --audit AUDIT.json --diagnosis DIAGNOSIS.json --publish-dir PUBLISHED_PROJECT
```

The neighboring `ASSEMBLY.glb`, the source manifest, actor audit and completed
diagnosis must match their SHA-256 witnesses. The original `.umap` must still
match the verified snapshot. The tool checks GLB mesh/material/texture counts.

Two snapshot hash contracts are deliberately kept separate:

- `verified_workspace_snapshot_hash`: digest of the full snapshot object,
  matching `state.json.snapshot_hash` and assembly witnesses.
- `verified_source_files_hash`: digest of `snapshot.files`, matching Asset Registry
  metadata. Different values do not by themselves indicate different scans.

The tool publishes a content-addressed directory under `recovered-maps/` and
adds `recovered-map-catalog.json`. Existing verified files are reused. On the
same volume the payloads use hardlinks; a copy is used if hardlinks are unavailable.

The canonical `dds-assets/maps/map-manifest.json` is untouched. Recovered assemblies
are excluded from certified map export totals, even when every original actor
is represented. `complete_level`, `play_verified`, `visual_1to1_verified`,
`physics_verified` and `niagara_verified` remain false.

Manual testing should separately check visible geometry, original material
appearance, navigation/collision, effects, sound, interaction and behavior.
A static assembly preview does not certify those systems.
