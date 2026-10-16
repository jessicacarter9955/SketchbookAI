# Fab online per SketchbookAI (Render + FabCLI)
Il backend Fab ora gira in un container separato su Render:
https://sketchbook-fab-bridge.onrender.com/health

La libreria di Sketchbook online è:
https://my-test-site3.netlify.app/editor.html

## Primo collegamento (non serve installare FabCLI sul PC)

1. Apri l'editor e il pannello **Cerca su Sketchfab → Fab**.
2. Apri **Connetti Fab a Epic Games (una volta)**.
3. Incolla la chiave privata Fab (creata tra le variabili d'ambiente Render, mai messa su GitHub). Premi **Salva chiave Fab**. Resta memorizzata in IndexedDB nel browser attuale: non devi ricaricare file JSON ogni volta.
4. Premi **Accedi a Epic Games** e completa l'autenticazione SOLO sul sito Epic. Al termine vedrai un piccolo JSON che contiene `authorizationCode`; copia solo quel campo e incollalo nel modulo di Sketchbook.
5. Premi **Collega Epic al bridge**. Dopo risposta positiva, ricerca ad esempio **BMW** e premi **Importa** su un modello già acquisito nel tuo account, disponibile in formato GLB o glTF/ZIP.

La password Epic e le credenziali FabCLI non entrano nel repository. Il codice di autorizzazione viene passato una volta al servizio Render tramite HTTPS, senza registrarlo nei log; il bridge stesso richiede una chiave privata per le operazioni e verifica che le richieste browser provengano dal sito Netlify autorizzato. I modelli vengono consegnati al browser attraverso una richiesta autenticata e importati in Sketchbook, senza file da selezionare manualmente.

Il bridge espone `/health` pubblicamente senza dati sensibili, e `/status`, `/search`, `/download` e `/auth/code` solo con chiave privata. Non fornisce download non autenticati.

## Limiti

- **Render gratuito non ha disco permanente:** la sessione Epic locale può essere persa quando il container viene ricreato, ad esempio dopo un deploy o riavvio. In tal caso occorrerà un nuovo codice Epic. La chiave salvata nel browser rimane disponibile.
- **FabCLI è non ufficiale.** La documentazione dell'autore avverte che API non documentate possono smettere di funzionare e che l'uso può comportare rischi per l'account Epic. Nessun acquisto o claim automatico viene eseguito.
- I modelli **.uasset/FBX** non possono essere importati automaticamente in Three.js dal backend attuale; sono ammessi GLB e glTF/ZIP entro 50 MB.
- L'importazione aggiunge per ora un oggetto nella scena. Per renderlo un'auto guidabile o NPC occorre collegarlo esplicitamente al prefab con fisica e controlli; non è ancora disponibile la conversione automatica.
- La chiave salvata nel browser è leggibile da eventuali script della stessa origine: usa soltanto il sito Sketchbook ufficiale e un dispositivo personale.
