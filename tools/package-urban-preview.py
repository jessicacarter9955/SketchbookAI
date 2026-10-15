"""Package the freshly compiled runtime and local assets, never the stale Git bundle."""
from pathlib import Path
import shutil
import subprocess
root=Path(__file__).resolve().parents[1]
out=root/'artifacts'/'urban-playable'
out.mkdir(parents=True,exist_ok=True)
for name in ['editor.html','sa-navigation.html','urban-examples.html','urban-assets.html','urban-webgpu.html','3dPicker.js','city-assets-sw.js','_headers']:
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
if old not in html: raise RuntimeError('editor.html module script missing')
(out/'editor.html').write_text(html.replace(old,'<script defer src="build/editor.bundle.js"></script>'),encoding='utf-8')
# Drop original unneeded high-poly tree source; runtime loads the 2 LODs.
original=out/'assets/urban-kits/tree_small_02/tree_small_02.bin'
if original.exists(): original.unlink()

(out/'index.html').write_text('<!doctype html><meta http-equiv="refresh" content="0;url=editor.html?scene=urban-photoreal&play=1"><a href="editor.html?scene=urban-photoreal">Apri la città</a>')
(out/'WEBGPU-README.txt').write_text('WebGPU sperimentale: urban-webgpu.html?backend=webgpu\nControllo identico: urban-webgpu.html?backend=webgl2\nEntrambi condividono la pianta urbana, non la completa grafica e simulazione del gioco WebGL.\n')
(out/'AVVIO.txt').write_text('Avvia in questa cartella: python -m http.server 8401\nApri http://localhost:8401/editor.html?scene=urban-photoreal\nEsempi: http://localhost:8401/urban-examples.html\nAsset locali: non servono API key.\n')
print(out)
