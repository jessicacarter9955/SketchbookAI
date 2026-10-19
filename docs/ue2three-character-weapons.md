# Personaggio e armi · checklist di chiusura

Aggiornamento: 19 ottobre2026. Stato complessivo: **🟡 incompleto**.
Le prove offline sui dati non dimostrano un personaggio completo e giocabile1:1.

| Passaggio | Stato | Evidenza / lavoro restante |
| --- | --- | --- |
| Mesh e socket di personaggio, rifle e pistol | 🟡 | Esportati; trasformazioni sorgenti disponibili. Serve accettazione visiva corrente nella scena. |
| Selezione montage equip/unequip | 🟢 dati |36 confronti dei selettori originali; nessuna esecuzione del montage implicita. |
| Collegamento inventario → query combattimento | 🟢 dati | Adapter generico con classi/SCS originali e dipendenze controllate; esecuzione mutante ancora esclusa. |
| Condizione di ricarica e notifica munizioni | 🟢 dati |26 confronti originali. Oggetti QA espliciti e offline; nessun attore arma generato nella scena da queste prove. |
| Inizializzazione originale dei componenti e delegate | 🔴 | InitializeCombatComponent/BeginPlay e collegamenti fra istanze ancora da eseguire. |
| Equip/unequip e attore arma originali | 🔴 | Ciclo completo, native mesh adapters e sette funzioni BPA_Weapon ancora bloccati. |
| Sparo completo | 🔴 | Clock/cadenza, munizioni, trace, danni e callback originali da collegare; il trace corrente è dimostrativo. |
| Ricarica completa | 🔴 | Trasferimento munizioni, timer, completamento e interruzione originali ancora mancanti. Il tasto R corrente attiva principalmente una clip. |
| Animazioni e IK | 🟡 |45 clip disponibili; controller/IK/montage-notify completi ancora da portare. Verifica1:1 rimandata su richiesta. |
| Movimento1:1 | 🟡 | Vincoli sorgenti sprint/salto collegati; controller Mover completo e consumo stamina non ancora trasposti. |
| Effetti, audio e verifica giocando | 🔴 | Native effects/audio non ancora portati; nessuna nuova accettazione visiva nel browser bloccato. |

## Verifiche salvate

- 143 test Python,97 test JavaScript, build editor23 riusciti.
- 719 confronti sui dati sorgenti,491 relativi all'inventario; tutte le aspettative passano.
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
