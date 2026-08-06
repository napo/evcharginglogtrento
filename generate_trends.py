"""
generate_trends.py — Precalcola l'andamento nel tempo (uso/disponibilità)
delle colonnine cittadine di Trento.

Le colonnine dell'autostrada A22 sono escluse a monte, non solo filtrate:
sono per il traffico di transito, non per l'utenza urbana, e nessun
operatore autostradale pubblica oggi lo stato in tempo reale necessario per
costruire un andamento. Restano visibili su mappa live, card dedicata e
tabella A22 della pagina statistiche — solo qui non compaiono.

Genera tre blocchi via via più esigenti in storico:
  andamento_giornaliero  (serve >=2 giorni)
  profilo_settimanale    (serve >=7 giorni)
  profilo_mensile        (serve >=30 giorni)

Ogni blocco sotto soglia scrive solo {"available": false, "days_collected",
"days_needed"}: il frontend mostra un avviso invece di un grafico vuoto, e il
giorno in cui la soglia scatta il grafico compare da solo.

Solo le colonnine real_time=True entrano nel calcolo: per le altre lo stato
è statico (vedi README, sezione Limiti) e mediarle vorrebbe dire modellare
una costante, non un uso reale.

Va eseguito una volta al giorno (dopo generate_stats.py), non ad ogni ciclo:
il calcolo scandisce l'intero dataset storico, non solo l'ultimo snapshot.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pyarrow.dataset as ds

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / 'data'
OUT = ROOT / 'docs' / 'stats' / 'data' / 'trends.json'

DAYS_NEEDED = {
    'andamento_giornaliero': 2,
    'profilo_settimanale': 7,
    'profilo_mensile': 30,
    'andamento_conteggio_giornaliero': 2,
    'colonnine_monitorabili_giornaliero': 2,
}

WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']


def load_city_table() -> pd.DataFrame:
    """Tutte le colonnine cittadine (a differenza di
    load_real_time_city_table, NON filtra su real_time=True): serve ai
    blocchi che contano quante colonnine esistono/sono attive nel tempo,
    non quanto sono usate — quella distinzione lì non ha senso."""
    table = ds.dataset(str(DATASET), format='parquet', partitioning='hive').to_table().to_pandas()
    table['ts'] = pd.to_datetime(table['ts'], utc=True)
    # Solo Comune di Trento (non i comuni limitrofi che lo scraper raccoglie
    # comunque), e non l'A22 (pubblico diverso, gestito a parte).
    is_trento = table['citta'].fillna('').str.strip().str.lower() == 'trento'
    table['is_active'] = table['stato'].eq('Attivo')
    return table[is_trento].copy()


def load_real_time_city_table() -> pd.DataFrame:
    table = load_city_table()
    table['is_charging'] = table['stato_raw'].fillna('').str.upper().eq('CHARGING')
    return table[table['real_time'] == True].copy()  # noqa: E712


def placeholder(kind: str, days_collected: int) -> dict:
    return {
        'available': False,
        'kind': kind,
        'days_collected': days_collected,
        'days_needed': DAYS_NEEDED[kind],
    }


def andamento_giornaliero(g: pd.DataFrame, days: int) -> dict:
    if days < DAYS_NEEDED['andamento_giornaliero']:
        return placeholder('andamento_giornaliero', days)
    daily = g.groupby('date').agg(
        share_active=('is_active', 'mean'),
        share_charging=('is_charging', 'mean'),
        n_snapshots=('ts', 'nunique'),
    ).reset_index()
    return {
        'available': True,
        'kind': 'andamento_giornaliero',
        'days_collected': days,
        'points': [
            {
                'date': str(row['date']),
                'share_active': round(float(row['share_active']) * 100, 1),
                'share_charging': round(float(row['share_charging']) * 100, 1),
                'n_snapshots': int(row['n_snapshots']),
            }
            for _, row in daily.sort_values('date').iterrows()
        ],
    }


def profilo_settimanale(g: pd.DataFrame, days: int) -> dict:
    if days < DAYS_NEEDED['profilo_settimanale']:
        return placeholder('profilo_settimanale', days)
    g = g.copy()
    g['dow'] = g['ts'].dt.dayofweek
    g['hour'] = g['ts'].dt.hour
    active = g.groupby(['dow', 'hour'])['is_active'].mean().unstack('hour')
    charging = g.groupby(['dow', 'hour'])['is_charging'].mean().unstack('hour')
    active = active.reindex(index=range(7), columns=range(24))
    charging = charging.reindex(index=range(7), columns=range(24))

    def to_matrix(df: pd.DataFrame) -> list[list[float | None]]:
        return [
            [None if pd.isna(v) else round(float(v) * 100, 1) for v in row]
            for row in df.to_numpy()
        ]

    return {
        'available': True,
        'kind': 'profilo_settimanale',
        'days_collected': days,
        'weekday_labels': WEEKDAY_LABELS,
        'matrix_active': to_matrix(active),
        'matrix_charging': to_matrix(charging),
    }


def profilo_mensile(g: pd.DataFrame, days: int) -> dict:
    if days < DAYS_NEEDED['profilo_mensile']:
        return placeholder('profilo_mensile', days)
    g = g.copy()
    g['month'] = g['ts'].dt.strftime('%Y-%m')
    monthly = g.groupby('month').agg(
        share_active=('is_active', 'mean'),
        share_charging=('is_charging', 'mean'),
        n_days=('date', 'nunique'),
    ).reset_index()
    return {
        'available': True,
        'kind': 'profilo_mensile',
        'days_collected': days,
        'points': [
            {
                'month': row['month'],
                'share_active': round(float(row['share_active']) * 100, 1),
                'share_charging': round(float(row['share_charging']) * 100, 1),
                'n_days': int(row['n_days']),
            }
            for _, row in monthly.sort_values('month').iterrows()
        ],
    }


def andamento_conteggio_giornaliero(g_all: pd.DataFrame, days: int) -> dict:
    """Conteggio (non quota %) di colonnine attive/non attive per giorno, su
    TUTTE le colonnine cittadine — a differenza degli altri blocchi qui
    sopra, include anche quelle senza stato real-time: la domanda a cui
    risponde ("quante colonnine ci sono e quante sono attive") non richiede
    telemetria osservata, solo l'ultimo stato pubblicato quel giorno."""
    if days < DAYS_NEEDED['andamento_conteggio_giornaliero']:
        return placeholder('andamento_conteggio_giornaliero', days)
    daily_latest = g_all.sort_values('ts').drop_duplicates(subset=['date', 'id_evse'], keep='last')
    counts = daily_latest.groupby('date').agg(
        n_attive=('is_active', 'sum'),
        n_totale=('is_active', 'size'),
    ).reset_index()
    counts['n_non_attive'] = counts['n_totale'] - counts['n_attive']
    return {
        'available': True,
        'kind': 'andamento_conteggio_giornaliero',
        'days_collected': days,
        'points': [
            {
                'date': str(row['date']),
                'n_attive': int(row['n_attive']),
                'n_non_attive': int(row['n_non_attive']),
                'n_totale': int(row['n_totale']),
            }
            for _, row in counts.sort_values('date').iterrows()
        ],
    }


def colonnine_monitorabili_giornaliero(g_all: pd.DataFrame, days: int) -> dict:
    """Quante colonnine cittadine pubblicano stato real-time, per giorno:
    il "parco monitorabile" può crescere (nuovi operatori aprono l'API) o
    ridursi (un operatore smette di pubblicarlo) indipendentemente dal
    parco totale."""
    if days < DAYS_NEEDED['colonnine_monitorabili_giornaliero']:
        return placeholder('colonnine_monitorabili_giornaliero', days)
    rt = g_all[g_all['real_time'] == True]  # noqa: E712
    per_day = rt.groupby('date')['id_evse'].nunique().reset_index(name='n_monitorabili')
    return {
        'available': True,
        'kind': 'colonnine_monitorabili_giornaliero',
        'days_collected': days,
        'points': [
            {'date': str(row['date']), 'n_monitorabili': int(row['n_monitorabili'])}
            for _, row in per_day.sort_values('date').iterrows()
        ],
    }


def main() -> None:
    g_all = load_city_table()
    days_all = int(g_all['date'].nunique()) if not g_all.empty else 0

    g = load_real_time_city_table()
    days = int(g['date'].nunique()) if not g.empty else 0

    payload = {
        'generated_at': pd.Timestamp.now('UTC').isoformat(),
        'label': 'Trento città',
        'n_colonnine_real_time': int(g['id_evse'].nunique()) if not g.empty else 0,
        'days_collected': days,
        'andamento_giornaliero': andamento_giornaliero(g, days),
        'profilo_settimanale': profilo_settimanale(g, days),
        'profilo_mensile': profilo_mensile(g, days),
        'andamento_conteggio_giornaliero': andamento_conteggio_giornaliero(g_all, days_all),
        'colonnine_monitorabili_giornaliero': colonnine_monitorabili_giornaliero(g_all, days_all),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    print('generato', OUT)


if __name__ == '__main__':
    main()
