# ue2three: riduzione dei tempi · 2026-10-19

## Risultato misurato sul DDS

Modifiche implementate nel tool generico, usando solo le cache già disponibili.
Nessun avvio di Unreal, nuova scansione, export, upload o installazione.

| Scenario | Prima | Dopo | Guadagno osservato |
|---|---:|---:|---:|
| Iterazione con modifica al solo runtime/QA, compilazione già disponibile | 6,296 s medi | 1,175 s medi | 5,36×; −81,3% del tempo |
| Prima compilazione con creazione della nuova cache IR | — | 7,850 s | Nessun guadagno rivendicato |

Due campioni prima: 5,402 / 7,190 s. Due campioni dopo il popolamento della
cache: 1,344 / 1,007 s. Tempi wall clock senza profiler, stesso laptop e stessi
sorgenti DDS. Baseline: orchestrazione del commit 8b29b14. Una sostituzione
controllata dell'hash runtime simula una modifica a Ue2ThreeGameplay.js, senza
modificare quel file né il progetto Unreal. Ogni campione verifica gli hash reali
dei sorgenti/cache e confronta l'intero payload compilato, non soltanto i conteggi.

Payload identico in tutti i campioni:
`7f9e24a00fde073dedd4217d810adfb6ea0f5b080e09fc3d1b4c220df59cb992`.
Risultati strutturati: [ue2three-acceleration-results.json](ue2three-acceleration-results.json).

Il guadagno riguarda questo scenario incrementale. Non misura il tempo per
implementare le API mancanti, l'export di asset o l'intero porting del gioco.
Il numero ridotto di campioni non costituisce una garanzia su altri progetti.

## Cosa cambia nel convertitore

1. **Cache IR distinta dal runtime.** La chiave del compilatore comprende hash
   di sorgenti, AST originali, tipi, tabelle, controlli e moduli del compilatore.
   Una modifica al runtime riusa l'IR; i documenti AST, circa 177 MB per i14
   pacchetti Blueprint letti del DDS, non vengono decodificati e tradotti di nuovo.
2. **Prove sempre invalidate quando serve.** Gli hash runtime restano nella
   versione pubblicata. Una modifica a runtime/QA cambia fingerprint e checksum
   del report: una prova precedente non diventa automaticamente valida.
3. **Controllo dei contenuti prima del riuso.** Nessuna fiducia nei soli timestamp.
   Hash sorgenti/cache controllati a ogni esecuzione; una cache IR corrotta viene
   ricostruita. Un sorgente cambiato rispetto alla scansione viene rifiutato.
4. **Analisi delle dipendenze indipendente dal runtime.** Il piano e i suoi
   pacchetti non rileggono gli AST per un cambiamento al solo runtime. I riferimenti
   alla versione pubblicata e i checksum dei pacchetti vengono aggiornati.

La cache privata si trova in `artifacts/blueprint-compiled/` del workspace;
non è scritta dentro il progetto Unreal. Il tool la usa automaticamente durante
la migrazione Blueprint esistente, senza richiedere una nuova azione all'utente.

## Accelerare lo sviluppo: adattatori condivisi

Il piano ora legge le identità esatte delle API native, le arità osservate e le
funzioni originali che le richiamano. Analizza anche165 entry costanti di eventi
con layout Kismet e raggiungibilità verificati. Non attribuisce a un wrapper le
API presenti soltanto in altri eventi irraggiungibili dello stesso grafo.

| Famiglia di dipendenze | Funzioni bloccate coinvolte | API distinte osservate |
|---|---:|---:|
| Oggetti e componenti | 244 | 113 |
| Matematica nativa | 152 | 80 |
| Clock e timer | 66 | 7 |
| Dati e contenitori | 37 | 11 |
| Mesh, socket e animazione | 33 | 14 |
| Audio ed effetti | 15 | 7 |
| Query, collisioni e danni | 6 | 2 |

Sono conteggi sovrapposti nei14 pacchetti letti. Le categorie sono suggerimenti
di lavoro; non misurano quante funzioni diventeranno traducibili completando un
adattatore. La presenza di una famiglia già implementata non garantisce supporto
per ogni receiver, overload o forma dei parametri. Le chiamate virtuali senza
receiver risolto sono elencate separatamente e non attribuite a classi inventate.

Esempio concreto per il prossimo intervento: l'API originale
`/Script/Engine.Actor.GetComponentByClass` compare in45 funzioni bloccate.
Conviene implementare una sola risoluzione tipizzata dei componenti originali e
riusarla nei chiamanti. Prima servono i contratti di classe, proprietà e vita degli
oggetti: un semplice ritorno fittizio non soddisferebbe il comportamento Unreal.
Per personaggio/armi seguono inizializzazione dei componenti, mesh/socket e clock
originale; la posizione nella classifica non sostituisce la priorità del gameplay.

Il tool prepara sette pacchetti locali per famiglie native, oltre ai tre pacchetti
strutturali esistenti, con API esatte, witness dei sorgenti ed esempi completi
di dimensione limitata. Possono essere assegnati a chat separate per proposte di
adattatori, poi integrati e verificati qui. Il tool non invia dati a servizi esterni.
Rimosse anche istruzioni obsolete che presentavano scritture/costruttori struct
come interamente mancanti, evitando di richiedere nuovamente lavoro già svolto.

## Verifiche e stato del gioco

- 151 test Python PASS, inclusi8 nuovi test di cache e dipendenze native.
- 97 test JavaScript PASS.
- 719 confronti source DDS PASS, di cui491 relativi all'inventario.
- 187 funzioni tradotte /320 bloccate: quantità e semantica del payload invariate.
- Verifica visiva nuova **non ottenuta**: la scheda integrata resta nello stato
  di errore/protocollo già segnalato. Nessun aggiramento tramite altri browser.

| Area | Stato | Fatto stimato | Restante stimato | Variazione | Beneficio per chi gioca |
|---|---|---:|---:|---|---|
| Riuso della compilazione Blueprint | 🟢 | Scenario verificato | — | Nuovo | Iterazioni più rapide del tool; nessuna nuova meccanica |
| Inventario delle dipendenze native | 🟢 | Sui pacchetti letti | — | Nuovo | Riduce ricerca e duplicazione nello sviluppo degli adattatori |
| Personaggio e armi | 🟡 | 15–25% | 75–85% | Invariato | Al100%: equipaggiamento, fuoco e ricarica originali integrati |
| Blueprint | 🟡 | 5–15% | 85–95% | Invariato | Al100%: regole originali eseguite nella scena |
| Inventario | 🟡 | 15–25% | 75–85% | Invariato | Al100%: oggetti, quantità e scambi collegati al gioco |

Le stime funzionali di tutte le18 aree restano nella
[baseline](ue2three-completion-baseline.md). I due nuovi verdi riguardano capacità
del tool verificate, non la completezza del gioco. Animazioni1:1 ancora rimandate;
illuminazione ultima priorità.


---

## Storico: analisi del 2026-10-14

Snapshot precedente, conservato come storico. I suoi conteggi e le sue lacune
non descrivono lo stato attuale: usare le misure e i contratti sopra.

# Accelerating the original game migration · 2026-10-14

The largest opportunity is extending the reusable Blueprint runtime by shared
capability. Converting source game functions individually would duplicate work.
DDS remains the test project, and successful primitive tests do not establish
complete game fidelity.

## Measured local scope

The first measured snapshot had 13 parsed Blueprint/widget packages, about 167 MiB of raw
JSON, 38 translated functions and 462 blocked functions. Parsing that JSON alone
took 1.787 seconds in one local observation. Translation semantics and native
runtime dependencies are the current engineering bottleneck.

| Shared capability | First blocker | Functions involving it |
|---|---:|---:|
| Event dispatch and persistent frames | 173 | 243 |
| Object references / Context calls | 69 | 146 |
| Structs and containers | 23 | 84 |

232 blocked functions call shared ExecuteUbergraph entry points. This is about
50% of the blocked functions in the parsed subset. Candidate counts overlap,
and removing one blocker can expose another. These are neither guaranteed unlock
counts nor a percentage of the complete game. Another 263 packages are uncached.
The subsequent struct/name batch reached 39 translated / 461 blocked functions.
Struct member reads are supported; constructors and container mutations remain
open. The planner refreshes its counts as later blockers become visible.

## Best next operations

1. Translate reachable event paths while preserving the original persistent
   frame and Kismet offsets. Use UAssetAPI Visit implementations as the layout
   reference. A native operation in an unrelated event should not block an
   otherwise supported entry. Unknown reachable effects must still block it.
2. Build one typed object/native adapter registry. Prioritize the actual source
   dependencies of CanFire: component lookup, object validity and game time.
   Keep exact engine/class identity and explicit missing dependencies.
3. Implement struct/container semantics as a separate module. This supports
   inventory, weapon data and UI bindings without recreating their game rules.
4. Read only missing packages reached from the selected playable scene and its
   dependencies. Keep source checksums, converted outputs and verification caches.
5. Reuse equivalent meshes/textures across maps by identity/checksum. Keep the
   full source quality; geometry reduction and lossy texture shortcuts would
   conflict with the 1:1 target.

UAssetAPI is the public .NET asset reader used by the existing extraction path:
https://github.com/atenfyr/UAssetAPI
It supplies asset/bytecode access, rather than a complete browser game runtime.

## Work that can be handed to separate GLM / ChatGPT chats

The tool creates three standalone Markdown packets with bounded complete source
examples, relevant properties/imports, hashes, scope and acceptance requirements:

- `work-packets/events.md`: event entry dispatch and persistent memory.
- `work-packets/objects.md`: references, Context, nulls and component calls.
- `work-packets/data.md`: source structs and containers.

Assign one packet per chat. Ask for a separate reusable module, its IR contract,
integration points and independently explained test fixtures. Bring the returned
files here for integration and local/browser verification. Avoid several chats
editing the same compiler/interpreter dispatcher concurrently. No packets are
uploaded automatically and no paid API is configured.

Three workers can theoretically reduce calendar time by 40% if 60% of the work
is independent: speedup = 1 / (0.4 + 0.6 / 3) = 1.67. This is a planning scenario,
not a measured prediction for DDS. Review, integration and new dependencies reduce
the gain; we need completed module measurements before estimating the full clone.

## Optimizations already implemented

The cached blocker planner regenerates only when program/compiler inputs or its
outputs change. One local comparison measured 5.660 seconds for a fresh plan and
0.532 seconds for cache reuse: 90.6% less time for this planning step. This figure
does not apply to the whole migration. The three packets total about 85 KB instead
of requiring the raw 167 MiB cache as each chat's starting input; they contain
selected examples, not the entire project.

The plan is generated automatically by migrate-blueprints and can be refreshed
by plan-blueprints. Its output is blueprint-plan.html next to progress.html.

## External machines

Another Windows machine is useful for future expensive engine exports/bakes and
can return checksummed outputs to the same cache. A VPS or notebook can run pure
asset validation, hashing and independent module tests. Their value depends on
measured jobs and transfer time. A GPU notebook would have little effect on the
current 1.8-second JSON parse or the missing Blueprint/native semantics.

For now, the best parallel resource is independent work on the three runtime
modules. Keep the current laptop as the integration and visual verification site.
