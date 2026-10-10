"""Package the freshly compiled runtime and local assets, never the stale Git bundle."""
from pathlib import Path
import shutil
root=Path(__file__).resolve().parents[1]
out=root/'artifacts'/'urban-playable'
out.mkdir(parents=True,exist_ok=True)
for name in ['editor.html','urban-examples.html','urban-assets.html','3dPicker.js']:
    shutil.copy2(root/name,out/name)
for name in ['src/editor','build/assets','assets/roadforge','assets/urban-kits','node_modules/three']:
    shutil.copytree(root/name,out/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('*.part','__pycache__'))
shutil.copy2(root/'build/sketchbook.min.js',out/'build/sketchbook.min.js')
# A real static host cannot resolve bare module imports such as 'three'.
# The dedicated webpack bundle includes city, traffic, NPC conversations and weather.
bundle=root/'build/editor.bundle.js'
if not bundle.is_file(): raise RuntimeError('Editor bundle missing. Run npm run build.')
shutil.copy2(bundle,out/'build/editor.bundle.js')
html=(out/'editor.html').read_text(encoding='utf-8')
old='<script type="module" src="src/editor/start.js"></script>'
if old not in html: raise RuntimeError('editor.html module script missing')
(out/'editor.html').write_text(html.replace(old,'<script defer src="build/editor.bundle.js"></script>'),encoding='utf-8')
# Drop original unneeded high-poly tree source; runtime loads the 2 LODs.
original=out/'assets/urban-kits/tree_small_02/tree_small_02.bin'
if original.exists(): original.unlink()

(out/'index.html').write_text('<!doctype html><meta http-equiv="refresh" content="0;url=editor.html?scene=urban-photoreal&play=1"><a href="editor.html?scene=urban-photoreal">Apri la città</a>')
(out/'AVVIO.txt').write_text('Avvia in questa cartella: python -m http.server 8401\nApri http://localhost:8401/editor.html?scene=urban-photoreal\nEsempi: http://localhost:8401/urban-examples.html\nAsset locali: non servono API key.\n')
print(out)
