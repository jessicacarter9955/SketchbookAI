"""Lightweight Android shell: menu is local; game pages are on our online server.
No huge glTF kits in the APK. Needs Internet to play.
"""
from pathlib import Path
out=Path(__file__).resolve().parents[1]/'www'
out.mkdir(exist_ok=True)
base='https://6ac957570f93df0fe9c6979e--my-test-site3.netlify.app/editor.html?scene='
scenes=[
('urban-photoreal','🏙️ Città · Pedoni, auto e dialoghi','Gioca nella città 3D con 36 pedoni, traffico NPC e conversazioni RPG'),
('urban-photoreal-sunset','🌇 Città al tramonto','Stessa città con luce serale'),
('urban-procedural','🚗 Città · Guida libera','Strade, auto e abitanti'),
('island-bridge','🌉 Isola · Ponte e costa','Ambiente esplorabile'),
('sandbox','🎮 Sketchbook originale','Mappa originale del gioco')
]
rows=''.join(f'<a class="scene" href="{base}{id}&amp;play=1"><strong>{name}</strong><span>{desc}</span></a>' for id,name,desc in scenes)
html='''<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>SketchbookAI City Lite</title>
<style>html,body{margin:0;min-height:100%;background:#0d1825;color:#f3f6ff;font:16px system-ui,sans-serif}body{padding:26px 16px 40px;box-sizing:border-box}main{max-width:620px;margin:auto}h1{font-size:28px;margin:0 0 8px}p{line-height:1.5;color:#bad3e4}a.scene{display:block;text-decoration:none;color:#fff;margin:12px 0;padding:19px;border:1px solid #416a88;border-radius:12px;background:#193449}a.scene:first-child{border:2px solid #69c8ff;background:#205372}a.scene strong,a.scene span{display:block}a.scene span{font-size:13px;line-height:1.6;color:#c4d8eb;margin-top:4px}.note{font-size:13px;margin-top:20px}</style></head><body><main>
<h1>SketchbookAI · City Lite</h1><p>Seleziona una scena. Il gioco viene caricato online, così l'app è molto più piccola.</p>
'''+rows+'''
<p class="note">Internet richiesto. In città, avvicinati a un NPC e premi <strong>Parla</strong> per scegliere le risposte. Per cambiare scena, usa Indietro fino al menu.</p>
</main></body></html>'''
(out/'index.html').write_text(html,encoding='utf8')
print(f'Online scene chooser: {(out/"index.html").stat().st_size} bytes')
