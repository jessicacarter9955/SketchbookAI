"""Convert the user's BeamNG Collada map into local, streamable browser sectors.
No source files are changed. Requires numpy and Pillow, no Blender installation.
"""
import argparse
from pathlib import Path
import json
import re
import shutil
import xml.etree.ElementTree as ET
from collections import defaultdict
import numpy as np
from PIL import Image

NS = {'c': 'http://www.collada.org/2005/11/COLLADASchema'}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path('build/local-scenes/liberty-city'))
    args = parser.parse_args()
    source, out = args.source.resolve(), args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    (out / 'textures').mkdir(exist_ok=True)
    props = []
    for file in (source / 'main').rglob('items.level.json'):
        props.extend(json.loads(line) for line in file.read_text(encoding='utf-8-sig').splitlines() if line.strip())
    spawn_data = [p for p in props if p.get('class') == 'SpawnSphere']
    origin = np.array(next(p['position'] for p in spawn_data if p.get('name') == 'spawn_portland'))
    # BeamNG Z-up -> Three Y-up, preserving a right-handed coordinate system.
    axis = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=np.float64)
    convert = lambda p: (axis @ (np.array(p) - origin)).tolist()
    city = source / 'assets/city'
    texture_files = {p.name.lower(): p for p in city.glob('*') if p.suffix.lower() == '.png'}
    material_overrides = {}
    text = (city / 'materials.cs').read_text(encoding='utf-8-sig')
    for body in re.findall(r'singleton\s+material\([^)]*\)\s*\{(.*?)\};', text, re.S | re.I):
        key = re.search(r'mapTo\s*=\s*"([^"]+)"', body, re.I)
        tex = re.search(r'(?:colorMap|diffuseMap)\[0\]\s*=\s*"([^"]+)"', body, re.I)
        if key and tex:
            material_overrides[key[1].lower()] = tex[1]
    texture_info, missing = {}, set()

    def texture(name):
        name = Path(name.replace('\\', '/')).name
        if not name.lower().endswith('.png'): name += '.png'
        path = texture_files.get(name.lower())
        if not path:
            missing.add(name)
            return None
        key = path.name
        if key not in texture_info:
            with Image.open(path) as image:
                alpha = 'A' in image.getbands() and image.getchannel('A').getextrema()[0] < 250
            shutil.copy2(path, out / 'textures' / key)
            texture_info[key] = {'alpha': bool(alpha)}
        return key

    placements = {Path(p['shapeName']).name.lower(): p for p in props if p.get('class') == 'TSStatic' and p.get('shapeName')}
    manifest = {'version': 1, 'id': 'liberty-city', 'title': 'Liberty City', 'origin': origin.tolist(),
                'spawns': [{'id': p['name'], 'name': p['name'].replace('spawn_', '').replace('_', ' ').title(), 'position': convert(p['position'])} for p in spawn_data], 'sectors': []}

    for file in sorted(city.glob('*.dae')):
        print('Converting', file.name, flush=True)
        root = ET.parse(file).getroot()
        geometry = {e.get('id'): e for e in root.findall('c:library_geometries/c:geometry', NS)}
        images = {e.get('id'): e.findtext('c:init_from', '', NS) for e in root.findall('c:library_images/c:image', NS)}
        effects = {}
        for e in root.findall('c:library_effects/c:effect', NS):
            image_id = e.findtext('.//c:surface/c:init_from', '', NS)
            effects[e.get('id')] = images.get(image_id, '')
        materials = {}
        for m in root.findall('c:library_materials/c:material', NS):
            effect = m.find('c:instance_effect', NS)
            name = m.get('name', '').lower()
            tex = material_overrides.get(name, effects.get(effect.get('url', '')[1:], '') if effect is not None else '')
            materials[m.get('id')] = texture(tex) if tex else None

        placement = placements.get(file.name.lower(), {'position': [0, 0, 115.5]})
        base = np.eye(4)
        base[:3, 3] = placement.get('position', [0, 0, 0])
        if 'rotationMatrix' in placement: base[:3, :3] = np.array(placement['rotationMatrix']).reshape(3, 3).T
        base[:3, :3] *= np.array(placement.get('scale', [1, 1, 1]))
        instances = []

        def visit(node, parent):
            matrix = np.eye(4)
            element = node.find('c:matrix', NS)
            if element is not None: matrix = np.fromstring(element.text, sep=' ').reshape(4, 4)
            transform = parent @ matrix
            for inst in node.findall('c:instance_geometry', NS):
                bindings = {m.get('symbol'): m.get('target')[1:] for m in inst.findall('.//c:instance_material', NS)}
                instances.append((node.get('name', ''), inst.get('url')[1:], transform, bindings))
            for child in node.findall('c:node', NS): visit(child, transform)

        for node in root.findall('c:library_visual_scenes/c:visual_scene/c:node', NS): visit(node, base)
        lods = [int(re.sub(r'\D', '', n) or 0) for n, *_ in instances if n.upper().startswith('LOD')]
        highest = max(lods, default=0)
        render, collision = defaultdict(list), []
        for name, geo_id, transform, bindings in instances:
            is_collision = name.lower().startswith(('colmesh', 'collision'))
            if not is_collision and lods and (not name.upper().startswith('LOD') or int(re.sub(r'\D', '', name) or 0) != highest): continue
            mesh = geometry[geo_id].find('c:mesh', NS)
            arrays, vertices = {}, {}
            for src in mesh.findall('c:source', NS):
                values = src.find('c:float_array', NS)
                accessor = src.find('c:technique_common/c:accessor', NS)
                if values is not None:
                    arrays[src.get('id')] = np.fromstring(values.text, sep=' ', dtype=np.float32).reshape(-1, int(accessor.get('stride', '1')))
            for v in mesh.findall('c:vertices', NS): vertices[v.get('id')] = v.find('c:input', NS).get('source')[1:]
            for primitive in mesh.findall('c:triangles', NS):
                inputs = list(primitive.findall('c:input', NS)); stride = max(int(i.get('offset', 0)) for i in inputs) + 1
                p = np.fromstring(primitive.findtext('c:p', '', NS), sep=' ', dtype=np.int32).reshape(-1, stride)
                if not len(p): continue
                attributes = {}
                for entry in inputs:
                    sem, src = entry.get('semantic'), entry.get('source')[1:]
                    if sem == 'VERTEX': sem, src = 'POSITION', vertices[src]
                    attributes[sem] = arrays[src][p[:, int(entry.get('offset', 0))]]
                pos = attributes['POSITION'][:, :3].astype(np.float64) @ transform[:3, :3].T + transform[:3, 3]
                pos = (pos - origin) @ axis.T
                if is_collision:
                    collision.append(pos.astype('<f4'))
                    continue
                uv = attributes.get('TEXCOORD', np.zeros((len(p), 2)))[:, :2]
                color = attributes.get('COLOR', np.ones((len(p), 3)))[:, :3]
                material = materials.get(bindings.get(primitive.get('material'), primitive.get('material')))
                render[material].append(np.concatenate([pos, uv, color], axis=1).astype('<f4'))

        if not render: continue
        groups, packed, count = [], [], 0
        for tex, parts in render.items():
            data = np.concatenate(parts)
            groups.append({'texture': tex, 'start': count, 'count': len(data)})
            packed.append(data); count += len(data)
        packed = np.concatenate(packed)
        packed.tofile(out / (file.stem + '.bin'))
        # Keep each trimesh below Cannon's signed Int16 index limit; local spatial batches
        # also keep the broadphase and ray queries inexpensive.
        triangles = np.concatenate(collision).reshape(-1, 3, 3) if collision else packed[:, :3].reshape(-1, 3, 3)
        centroids = triangles.mean(axis=1)
        cells = np.floor(centroids[:, [0, 2]] / 64).astype(np.int32)
        unique, inverse = np.unique(cells, axis=0, return_inverse=True)
        physics_groups, physical, offset = [], [], 0
        for i, cell in enumerate(unique):
            selected = triangles[inverse == i]
            for start in range(0, len(selected), 10000):
                chunk = selected[start:start+10000].reshape(-1, 3).astype('<f4')
                center = (chunk.min(axis=0) + chunk.max(axis=0)) / 2
                physics_groups.append({'start': offset, 'count': len(chunk), 'center': center.tolist(), 'bounds': [chunk.min(axis=0).tolist(), chunk.max(axis=0).tolist()]})
                physical.append(chunk - center); offset += len(chunk)
        np.concatenate(physical).astype('<f4').tofile(out / (file.stem + '.collision.bin'))
        sector = {'id': file.stem, 'bounds': [packed[:, :3].min(axis=0).tolist(), packed[:, :3].max(axis=0).tolist()],
                  'vertices': count, 'triangles': count // 3, 'groups': groups, 'physics': physics_groups}
        (out / (file.stem + '.json')).write_text(json.dumps(sector, separators=(',', ':')), encoding='utf-8')
        manifest['sectors'].append({k: sector[k] for k in ['id', 'bounds', 'triangles']})
        print(f'  {count//3:,} render triangles / {len(triangles):,} collision triangles / {len(groups)} materials', flush=True)

    manifest['textures'] = texture_info
    manifest['missingTextures'] = sorted(missing)
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(f"Done: {len(manifest['sectors'])} sectors, {len(texture_info)} textures, {len(missing)} missing texture references", flush=True)

if __name__ == '__main__': main()
