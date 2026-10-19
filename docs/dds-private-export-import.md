# Import privato di export DDS/ue2three in Three.js

Quest'implementazione collega effettivamente il GLTFLoader di `ActorLayer`
a GLB esportati dal tool originale, salvati in IndexedDB dello **stesso**
dominio Netlify / profilo browser. Senza questo percorso il player cercava
`build/local-scenes/dds/manifest.json` e falliva con HTTP 404.

## Flusso

1. Genera gli export reali **dal tuo progetto Unreal DDS originale** attraverso
   `tools/ue2three/ue2three.py migrate-character` con la recipe DDS, oppure
   usa un export già generato dallo stesso tool. Per il precedente formato
   legacy `tools/export-dds.ps1` produce `manifest.json` versione 1.
2. Apri `dds-manual-playtest.html` nello stesso dominio della preview.
3. Premi **Importa export ue2three** o **Importa export DDS legacy**,
   seleziona la cartella che contiene `manifest.json` e tutti i GLB.
4. La pagina legge header + JSON interni di ogni GLB 2.0 e controlla
   dimensioni, geometria, animazioni e manifest. Salva tutto in IndexedDB;
   non invia file a GitHub, server, o Netlify. Il pack precedente non viene
   sostituito se la validazione fallisce.
5. Premi **Apri personaggio ue2three**. `ActorLayer` usa i Blob URL del pack
   di `ue2three`. Per il legacy usa **Apri DDS Portland**, ma la mappa
   Liberty City è richiesta separatamente e potrebbe mancare nella preview.
6. Ripeti il collaudo manuale; report automatici restano gated dopo la tua
   approvazione. La presenza di un asset non equivale a fedeltà 1:1.

## Limiti e protezioni

- Cartelle Google Drive che contengono solo nomi non sono esportabili. Non
  scarichiamo né inventiamo mesh, animazioni, texture o Blueprint assenti.
- Il file più grande ammesso è 160 MiB, un pack 900 MiB; il browser può
  imporre quote IndexedDB inferiori. Se gli originali superano questi limiti
  occorre uno streaming locale o asset hosting autorizzato.
- Il nome di ogni GLB deve essere sicuro e non duplicato, ed essere esattamente
  quello richiesto dal manifest; risorse esterne ai GLB non sono consentite.
- `source_verification: not_verified_against_original_unreal` è permanente
  fino a evidenza da un export autentico, confronto visivo e QA funzionale.
- Questo non porta ancora i sistemi Unreal AnimBP, rete, inventory, MetaHuman
  o eventi complessi. Il player riutilizza soltanto runtime DDS già presenti.
- La conservazione per origine browser non è un backup. Pulizia dati del sito
  o browser differente richiedono una nuova importazione.
