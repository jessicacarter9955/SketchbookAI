#!/usr/bin/env python3
"""Run one original Unreal StaticMesh -> GLB export in an isolated scratch project.

No changes to original assets. Prior job supplies the verified scratch source;
creates an output directory only if absent and never overwrites existing
native exports. Unreal shutdown failures do not invalidate independently
verified and hashed GLB payloads.
"""
import argparse
import json
import os
import subprocess
import sys
import hashlib
from pathlib import Path


def file_hash(path):
    hash_value = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            hash_value.update(chunk)
    return hash_value.hexdigest()


def run(old_job_file, engine_file, destination, asset, filename, timeout=540,
        material_mode='original_material_bake'):
    old_job_file = Path(old_job_file).resolve(strict=True)
    engine_file = Path(engine_file).resolve(strict=True)
    output = Path(destination).resolve()
    old = json.loads(old_job_file.read_text(encoding='utf-8-sig'))
    engine = json.loads(engine_file.read_text(encoding='utf-8-sig'))
    source = Path(old['source_project']).resolve(strict=True)
    scratch = Path(old['scratch_project']).resolve(strict=True)
    exe = Path(engine['executable']).resolve(strict=True)
    script = (Path(__file__).parent / 'unreal_gallery_static_export.py').resolve(strict=True)
    if (source == scratch or source.parent == scratch.parent
            or source.parent in output.parents or output == source.parent):
        raise RuntimeError('Original source cannot serve as scratch or export destination')
    if not (asset.startswith(('/Game/', '/Engine/')) and '.' in asset
            and filename == Path(filename).name and filename.endswith('.glb')):
        raise ValueError('Invalid original source StaticMesh identity or output filename')
    if not isinstance(timeout, int) or not 30 <= timeout <= 1200:
        raise ValueError('Invalid bounded Unreal timeout')
    if material_mode not in ('original_material_bake', 'geometry_only_no_bake'):
        raise ValueError('Unknown original material export mode')
    if output.exists():
        raise FileExistsError('Refusing to reuse/overwrite an existing native GLB export directory')
    try:
        import psutil
    except ImportError as exc:
        raise RuntimeError('psutil process-check is required for exclusive Unreal export') from exc
    processes = [p.info for p in psutil.process_iter(['name']) if 'UnrealEditor' in (p.info.get('name') or '')]
    if processes:
        raise RuntimeError(f'Other Unreal processes are running: {len(processes)}')
    output.mkdir(parents=True)
    job_file = output / 'job.json'
    job = {'source_project': str(source), 'scratch_project': str(scratch),
           'output_dir': str(output), 'material_mode': material_mode,
           'meshes': [{'asset': asset, 'filename': filename}]}
    job_file.write_text(json.dumps(job, indent=2), encoding='utf-8')
    cmd = [str(exe), str(scratch), '-run=pythonscript',
           '-script=' + str(script), '-unattended', '-nosplash',
           '-AllowCommandletRendering', '-NoSourceControl',
           '-NoEpicPortal', '-NoAnalytics', '-stdout',
           '-FullStdOutLogOutput', '-abslog=' + str(output / 'unreal.log')]
    env = os.environ.copy()
    env['UE2THREE_GALLERY_STATIC_JOB'] = str(job_file)
    print('UE2THREE_ORIGINAL_STATIC_START', asset, 'SCRATCH', scratch, flush=True)
    with (output / 'process-stdout.log').open('wb') as handle:
        try:
            completed = subprocess.run(cmd, cwd=scratch.parent, env=env,
                                       stdout=handle, stderr=subprocess.STDOUT,
                                       timeout=timeout, check=False)
        except subprocess.TimeoutExpired as exc:
            print('UE2THREE_ORIGINAL_STATIC_TIMEOUT', timeout, flush=True)
            raise RuntimeError('Unreal timed out; preserve outputs for offline audit') from exc
    progress_file = output / 'native-mesh-exports.json'
    progress = json.loads(progress_file.read_text(encoding='utf-8-sig')) if progress_file.exists() else {}
    rows = progress.get('meshes', [])
    target = output / filename
    valid = (len(rows) == 1 and rows[0].get('asset') == asset
             and rows[0].get('status') in ('exported', 'reused')
             and rows[0].get('sha256') == file_hash(target)
             and rows[0].get('bytes') == target.stat().st_size)
    print('UE2THREE_ORIGINAL_STATIC_RESULT', json.dumps({
        'exit_code': completed.returncode, 'source': asset,
        'verified_glb': valid, 'file': str(target) if valid else None,
        'sha256': file_hash(target) if valid else None,
        'bytes': target.stat().st_size if valid else None,
        'progress': rows}), flush=True)
    if not valid:
        text = (output / 'process-stdout.log').read_text(encoding='utf-8', errors='replace')
        print('UNREAL_LOG_TAIL', text[-2000:], flush=True)
        raise RuntimeError('Original static GLB did not pass export progress and SHA checks')
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--previous-job', required=True, type=Path)
    parser.add_argument('--engine', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--asset', required=True)
    parser.add_argument('--filename', required=True)
    parser.add_argument('--timeout', type=int, default=540)
    parser.add_argument('--material-mode', choices=['original_material_bake','geometry_only_no_bake'],
                        default='original_material_bake')
    args = parser.parse_args()
    run(args.previous_job, args.engine, args.output, args.asset, args.filename,
        args.timeout, args.material_mode)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, FileNotFoundError, OSError, KeyError, TypeError, ValueError) as err:
        print('UE2THREE_ORIGINAL_STATIC_ERROR', type(err).__name__, str(err), file=sys.stderr)
        raise SystemExit(2)
