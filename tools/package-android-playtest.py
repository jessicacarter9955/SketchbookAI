"""Create a self-contained Capacitor web asset directory for Android."""
from pathlib import Path
import shutil
root=Path(__file__).resolve().parents[1]
out=root/'www'
out.mkdir(exist_ok=True)
for filename in ('editor.html','3dPicker.js','src/editor/sketchfab-client.js','src/editor/fab-client.js'):
    source=root/filename
    target=out/filename
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(source,target)
for directory in ('src/editor','build/assets','assets/roadforge','assets/urban-kits','node_modules/three'):
    source=root/directory
    if not source.exists():
        raise RuntimeError(f'Required offline game directory absent: {directory}')
    target=out/directory
    shutil.copytree(source,target,dirs_exist_ok=True,
        ignore=shutil.ignore_patterns('*.part','*.tgz','*.zip','__pycache__','*.map','*.ts'))
# The vegetation runtime uses scene-lod0.gltf + lod0.bin and
# scene-lod1.gltf + lod1.bin. The original high-detail source (90.7 MiB)
# is NOT loaded by Android. Keeping it needlessly doubles install size.
heavy_source=out/'assets/urban-kits/tree_small_02/tree_small_02.bin'
if heavy_source.exists():
    heavy_source.unlink()
    print('Omitted unused original tree source (90.7 MiB); LODs retained.')

bundle=root/'build/sketchbook.min.js'
if not bundle.is_file():raise RuntimeError('Production game bundle missing')
(out/'build').mkdir(exist_ok=True)
shutil.copy2(bundle,out/'build/sketchbook.min.js')
html='''<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"><title>Sketchbook AI · Scegli scena</title>
<style>html,body{margin:0;min-height:100%;background:#0b1623;color:#eaf3fb;font:16px system-ui,sans-serif}body{box-sizing:border-box;padding:max(28px,env(safe-area-inset-top)) 16px 36px}main{max-width:740px;margin:auto}h1{font-size:31px;margin:0 0 8px}.subtitle{color:#a4c1d8;margin:0 0 26px}section{display:grid;gap:14px}.scene{display:block;border:1px solid #3b627c;border-radius:16px;background:linear-gradient(120deg,#15283e,#203b50);color:white;text-decoration:none;padding:18px 20px;box-shadow:0 5px 20px #0005}.scene strong{display:block;font-size:19px;margin-bottom:5px}.scene span{display:block;color:#c2d6e7}.recommended{border:2px solid #5cc2fa;background:linear-gradient(120deg,#194e72,#132c42)}small{display:block;margin-top:25px;color:#9ab3c4;line-height:1.6}</style></head><body><main>
<h1>Sketchbook AI</h1><p class="subtitle">Scegli una scena per giocare sul tuo telefono.</p><section>
<a class="scene recommended" href="editor.html?scene=urban-rpg-dialogue&play=1"><strong>💬 RPG · Dialogo con un NPC</strong><span>Incontra un abitante, premi Parla e scegli le risposte.</span></a>
<a class="scene" href="editor.html?scene=urban-photoreal&play=1"><strong>🏙️ Urban Photoreal · Boulevard</strong><span>Cammina per la città con traffico e pedoni.</span></a>
<a class="scene" href="editor.html?scene=urban-photoreal-sunset&play=1"><strong>🌇 Urban Photoreal · Tramonto</strong><span>Stessa città con atmosfera serale.</span></a>
<a class="scene" href="editor.html?scene=urban-procedural&play=1"><strong>🚘 Procedural City · Drive Test</strong><span>Esplora le strade e guida le auto.</span></a>
<a class="scene" href="editor.html?scene=island-bridge&play=1"><strong>🌉 Isola · Ponte e costa</strong><span>Un mondo procedural island da esplorare.</span></a>
<a class="scene" href="editor.html?scene=island-sunset&play=1"><strong>🏝️ Isola · Tramonto</strong><span>Ambiente costiero con luce del tramonto.</span></a>
<a class="scene" href="editor.html?scene=liberty-city&play=1"><strong>🌃 Liberty City · Portland</strong><span>Scenario urbano originale, dipendente dagli asset disponibili.</span></a>
<a class="scene" href="editor.html?scene=sandbox&play=1"><strong>🧱 Sketchbook originale</strong><span>Scena iniziale originale.</span></a></section>
<small>Comandi: joystick per muoversi, trascina sul lato destro per orientare la visuale, Parla per le conversazioni, Auto per entrare nei veicoli, Scene per tornare qui. Le scene pesanti possono richiedere qualche secondo per caricarsi. Tutte le scene sono selezionabili; alcune potrebbero richiedere asset aggiuntivi.</small></main></body></html>'''
(out/'index.html').write_text(html,encoding='utf-8')
size=sum(p.stat().st_size for p in out.rglob('*') if p.is_file())
print(f'Android game assets: {size/1024/1024:.1f} MiB')
