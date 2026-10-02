# SketchbookAI: editor e percorso verso un sandbox urbano

Il progetto è clonato in `C:\Users\jessi\Documents\Codex\2026-10-01\cl\SketchbookAI` dal repository https://github.com/friuns2/SketchbookAI (commit iniziale `545aa719683be692716f0925bde66dd102d042fe`, clone superficiale del ramo master).

## Avvio

Da PowerShell:

```powershell
cd C:\Users\jessi\Documents\Codex\2026-10-01\cl\SketchbookAI
npm ci
npm run editor
```

L'editor si apre su http://127.0.0.1:8401/editor.html. Se il server è già avviato, apri direttamente l'indirizzo. `npm run dev -- --host 127.0.0.1 --port 8401` avvia lo stesso server senza aprire il browser. Il sandbox AI originale rimane su `/index.html`, con il collegamento «Editor mappa».

## Cosa è stato implementato

- Editor 3D separato dal codice generato dall'AI, sulla stessa mappa e con lo stesso motore.
- Blocchi, edifici, strade, alberi, lampioni e auto statiche da inserire senza account o chiamate AI.
- Selezione tramite clic o elenco, manipolatori per spostamento/rotazione/scala, proprietà numeriche, rinomina, duplicazione, eliminazione e inquadratura.
- Posizionamento su una superficie al clic, appoggio verticale a terra, scatto a 0,5/1/5 metri e rotazione a 15°.
- Collisioni box statiche aggiornate quando si muove, ruota o ridimensiona un oggetto.
- Annulla/ripeti, salvataggio automatico locale e ripristino alla riapertura.
- Esportazione/importazione JSON con i GLB incorporati e i dati di attribuzione disponibili. Un'importazione fallita non sostituisce la scena corrente.
- Modalità «Prova» con personaggio e veicoli della mappa; F2 torna all'editor e mette in pausa la simulazione.
- Ricerca Sketchfab con anteprime, facce, autore, licenza, filtro animazioni/geometria, paginazione e preferiti.
- Token incorporati rimossi dal picker: il token personale resta solo nella memoria della pagina.
- Gli URL temporanei di Sketchfab vengono risolti al momento del download e i byte del modello sono conservati in IndexedDB.

## Un primo esercizio

1. Inserisci un edificio e premi «Posiziona al clic», poi scegli una superficie nella mappa.
2. Regola la scala e la rotazione nell'ispettore. Duplica l'edificio per costruire un isolato.
3. Aggiungi alberi, lampioni e auto statiche. Usa «Appoggia a terra» dopo averli spostati.
4. Premi «Prova», clicca nella mappa, muoviti con WASD e usa F vicino a un veicolo originale per entrarvi. F2 riapre l'editor.
5. Esporta la scena per conservarla fuori dal browser. Importarla sostituisce gli oggetti dell'editor; puoi annullare l'operazione.

Comandi editor: W sposta, E ruota, R scala, F inquadra; Ctrl+D duplica, Canc elimina, Ctrl+Z annulla, Ctrl+Y o Ctrl+Shift+Z ripete, Ctrl+S esporta. Trascina per orbitare, tasto destro per la panoramica, rotella per zoomare. Quando scrivi nei campi, i tasti non controllano il personaggio.

## Sketchfab e modelli

Cerca «albero», «auto», «edificio», «lampione» oppure termini inglesi. Alcuni termini italiani comuni sono tradotti automaticamente. Per scaricare, apri «Accesso ai download» e inserisci il token del TUO account Sketchfab; la ricerca pubblica può funzionare senza autenticazione. Il token non viene salvato nei preferiti o nei file scena.

La selezione aggiunge un oggetto statico. Importare una macchina non crea automaticamente ruote fisiche, sedili o un motore; importare un personaggio animato non lo trasforma in un pedone con IA. L'editor conserva la geometria, mentre il comportamento deve essere assegnato da un prefab funzionale.

Sono accettati GLB 2.0 con risorse incorporate, massimo 50 MB per file e complessivamente per pacchetto esportato. Gli archivi glTF/ZIP vengono segnalati: scaricali dalla pagina del modello, aprili in un programma 3D e riesporta un GLB con texture incorporate. La prima versione non include decoder Draco/KTX2 né riproduzione delle animazioni importate. I modelli vengono normalizzati a quattro metri sul lato maggiore; regola poi la scala.

La ricerca è stata provata dal browser. Il download autenticato da Sketchfab richiede il tuo token e non è stato verificato con un account personale. Importazione locale, persistenza e pacchetti sono coperti dalle verifiche incluse.

Riferimenti ufficiali: https://sketchfab.com/developers/data-api/v3 e https://docs.sketchfab.com/data-api/v3/index.html.

## Come portarlo verso un gioco in stile GTA

La base contiene già `Character`, stati di movimento e ingresso/uscita dai veicoli, `Car`, `Vehicle`, `Helicopter`, `FollowPath` e `FollowTarget`. Questo riduce il lavoro iniziale, ma non equivale a un gioco open world completo.

Il primo obiettivo sensato è una piccola esperienza completa: parti a piedi, raggiungi una macchina, sali, guida fino a una destinazione, completa una consegna e ricevi una ricompensa. Un quartiere compatto basta per verificare se il gioco è divertente.

| Passo | Lavoro concreto | Criterio di completamento |
|---|---|---|
| 1. Quartiere giocabile | Strade, marciapiedi, collisioni, punti di partenza e parcheggi nell'editor | Il personaggio e una macchina attraversano tutto il quartiere senza bloccarsi |
| 2. Prefab funzionali | Assegnare a un modello il tipo `prop`, `vehicle`, `pedestrian`, `missionTrigger`; aggiungere metadati per ruote, sedili e porte | Una macchina della libreria diventa guidabile tramite configurazione salvata |
| 3. Missione completa | Stati disponibili/in corso/completata/fallita, trigger di arrivo, obiettivi e ricompensa | Una consegna è completabile dall'inizio alla fine e ripristinabile da salvataggio |
| 4. Città viva | Grafo corsie per traffico, percorsi pedonali, ostacoli, semafori, distanza di attivazione degli NPC | Un numero limitato di auto e pedoni si muove senza attraversare muri o creare ingorghi permanenti |
| 5. Inseguimenti | Eventi di infrazione, livello di allerta, pattuglie, ricerca e perdita del bersaglio | Un inseguimento può iniziare, evolversi e finire |
| 6. Mappa più grande | Settori caricati per distanza, LOD, istanze per oggetti ripetuti, limiti di texture e fisica | Il frame time resta stabile sul dispositivo scelto mentre si attraversano più quartieri |

`src/ts/vehicles/MyCar.ts` è un punto di partenza per adattare modelli nuovi, ma contiene coordinate fisse di ruote, sedili e porte: vanno rese configurabili nell'editor. Per gli NPC esistono già comportamenti di inseguimento e percorsi; traffico, regole stradali e navigazione urbana richiedono un sistema aggiuntivo.

Per sfruttare bene l'AI, il passo successivo è farle produrre comandi strutturati, ad esempio «aggiungi 8 alberi lungo questo tratto», validati e inseriti nella stessa cronologia annulla/ripeti. Un comando dovrebbe specificare il prefab, il riferimento all'asset, posizione e comportamento. La generazione di TypeScript libero del sandbox rimane uno strumento sperimentale; la costruzione della mappa dovrebbe passare da queste operazioni verificabili.

Il progetto può diventare un prototipo urbano originale nel browser. Per una produzione molto più grande occorrerà rivalutare strumenti per terreni, streaming, animazioni, navigazione e contenuti. Prima di distribuire il progetto, chiarisci anche la licenza del codice: il package originale dichiara `UNLICENSED`, e i modelli hanno licenze individuali.

## Limiti della prima versione

Gli oggetti della mappa originale non sono modificabili dall'editor; il JSON salva gli oggetti aggiunti sopra quella mappa. Le collisioni sono box statici: una chioma o un edificio con un passaggio possono richiedere collider separati in una versione successiva. Le auto nuove sono statiche, mentre quelle originali mantengono il comportamento del motore. Lo stato di missioni, NPC e movimento del giocatore non è incluso nei file scena. L'editor è pensato per desktop e massimo 500 oggetti. Il salvataggio automatico è specifico del browser e dell'indirizzo/porta: per trasferire il lavoro usa il JSON esportato.

## Verifica e manutenzione

```powershell
npm test
npm run build
```

Con il server attivo, apri `/tests/editor-smoke.html` per i test integrati WebGL/Cannon/IndexedDB. Usano una chiave di salvataggio separata e non sostituiscono la scena dell'utente. Il risultato deve terminare con `ALL INTEGRATION CHECKS PASSED`.

Le modifiche principali sono in `src/editor/`, `editor.html`, `3dPicker.js` e nei punti di integrazione di `World.ts`/`InputManagerBase.ts`. Nessun nuovo pacchetto runtime è stato aggiunto.