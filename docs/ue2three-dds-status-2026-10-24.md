# DDS → Three.js — checkpoint di continuità, 24 ottobre 2026

**Fonte verificabile:** repository `jessicacarter9955/SketchbookAI`, branch
`chatgpt/ue2three-dds`; progetto originale `VIPExtractionKitDDS.uproject`
su Windows. Questo documento serve anche a riprendere il lavoro quando una
conversazione ChatGPT non si carica. I GLB originali/licenziati restano locali.

## Semafori e prove

| Ambito | Ultima prova | Stato |
| --- | --- | --- |
| GLB principali | Manifest PC `asset-export/manifest.json`: 56/58 verificati, 2 falliti, generato il 24 ottobre alle 12:47 UTC. | 🟡 |
| Mappe | Otto GLB in `dds-assets/maps/maps/` hanno risposto HTTP 200 sul server locale 8401; `LV_Fixers_Startup` e `GalleryLevel` non complete. | 🟡 |
| Gallery | `GalleryPartialSource.glb` (52.264.952 byte); 163/185 attori coperti da geometria, 22 non coperti. Luce, VFX, spawn e altri attori non-mesh richiedono adapter Three.js tipizzati. | 🟡 |
| Materiali originali | Grafi sorgente recuperati secondo report precedente; fedeltà shader originale e confronti visivi non certificati. | 🟡 |
| Blueprint | Ricompilazione isolata sui *medesimi* SHA sorgenti: 436→439 tradotte, 1.521→1.518 bloccate. Tre funzioni `CBP_Fixers_Mover_ABP` convertite. | 🔴 gioco / 🟢 incremento offline |
| Runtime e Play DDS | End-to-end originale e Play manuale non superati; il `dds-portland` training raid è un demo distinto. | 🔴 |
| Test di migrazione CI | Workflow UE2Three verde al commit `4e3e29c` (nuove modifiche successive da verificare). | 🟢 nell'ambito testato |
| Deploy Netlify | La build GitHub ha passato lo step Build; lo step `Verify Netlify credentials` è fallito e il deploy è stato saltato. | 🔴 |
| Server locale | Il PC serve con HTTP 200 `/editor.html`, `/ue2three-level.html`, `/ue2three-character.html`, `/ue2three-blueprint.html`, otto mappe GLB e il `GalleryPartialSource.glb`; rendering/Play da provare. | 🟢 trasporto HTTP, non fedeltà |

Non equiparare un file valido o una funzione che compila all'integrazione
effettiva. Per diventare verdi servono fonte completa, conversione integrata,
runtime reale, test pertinenti e accettazione manuale.

## Modifiche fatte in questo ciclo

1. Aggiunti traduzione e runtime per `VSizeXY` e `Conv_IntToInt64` con controllo
   rigoroso dei parametri originali; chiamate ora superate, ma le funzioni
   possono essere bloccate da altri vincoli (per esempio struct irrisolte).
2. Aggiunta conversione `Conv_LinearColorToVector` e corretta la lettura
   `EX_StructConst.Struct` di UAssetAPI, con regressioni.
3. Riprodotta la formula di Unreal Engine **5.7** `FMath::FInterpTo` dal suo
   `UnrealMathUtility.h` installato sul PC; questa modifica ha permesso le
   tre traduzioni reali `Update_AnimationBlendWeights`,
   `Update_WeaponOverlay`, `Update_WeaponStateAlphas`.
4. Corretto `compare_blueprint_reports.py`: ora confronta davvero la mappa
   `packages[*].functions`, anziché un campo inesistente `translated`;
   aggiunti quattro test di verifica della corrispondenza SHA sorgente.
5. Implementato compilatore/runtime del salto dinamico originale
   `ExecuteUbergraph` limitato al parametro `EntryPoint` Int32 verificato e
   alla tabella completa dei confini VM. I 153 casi di primo blocco sono
   `EX_LocalVariable EntryPoint`; la ricompilazione sul PC deve ancora
   determinare il guadagno reale e gli ulteriori blocchi.
6. Pubblicata [la checklist completa per il tester](ue2three-dds-manual-play-acceptance.md)
   con ID, azioni e risultati attesi, distinguendo il demo dalla sorgente DDS.

## Report locali PC da recuperare

Percorsi relativi alla checkout d'integrazione Windows:

- `.local/ue2three/asset-export/progress.json` e `manifest.json` — numeri
  GLB, heartbeat e log delle due lane originali.
- `.local/ue2three/blueprint-translation-20261024/blueprint-programs.json`
  — base 436/1.521.
- `.local/ue2three/blueprint-finterp-verify-20261024/blueprint-programs.json`
  — 439/1.518, stesso snapshot fonte, tre funzioni nuove.
- `.local/ue2three/blueprint-entrypoint-verify-20261024/` — output del job
  di ricompilazione successivo: **non assumere conclusione prima di leggerlo**.
- `.local/ue2three/gallery-assembled-20261024/GalleryPartialSource.glb`
  — geometria Gallery ancora incompleta.

## Continuità, se ChatGPT non carica questa conversazione

Aprire una nuova conversazione e dare questi tre link:

1. Branch: `https://github.com/jessicacarter9955/SketchbookAI/tree/chatgpt/ue2three-dds`
2. Questo checkpoint: `docs/ue2three-dds-status-2026-10-24.md`.
3. Checklist Play: `docs/ue2three-dds-manual-play-acceptance.md`.

Istruzione di ripresa: **controlla gli strumenti GitHub e bridge realmente
disponibili, leggi il checkpoint e i report locali aggiornati; non rifare gli
export già sorgente-verificati; finisci GLB mancanti, mappe, Blueprint,
integrazione Three.js e test automatici. Io farò soltanto il Play manuale.**

Un job deve avere un ID univoco, checkpoint atomici, log e PID indipendenti
dalla chat. Un `unknown_after_restart` del bridge non equivale a conversione
fallita: verificare prima il report finale e la presenza del processo.

Non cancellare asset originali, `Content` Unreal, GLB utilizzabili, checkpoint
o log necessari a riprendere i job. Nessuna percentuale per il gameplay DDS
viene dedotta dalla sola conta dei file o delle funzioni.
