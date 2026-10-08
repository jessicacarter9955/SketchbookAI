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
(out/'index.html').write_text('<!doctype html><meta http-equiv="refresh" content="0;url=editor.html?scene=urban-photoreal&play=1"><a href="editor.html?scene=urban-photoreal">Apri la città</a>')
(out/'AVVIO.txt').write_text('Avvia in questa cartella: python -m http.server 8401\nApri http://localhost:8401/editor.html?scene=urban-photoreal\nEsempi: http://localhost:8401/urban-examples.html\nAsset locali: non servono API key.\n')
print(out)
