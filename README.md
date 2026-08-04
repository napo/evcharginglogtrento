# EVChargingLogTrento
Serie storica aperta dello stato delle colonnine di ricarica per veicoli elettrici del **Comune di Trento**, costruita interrogando periodicamente la [Piattaforma Unica Nazionale (PUN)](https://www.piattaformaunicanazionale.it/idr) e accumulando ogni snapshot in file Parquet.

La PUN espone solo lo stato *attuale*: non esiste un endpoint per interrogare i dati a una certa data, né un archivio storico. Questo progetto colma quel vuoto registrando lo stato nel tempo - l'archivio storico *è* il dato che produce.

> Progetto indipendente e non ufficiale.
> Non è affiliato né promosso da FBK o Comune di Trento o GSE, MASE o RSE

## Cosa fa
Ogni ciclo (default: 5 minuti):
1. individua le colonnine del comune (fase *discovery*, rifatta ogni 24h);
2. ne scarica lo stato corrente (disponibile / in ricarica / fuori servizio,
   potenza, connettori, operatore, coordinate…);
3. se qualcosa è cambiato rispetto al ciclo precedente, appende uno snapshot
   completo con timestamp al Parquet del giorno; se è identico, lo salta
   (dedup), così il file non si gonfia di righe ridondanti.

## La fonte dei dati
I dati provengono dalla PUN (GSE/MASE). 

```
/config.json                → region + IdentityPoolId
Cognito GetId / GetCreds     → credenziali SigV4 temporanee (1h)
POST /v1/chargepoints/public/map/search   → lista evse_id (paginata)
POST /v1/chargepoints/group               → dettagli completi (batch da 100)
```

Il meccanismo dell'API è stato ricostruito a partire dall'ETL del progetto [`AgID/cruscotto-italia`](https://github.com/AgID/cruscotto-italia), a cui va il credito per il reverse-engineering della sorgente.

## Schema del Parquet
Un file per giorno in `data/` (`data_YYYY-MM-DD.parquet`). Ogni riga è lo stato di una colonnina a un dato istante `ts`.

| campo | descrizione |
|---|---|
| `ts` | timestamp UTC dello snapshot (ISO-8601) |
| `id_evse` | identificativo EVSE della colonnina |
| `stato` | stato normalizzato: `Attivo` / `Non Attivo` |
| `stato_raw` | stato grezzo dall'API (`AVAILABLE`, `CHARGING`, `OUTOFORDER`…) |
| `real_time` | `True` se il CPO aggiorna lo stato in tempo reale (vedi *Limiti*) |
| `cpo` | operatore (Charging Point Operator) |
| `indirizzo`, `citta`, `cap` | localizzazione |
| `lat`, `lon` | coordinate |
| `potenza_w` | potenza massima del connettore principale (W) |
| `corrente` | `AC` / `DC` (derivata dallo standard connettore) |
| `standard_connettore` | es. `IEC_62196_T2`, `IEC_62196_T2_COMBO`, `CHADEMO` |
| `n_connettori` | numero di connettori |
| `open_24h7` | apertura h24 7/7 |
| `party_id`, `capabilities`, `publication_status` | metadati OCPI |

Esempio di lettura con pandas:

```python
import pandas as pd, glob
df = pd.concat(pd.read_parquet(f) for f in glob.glob("data/data_*.parquet"))

# stato a un istante specifico
snap = df[df.ts.str.startswith("2026-08-04T10:")]

# % colonnine attive nel tempo
(df.assign(attiva=df.stato.eq("Attivo"))
   .groupby("ts").attiva.mean().mul(100).round(1))
```

## Uso

Requisiti: Python 3.10+.

```bash
pip install -r requirements.txt

python pun_trento.py --once                  # un ciclo di prova
python pun_trento.py                          # loop ogni 5 min (Ctrl-C per fermare)
python pun_trento.py --comune Rovereto --provincia TN --interval 600
```

Opzioni principali:

```
--comune / --provincia     comune da monitorare (default: Trento / TN)
--outdir                   cartella dei Parquet (default: ./data)
--statedir                 cache discovery + lasthash (default: ./state)
--interval                 secondi fra i cicli (default: 300)
--once                     esegue un solo ciclo e termina
--refresh-discovery        ore fra due discovery complete (default: 24)
--no-dedup                 scrive ogni ciclo anche se identico al precedente
```

## Automazione (GitHub Actions)

Il workflow in `.github/workflows/scrape.yml` gira ogni ora e, con un loop interno, esegue un ciclo ogni 5 minuti committando i dati nel repo (il cron nativo di Actions non è affidabile sui 5 minuti). Serve solo abilitare *Settings → Actions → Workflow permissions → Read and write*. Nessun secret: le credenziali PUN sono guest e il push usa il `GITHUB_TOKEN`.

Prima di affidarti alle Actions conviene fare un `--once` in locale e committare `state/discovery_trento.json`, così il job parte con la discovery già pronta.

## Limiti e note oneste
- **Nessuno storico a monte.** La serie temporale esiste solo se la raccogli:
  non puoi fare backfill del passato, parti da quando accendi lo script.
- **Il campo `real_time`.** Solo per le colonnine con `real_time=True` lo stato
  è vivo; per le altre è statico e il polling frequente ri-registra lo stesso
  valore (il dedup lo assorbe). Vale la pena guardare quante colonnine di Trento
  siano davvero in tempo reale prima di decidere la cadenza.
- **Prima discovery.** Se `map/search` non espone già città/coordinate, la
  discovery iniziale scarica i dettagli di tutta Italia (pesante, una volta al
  giorno). Il bootstrap locale della cache aggira il problema.

## Licenza

Il **codice** è rilasciato sotto licenza WTFPL
I **dati** raccolti derivano dalla PUN. Secondo l'interpretazione di AgID (principio *open data by default*, art. 52 c.2 del D.Lgs 82/2005 - CAD, e Linee Guida Open Data AgID), i dati pubblicati dalla PA senza licenza espressa si intendono aperti e riconducibili a **CC BY 4.0** con attribuzione al titolare (GSE). 
Questa è un'interpretazione giuridica di AgID, non una licenza dichiarata esplicitamente dalla PUN: verifica prima di riusi in contesti sensibili.
Fonte da attribuire: *GSE — Piattaforma Unica Nazionale (PUN)*.
