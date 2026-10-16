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


## Pedoni e veicoli sulla rete originale

`SanAndreasPopulation` usa `buildSanAndreasNetwork` e `sa-agent-navigation.mjs` per posizionare manichini e veicoli Sketchbook sulle posizioni vere dei nodi `nodes*.dat`, rispettando gli archi diretti, i blocchi stradali e le aree consentite. Le auto non guidabili dell'ambiente sono instanziate con `InstancedMesh`, i pedoni animati hanno distanza massima e sleep LOD. Gli agenti si riciclano su nodi originali vicino al giocatore, non inventano strade. Sono prototipi di popolazione, non ancora IA con missioni, traffico poliziesco o semafori GTA originali.


## Ottimizzazione città grande: streaming vero

L'importatore GLB registra i bounding box mondiali di ogni settore in IndexedDB (schema v2). La scena giocabile seleziona solo i 12 settori più vicini entro ~520 m, ne carica 2 alla volta, e rilascia geometrie/materiali/texture GPU oltre 1250 m. Mesh statiche hanno trasformazioni congelate, collisioni Cannon Trimesh vengono preparate solo vicino al giocatore, fino a 3 nuove a tick. Le draw call, il numero di settori caricati e gli FPS vengono mostrati nella HUD. Se gli FPS rimangono bassi, un adattamento lento riduce il pixel ratio (non la geometria o le texture originali): `&adaptive=0` lo disabilita. Per importazioni precedenti allo schema v2 con oltre 2 GLB occorre reimportare i GLB tramite il visualizzatore per costruire gli indici; nessun asset viene inviato online. Per grandi mappe separare i GLB in settori, idealmente <256 MB per file; un singolo GLB gigante non può essere diviso automaticamente. Questo non garantisce 60 FPS su tutti i dispositivi: richiede benchmark sul dispositivo reale.

## StreetLab · ottobre 2026

La nuova scena `editor.html?scene=san-andreas-streetlab&play=1` usa i veri GLB SA importati privatamente, senza includere asset GTA in Netlify. Nel pannello StreetLab si trovano fonti Sketchfab CC BY per BMW M4, Porsche 911, Ferrari 458 e NPC umani: scaricare il GLB dalla pagina dell'autore e importarlo localmente; auto guidabili si appoggiano al rig Sketchbook esistente, mantenendo sedile, ruote e controlli F/WASD. L'aspetto del protagonista può essere cambiato in GLB (animazioni compatibili solo se presenti; niente retarget automatico). `StreetLabCrime` offre un prototipo di ricercato, polizia sui percorsi SA, denaro, inventario e munizioni. Non è il sistema missioni/polizia GTA completo e i modelli DDS originali restano assenti.

Nella città procedurale i semafori sono finalmente VISIBILI: pali e tre LED su 3 InstancedMesh totali, aggiornati sulle fasi del traffico. Sia l'ambientazione urbana HD sia il test SA mostrano FPS e draw call. Per test città procedurali grandi su profili senza scena salvata: `editor.html?scene=urban-photoreal&play=1&cityBlocks=6` su desktop (6x6) e fino a 4x4 su mobile. Non forzare 60 FPS: i benchmark di device reali sono ancora necessari. Un salvataggio preesistente del generatore prevale sul parametro URL.

## Fix urban-photoreal 4×4/6×6 timeout HD

Eliminato il timeout fisso a 50 s che abortiva anche caricamenti originali GLTF in corso. Il gate di avvio continua a richiedere tutti i dettagli HD e compilazione degli shader, senza mostrare asset fittizi. La vegetazione `tree_small_02` mantiene i due LOD e i materiali originali, ma usa `THREE.InstancedMesh` e selezione di esemplari visibili, anziché decine/centinaia di cloni `THREE.LOD`. Non è ancora implementato un timeout per singola richiesta di rete; una richiesta realmente bloccata resta da diagnosticare.
