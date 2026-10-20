# Personaggio e armi · checklist di chiusura

Aggiornamento: 20 ottobre2026. Stato complessivo: **🟡 incompleto**.
Le prove offline sui dati non dimostrano un personaggio completo e giocabile1:1.

| Passaggio | Stato | Evidenza / lavoro restante |
| --- | --- | --- |
| Mesh e socket di personaggio, rifle e pistol | 🟡 | Esportati; trasformazioni sorgenti disponibili. Serve accettazione visiva corrente nella scena. |
| Selezione montage equip/unequip | 🟢 dati |36 confronti dei selettori originali; nessuna esecuzione del montage implicita. |
| Collegamento inventario → query combattimento | 🟢 dati | Adapter generico con classi/SCS originali e dipendenze controllate; esecuzione mutante ancora esclusa. |
| Condizione di ricarica e notifica munizioni | 🟢 dati |26 confronti originali. Oggetti QA espliciti e offline; nessun attore arma generato nella scena da queste prove. |
| Condizione di sparo originale | 🟢 dati |17 casi CanFire: munizioni, cadenza double, traversal, equip/unequip e ricarica. Non equivale al ciclo TryFire/Server_Fire integrato. |
| Trasferimento munizioni dell'inventario | 🟢 dati |15 casi dell'originale Server_ReloadWeapon, con consumo/rimozione stack, slot primario/secondario e anomalie sorgenti conservate. Timer e callback del combattimento non ancora collegati. |
| Inizializzazione originale dei componenti e delegate | 🔴 | InitializeCombatComponent/BeginPlay e collegamenti fra istanze ancora da eseguire. |
| Equip/unequip e attore arma originali | 🔴 | Ciclo completo, native mesh adapters e sette funzioni BPA_Weapon ancora bloccati. |
| Sparo completo | 🔴 | Clock simulato double e CanFire disponibili; TryFire/Server_Fire, consumo, trace, danni e callback originali ancora da collegare. Il trace corrente è dimostrativo. |
| Ricarica completa | 🟡 | Trasferimento munizioni sorgente verificato nell'inventario; timer, completamento/interruzione e collegamento al combattimento mancanti. Il tasto R corrente attiva principalmente una clip. |
| Animazioni e IK | 🟡 |45 clip disponibili; controller/IK/montage-notify completi ancora da portare. Verifica1:1 rimandata su richiesta. |
| Movimento1:1 | 🟡 | Vincoli sorgenti sprint/salto collegati; controller Mover completo e consumo stamina non ancora trasposti. |
| Effetti, audio e verifica giocando | 🔴 | Native effects/audio non ancora portati; nessuna nuova accettazione visiva nel browser bloccato. |

## Verifiche salvate

- 158 test Python,102 test JavaScript; build editor24 riuscita.
- 751 confronti sui dati sorgenti,506 relativi all'inventario; tutte le aspettative passano.
- 206 funzioni tradotte /363 bloccate su19 pacchetti letti. Denominatore569, prima507: cinque letture mirate hanno aggiunto62 funzioni al perimetro, senza nuova scansione o avvio UE.
- `build/local-scenes/ue2three/projects/VIPExtractionKitDDS-23a280ac11/blueprint-offline-verification.json` è una prova locale sui dati, esclusa dal repository insieme agli asset del progetto.
- La scheda integrata è rimasta su un documento interno di errore. Browser Use ne rifiuta l'accesso; serve ricaricarla manualmente prima di ottenere nuovi screenshot. Nessuna prova visiva sostitutiva è stata dichiarata.

## Ordine di lavoro

1. Inizializzazione e collegamenti originali degli oggetti; stato iniziale dell'equipaggiamento.
2. Mesh/socket nativi e ciclo di vita dell'attore arma.
3. Equip/unequip, sparo e ricarica originali con effetti transazionali.
4. Collegamento ai comandi della scena, confronto dei dati ed esecuzione visibile.
5. Verifica1:1 delle animazioni quando riattivata dall'utente.

Conservare tutte le asimmetrie originali: grip12 ha equip HipLeft ma unequip nullo;
CanReload non controlla bIsUnequipping o bIsFiring e non applica clamp inventati.
Gli enum iniziali nominativi ora usano le definizioni sorgenti; TraceChannel resta
esplicitamente senza mapping nativo. Riutilizzare cache, export e pacchetti già
letti; non avviare Unreal né ricostruire regole DDS a mano.

## Correzioni e limiti del checkpoint del20 ottobre

- Aggiunti lookup dei componenti SCS originali e lettura tipizzata dei loro
  campi. Classi non risolte, construction script non banali, template corrispondenti
  indisponibili e ordine ambiguo continuano a bloccare. Un template camera non
  rappresentabile non deve bloccare il lookup di un'altra classe nota distinta.
- Il clock è un double esplicito della simulazione: niente Date.now; uno step0
  conserva la pausa. Cambiare personaggio conserva il tempo del mondo. La sua
  presenza non implica timer/azioni latenti o l'intero movimento Mover.
- Aggiunte scritture di campi struct e operazioni su array nei frame persistenti
  originali. La ricarica dell'inventario dipendeva da queste capacità condivise.
- Il primo tentativo con struct persistenti ha esposto TypeError: unhashable
  type: dict. La compattazione rimappava ogni campo target come salto, compresi
  i target delle scritture. Ora rimappa soltanto jump, branch e push_flow, con
  regressione dedicata. Le scritture riacquisiscono anche lo storage dopo una
  chiamata RHS annidata, evitando di modificare un oggetto JS ormai sostituito.
- Due aspettative iniziali sulla ricarica sono fallite: ricerca senza munizioni
  e munizioni di tipo errato. Nel bytecode originale FindAmmoInCarry assegna
  FoundIndex=-1 all'istruzione4, poi0 all'istruzione7. Se la ricerca fallisce,
  restituisce quindi Found=true, Quantity=0 e SlotIndex=0. Server_ReloadWeapon
  può rimuovere il primo stack anche se non adatto, senza aumentare il caricatore.
  Aspettative corrette sulla base di quelle istruzioni, senza correggere le
  regole del DDS. Conservati anche HP=-1 ricostruendo lo slot e il consumo dal
  solo primo stack corrispondente.
- Nel sorgente InitializeWeapon sono presenti offset mesh letti da DT_Items,
  oltre al socket scheletrico. Il runtime corrente non esegue ancora quella
  inizializzazione: non dichiarare socket/equipaggiamento completi.

Stime complessive invariate: personaggio/armi15–25%, restante75–85%.
Questi verdi sono confronti di dati e contratti del tool, non accettazione
visiva o completamento del ciclo giocabile.
