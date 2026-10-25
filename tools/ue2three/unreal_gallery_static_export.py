"""Unreal-side, original-asset static mesh export for Gallery crash recovery.

Run only with the isolated Inspect.uproject and a source-witnessed JSON job.
This program never saves an original Unreal package, alters an authored mesh,
or substitutes generated geometry for a missing asset.
"""

import hashlib
import json
import os
from pathlib import Path

import unreal


def digest_file(path):
    checksum = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def valid_glb(path):
    if not path.is_file() or path.stat().st_size < 28:
        return False
    with path.open('rb') as stream:
        header = stream.read(12)
    import struct
    return (header[:4] == b'glTF' and
            struct.unpack_from('<II', header, 4) == (2, path.stat().st_size))


job_path = Path(os.environ['UE2THREE_GALLERY_STATIC_JOB']).resolve(strict=True)
job = json.loads(job_path.read_text(encoding='utf-8'))
source_project = Path(job['source_project']).resolve(strict=True)
scratch_project = Path(job['scratch_project']).resolve(strict=True)
active = Path(unreal.Paths.convert_relative_path_to_full(unreal.Paths.get_project_file_path())).resolve()
if active != scratch_project or active == source_project or active.parent == source_project.parent:
    raise RuntimeError('Only the isolated, previously verified scratch project may export')
directory = Path(job['output_dir']).resolve()
if directory == source_project.parent or source_project.parent in directory.parents:
    raise RuntimeError('Gallery export output must stay outside the original project')
if not 1 <= len(job['meshes']) <= 8:
    raise RuntimeError('Bounded source mesh list required')
directory.mkdir(parents=True, exist_ok=True)
progress = directory / 'native-mesh-exports.json'


def checkpoint(rows):
    temporary = progress.with_suffix('.tmp')
    temporary.write_text(json.dumps({'schema_version': 1,
                                     'source_project': str(source_project),
                                     'scratch_project': str(scratch_project),
                                     'meshes': rows}, indent=2), encoding='utf-8')
    os.replace(temporary, progress)


material_mode = job.get('material_mode', 'original_material_bake')
if material_mode not in ('original_material_bake', 'geometry_only_no_bake'):
    raise RuntimeError('Unknown original glTF material export mode')
options = unreal.GLTFExportOptions()
options.set_editor_property('export_uniform_scale', 0.01)
# The geometry-only fallback avoids shader/texture baking hangs. Its material
# fidelity is explicitly NOT certified; original material graphs remain separate.
options.set_editor_property('bake_material_inputs',
                            unreal.GLTFMaterialBakeMode.DISABLED if material_mode == 'geometry_only_no_bake'
                            else unreal.GLTFMaterialBakeMode.USE_MESH_DATA)
rows = []
for item in job['meshes']:
    package = item['asset']
    filename = item['filename']
    if (not isinstance(package, str) or not package.startswith(('/Game/', '/Engine/')) or
            not isinstance(filename, str) or Path(filename).name != filename or
            not filename.endswith('.glb')):
        raise RuntimeError('Invalid original source asset or output filename')
    target = directory / filename
    row = {'asset': package, 'filename': filename, 'status': 'pending',
           'material_mode': material_mode, 'visual_1to1_certified': False}
    rows.append(row)
    checkpoint(rows)
    try:
        asset = unreal.load_asset(package)
        if not isinstance(asset, unreal.StaticMesh):
            raise RuntimeError('Original StaticMesh failed to load')
        if valid_glb(target):
            row['status'] = 'reused'
        else:
            if target.exists():
                raise RuntimeError('Existing invalid GLB will not be overwritten')
            print('UE2THREE_GALLERY_NATIVE_START ' + package, flush=True)
            messages = unreal.GLTFExporter.export_to_gltf(asset, str(target), options, set())
            if messages is None or getattr(messages, 'errors', None):
                raise RuntimeError('Native GLTFExporter reported errors')
            if not valid_glb(target):
                raise RuntimeError('Native GLTFExporter produced no valid GLB')
            row['status'] = 'exported'
        row['sha256'] = digest_file(target)
        row['bytes'] = target.stat().st_size
        print('UE2THREE_GALLERY_NATIVE_OK ' + filename + ' ' + str(row['bytes']), flush=True)
    except Exception as error:
        row['status'] = 'failed'
        row['error'] = type(error).__name__ + ': ' + str(error)[:350]
        print('UE2THREE_GALLERY_NATIVE_FAIL ' + filename + ' ' + row['error'], flush=True)
    checkpoint(rows)

if any(item['status'] == 'failed' for item in rows):
    raise RuntimeError('Some native source static mesh exports failed; inspect checkpoint')
print('UE2THREE_GALLERY_NATIVE_COMPLETE ' + str(len(rows)), flush=True)
