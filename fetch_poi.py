#!/usr/bin/env python3
"""
fetch_poi.py — Scarica una tantum i punti di interesse (musei, supermercati,
banche, ospedali, ambulatori) nell'area di Trento da OpenStreetMap, via
Overpass API, e li salva in poi_trento.json.

Perché non da dati.trentino.it: il dataset comunale "Luoghi e punti di
interesse del Comune di Trento" non è più raggiungibile (404), e l'unico
dataset provinciale attivo ("Punti di interesse del Trentino") è un elenco
turistico del 2013 (hotel/ristoranti), non aggiornato e privo delle
categorie che servono qui.

Script MANUALE, da rilanciare a mano ogni tanto: Overpass è un servizio
pubblico condiviso, non va interrogato automaticamente ad ogni build (per
questo non è nei workflow GitHub Actions). I punti di interesse cambiano
comunque di rado.

Licenza dei dati risultanti: OpenStreetMap, © contributori OpenStreetMap,
ODbL — l'attribuzione va mantenuta (vedi docs/info/index.html).

Uso:
  python fetch_poi.py
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'poi_trento.json'

OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
TIMEOUT = 90
# Il reverse proxy davanti a Overpass rifiuta con 406 lo User-Agent di
# default di `requests` (probabile filtro anti-bot generico); un
# User-Agent "da browser/curl" basta a farlo accettare.
HEADERS = {'User-Agent': 'curl/8.5.0'}

# Stesso bbox usato da pun_trento.py per il comune di Trento.
BBOX = (46.00, 11.03, 46.16, 11.22)  # lat_min, lon_min, lat_max, lon_max

# categoria -> lista di filtri Overpass (chiave, valore)
CATEGORIES: dict[str, list[tuple[str, str]]] = {
    'musei': [('tourism', 'museum')],
    'supermercati': [('shop', 'supermarket')],
    'banche': [('amenity', 'bank')],
    'ospedali': [('amenity', 'hospital')],
    'ambulatori': [('amenity', 'clinic'), ('amenity', 'doctors')],
}

# Categorie "incrocio": non hanno un nome proprio in OSM (i nodi
# motorway_junction/traffic_signals raramente hanno un tag `name`), quindi
# il nome mostrato è quello della via su cui si trovano, con prefisso
# "Incrocio " — vedi fetch_road_junctions().
# categoria -> (valori highway delle way "genitore", valori highway dei nodi da cercare su quelle way)
JUNCTION_CATEGORIES: dict[str, tuple[list[str], list[str]]] = {
    'svincoli_autostradali': (['motorway'], ['motorway_junction']),
    'incroci_primarie': (['trunk', 'primary'], ['motorway_junction', 'traffic_signals']),
}


def element_point(el: dict) -> tuple[float, float] | None:
    if el.get('type') == 'node':
        return el.get('lat'), el.get('lon')
    center = el.get('center')
    if center:
        return center.get('lat'), center.get('lon')
    return None


def _run_overpass_query(cat_name: str, query: str) -> list[dict]:
    for attempt in range(3):
        r = requests.post(OVERPASS_URL, data={'data': query}, timeout=TIMEOUT + 10, headers=HEADERS)
        if r.status_code == 200:
            break
        print(f'  {cat_name}: tentativo {attempt + 1} fallito ({r.status_code}), riprovo...')
        time.sleep(10)
    else:
        r.raise_for_status()
    return r.json().get('elements', [])


def fetch_category(cat_name: str, filters: list[tuple[str, str]]) -> list[dict]:
    lat_min, lon_min, lat_max, lon_max = BBOX
    bbox_str = f'{lat_min},{lon_min},{lat_max},{lon_max}'
    clauses = []
    for key, value in filters:
        clauses.append(f'node["{key}"="{value}"]({bbox_str});')
        clauses.append(f'way["{key}"="{value}"]({bbox_str});')
    query = f'[out:json][timeout:{TIMEOUT}];\n(\n  {"".join(clauses)}\n);\nout center tags;'

    elements = _run_overpass_query(cat_name, query)
    items = []
    for el in elements:
        tags = el.get('tags', {}) or {}
        point = element_point(el)
        if not point or point[0] is None or point[1] is None:
            continue
        lat, lon = round(float(point[0]), 6), round(float(point[1]), 6)
        name = tags.get('name') or tags.get('name:it') or 'Senza nome'
        items.append({'name': name, 'lat': lat, 'lon': lon})
    return items


def fetch_road_junctions(cat_name: str, way_highway_values: list[str], node_highway_values: list[str]) -> list[dict]:
    """Nodi highway=motorway_junction/traffic_signals che giacciono su way
    highway=motorway/trunk/primary, col nome preso dalla way (i nodi stessi
    di rado hanno un `name`). Una query sola: chiede sia le way (per i tag
    name/ref e l'elenco dei nodi che le compongono) sia i nodi filtrati che
    ne fanno parte, poi il match nodo->via è fatto in Python via l'elenco
    `nodes` di ogni way."""
    lat_min, lon_min, lat_max, lon_max = BBOX
    bbox_str = f'{lat_min},{lon_min},{lat_max},{lon_max}'
    way_re = '|'.join(way_highway_values)
    node_re = '|'.join(node_highway_values)
    query = (
        f'[out:json][timeout:{TIMEOUT}];\n'
        f'way["highway"~"^({way_re})$"]({bbox_str})->.w;\n'
        f'node(w.w)["highway"~"^({node_re})$"]->.n;\n'
        f'(.w; .n;);\n'
        f'out body;'
    )
    elements = _run_overpass_query(cat_name, query)

    ways = [el for el in elements if el.get('type') == 'way']
    nodes = {el['id']: el for el in elements if el.get('type') == 'node'}

    node_to_way_tags: dict[int, dict] = {}
    for way in ways:
        way_tags = way.get('tags', {}) or {}
        for node_id in way.get('nodes', []):
            if node_id in nodes and node_id not in node_to_way_tags:
                node_to_way_tags[node_id] = way_tags

    items = []
    for node_id, node in nodes.items():
        lat, lon = node.get('lat'), node.get('lon')
        if lat is None or lon is None:
            continue
        way_tags = node_to_way_tags.get(node_id, {})
        nome_via = way_tags.get('name') or way_tags.get('ref') or 'via senza nome'
        items.append({'name': f'Incrocio {nome_via}', 'lat': round(float(lat), 6), 'lon': round(float(lon), 6)})
    return items


def fetch() -> dict:
    categories: dict[str, list[dict]] = {}
    for cat_name, filters in CATEGORIES.items():
        print(f'interrogo Overpass per "{cat_name}"...')
        categories[cat_name] = fetch_category(cat_name, filters)
        print(f'  {cat_name}: {len(categories[cat_name])} elementi')
        time.sleep(2)  # non martellare un servizio pubblico condiviso
    for cat_name, (way_values, node_values) in JUNCTION_CATEGORIES.items():
        print(f'interrogo Overpass per "{cat_name}"...')
        categories[cat_name] = fetch_road_junctions(cat_name, way_values, node_values)
        print(f'  {cat_name}: {len(categories[cat_name])} elementi')
        time.sleep(2)
    return categories


def main() -> None:
    categories = fetch()
    payload = {
        'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'source': 'OpenStreetMap contributors, via Overpass API (ODbL)',
        'bbox': list(BBOX),
        'categories': categories,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    for name, items in categories.items():
        print(f'  {name}: {len(items)}')
    print('scritto', OUT)


if __name__ == '__main__':
    main()
