# GTA San Andreas navigation import

This branch is for GTA gameplay porting, NOT img2threejs.

The browser game includes Three.js pedestrian, traffic and DDS weapon event systems. The binary parser now reads the same GTA SA node and link record format used by SanAndreasUnity's NodeFile.cs.

To import **legally obtained** game data:
```sh
node tools/import-sa-paths.mjs /path/to/nodes-files build/local-scenes/sa-navigation/navigation.json
```

Place nodes0.dat to nodes63.dat in the input folder. The tool exports separate pedestrian and vehicle networks with cross-sector links. There are no bundled Rockstar assets or procedural substitutions.

Current limitation: GTA San Andreas geometry, textures and corresponding collision meshes are not yet connected to these imported paths. The existing playable preview is still Sketchbook's procedural city. The import alone does not provide a playable SA map.


## Visualizzatore GTA SA (ottobre 2026)

Apri `sa-navigation.html` sul deploy del ramo. Questa pagina usa Three.js per mostrare **soltanto** geometrie GLB esportate realmente dal tuo GTA San Andreas e i percorsi pedonali/veicolari dei file originali `nodes0.dat` … `nodes63.dat` senza caricarli su server. Le due sorgenti sono selezionabili separatamente e visualizzate nelle coordinate originali del file, con camera orbitale e diagnostica copiabile. I settori GLB devono essere esportati mantenendo la posizione nel mondo e incorporando le texture; importare nodi da soli non fornisce mesh. I file non sono inclusi per ragioni di licenza. Questa è una **vista tecnica di integrazione**, non ancora il gioco San Andreas completo con missioni, fisica e collisioni.

## Giocare nella geometria locale

La nuova scena `editor.html?scene=san-andreas-local&play=1` condivide l'IndexedDB del visualizzatore `sa-navigation.html` **sullo stesso dominio Netlify**. Importa i veri settori GLB e opzionalmente `nodes*.dat` nel visualizzatore, poi premi `▶ Prova in Sketchbook City Player`. Sketchbook ora istanzia i settori GLB originali senza inventare edifici, trasferisce le due reti originali di navigazione al runtime e crea collisioni Cannon Trimesh *a breve distanza* per mesh con meno di 55.000 triangoli (fino a 36 collider vicini). La posizione di partenza è scelta fra i nodi pedonali originali quando presenti. Nessun asset viene pubblicato online. Si tratta di una prima integrazione giocabile: AI sulle reti SA, missioni, streaming ottimizzato dei settori giganteschi, collisioni complesse e DDS autentico restano incompleti. Il personaggio del test è quello già esistente di Sketchbook, non un nuovo modello GTA.
