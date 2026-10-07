"""Download complete 1K CC0 Poly Haven kits; preserve relative glTF resources."""
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'assets' / 'urban-kits'
ASSETS = ['modular_urban_apartments_facade', 'modular_factory_facade']

def fetch(url, target, expected_md5=None):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and expected_md5 and hashlib.md5(target.read_bytes()).hexdigest() == expected_md5:
        return
    temporary = target.with_suffix(target.suffix + '.part')
    subprocess.run(['curl', '-fLs', '--retry', '2', '--max-time', '90', url, '-o', str(temporary)], check=True)
    if expected_md5 and hashlib.md5(temporary.read_bytes()).hexdigest() != expected_md5:
        temporary.unlink(missing_ok=True)
        raise ValueError(f'Checksum mismatch: {target.name}')
    temporary.replace(target)

if __name__ == '__main__':
    for asset in ASSETS:
        data = json.loads(subprocess.check_output(['curl', '-fLs', '--retry', '2', '--max-time', '60', 'https://api.polyhaven.com/files/' + asset]))
        kit = data['gltf']['1k']['gltf']
        folder = ROOT / asset
        files = [(kit['url'], folder / 'scene.gltf', kit['md5'])]
        files += [(v['url'], folder / path, v['md5']) for path, v in kit['include'].items()]
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda item: fetch(*item), files))
        print(asset, 'verified', len(files), 'files', flush=True)
