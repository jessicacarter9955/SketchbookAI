"""Offline, source-bounded corrections and explicit material fallback diagnostics.

Uses the same cached UAssetAPI reader as UI migration. Never launches Unreal.
Only constant, almost-flat landscapes with invalid exported spikes are repaired.
Parameter tints are a reported fallback, not a translation of a shader graph.
"""
import copy
import json
import math
import os
import struct
from pathlib import Path

from core import atomic_json, file_hash, read_json
from umg_migration import _asset_document, _properties, _value


def _unwrap(value):
    while isinstance(value, dict) and len(value) == 1:
        value = next(iter(value.values()))
    return value


def _color(value):
    value = _unwrap(value)
    if isinstance(value, dict) and all(k in value for k in ('R', 'G', 'B')):
        result = [float(value[k]) for k in ('R', 'G', 'B')] + [float(value.get('A', 1))]
        if all(math.isfinite(v) and v >= 0 for v in result):
            return result
    return None


def _reference(package, reference):
    if not isinstance(reference, int) or reference == 0:
        return None
    objects = package.exports if reference > 0 else package.imports
    index = reference - 1 if reference > 0 else -reference - 1
    if index >= len(objects):
        return None
    obj = objects[index]
    name = obj.get('ObjectName', '')
    if name.startswith('/'):
        return name
    outer = _reference(package, obj.get('OuterIndex', 0))
    return outer + '.' + name if outer else name


def source_scene(project, map_package, workspace):
    project, workspace = Path(project).resolve(), Path(workspace).resolve()
    if not map_package.startswith('/Game/'):
        raise ValueError('Offline scene inspection currently supports /Game map packages')
    source = project.parent / 'Content' / (map_package[6:] + '.umap')
    if project.parent not in source.resolve().parents:
        raise ValueError('Map package escapes source project')
    tool = workspace / 'tool-cache' / 'UAssetGUI-1.1.0.exe'
    # This stage reuses the installed parser; it never installs or downloads one.
    if not tool.is_file():
        raise ValueError('Cached UAssetAPI reader is unavailable; source corrections skipped')
    from umg_migration import UASSETGUI_SHA256
    if file_hash(tool) != UASSETGUI_SHA256:
        raise ValueError('Cached UAssetAPI reader checksum mismatch')
    engine = read_json(workspace / 'artifacts' / 'engine.json')
    version = str(engine.get('version', '')).split('-')[0]
    cache = workspace / 'artifacts' / 'uasset-json'
    package, sha = _asset_document(map_package, source, tool, cache, version)
    material_cache = {}
    source_hashes = {str(source): sha}

    def parameters(pkg, export, ancestry=()):
        props = pkg.props(export)
        parent = props.get('Parent')
        values = {}
        parent_path = _reference(pkg, parent)
        if isinstance(parent, int) and parent > 0:
            parent_export = pkg.export(parent)
            if parent_export and parent_export is not export:
                values.update(parameters(pkg, parent_export, ancestry))
        elif parent_path and parent_path.startswith('/Game/'):
            name = parent_path.split('.', 1)[0]
            if name not in ancestry:
                parent_file = project.parent / 'Content' / (name[6:] + '.uasset')
                if project.parent in parent_file.resolve().parents and parent_file.is_file():
                    if name not in material_cache:
                        material_cache[name] = _asset_document(name, parent_file, tool, cache, version)
                    parent_pkg, parent_sha = material_cache[name]
                    source_hashes[str(parent_file)] = parent_sha
                    root = next((e for e in parent_pkg.exports if parent_pkg.class_name(e) in ('Material', 'MaterialInstanceConstant')), None)
                    if root:
                        values.update(parameters(parent_pkg, root, ancestry + (name,)))
        if pkg.class_name(export) == 'Material':
            for expression in pkg.exports:
                kind = pkg.class_name(expression)
                if kind not in ('MaterialExpressionVectorParameter', 'MaterialExpressionScalarParameter'):
                    continue
                p = pkg.props(expression)
                value = _color(p.get('DefaultValue')) if kind.endswith('VectorParameter') else p.get('DefaultValue')
                if p.get('ParameterName') and value is not None:
                    values[p['ParameterName']] = value
        for row in props.get('VectorParameterValues', []):
            info = row.get('ParameterInfo', {})
            value = _color(row.get('ParameterValue'))
            if info.get('Name') and value:
                values[info['Name']] = value
        for row in props.get('ScalarParameterValues', []):
            info = row.get('ParameterInfo', {})
            if info.get('Name'):
                values[info['Name']] = float(row.get('ParameterValue', 0))
        return values

    landscapes, materials = {}, {}
    for export in package.exports:
        kind, props = package.class_name(export), package.props(export)
        if kind == 'LandscapeComponent':
            bounds = _unwrap(props.get('CachedLocalBox'))
            if isinstance(bounds, dict) and bounds.get('IsValid'):
                landscapes[export['ObjectName']] = {'min': float(bounds['Min']['Z']) * 0.01,
                                                   'max': float(bounds['Max']['Z']) * 0.01}
        if kind not in ('MaterialInstanceDynamic', 'MaterialInstanceConstant'):
            continue
        values = parameters(package, export)
        # Recognition requires the authored parameter contract, not an asset filename.
        if not all(key in values for key in ('Surface Color', 'Grid Color', 'Grid 1 Size', 'Grid 2 Size', 'Grid 3 Size')):
            continue
        owner = package.export(export.get('OuterIndex'))
        actor = package.export(owner.get('OuterIndex')) if owner else None
        actor_label = package.props(actor).get('ActorLabel') if actor else None
        key = actor_label or export['ObjectName']
        materials[key] = {'name': export['ObjectName'], 'actor': actor_label, 'parameters': values,
                          'parent': _reference(package, props.get('Parent'))}
    return {'schema_version': 1, 'project': str(project), 'map': map_package,
            'source_sha256': sha, 'source_hashes': source_hashes, 'landscapes': landscapes,
            'grid_materials': materials}


def _read_glb(path):
    raw = Path(path).read_bytes()
    if len(raw) < 28 or struct.unpack_from('<4sII', raw) != (b'glTF', 2, len(raw)):
        raise ValueError('Invalid GLB header')
    length, kind = struct.unpack_from('<II', raw, 12)
    if kind != 0x4e4f534a:
        raise ValueError('GLB has no JSON chunk')
    document = json.loads(raw[20:20 + length])
    bin_length, bin_kind = struct.unpack_from('<II', raw, 20 + length)
    if bin_kind != 0x004e4942 or 28 + length + bin_length != len(raw):
        raise ValueError('Unsupported GLB binary layout')
    return document, bytearray(raw[28 + length:])


def _accessor(document, blob, index):
    accessor = document['accessors'][index]
    if accessor.get('componentType') != 5126 or accessor.get('type') != 'VEC3' or 'sparse' in accessor:
        raise ValueError('Repair requires an ordinary FLOAT VEC3 accessor')
    view = document['bufferViews'][accessor['bufferView']]
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', 12)
    count = accessor['count']
    if view.get('buffer', 0) != 0 or start + (count - 1) * stride + 12 > len(blob):
        raise ValueError('Invalid GLB accessor range')
    return accessor, start, stride, [struct.unpack_from('<fff', blob, start + i * stride) for i in range(count)]


def fixup_map(path, source, restore_tints=True):
    path = Path(path)
    document, blob = _read_glb(path)
    report = {'landscapes': [], 'material_fallbacks': [], 'warnings': [], 'source_sha256': source['source_sha256']}
    for mesh in document.get('meshes', []):
        bounds = source.get('landscapes', {}).get(mesh.get('name'))
        if not bounds:
            continue
        for primitive in mesh['primitives']:
            accessor, start, stride, points = _accessor(document, blob, primitive['attributes']['POSITION'])
            valid = [p[1] for p in points if bounds['min'] - 1e-5 <= p[1] <= bounds['max'] + 1e-5]
            invalid = [i for i, p in enumerate(points) if not bounds['min'] - 1e-5 <= p[1] <= bounds['max'] + 1e-5]
            if not invalid:
                continue
            # Refuse reconstruction of non-flat terrain or predominantly missing data.
            if (bounds['max'] - bounds['min'] > 0.021 or len(valid) < len(points) * 0.75 or
                    max(valid) - min(valid) > 1e-6):
                report['warnings'].append(f"{mesh['name']}: invalid heights; non-flat or insufficient source data, repair refused")
                continue
            height = valid[0]
            for i in invalid:
                struct.pack_into('<f', blob, start + i * stride + 4, height)
            accessor['min'][1] = accessor['max'][1] = height
            if 'NORMAL' in primitive['attributes']:
                normal, nstart, nstride, normals = _accessor(document, blob, primitive['attributes']['NORMAL'])
                for i in range(len(normals)):
                    struct.pack_into('<fff', blob, nstart + i * nstride, 0, 1, 0)
                normal['min'], normal['max'] = [0, 1, 0], [0, 1, 0]
            report['landscapes'].append({'component': mesh['name'], 'repaired_vertices': len(invalid),
                                          'local_height': height, 'source_bounds': bounds})
    # Apply per-actor tints by cloning material/mesh definitions, preserving instances.
    if restore_tints:
        def visit(index, actor=None):
            node = document['nodes'][index]
            actor = node.get('name') if node.get('name') in source.get('grid_materials', {}) else actor
            assignment = source.get('grid_materials', {}).get(actor)
            if assignment and 'mesh' in node:
                mesh = copy.deepcopy(document['meshes'][node['mesh']])
                changed = False
                for prim in mesh['primitives']:
                    if 'material' not in prim:
                        continue
                    material = copy.deepcopy(document['materials'][prim['material']])
                    # Only the matching assigned MID; leave other slots intact.
                    name = material.get('name', '')
                    parent_name = (assignment.get('parent') or '').rsplit('.', 1)[-1]
                    if not (name.startswith(assignment['name']) or parent_name and name.startswith(parent_name)):
                        continue
                    color = assignment['parameters']['Surface Color']
                    pbr = material.setdefault('pbrMetallicRoughness', {})
                    factor = pbr.get('baseColorFactor', [1, 1, 1, 1])
                    magenta = factor[:3] == [1, 0, 1]
                    # Preserve successful mesh-dependent bakes: their textures
                    # already include the source tint and world-aligned grids.
                    if 'baseColorTexture' in pbr and not magenta:
                        continue
                    pbr['baseColorFactor'] = color
                    material.setdefault('extras', {})['ue2three'] = {'status': 'parameter_tint_fallback',
                        'source_actor': actor, 'source_material': assignment['parent'],
                        'parameters': assignment['parameters'], 'shader_fidelity': 'not_verified'}
                    prim['material'] = len(document['materials'])
                    document['materials'].append(material)
                    changed = True
                    report['material_fallbacks'].append({'actor': actor, 'material': name, 'color': color})
                if changed:
                    node['mesh'] = len(document['meshes'])
                    document['meshes'].append(mesh)
            for child in node.get('children', []):
                visit(child, actor)
        for scene in document.get('scenes', []):
            for root in scene.get('nodes', []):
                visit(root)
        if report['material_fallbacks']:
            report['warnings'].append('Source parameter tints restored as a fallback. World-aligned grid shaders, top-face colors and texture composition remain unverified.')
    document.setdefault('extras', {})['ue2three_validation'] = report
    encoded = json.dumps(document, separators=(',', ':'), allow_nan=False).encode()
    encoded += b' ' * (-len(encoded) % 4)
    blob += b'\0' * (-len(blob) % 4)
    output = struct.pack('<4sII', b'glTF', 2, 28 + len(encoded) + len(blob))
    output += struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
    output += struct.pack('<II', len(blob), 0x004e4942) + blob
    temp = path.with_suffix('.glb.tmp')
    temp.write_bytes(output)
    os.replace(temp, path)
    return report


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', required=True, type=Path)
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--map-package', required=True)
    parser.add_argument('--model', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    project = args.project.resolve(strict=True)
    output = args.output.resolve()
    if project.parent == output or project.parent in output.parents:
        raise ValueError('Output must stay outside source project')
    # Preserve the prior export for before/after inspection.
    import shutil
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.model, output)
    source = source_scene(project, args.map_package, args.workspace)
    report = fixup_map(output, source)
    atomic_json(output.with_suffix('.source.json'), source)
    atomic_json(output.with_suffix('.validation.json'), report)
    print(json.dumps({'output': str(output), 'landscapes': len(report['landscapes']),
                      'material_fallbacks': len(report['material_fallbacks']), 'warnings': report['warnings']}))
