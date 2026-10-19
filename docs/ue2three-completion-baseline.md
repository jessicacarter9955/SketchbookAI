# Completamento DDS → Three.js: riferimento iniziale

Data: 19 ottobre 2026. Percentuali **stimate e provvisorie**, basate sui progressi
salvati e sugli output disponibili; nessuna nuova scansione o verifica visiva.

## Cosa significa 100%

Il riferimento è il progetto DDS originale completo: tutti i contenuti e i flussi
usati nelle sue scene giocabili, con il comportamento originale. Le scene
dimostrative e i confronti offline hanno un proprio ambito di verifica.

Un'area raggiunge il 100% quando:

1. Il suo ambito sorgente è censito: contenuti, dipendenze e flussi previsti.
2. I contenuti e i comportamenti richiesti sono convertiti e integrati.
3. I flussi originali, i casi limite e i collegamenti con le altre aree funzionano.
4. Le verifiche pertinenti passano, con evidenze visive per i risultati visibili.
5. Non rimangono sostituzioni dimostrative o dipendenze mancanti nel suo ambito.

Le percentuali sotto sono valutazioni ingegneristiche della completezza funzionale
della checklist, con intervalli per l'incertezza. Non sono misure del tempo già
speso o del tempo restante. Non derivano automaticamente dal numero di file,
funzioni o test: completare molti getter non completa un ciclo di combattimento.
Gli intervalli non sono intervalli di confidenza statistica.

## Baseline per tutte le aree

| Area | 100% significa | Fatto stimato | Resta stimato | Stato |
| --- | --- | --- | --- | --- |
| Verificatore dei dati supportati | Confronti riproducibili su output, stato ed effetti delle capacità supportate, con identità sorgenti e prove salvate | 100% dell'ambito attuale | 0% dell'ambito attuale | 🟢 |
| Personaggio e armi | Personaggi giocabili, rig/materiali/socket, movimento, equip/unequip, mira, sparo, ricarica, munizioni e danni originali integrati e verificati | 15–25% | 75–85% | 🟡 |
| Clip di animazione | Tutte le clip necessarie ai flussi originali, con curve, root motion e notify pertinenti, riproducibili e confrontate | 5–10% | 90–95% | 🟡 |
| Sistemi di animazione e IK | Stati, transizioni, montage, blending, Motion Matching e IK originali eseguiti con corretta sincronizzazione | 0–5% | 95–100% | 🔴 |
| Blueprint e moduli nativi | Logica usata dal gioco, oggetti, eventi, delegate, timer e chiamate native tradotti ed eseguiti nei flussi completi | 5–15% | 85–95% | 🟡 |
| Inventario, equipaggiamento e loot | Raccolta, stack, slot, trasferimenti, equipaggiamento, munizioni e notifiche originali collegati alla scena e alla UI | 15–25% | 75–85% | 🟡 |
| Salvataggi e persistenza | Salvataggio e ripristino dello stato originale previsto, inclusi rientro nel gioco e gestione dei fallimenti | 0–5% | 95–100% | 🔴 |
| Geometria e trasformazioni | Geometria, terreno, gerarchie e trasformazioni delle scene originali corretti e confrontati | 10–20% | 80–90% | 🟡 |
| Materiali, texture e shader | Aspetto originale dei contenuti usati, compresi canali, istanze, funzioni e parametri dinamici, senza ripieghi irrisolti | 10–20% | 80–90% | 🟡 |
| Mappe e streaming | Tutte le mappe giocabili previste, spawn, caricamento e passaggi tra livelli funzionanti | 5–10% | 90–95% | 🟡 |
| Menu, HUD e schermate | Layout, immagini, stili, input, binding ed eventi delle schermate originali funzionanti | 0–5% | 95–100% | 🟡 |
| NPC, shop, dialoghi e missioni | Interazioni, AI, condizioni, transazioni, conversazioni e progressione presenti nella sorgente funzionanti | 0–5% | 95–100% | 🔴 |
| Modalità, lobby e raid | Avvio, lobby, ingresso, partita, morte, estrazione e ritorno secondo i flussi originali | 0–5% | 95–100% | 🔴 |
| Collisioni e fisica | Collisioni, canali, query, contatti e comportamenti fisici usati dal gioco equivalenti alla sorgente | 0–5% | 95–100% | 🔴 |
| Effetti e groom | Effetti visivi originali necessari alle scene, con materiali, trigger e tempi corretti | 0–5% | 95–100% | 🔴 |
| Audio e sequenze | Suoni, attenuazione, cue, MetaSound e sequenze usati dal gioco, con eventi e sincronizzazione originali | 0–5% | 95–100% | 🔴 |
| Multiplayer e servizi | Autorità, RPC, replica, sessioni e servizi previsti funzionanti tra più client | 0% | 100% | 🔴 |
| Illuminazione e postprocessing | Luci, ambiente, esposizione, ombre, riflessi e postprocessing confrontati nelle scene originali | 5–10% | 90–95% | 🟡 |

Il verificatore al 100% riguarda le capacità di confronto già supportate.
Le prove del gioco completo, il confronto visivo automatico universale e le
future capacità del traduttore richiedono ulteriore lavoro di verifica.

## Evidenze e incertezza

- 719 confronti sui dati sorgenti passati, di cui 491 sull'inventario.
- 187 funzioni tradotte e 320 bloccate nei pacchetti letti; 262 pacchetti
  Blueprint ancora senza lettura. Tra le funzioni tradotte figurano 6 funzioni
  vuote e 56 callback senza effetti di gioco. Questo limita la stima sui Blueprint.
- 45 clip pubblicate su 1590 AnimSequence censite; le sequenze includono pose e
  varianti. Il denominatore delle clip necessarie a tutti i flussi resta da chiudere.
- 1 file mappa pubblicato su 10 file censiti; il registry elenca 6 World.
  File, World e peso funzionale delle mappe non sono unità intercambiabili.
- 152 trasformazioni confrontabili coerenti, 3072 vertici di terreno corretti,
  8 ripieghi materiali nella mappa selezionata e 66 collegamenti diretti shader letti.
- 2 accessori arma pubblicati, 20 mesh scheletriche censite, 1 gerarchia UI
  pubblicata su 57 widget censiti.
- Il ciclo originale di sparo/ricarica/equipaggiamento nella scena è incompleto.
  Le identità oggetto usate nei nuovi confronti offline non provano il ciclo di vita
  degli oggetti nel gioco.
- Animazioni: verifica 1:1 rimandata su richiesta dell'utente. Nessuna promozione
  al verde finché la verifica pertinente resta sospesa.
- L'accettazione visiva corrente è sospesa per il blocco della scheda integrata.

## Come aggiornare le percentuali

Ad ogni aggiornamento comunicare **area, fatto stimato, restante, variazione e
criterio di chiusura completato o ancora mancante**. Il verde richiede il 100%
verificato dell'area dichiarata. I sottopassi verificati conservano il proprio
ambito, esplicitando se la prova è offline o nella scena.

Le stime salgono quando viene completato un passaggio della checklist funzionale
o aumenta in modo dimostrabile la copertura dei contenuti richiesti. Nuovi test
su una capacità già verificata non producono da soli un incremento.

Quando emergono funzioni o contenuti prima non censiti, aggiornare il denominatore,
motivare l'eventuale revisione della percentuale e conservare il precedente valore.
Gli ambiti si sovrappongono: **non sommare né mediare queste percentuali** per
ottenere il completamento del gioco. Una percentuale complessiva richiederà un
elenco dei flussi originali con pesi e copertura verificabile.

Riferimenti locali: progress.json e blueprint-programs.json pubblicati sotto
build/local-scenes/ue2three/projects/VIPExtractionKitDDS-23a280ac11/;
checklist specifica: [Personaggio e armi](ue2three-character-weapons.md).
