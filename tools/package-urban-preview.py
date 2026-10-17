"""Package the freshly compiled runtime and local assets, never the stale Git bundle."""
from pathlib import Path
import shutil
import subprocess
root=Path(__file__).resolve().parents[1]
out=root/'artifacts'/'urban-playable'
out.mkdir(parents=True,exist_ok=True)
for name in ['editor.html','mobile.html','sa-navigation.html','urban-examples.html','urban-assets.html','urban-webgpu.html','3dPicker.js','city-assets-sw.js','_headers']:
    shutil.copy2(root/name,out/name)
for name in ['src/editor','build/assets','assets/roadforge','assets/urban-kits','node_modules/three']:
    shutil.copytree(root/name,out/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('*.part','__pycache__'))
# Isolated renderer experiment: keep modern Three separate from the legacy
# game's 0.152 bundle. This exact distribution is served without an external CDN.
modern=root/'tools/webgpu/node_modules/three'
if not (modern/'build/three.webgpu.js').is_file():
    print('Installing pinned Three.js 0.187.0 for WebGPU lab (separate from the game)...')
    subprocess.run(['npm','install','--prefix',str(root/'tools/webgpu'),'--no-audit','--no-fund'],check=True,timeout=120)
if not (modern/'build/three.webgpu.js').is_file():
    raise RuntimeError('Pinned WebGPU runtime unavailable after installation')
shutil.copytree(root/'webgpu',out/'webgpu',dirs_exist_ok=True)
shutil.copytree(modern/'build',out/'webgpu/vendor/three/build',dirs_exist_ok=True)
if (modern/'LICENSE').is_file():
    shutil.copy2(modern/'LICENSE',out/'webgpu/vendor/three/LICENSE')

# Include verified UE2Three district assets if a licensed Unreal exporter populated the cache.
ue_districts=root/'build/local-scenes/ue2three-districts'
if (ue_districts/'manifest.json').is_file() or (ue_districts/'native-meshes.json').is_file():
    shutil.copytree(ue_districts,out/'build/local-scenes/ue2three-districts',dirs_exist_ok=True)
else:
    print('No genuine Unreal level or static-mesh architectural exports: coastal mode explicitly reports procedural preview.')

# Include original DDS mannequin, weapon meshes and animation exports when supplied.
# Keep the Sketchbook variant deployable when DDS exports are not available.
dds=root/'build/local-scenes/dds'
if dds.is_dir():
    shutil.copytree(dds,out/'build/local-scenes/dds',dirs_exist_ok=True)
else:
    print('DDS export not present: photoreal Sketchbook mode works; DDS requires exported assets.')
shutil.copy2(root/'build/sketchbook.min.js',out/'build/sketchbook.min.js')
# A real static host cannot resolve bare module imports such as 'three'.
# The dedicated webpack bundle includes city, traffic, NPC conversations and weather.
bundle=root/'build/editor.bundle.js'
if not bundle.is_file(): raise RuntimeError('Editor bundle missing. Run npm run build.')
shutil.copy2(bundle,out/'build/editor.bundle.js')
sa_bundle=root/'build/sa-viewer.bundle.js'
if not sa_bundle.is_file(): raise RuntimeError('San Andreas viewer bundle missing.')
shutil.copy2(sa_bundle,out/'build/sa-viewer.bundle.js')
html=(out/'editor.html').read_text(encoding='utf-8')
old='<script type="module" src="src/editor/start.js"></script>'
if old in html:
    html=html.replace(old,'<script defer src="build/editor.bundle.js"></script>')
elif '<script src="build/editor.bundle.js"></script>' in html:
    html=html.replace('<script src="build/editor.bundle.js"></script>','<script defer src="build/editor.bundle.js"></script>')
else:
    raise RuntimeError('editor.html has no valid compiled City Player boot script')
(out/'editor.html').write_text(html,encoding='utf-8')
# Drop original unneeded high-poly tree source; runtime loads the 2 LODs.
original=out/'assets/urban-kits/tree_small_02/tree_small_02.bin'
if original.exists(): original.unlink()

(out/'index.html').write_text('<!doctype html><meta http-equiv="refresh" content="0;url=editor.html?scene=urban-photoreal&play=1"><a href="editor.html?scene=urban-photoreal">Apri la città</a>')
(out/'WEBGPU-README.txt').write_text('WebGPU sperimentale: urban-webgpu.html?backend=webgpu\nControllo identico: urban-webgpu.html?backend=webgl2\nEntrambi condividono la pianta urbana, non la completa grafica e simulazione del gioco WebGL.\n')
(out/'AVVIO.txt').write_text('Avvia in questa cartella: python -m http.server 8401\nApri http://localhost:8401/editor.html?scene=urban-photoreal\nEsempi: http://localhost:8401/urban-examples.html\nAsset locali: non servono API key.\n')
# Distribute genuine licensed Sketchfab supercars with the same photoreal
# static site: no private API tokens in the browser or this Git repository.
# Serve the 28 MB Lamborghini directly from Netlify instead of waiting for
# the Render free-tier proxy on every first visit.
import json
import struct
import time
import urllib.request
cars=out/'build/assets/supercars'
cars.mkdir(parents=True,exist_ok=True)
for model in ('bmw','ferrari','lamborghini'):
    source='https://sketchbook-fab-bridge.onrender.com/sketchfab/cars/'+model
    destination=cars/(model+'.glb')
    temp=cars/(model+'.glb.part')
    for attempt in range(3):
        try:
            request=urllib.request.Request(source,headers={'User-Agent':'SketchbookAI-Urban-Photoreal-Release/1.0'})
            with urllib.request.urlopen(request,timeout=180) as response, temp.open('wb') as output:
                total=0
                while True:
                    chunk=response.read(1024*1024)
                    if not chunk:break
                    total+=len(chunk)
                    if total>50*1024*1024:raise ValueError('Sketchfab model exceeds 50MB')
                    output.write(chunk)
            with temp.open('rb') as input_file:
                header=input_file.read(20)
                if len(header)!=20 or header[:4]!=b'glTF':raise ValueError('Sketchfab asset is not a GLB')
                size=struct.unpack_from('<I',header,8)[0]
                json_size=struct.unpack_from('<I',header,12)[0]
                if size!=temp.stat().st_size or size<500 or json_size>size-20:
                    raise ValueError('Sketchfab GLB has invalid length')
                data=json.loads(input_file.read(json_size))
                if not data.get('meshes'):raise ValueError('Sketchfab model contains no meshes')
            temp.replace(destination)
            print('Included genuine',model,'Sketchfab GLB,',round(total/1e6,1),'MB,',len(data['meshes']),'meshes')
            break
        except Exception as error:
            temp.unlink(missing_ok=True)
            if attempt==2:raise RuntimeError('Required Sketchfab '+model+' GLB download failed') from error
            time.sleep(3*(attempt+1))
shutil.copy2(root/'docs/sketchfab-supercars-attribution.txt',cars/'ATTRIBUTION.txt')

print(out)
