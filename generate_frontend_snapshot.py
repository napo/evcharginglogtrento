from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pyarrow.dataset as ds

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / 'data'
OUT = ROOT / 'docs' / 'evcharging_snapshot.json'

# Stesso prefisso usato in generate_stats.py per isolare le colonnine A22
# (Autostrada del Brennero), es. 'IT*A22*ET365IT13024001*1'.
A22_ID_PREFIX = 'IT*A22*'


def main() -> None:
    table = ds.dataset(str(DATASET), format='parquet', partitioning='hive').to_table().to_pandas()
    table['ts'] = pd.to_datetime(table['ts'], utc=True)
    latest_ts = table['ts'].max()
    latest = table[table['ts'] == latest_ts].copy()

    latest['stato'] = latest['stato'].fillna('Sconosciuto')
    latest['stato_raw'] = latest['stato_raw'].fillna('UNKNOWN')
    latest['is_a22'] = (
        latest['id_evse'].fillna('').str.upper().str.startswith(A22_ID_PREFIX)
        | latest['cpo'].fillna('').str.contains('autostrada del brennero', case=False, na=False)
    )
    # Solo Comune di Trento (mappa/tabella live) + A22 (caso a sé, resta
    # visibile): i comuni limitrofi che lo scraper raccoglie comunque nel
    # dataset grezzo non compaiono qui.
    is_trento = latest['citta'].fillna('').str.strip().str.lower() == 'trento'
    latest = latest[is_trento | latest['is_a22']]

    active = int((latest['stato'] == 'Attivo').sum())
    inactive = int((latest['stato'] == 'Non Attivo').sum())
    charging = int((latest['stato_raw'] == 'CHARGING').sum())

    output = {
        'generated_at': latest_ts.isoformat(),
        'stats': {
            'total': int(len(latest)),
            'active': active,
            'inactive': inactive,
            'charging': charging,
        },
        'points': [
            {
                'id_evse': row['id_evse'],
                'stato': row['stato'],
                'stato_raw': row['stato_raw'],
                'real_time': bool(row['real_time']),
                'cpo': row['cpo'],
                'indirizzo': row['indirizzo'],
                'citta': row['citta'],
                'cap': row['cap'],
                'lat': float(row['lat']),
                'lon': float(row['lon']),
                'potenza_w': int(row['potenza_w']) if pd.notna(row['potenza_w']) else None,
                'corrente': row['corrente'],
                'n_connettori': int(row['n_connettori']) if pd.notna(row['n_connettori']) else None,
                'open_24h7': bool(row['open_24h7']) if pd.notna(row['open_24h7']) else None,
                'party_id': row['party_id'],
                'is_a22': bool(row['is_a22']),
            }
            for _, row in latest.iterrows()
        ],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
