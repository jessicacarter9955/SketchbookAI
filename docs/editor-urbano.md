# Editor urbano: cosa è pronto e come estenderlo

## Fix di questa revisione

- Sketchfab: errore visibile sulla scheda del modello, apertura del campo token e possibilità di riprovare il modello selezionato. La ricerca «Albero» è stata provata con il risultato Maple tree di atrodler.
- Importazione di GLB e ZIP glTF, conversione in GLB con risorse incorporate, persistenza e inquadratura del modello. Archivio massimo 50 MB, contenuto estratto massimo 100 MB; il GLB risultante deve rientrare nei 50 MB.
- Timeout delle richieste e messaggi per autenticazione, file mancanti e archivi non supportati.
- Scene separate Portland · laboratorio e Staunton · laboratorio. La prima copia gli oggetti salvati a Portland solo al primo avvio. La seconda parte dal punto di spawn di Staunton, con la mappa ma senza attori preinseriti.
- «Crea copia / ramo», revisioni nominate e «Apri revisione in una copia». La prima revisione è conservata e le ultime 19 restano disponibili. Le copie condividono i byte degli asset locali ma hanno trasformazioni e oggetti indipendenti.

Il 3 ottobre 2026 è stato recuperato un token valido dalla configurazione storica: il download del Maple tree di atrodler è stato autorizzato e il modello è stato aggiunto realmente a Portland · laboratorio tramite la ricerca «Albero». Il token risiede in `.local/sketchfab.json`, escluso da Git, e viene caricato automaticamente solo aprendo l'app su localhost/127.0.0.1. I token inseriti manualmente nel campo della libreria restano in memoria. La configurazione locale non viene trasferita con il repository. GLTF Draco/KTX2 richiedono decoder aggiuntivi e non sono inclusi in questa revisione.

## Si possono modificare strada, prato, lampioni ed edifici di Liberty City?

Ora è disponibile il primo strumento per la mappa originale: selezione per materiale e area rettangolare, con erba animata, asfalto e sabbia. Gli edifici e i lampioni originali non sono ancora separabili o spostabili; quelli aggiunti dalla libreria rimangono modificabili individualmente.

### Come modificare il prato

1. Apri una copia della tua scena oppure **Portland · prato animato**, nuova scena dimostrativa indipendente.
2. Nel pannello **Superfici della città**, premi **Scegli superficie nella mappa** e clicca il prato. L'anteprima evidenzia soltanto i triangoli del materiale campionato.
3. Regola larghezza e profondità, oppure usa **Disegna area · 2 clic**. La fascia verticale esclude altri piani della mappa. Il rettangolo segue gli assi della mappa, fino a 200 × 200 m.
4. Scegli Erba animata, Asfalto o Sabbia; regola densità e altezza dell'erba. Premi **Applica superficie**.
5. Usa Annulla/Ripeti, elimina un intervento dall'elenco oppure salva una revisione e creane una copia. Esportazione e salvataggio automatico includono gli interventi.

L'erba è geometria istanziata con vento, colore variabile e dissolvenza a distanza, implementata qui senza copiare gli shader Shadertoy. I triangoli vengono tagliati esattamente al bordo della selezione; strade con altre texture rimangono inalterate. Le collisioni e i file della città non cambiano. Un intervento successivo copre il precedente nella stessa zona. Limiti: 32 interventi, 24.000 fili per intervento/settore e 80.000 caricati complessivamente; la densità può quindi ridursi su aree grandi. L'anteprima conta soltanto i settori già caricati, mentre gli interventi salvati si riapplicano quando gli altri settori entrano in memoria. Non è ancora un pennello libero o una selezione poligonale.

La cartella fornita è una conversione della mappa per BeamNG. Per esempio bridgeeast.dae e bridgewest.dae hanno nodi base00/start01, una mesh di collisione e due livelli di dettaglio: non un catalogo di oggetti con comportamento GTA. Il nostro importatore conserva il livello visivo più dettagliato, raggruppa i triangoli per texture e suddivide le collisioni in celle spaziali. Questo favorisce il caricamento, ma non conserva una selezione editor per edificio. Inoltre alcuni elementi possono essere già fusi nei DAE originali: conservare i nodi da solo non li separa.

Servono tre strumenti distinti:

| Operazione | Strumento da costruire | Effetto su geometria e fisica |
|---|---|---|
| Spostare un lampione o edificio separabile | Selezione oggetto, ID stabile, pivot, estrazione della componente connessa | Nascondere la parte originale e muovere insieme mesh e collisione |
| Cambiare tutto un tipo di prato | Selezione materiale con anteprima e filtro per settore | Sostituzione del materiale e distribuzione della vegetazione solo sulle superfici ammesse |
| Cambiare il prato lungo una strada | Selezione rettangolare/poligonale o pennello + filtro materiale | Maschera spaziale; triangoli di strada ed edifici esclusi; taglio ai bordi quando necessario |
| Muovere/scalare molti oggetti | Selezione multipla, gruppo temporaneo e pivot comune | Un'unica operazione annullabile; aggiornamento di tutti i corpi fisici |
| Allargare un terreno o disegnare una strada | Terreno a tasselli e curve con punti di controllo | Rigenerazione locale di mesh, collisioni e percorsi degli agenti |

La soluzione robusta conserva i file sorgente immutabili e salva modifiche separatamente: oggetti nascosti, trasformazioni, sostituzioni materiali e maschere. Anche collisioni e selezione devono usare gli stessi ID; spostare solo la parte visibile lascerebbe muri invisibili o buchi nel pavimento.

Il primo passaggio del tuo esempio è implementato: delimitare una zona a Portland, riconoscere il materiale del prato con un clic, visualizzare la maschera, applicare l'erba e annullare l'operazione. Spostamento della geometria originale, selezione multipla e generatore di isole/strade restano i passi successivi.

## Shader di erba, acqua e città procedurale

I riferimenti forniti sono:

- Erba: https://www.shadertoy.com/view/dd2cWh
- Acqua: https://www.shadertoy.com/view/Xl2XRW
- Città: https://www.shadertoy.com/view/XtsSWs

Non sono riuscito a leggere il sorgente di queste tre pagine tramite il servizio web disponibile, quindi non attribuisco loro caratteristiche tecniche specifiche o licenze non verificate. Non li ho copiati né integrati. Prima del riuso vanno esaminati sorgente, canali, passaggi multipli e licenza del singolo autore.

In generale uno shader Shadertoy non è automaticamente un materiale per un terreno 3D: spesso disegna un'intera immagine con una camera e una geometria implicita proprie. Un porting deve usare camera, coordinate del mondo, profondità, luce e tempo del nostro motore. Proiettarlo come un video su una strada non produce vegetazione 3D integrata.

Per l'erba consiglierei terreno con materiale PBR e ciuffi/lamine istanziati vicino alla camera, animazione del vento nello shader, densità e altezza dipendenti dalla maschera; a distanza, meno geometria. Così il prato resta visibile da ogni direzione e non ricopre l'asfalto.

Per l'acqua servono superficie reale, normali animate, riflessi, attenuazione con la profondità e trattamento delle rive. Nuoto e galleggiamento restano sistemi fisici separati. Three.js include già un esempio di oceano e cielo, utile come riferimento di integrazione: https://threejs.org/examples/webgl_shaders_ocean.html. ShaderMaterial è il punto di ingresso per shader personalizzati: https://threejs.org/docs/#api/en/materials/ShaderMaterial.

Una città ottenuta con ray marching non fornisce automaticamente edifici selezionabili, marciapiedi, collisioni o corsie per il traffico. Per un mondo giocabile preferisco generare dati e mesh reali; lo shader può migliorare materiali o sfondi.

## Veicoli e pedoni GTA: dove sono?

Non ci sono prefab GTA guidabili o pedoni GTA configurati nelle scene attuali. I file controllati della mappa non contengono GLB, FBX, JBeam, DFF, YFT o YDD. La mappa non include la logica del gioco originale.

La cartella build/assets del progetto contiene car.glb, car2.glb, heli.glb, airplane.glb e boxman.glb. Il prefab «Auto guidabile» utilizza car.glb e gli abitanti usano boxman.glb. L'importazione di una carrozzeria da Sketchfab crea scenografia finché non le viene assegnato un controller.

Per usare un'altra auto serve una procedura di rigging nell'editor: orientamento, scala, ruote e assi, baricentro, collider, sedile, punto d'ingresso e parametri di guida. Un pedone richiede scheletro, animazioni compatibili e retargeting, oltre al comportamento. Non basta che il nome del modello contenga «GTA». La fonte dell'asset va scelta con diritti adatti all'uso previsto; l'importatore dovrebbe conservarne autore e licenza.

## Isola con ponte: struttura del generatore

Questo è un generatore di mondo, non soltanto uno shader. La sequenza proposta è:

1. Un seed riproducibile genera forma dell'isola, quota, pendenze, costa e fondale.
2. Punti di controllo definiscono strade e ponte. La strada adatta il terreno; il ponte mantiene una quota e genera piloni, parapetti e collisioni.
3. Gli isolati derivano dal grafo stradale, poi si suddividono in lotti. Edifici modulari occupano i lotti con regole di arretramento e altezza.
4. Vegetazione e arredo seguono maschere: niente alberi sulla carreggiata, meno erba sui pendii, distanze minime fra lampioni.
5. Il grafo stradale genera corsie per le auto; marciapiedi e attraversamenti producono i percorsi pedonali.
6. Il generatore salva parametri e risultati come oggetti editabili. La rigenerazione di un'area conserva gli interventi manuali bloccati e crea prima una revisione.

L'editor dovrebbe avere modalità Terreno, Strade, Oggetti, Materiali e Popolazione, con anteprima prima di applicare modifiche pesanti. Un generatore a seed è utile per produrre rapidamente la base; gli strumenti manuali servono per rifinire il quartiere.

## Realismo: cosa limita oggi il risultato

Liberty City usa attualmente MeshBasicMaterial con texture e colori dei vertici, senza illuminazione fisica dinamica per gli edifici. Le ombre della città sono disattivate per contenere il costo. Il cielo di Sketchbook è già basato su un modello analitico di atmosfera, ma da solo non rende realistici materiali e geometria.

Per migliorare il risultato servono materiali PBR coerenti (colore, rugosità, normali), texture adeguate, dettagli geometrici vicino alla camera, luce e cielo coordinati, riflessi, ombre con distanza limitata e livelli di dettaglio. Le ombre già disegnate nelle vecchie texture non si possono eliminare regolando il cielo. Non prometterei fotorealismo semplicemente applicando quei tre shader alla mappa esistente.

Per il cielo: un pannello con ora del giorno, azimut, foschia e copertura nuvolosa; sole, luce ambientale, riflessi e nebbia devono cambiare insieme. Preparerei scene separate Giorno, Tramonto e Coperto per confrontare il risultato, senza alterare il riferimento originale. Questo pannello e questi preset atmosferici non sono inclusi nelle fix attuali.

## Revisioni delle scene e GitHub

Le revisioni nell'editor sono salvataggi locali della scena: non sono commit Git. Una copia riaperta da una revisione è indipendente e non sovrascrive la scena corrente. Le risorse importate restano in IndexedDB; esportare la scena produce il backup portabile con i GLB. Le mappe di base, come Liberty City, restano file locali separati.

Il codice testato viene salvato in commit su https://github.com/jessicacarter9955/SketchbookAI. La cronologia pubblica parte da una base senza le credenziali incorporate nel progetto ereditato; la vecchia cronologia è conservata nel ramo master locale. Non usare un push indiscriminato di tutti i rami.

I 474 MB circa della conversione Liberty City sono esclusi da Git. Il repository contiene il convertitore e i riferimenti alla mappa; su un'altra macchina occorre fornire e convertire la cartella della mappa. Anche le scene salvate nel browser non vengono caricate su GitHub automaticamente: per versionarle nel repository bisogna esportare un pacchetto o introdurre un backend di progetto.

## Verifiche delle fix

- Test Node per schema, revisioni, copie, ricerca e download.
- Test browser WebGL/Cannon/IndexedDB: importazione GLB, ZIP glTF con buffer relativo, persistenza, esportazione, annulla/ripeti, rifiuto di ZIP non valido e passaggio gioco/editor.
- Ricerca reale «Albero», download autenticato del Maple tree, importazione e selezione nella scena Portland.
- Test superfici: taglio ai bordi, filtro materiale/quota, geometria e collisioni originali, erba istanziata, streaming riproducibile, annulla/ripeti, salvataggio/esportazione e compilazione shader.
- Creazione di una revisione e apertura in una copia indipendente dal browser.
- Build di produzione e controllo del diff prima del push.
