# SketchbookAI — Sketchfab e Fab nello stesso picker

## Non caricare mai più il JSON a ogni avvio

- **App locale:** lascia una sola volta `/.local/sketchfab.json` nella cartella del progetto (esclusa da Git). L'app lo legge automaticamente ogni volta che si apre su localhost.
- **Browser online / Android:** apri il picker > Sketchfab > Accesso ai download, incolla una volta il token o il JSON `{"tokens":["..."]}` e premi **Salva su questo dispositivo**. La configurazione è conservata in IndexedDB, associata all'origine del sito, e viene letta automaticamente dopo un refresh o riavvio del browser. Nessun upload ricorrente.
- **Revoca:** premi **Elimina accesso salvato**. Cancellare i dati del sito o cambiare dispositivo/browser richiede una nuova configurazione.
- **Sicurezza:** IndexedDB non è un archivio crittografato: il codice JavaScript della stessa origine può leggerlo. Non usare un dispositivo condiviso o un sito di cui non ti fidi. Il JSON/tokens non sono sincronizzati con GitHub né esposti nelle esportazioni delle scene. Quando possibile, preferire un proxy autenticato lato server con segreti protetti.


## Sketchfab: configurazione locale

Il file privato /.local/sketchfab.json viene caricato automaticamente solo da localhost / 127.0.0.1. La cartella /.local/ è esclusa da Git. GitHub non contiene questo file: deve restare sulla macchina che avvia Sketchbook.

Formato precedente, ancora supportato:

    { "token": "TUO_TOKEN_SKETCHFAB" }

Formato nuovo per più credenziali di tua proprietà:

    { "tokens": ["TOKEN_1", "TOKEN_2"] }

È possibile specificare entrambi. Le stringhe vengono validate, deduplicate e conservate solo in memoria. Ogni richiesta usa una credenziale locale; su HTTP 401 la credenziale rifiutata viene tolta dalla lista in memoria. Non si alternano le credenziali per aggirare HTTP 429 o 403. Il campo token manuale del picker ha precedenza. Non pubblicare il JSON né includerlo in commit.

I token condivisi in conversazioni o messaggi andrebbero rigenerati dall'account proprietario.

## FabCLI — installazione facoltativa, non ufficiale

FabCLI: https://github.com/zirklerite/FabCLI

FabCLI comunica con API Fab/Epic non documentate. Il progetto avverte che l'uso può violare termini e comportare rischi per l'account. Questa integrazione è opt-in, non viene avviata da Sketchbook automaticamente, e non effettua login, claim, né acquisti in background.

1. Installa FabCLI dalla release verificata e aggiungi il binario al PATH.
2. Sul tuo PC esegui: fabcli auth login. Completa il login Epic nella finestra FabCLI. Non incollare password Epic o refresh token in Sketchbook.
3. Controlla la sessione: fabcli auth status.
4. Avvia il bridge dalla cartella Sketchbook: node tools/fab-bridge.cjs.
5. In un altro terminale avvia Sketchbook: npm run editor. Apri l'URL localhost stampato da webpack.
6. Apri Libreria modelli > Fab, cerca BMW e importa un asset già presente nella tua libreria, disponibile in GLB, glTF o ZIP glTF.

Il bridge esegue la ricerca con FabCLI e il download solo dopo il clic Importa. Non trasferisce sessione Epic o credenziali al browser. L'accesso è limitato a 127.0.0.1 e a pagine dell'editor su localhost. Il picker condivide titolo, immagine, informazioni di licenza, preferiti e importazione. Se un asset non appartiene al tuo account, il pulsante apre la pagina per acquisirlo legittimamente.

Limiti: il bridge non funziona sulla demo Netlify e richiede un computer con FabCLI e login. Il download avviene soltanto per asset a cui l'account ha accesso. La conversione di .uasset, FBX e altri formati proprietari in GLB non è implementata. GLB e glTF importati sono inizialmente oggetti statici: auto guidabili e NPC richiedono ancora rigging, collisioni, punti di ingresso e animazioni.

## Verifiche

Node: node --test tests/editor.test.mjs tests/fab-bridge.test.cjs

Build: npm run build

La prova reale su Fab richiede FabCLI, login Epic e l'avvio manuale del bridge.
