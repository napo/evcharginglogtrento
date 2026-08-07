"""Configurazione condivisa: nome del comune monitorato.

Unica fonte di verità in docs/config.json, letta sia dagli script Python
(qui) sia dal sito statico (docs/shared-config.js, via fetch a runtime).
Per ripetere il progetto su un altro comune basta cambiare quel file.
"""
from __future__ import annotations

import json
from pathlib import Path

_CONFIG_PATH = Path(__file__).resolve().parent / 'docs' / 'config.json'
_config = json.loads(_CONFIG_PATH.read_text(encoding='utf-8'))

COMUNE = _config['comune']
PROVINCIA = _config['provincia']

# Stessa normalizzazione usata dai filtri 'citta' == COMUNE negli script
# generate_*.py (case/spazi non significativi nei dati PUN).
COMUNE_NORM = COMUNE.strip().lower()
