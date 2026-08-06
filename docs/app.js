const tableBody = document.getElementById('points-table');
const filterButtons = Array.from(document.querySelectorAll('[data-filter]'));

const statusLabel = {
  AVAILABLE: 'Attivo',
  CHARGING: 'In uso',
  OUTOFORDER: 'Non Attivo',
  BLOCKED: 'Non Attivo',
  UNKNOWN: 'Sconosciuto',
};

// Colore di brand (dal logo) + stato, validati con lo skill dataviz — vedi
// theme.css per i dettagli. Copie esadecimali qui perché ECharts non legge
// le variabili CSS. ACCENT è una tinta chiara della stessa tonalità del
// brand (#096277): quel colore ha ottimo contrasto come *fill* con testo
// bianco sopra, ma fallisce (2.7:1) come tratto/testo su sfondo scuro —
// ACCENT è la versione validata per quel ruolo (vedi shared-echarts-theme.js
// e il piano di questa iterazione per i numeri).
const ACCENT = '#28a1bd';
const TRACK_DIM = 'rgba(255,255,255,0.12)';
const HERO_GREEN = '#1da542';
// Stessa famiglia cromatica di HERO_GREEN ma più chiara: colonnine "Attivo"
// il cui stato non è però real-time (vedi isKnownOccupancy) — es. NEOGY,
// A22, Sagelio, che secondo lo storico dati non riportano mai altro che
// "AVAILABLE". Serve a non spacciare per osservato un valore stimato.
const HERO_GREEN_LIGHT = '#8bc34a';
const STATUS_RED = '#b02a2a';

let map;
let allPoints = [];
let activeFilter = 'all';
let stationsUsage = null;

// --- Fly-to tabella -> mappa ---------------------------------------------
let selectedRow = null;
let focusTimer = null;
let focusMarker = null;
let focusPopup = null;
// Unico popup "manuale" aperto sulla mappa (marker singoli, punti
// unclustered, marker esplosi dallo spiderfy) — un click su un punto
// diverso deve chiudere quello precedente invece di accumularli.
let openPopup = null;
let spiderfied = null;
// Il click che apre uno spiderfy fa comunque scattare il listener 'click'
// generico sulla mappa (registrato dopo quelli sui layer, vedi createMap):
// senza questo flag richiuderebbe lo spiderfy nello stesso istante in cui
// lo si è aperto.
let suppressSpiderClose = false;

function pointState(point) {
  return point.stato || statusLabel[point.stato_raw] || 'Sconosciuto';
}

// point.real_time distingue telemetria osservata da uno stub statico lato
// provider: alcuni operatori (NEOGY, A22, Sagelio, verificato sullo storico
// completo) non hanno mai riportato altro che "AVAILABLE" — il loro stato
// "Attivo" è un'assunzione, non un dato misurato.
function isKnownOccupancy(point) {
  return point.real_time === true;
}

// I 4 stati mostrati ovunque nell'app (mappa, tabella, popup, stacked bar):
// "malfunzionante" non è più una categoria a parte, rientra in "Non
// attiva" come qualunque altro stato diverso da Attivo/In uso.
function displayState(point) {
  if (point.stato_raw === 'CHARGING') return { label: 'In uso', cls: 'is-inuse' };
  if (pointState(point) === 'Attivo') {
    return isKnownOccupancy(point)
      ? { label: 'Attiva (reale)', cls: 'is-real' }
      : { label: 'Attiva (stimata)', cls: 'is-estimated' };
  }
  return { label: 'Non attiva', cls: 'is-inactive' };
}

function summarize(points) {
  let attivaReale = 0;
  let attivaStimata = 0;
  let inUso = 0;
  let nonAttiva = 0;
  points.forEach((p) => {
    if (p.stato_raw === 'CHARGING') {
      inUso += 1;
    } else if (pointState(p) === 'Attivo') {
      if (isKnownOccupancy(p)) attivaReale += 1;
      else attivaStimata += 1;
    } else {
      nonAttiva += 1;
    }
  });
  return { total: points.length, attivaReale, attivaStimata, inUso, nonAttiva };
}

function countUp(el, target, { duration = 900, decimals = 0, suffix = '' } = {}) {
  if (!el) return;
  const start = 0;
  const t0 = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - (1 - p) * (1 - p); // ease-out
    const value = start + (target - start) * eased;
    el.textContent = value.toFixed(decimals) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// --- Gauge + stacked bar ------------------------------------------------

function renderGaugeOccupied(cityPoints) {
  const el = document.getElementById('gauge-occupied');
  if (!el || typeof echarts === 'undefined') return;
  const occupate = cityPoints.filter((p) => p.stato_raw === 'CHARGING').length;
  // "In uso" ha senso solo per le colonnine monitorabili (real_time): sul
  // totale cittadino (che include quasi metà colonnine di cui non si sa
  // l'occupazione) la quota risulterebbe artificialmente bassa.
  const monitorabili = cityPoints.filter((p) => isKnownOccupancy(p)).length;
  const quota = EVDrilldown.ratio(occupate, monitorabili);

  const chart = echarts.init(el, 'evtrento-dark');
  chart.setOption({
    series: [
      {
        type: 'gauge',
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 100,
        splitNumber: 5,
        progress: { show: true, width: 16, itemStyle: { color: ACCENT } },
        axisLine: { lineStyle: { width: 16, color: [[1, TRACK_DIM]] } },
        pointer: { show: true, length: '55%', width: 4, itemStyle: { color: ACCENT } },
        anchor: { show: true, size: 10, itemStyle: { color: ACCENT, borderColor: '#fff', borderWidth: 2 } },
        axisTick: { show: false },
        splitLine: { length: 12, lineStyle: { width: 2, color: 'rgba(255,255,255,.3)' } },
        axisLabel: { distance: 22, fontSize: 12, color: '#aeb9cc' },
        title: { show: false },
        detail: {
          valueAnimation: true,
          formatter: () => `${occupate}`,
          width: '60%',
          fontSize: 32,
          fontWeight: 'bolder',
          offsetCenter: [0, '35%'],
          color: ACCENT,
        },
        data: [{ value: quota, name: 'occupate' }],
      },
    ],
  });
  window.addEventListener('resize', () => chart.resize());

  const quotaLabel = EVDrilldown.formatPct(quota);
  const caption = document.createElement('div');
  caption.className = 'text-center text-muted small mt-2';
  caption.textContent = `${occupate} veicoli in carica in questo momento (${quotaLabel}% delle ${monitorabili} colonnine dove è possibile avere il monitoraggio)`;
  el.parentElement.appendChild(caption);
}

function renderColonnineTotali(cityPoints) {
  const el = document.getElementById('drilldown-totali');
  if (!el || !window.EVDrilldown) return;
  window.EVDrilldown.render(el, summarize(cityPoints));
}

function renderTopUsage(city) {
  const box = document.getElementById('top-usage-box');
  if (!box) return;
  const top = city && city.colonnina_top;
  const topOperatori = city && city.operatori_per_uso;

  const righe = [];
  if (top) {
    righe.push(`
      <div class="mb-3">
        <div class="small text-muted">Colonnina più usata</div>
        <div class="fw-semibold station-link" data-station-popover="${top.id_evse}">${top.indirizzo}</div>
        <div class="small text-muted">${top.cpo} · ${top.n_sessioni} sessioni · ${top.energia_totale_kwh_stimata} kWh (stima)</div>
      </div>`);
  }
  if (topOperatori && topOperatori.length) {
    const leader = topOperatori[0];
    righe.push(`
      <div class="mb-3">
        <div class="small text-muted">Operatore di maggior successo</div>
        <div class="fw-semibold">${leader.cpo}</div>
        <div class="small text-muted">${leader.energia_totale_kwh_stimata} kWh erogati (stima) su ${leader.n_colonnine} colonnine</div>
      </div>`);
  }
  if (!top && (!topOperatori || topOperatori.length === 0)) {
    righe.push('<p class="text-muted small mb-3">Dati d\'uso non ancora disponibili.</p>');
  }
  box.innerHTML = righe.join('');
  if (window.EVUsage) EVUsage.wirePopovers(box);
}

// --- Tabella dettaglio ---------------------------------------------------

// Ordinamento di default della tabella: prima le colonnine in uso, poi
// quelle monitorabili disponibili (dato reale), poi quelle disponibili ma
// di cui non si sa se sono in uso (stimate), infine le non attive — a
// parità di stato, per via e poi per operatore. È solo l'ordine iniziale:
// il click su un'intestazione di colonna e la ricerca full-text di
// shared-table.js restano invariati e prendono il sopravvento da lì.
const STATE_SORT_RANK = { 'In uso': 0, 'Attiva (reale)': 1, 'Attiva (stimata)': 2, 'Non attiva': 3 };

function lastUsedIso(idEvse) {
  return stationsUsage && stationsUsage.stazioni && stationsUsage.stazioni[idEvse]
    ? stationsUsage.stazioni[idEvse].ultimo_uso
    : null;
}

function renderTable(items) {
  const rows = items
    .map((item) => ({ item, state: displayState(item) }))
    .sort((a, b) => {
      const rankDiff = STATE_SORT_RANK[a.state.label] - STATE_SORT_RANK[b.state.label];
      if (rankDiff !== 0) return rankDiff;
      const addrCmp = (a.item.indirizzo || '').localeCompare(b.item.indirizzo || '', 'it');
      if (addrCmp !== 0) return addrCmp;
      return (a.item.cpo || '').localeCompare(b.item.cpo || '', 'it');
    });

  tableBody.innerHTML = rows
    .map(({ item, state }) => {
      const lastUsed = lastUsedIso(item.id_evse);
      const lastUsedLabel = lastUsed && window.EVFormat ? EVFormat.popupDate(lastUsed.split('T')[0]) : '—';
      return `
        <tr data-id-evse="${item.id_evse}">
          <td><span class="badge rounded-pill badge-state ${state.cls}">${state.label}</span></td>
          <td>${item.cpo || '—'}${item.is_a22 ? ' <span class="badge bg-warning text-dark ms-1">A22</span>' : ''}</td>
          <td>${item.citta || 'Trento'}</td>
          <td data-sort-value="${item.potenza_w || 0}">${item.potenza_w ? `${item.potenza_w / 1000} kW` : '—'}</td>
          <td>${item.n_connettori ?? '—'}</td>
          <td>${item.corrente || '—'}</td>
          <td class="station-link" data-station-popover="${item.id_evse}" data-real-time="${item.real_time}">${item.indirizzo || '—'}</td>
          <td data-sort-value="${lastUsed || ''}">${lastUsedLabel}</td>
        </tr>`;
    })
    .join('');
  enhanceTable(document.getElementById('live-table'));
}

// --- Fly-to: click su una riga della tabella porta la mappa sul punto ---

let pendingMoveEndHandler = null;

function clearFocus() {
  clearTimeout(focusTimer);
  focusTimer = null;
  if (pendingMoveEndHandler) {
    // Un flyTo interrotto da una nuova selezione emette comunque un
    // 'moveend': senza sganciare l'handler in sospeso, quello vecchio
    // scatterebbe più tardi ed evidenzierebbe il punto sbagliato.
    map.off('moveend', pendingMoveEndHandler);
    pendingMoveEndHandler = null;
  }
  if (selectedRow) {
    selectedRow.classList.remove('table-active');
    selectedRow = null;
  }
  if (focusMarker) {
    focusMarker.remove();
    focusMarker = null;
  }
  if (focusPopup) {
    focusPopup.remove();
    focusPopup = null;
  }
  closeOpenPopup();
}

function closeOpenPopup() {
  if (openPopup) {
    openPopup.remove();
    openPopup = null;
  }
}

// Da agganciare a ogni popup creato manualmente (marker singoli, punti
// unclustered, marker esplosi): ne tiene traccia in `openPopup` così che
// aprirne uno nuovo chiuda automaticamente il precedente, e ripulisce da
// solo lo stato quando viene chiuso in altro modo (bottone di chiusura,
// clic altrove). Il popup del fly-to da tabella (focusPopup) resta
// tracciato qui a sua volta, per coerenza nella direzione opposta: aprire
// un popup manuale chiude anche quello.
function trackPopup(popup) {
  popup.on('open', () => {
    if (openPopup && openPopup !== popup) openPopup.remove();
    openPopup = popup;
  });
  popup.on('close', () => {
    if (openPopup === popup) openPopup = null;
  });
  return popup;
}

function highlightMapPoint(point) {
  const el = document.createElement('div');
  el.className = 'marker-focus-ring';
  focusMarker = new maplibregl.Marker({ element: el }).setLngLat([point.lon, point.lat]).addTo(map);
  focusPopup = trackPopup(
    new maplibregl.Popup({ offset: 12, maxWidth: '280px' }).setLngLat([point.lon, point.lat]).setHTML(popupHtml(point))
  );
  focusPopup.on('open', () => ensurePopupVisible(focusPopup));
  focusPopup.addTo(map);
}

function flyToPoint(idEvse) {
  const point = allPoints.find((p) => p.id_evse === idEvse);
  if (!point || !point.lat || !point.lon || !map) return;
  document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  map.flyTo({ center: [point.lon, point.lat], zoom: 17, duration: 1800, essential: true });
  pendingMoveEndHandler = () => {
    pendingMoveEndHandler = null;
    highlightMapPoint(point);
  };
  map.once('moveend', pendingMoveEndHandler);
}

function selectFromTable(tr) {
  clearFocus();
  tr.classList.add('table-active');
  selectedRow = tr;
  focusTimer = setTimeout(() => flyToPoint(tr.dataset.idEvse), 1000);
}

function wireTableFocus() {
  tableBody.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id-evse]');
    if (tr) selectFromTable(tr);
  });
}

// --- Popup mappa (contenuto condiviso da shared-usage.js) ---------------

function popupHtml(point) {
  const { label } = displayState(point);
  return `<strong>${point.cpo || 'Operatore'}</strong>${point.is_a22 ? ' <span class="badge bg-warning text-dark">A22</span>' : ''}<br>${point.indirizzo || '—'}<br>Stato: ${label}<br><span class="text-muted small">${point.id_evse}</span>${EVUsage.stationHtml(point.id_evse, { realTime: point.real_time })}`;
}

// Un popup aperto vicino al bordo della mappa può sconfinare fuori
// dall'area visibile (il pulsante di chiusura, in alto a destra, è la
// prima cosa a finire fuori): dopo l'apertura si misura la sua posizione
// reale e, se serve, si sposta la mappa quel tanto che basta per
// riportarlo tutto dentro l'area visibile. Il pan può far ricalcolare a
// MapLibre l'ancoraggio del popup (es. da "sopra" a "sotto" il punto), che
// a sua volta ne cambia ancora la posizione — per questo si rimisura dopo
// che il pan è terminato (`moveend`) invece di fidarsi di un unico calcolo,
// con un tetto di tentativi per non rincorrersi all'infinito.
function ensurePopupVisible(popup, attempt = 0) {
  requestAnimationFrame(() => {
    const popupEl = popup.getElement();
    const mapEl = map && map.getContainer();
    if (!popupEl || !mapEl) return;
    const mapRect = mapEl.getBoundingClientRect();
    const popupRect = popupEl.getBoundingClientRect();
    const margin = 16;
    let dx = 0;
    let dy = 0;
    if (popupRect.top < mapRect.top + margin) {
      dy = popupRect.top - (mapRect.top + margin);
    } else if (popupRect.bottom > mapRect.bottom - margin) {
      dy = popupRect.bottom - (mapRect.bottom - margin);
    }
    if (popupRect.left < mapRect.left + margin) {
      dx = popupRect.left - (mapRect.left + margin);
    } else if (popupRect.right > mapRect.right - margin) {
      dx = popupRect.right - (mapRect.right - margin);
    }
    if ((dx !== 0 || dy !== 0) && attempt < 2) {
      map.panBy([dx, dy], { duration: 300 });
      map.once('moveend', () => ensurePopupVisible(popup, attempt + 1));
    }
  });
}

// --- Mappa: cluster per attive/non attive, punti singoli per in-uso/A22 -

function toGeoJSON(points) {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      properties: { id_evse: p.id_evse },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })),
  };
}

// Chiude l'eventuale "spiderfy" in corso (vedi spiderfyAtCoordinate più
// sotto): rimuove i marker esplosi, le linee che li collegano al centro e
// ripristina la visibilità degli stalli originali che erano stati nascosti.
function unspiderfy() {
  if (!spiderfied) return;
  spiderfied.markers.forEach((m) => m.remove());
  if (map.getLayer('spider-legs-line')) map.removeLayer('spider-legs-line');
  if (map.getSource('spider-legs')) map.removeSource('spider-legs');
  ['active-known', 'active-unknown', 'inactive'].forEach((sourceId) => {
    if (map.getLayer(`${sourceId}-unclustered`)) map.setFilter(`${sourceId}-unclustered`, ['!', ['has', 'point_count']]);
  });
  document.querySelectorAll('.maplibregl-marker.charging-marker').forEach((el) => {
    el.style.display = '';
  });
  spiderfied = null;
}

function openPopupForPoint(point, lngLat) {
  clearFocus();
  const popup = trackPopup(new maplibregl.Popup({ offset: 10, maxWidth: '280px' }).setLngLat(lngLat).setHTML(popupHtml(point)));
  popup.on('open', () => ensurePopupVisible(popup));
  popup.addTo(map);
}

// Tutte le colonnine esattamente alla stessa coordinata di `point`
// (incluso `point` stesso): più EVSE/stalli della stessa stazione.
function pointsAtCoordinate(lon, lat) {
  return allPoints.filter((p) => Math.abs(p.lon - lon) < 1e-7 && Math.abs(p.lat - lat) < 1e-7);
}

// Esplode `points` in cerchio intorno a `center`, uno per stallo, colorato
// secondo il suo stato reale (non un colore unico per il gruppo: stalli
// alla stessa stazione possono avere stati diversi, è proprio quello che
// lo spiderfy deve far vedere). Nessun numero sul marker — il formato
// dell'id_evse non garantisce un vero numero di stallo per tutti gli
// operatori — ma il codice univoco resta raggiungibile al passaggio del
// mouse (title) e nel popup (popupHtml) al click. Condivisa da entrambi i
// percorsi di spiderfy (da cluster e da stalli sovrapposti allo zoom
// massimo): costruisce marker/linee, non decide cosa nascondere (se ne
// occupano i rispettivi chiamanti, il "come nascondere" è diverso nei due
// casi).
function buildSpiderMarkers(points, center) {
  const centerPx = map.project(center);
  const n = points.length;
  const radius = Math.min(70, 24 + n * 6);
  const legFeatures = [];
  const markers = [];

  points.forEach((point, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const px = { x: centerPx.x + Math.cos(angle) * radius, y: centerPx.y + Math.sin(angle) * radius };
    const lngLat = map.unproject(px);
    const { cls } = displayState(point);

    legFeatures.push({
      type: 'Feature',
      properties: { cls },
      geometry: { type: 'LineString', coordinates: [center, [lngLat.lng, lngLat.lat]] },
    });

    const el = document.createElement('div');
    el.className = `marker-pin spider-marker ${cls}`;
    el.title = point.id_evse;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openPopupForPoint(point, [lngLat.lng, lngLat.lat]);
    });
    markers.push(new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map));
  });

  map.addSource('spider-legs', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: legFeatures },
  });
  map.addLayer({
    id: 'spider-legs-line',
    type: 'line',
    source: 'spider-legs',
    paint: {
      'line-color': [
        'match',
        ['get', 'cls'],
        'is-real', HERO_GREEN,
        'is-estimated', HERO_GREEN_LIGHT,
        'is-inuse', ACCENT,
        STATUS_RED,
      ],
      'line-width': 1.5,
      'line-dasharray': [2, 2],
    },
  });

  return markers;
}

// Più stalli alla stessa coordinata (stessa stazione multi-EVSE) restano
// sovrapposti sullo stesso pixel una volta mostrati singolarmente —
// cliccarli raggiungerebbe sempre e solo quello più in alto nel
// rendering. Qui si esplodono tutti quanti, a prescindere dal loro stato
// (compreso quello eventualmente in uso, reso come marker HTML separato e
// non come feature del layer GL) — è esattamente il caso per cui l'utente
// vuole vedere quale stallo, tra quelli disponibili, è occupato.
// Chiamata sia per punti già unclustered sia — dopo lo zoom di
// espansione, vedi addClusterGroup — per un cluster i cui punti sono
// tutti alla stessa identica coordinata: supercluster non li separa mai
// (distanza zero), quindi anche al suo zoom massimo di clustering restano
// un gruppo unico che, un attimo dopo essersi risolto in punti singoli,
// va comunque esploso.
function spiderfyAtCoordinate(center, points) {
  unspiderfy();
  const markers = buildSpiderMarkers(points, center);
  const ids = points.map((p) => p.id_evse);

  ['active-known', 'active-unknown', 'inactive'].forEach((sourceId) => {
    if (map.getLayer(`${sourceId}-unclustered`)) {
      map.setFilter(`${sourceId}-unclustered`, [
        'all',
        ['!', ['has', 'point_count']],
        ['!', ['in', ['get', 'id_evse'], ['literal', ids]]],
      ]);
    }
  });
  document.querySelectorAll('.maplibregl-marker.charging-marker').forEach((el) => {
    if (ids.includes(el.dataset.idEvse)) el.style.display = 'none';
  });

  spiderfied = { markers };
}

function addClusterGroup(sourceId, points, color, textColor = '#fff') {
  const data = toGeoJSON(points);
  if (map.getSource(sourceId)) {
    unspiderfy();
    map.getSource(sourceId).setData(data);
    return;
  }

  map.addSource(sourceId, {
    type: 'geojson',
    data,
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 45,
  });

  map.addLayer({
    id: `${sourceId}-clusters`,
    type: 'circle',
    source: sourceId,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': color,
      'circle-opacity': 0.85,
      'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 30, 24],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  });

  map.addLayer({
    id: `${sourceId}-cluster-count`,
    type: 'symbol',
    source: sourceId,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-size': 12,
      'text-font': ['Noto Sans Bold'],
    },
    paint: { 'text-color': textColor },
  });

  map.addLayer({
    id: `${sourceId}-unclustered`,
    type: 'circle',
    source: sourceId,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': color,
      'circle-radius': 7,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  });

  map.on('click', `${sourceId}-clusters`, (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: [`${sourceId}-clusters`] });
    const clusterId = features[0].properties.cluster_id;
    const pointCount = features[0].properties.point_count;
    const center = features[0].geometry.coordinates;
    const source = map.getSource(sourceId);
    // MapLibre GL JS 5.x: getClusterLeaves/getClusterExpansionZoom restituiscono
    // una Promise (non più uno stile a callback (err, result) come nelle
    // versioni precedenti/mapbox-gl-js legacy).
    // getClusterLeaves/getClusterExpansionZoom sono asincrone (round-trip
    // al worker): il .then() gira ben dopo che il click originale ha
    // finito di essere dispatchato, quindi qui non serve (anzi sarebbe
    // fuorviante) toccare suppressSpiderClose — a differenza del click
    // handler sui punti unclustered qui sotto, che è sincrono.
    source
      .getClusterLeaves(clusterId, pointCount, 0)
      .then((leaves) => {
        const concentric = leaves.every((f) => {
          const [lon, lat] = f.geometry.coordinates;
          return Math.abs(lon - center[0]) < 1e-7 && Math.abs(lat - center[1]) < 1e-7;
        });
        const points = concentric
          ? leaves.map((f) => allPoints.find((p) => p.id_evse === f.properties.id_evse)).filter(Boolean)
          : null;

        return source.getClusterExpansionZoom(clusterId).then((zoom) => {
          unspiderfy();
          // Lo zoom viene sempre prima: solo se i punti sono concentrici
          // (supercluster non li separa mai, neanche al suo zoom massimo)
          // l'esplosione segue non appena la mappa arriva a destinazione.
          map.easeTo({ center, zoom });
          if (concentric) map.once('moveend', () => spiderfyAtCoordinate(center, points));
        });
      })
      .catch(() => {});
  });

  map.on('click', `${sourceId}-unclustered`, (e) => {
    const feature = e.features[0];
    const point = allPoints.find((p) => p.id_evse === feature.properties.id_evse);
    if (!point) return;
    // Più stalli della stessa stazione, alla stessa coordinata, restano
    // sovrapposti sullo stesso pixel oltre il clusterMaxZoom: si esplodono
    // invece di aprire il popup di uno solo di loro (vedi
    // spiderfyAtCoordinate). Sincrono (a differenza del click sui
    // cluster): suppressSpiderClose qui protegge davvero, perché il
    // generic closer registrato più sotto scatta nello stesso evento.
    const siblings = pointsAtCoordinate(point.lon, point.lat);
    if (siblings.length > 1) {
      suppressSpiderClose = true;
      spiderfyAtCoordinate(feature.geometry.coordinates, siblings);
      return;
    }
    openPopupForPoint(point, feature.geometry.coordinates);
  });

  [`${sourceId}-clusters`, `${sourceId}-unclustered`].forEach((layerId) => {
    map.on('mouseenter', layerId, () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = '';
    });
  });
}

function renderIndividualMarkers(points, className) {
  const markers = [];
  points.forEach((point) => {
    const pin = document.createElement('div');
    pin.className = `marker-pin ${className}`;
    pin.dataset.idEvse = point.id_evse;

    const siblings = pointsAtCoordinate(point.lon, point.lat);
    if (siblings.length > 1) {
      // Altri stalli alla stessa stazione (magari con stati diversi):
      // esplodi invece di aprire solo il popup di questo marker. Niente
      // .setPopup() qui, quindi niente doppio toggle da gestire.
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        clearFocus();
        spiderfyAtCoordinate([point.lon, point.lat], siblings);
      });
      markers.push(new maplibregl.Marker({ element: pin }).setLngLat([point.lon, point.lat]).addTo(map));
      return;
    }

    // Solo pulizia dello stato di focus da tabella: il toggle del popup è
    // già gestito da MapLibre stesso via setPopup() — un secondo listener
    // che lo richiamasse aprirebbe/chiuderebbe il popup due volte (bug già
    // risolto in una sessione precedente).
    pin.addEventListener('click', () => clearFocus());
    const popup = trackPopup(new maplibregl.Popup({ offset: 12, maxWidth: '280px' }).setHTML(popupHtml(point)));
    popup.on('open', () => ensurePopupVisible(popup));
    const marker = new maplibregl.Marker({ element: pin }).setLngLat([point.lon, point.lat]).setPopup(popup).addTo(map);
    markers.push(marker);
  });
  return markers;
}

function createMap(snapshot) {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://styles.maptoolkit.org/dark.json',
    center: [11.121, 46.074],
    zoom: 11,
    pitch: 0,
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.FullscreenControl());

  map.on('load', () => {
    const points = snapshot.points.filter((p) => p.lat && p.lon);
    allPoints = points;
    renderMapLayers(points);

    // Registrati dopo i click handler dei layer (aggiunti da renderMapLayers
    // qui sopra): MapLibre esegue i listener 'click' nell'ordine in cui
    // sono stati registrati, quindi questo vede già l'eventuale
    // suppressSpiderClose impostato dal click sincrono sui punti
    // unclustered nello stesso evento (vedi addClusterGroup).
    map.on('zoomstart', unspiderfy);
    map.on('dragstart', unspiderfy);
    map.on('click', () => {
      if (suppressSpiderClose) {
        suppressSpiderClose = false;
        return;
      }
      unspiderfy();
    });
  });
}

function renderMapLayers(points) {
  if (!map) return;

  // Nessuno split per is_a22 qui: sulla mappa l'A22 è trattata come
  // qualunque altra colonnina, colorata solo in base a stato/real_time.
  // Resta invece esclusa dalle statistiche cittadine (gauge, stacked bar,
  // riepilogo, tabella) che continuano a filtrare !p.is_a22 più sotto.
  const chargingPoints = points.filter((p) => p.stato_raw === 'CHARGING');
  const activeKnownPoints = points.filter(
    (p) => pointState(p) === 'Attivo' && p.stato_raw !== 'CHARGING' && isKnownOccupancy(p)
  );
  const activeUnknownPoints = points.filter(
    (p) => pointState(p) === 'Attivo' && p.stato_raw !== 'CHARGING' && !isKnownOccupancy(p)
  );
  const inactivePoints = points.filter((p) => pointState(p) === 'Non Attivo');

  // Il filtro "In uso" isola le colonnine in ricarica (marker blu): quando
  // è selezionato, i cluster attive/non attive spariscono e restano solo
  // quei marker. "Monitorabili" è un asse ortogonale allo stato: mostra
  // tutte le colonnine con real_time=true qualunque sia il loro stato
  // (reale + non attive + in uso), nascondendo solo le stimate.
  const showActiveKnown = activeFilter === 'all' || activeFilter === 'Attivo' || activeFilter === 'Monitorabile';
  const showActiveUnknown = activeFilter === 'all' || activeFilter === 'Attivo';
  const showInactive = activeFilter === 'all' || activeFilter === 'Non Attivo' || activeFilter === 'Monitorabile';
  const showCharging =
    activeFilter === 'all' || activeFilter === 'Attivo' || activeFilter === 'Charging' || activeFilter === 'Monitorabile';

  addClusterGroup('active-known', showActiveKnown ? activeKnownPoints : [], HERO_GREEN);
  addClusterGroup('active-unknown', showActiveUnknown ? activeUnknownPoints : [], HERO_GREEN_LIGHT, '#173318');
  addClusterGroup('inactive', showInactive ? inactivePoints : [], STATUS_RED);

  document.querySelectorAll('.maplibregl-marker.charging-marker').forEach((el) => el.remove());

  if (showCharging) {
    renderIndividualMarkers(chargingPoints, 'charging charging-marker');
  }
}

// --- Frase riepilogo hero -------------------------------------------------

function formatSituationDate(iso) {
  return window.EVFormat ? EVFormat.dateTime(iso) : iso;
}

function renderUsageHeadline(points, generatedAt) {
  const dateEl = document.getElementById('situation-date');
  if (dateEl) dateEl.textContent = formatSituationDate(generatedAt);

  const headline = document.getElementById('usage-headline');
  if (!headline) return;
  const cityPoints = points.filter((p) => !p.is_a22);
  const occupate = cityPoints.filter((p) => p.stato_raw === 'CHARGING').length;
  const kwh = stationsUsage && stationsUsage.city && stationsUsage.city.energia
    ? stationsUsage.city.energia.totale_kwh_stimato
    : null;
  // "Oggi" = dalle 00:00 di oggi ora italiana, non ultime 24h: stessa
  // definizione di calendario usata ovunque compaia questo dato (popup,
  // pagina Statistiche — vedi generate_station_usage.py).
  const kwhOggi = stationsUsage && stationsUsage.city && stationsUsage.city.energia
    ? stationsUsage.city.energia.oggi_kwh
    : null;

  let frase = `Al momento sono occupate <strong id="hl-occupate">0</strong> colonnine su <strong>${cityPoints.length}</strong>`;
  if (kwh != null) {
    frase += `, che hanno erogato circa <strong id="hl-kwh">0</strong> kWh finora (stima)`;
    if (kwhOggi != null) {
      frase += `, di cui <strong id="hl-kwh-oggi">0</strong> kWh oggi dalle 00:00 (ora italiana)`;
    }
  }
  headline.innerHTML = `${frase}.`;

  countUp(document.getElementById('hl-occupate'), occupate, { duration: 700 });
  if (kwh != null) countUp(document.getElementById('hl-kwh'), Math.round(kwh), { duration: 1100 });
  if (kwhOggi != null) countUp(document.getElementById('hl-kwh-oggi'), Math.round(kwhOggi), { duration: 1100 });
}

function wireFilters() {
  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      filterButtons.forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      activeFilter = button.dataset.filter;
      renderMapLayers(allPoints);
    });
  });
}

async function loadDashboard() {
  const [snapshotResponse, usageResponse] = await Promise.all([
    fetch('evcharging_snapshot.json'),
    fetch('stations_usage.json').catch(() => null),
  ]);
  const snapshot = await snapshotResponse.json();
  if (usageResponse && usageResponse.ok) {
    stationsUsage = await usageResponse.json();
    if (window.EVUsage) EVUsage.setData(stationsUsage);
  }

  const cityPoints = snapshot.points.filter((p) => !p.is_a22);

  renderGaugeOccupied(cityPoints);
  renderColonnineTotali(cityPoints);
  renderTopUsage(stationsUsage && stationsUsage.city);
  renderUsageHeadline(snapshot.points, snapshot.generated_at);
  renderTable(snapshot.points);
  document.getElementById('table-last-update').textContent = `Aggiornato: ${formatSituationDate(snapshot.generated_at)}`;
  createMap(snapshot);
  wireFilters();
  wireTableFocus();

  if (typeof AOS !== 'undefined') AOS.init({ once: true, duration: 600 });
}

loadDashboard();
