"""Convert verified original Unreal material graph recovery into source-bound GLSL.

Standalone, repeatable and read-only against the Unreal source tree. Output is
atomic and intentionally kept outside the original project. A successful
run DOES NOT certify Three shader execution, textures or visual 1:1.
"""
import argparse
import json
from pathlib import Path

from core import atomic_json, file_hash, read_json, digest
from material_recovery import verified_materials, MaterialRecoveryError
from material_glsl import compile_graph


class GLSLBatchError(ValueError):
    pass


def lower_verified(report, verified_rows):
    """Validate every recovered original/material hash before translating roots."""
    if not isinstance(report, dict) or report.get('schema_version') != 1:
        raise GLSLBatchError('Expected native material recovery report v1')
    materials = report.get('materials')
    if not isinstance(materials, dict):
        raise GLSLBatchError('Recovered original graphs are missing')
    witnesses = {row['package']: row for row in verified_rows}
    if (set(materials) != set(witnesses)
            or report.get('counts') != {'source': len(witnesses),
                'recovered': len(witnesses), 'blocked': 0, 'pending': 0}):
        raise GLSLBatchError('Recovered material census is incomplete or does not match original inventory')

    translated, blocked, accepted, results, eligible = 0, 0, 0, {}, []
    for package in sorted(witnesses):
        original, entry = witnesses[package], materials[package]
        if (entry.get('status') != 'recovered'
                or entry.get('source_sha256') != original['source_sha256']
                or not isinstance(entry.get('graph'), dict)):
            raise GLSLBatchError('Original source or recovered material witness mismatched: ' + package)
        graph = entry['graph']
        if len(graph.get('nodes', [])) != entry.get('nodes'):
            raise GLSLBatchError('Graph node census mismatch: ' + package)
        if graph.get('connection_count') != entry.get('connections'):
            raise GLSLBatchError('Graph connection census mismatch: ' + package)
        lowered = compile_graph(graph)
        tr, bl = lowered['translated_roots'], lowered['blocked_roots']
        translated += len(tr)
        blocked += len(bl)
        if tr and not bl:
            accepted += 1
            if set(tr).issubset({'BaseColor', 'Roughness', 'Metallic', 'EmissiveColor', 'Opacity'}):
                eligible.append(package)
        results[package] = {'source_sha256': original['source_sha256'], **lowered}
    return {
        'schema_version': 1,
        'source_project': report.get('project'),
        'source_snapshot_hash': report.get('source_snapshot_hash'),
        'source_graph_sha256': digest(report),
        'shader_execution': 'not_integrated',
        'counts': {'materials': len(witnesses), 'translated_roots': translated,
                   'blocked_roots': blocked, 'unblocked_material_graphs': accepted,
                   'pbr_adapter_candidates': len(eligible)},
        'pbr_adapter_candidate_packages': eligible,
        'materials': results,
        'limitations': ['No material-instance or texture bindings, native MaterialFunctions, light parity or Play 1:1',
                        'GLSL snippets are not compiled GPU shader programs until bound and rendered']
    }


def compile_batch(project, workspace, report_file, publish_dir):
    project = Path(project).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    report_file = Path(report_file).resolve(strict=True)
    publish_dir = Path(publish_dir).resolve()
    if (publish_dir == project.parent or project.parent in publish_dir.parents
            or report_file == publish_dir / 'material-glsl-report.json'):
        raise GLSLBatchError('Output must be separate from original Unreal source and recovery input')
    verified_rows, registry = verified_materials(project, workspace)
    report = read_json(report_file)
    if (report.get('project') != str(project)
            or report.get('source_snapshot_hash') != registry['source_snapshot_hash']):
        raise GLSLBatchError('Recovered material graph report belongs to another original project')
    # Every source file must still match the original SHA-256 witness.
    for row in verified_rows:
        if file_hash(row['original']) != row['source_sha256']:
            raise GLSLBatchError('Original Unreal source hash changed: ' + row['package'])
    result = lower_verified(report, verified_rows)
    result['compiler_sha256'] = file_hash(Path(__file__).with_name('material_glsl.py'))
    result['original_recovery_report_sha256'] = file_hash(report_file)
    publish_dir.mkdir(parents=True, exist_ok=True)
    atomic_json(publish_dir / 'material-glsl-report.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('original_project', type=Path)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--recovered-graphs', type=Path, required=True)
    parser.add_argument('--publish-dir', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = compile_batch(args.original_project, args.workspace,
                               args.recovered_graphs, args.publish_dir)
    except (GLSLBatchError, MaterialRecoveryError) as exc:
        parser.error(str(exc))
    print(json.dumps(result['counts'], sort_keys=True), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
