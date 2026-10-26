# DDS audio e HUD: integrazione verificabile (23 ottobre 2026)

Questo intervento modifica il player della **mappa Unreal migrata**, non il gioco dimostrativo `DdsGame`.

## HUD

- I getter elencati in `blueprint-programs.json.character_metrics` alimentano indicatori HTML con nome della proprietà, risultato percentuale originale e, se disponibili, valori correnti/massimi originali.
- Il valore testuale non viene corretto o inventato se il getter Unreal dà un rapporto maggiore di 1 o negativo; solo il riempimento grafico viene limitato all'intervallo visibile.
- Gli indicatori reagiscono allo stato Blueprint effettivo nel runtime e usano etichette accessibili. Le schermate UMG originali, immagini, pulsanti ed EventGraph restano **non completati**.

## Audio

- Il player osserva le richieste audio prodotte dalle funzioni Blueprint realmente tradotte. Solo la chiamata originale `GameplayStatics.PlaySound2D` con parametri compatibili e `SoundWave` effettivamente pubblicato può avviare audio.
- Le altre chiamate, i SoundCue, MetaSound, la spazializzazione, l'attenuazione e la concorrenza sono segnalate come non supportate, senza sostituirle con effetti sonori generati.
- La pubblicazione deve fornire `audio-manifest.json` al fianco di `blueprint-programs.json`, schema 1, elenco `sounds` con `asset` originale, `kind: SoundWave`, `source_sha256`, `output_sha256` e `filename` relativo `audio/*.wav` (o `.ogg`/`.mp3`). Per ciascun record occorre una prova riproducibile del checksum e della decodifica del file sorgente.
- L'exporter incrementale `python tools/ue2three/ue2three.py migrate-sounds <uproject> --workspace <verified-workspace> --publish-dir <projects/DDS> --limit 4` apre una copia isolata del progetto con l'Unreal installato; usa `SoundExporterWAV` nativo e verifica gli hash della sorgente e del WAV. Gli asset `SoundCue` e `MetaSound` non passano da questo exporter.
- Se non c'è il manifest (HTTP 404), il player espone esplicitamente **0 SoundWave originali pubblicati**. Nessun suono falso viene emesso.
- I browser richiedono un gesto dell'utente prima di consentire certe riproduzioni; una richiesta `play()` non equivale a playback verificato. Il contatore `played` cresce solo dopo la conferma della promise del browser.

## Verifica

`npm test` include i cinque test dedicati a manifest, identità, parametri, playback simulato e visualizzazione HUD. `npm run build` compila il player. I test non dimostrano che gli asset originali siano già esportati, che la visualizzazione corrisponda 1:1 a UMG o che i suoni siano stati ascoltati nel browser.

**Semaforo complessivo audio/HUD: 🟡** fino a export completo, binding degli EventGraph, verifica dei suoni e test manuale in Play.
