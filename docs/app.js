const tableBody = document.getElementById('points-table');
const filterButtons = Array.from(document.querySelectorAll('[data-filter]'));

const statusLabel = {
  AVAILABLE: 'Attivo',
  CHARGING: 'In ricarica',
  OUTOFORDER: 'Non Attivo',
  BLOCKED: 'Non Attivo',
  UNKNOWN: 'Sconosciuto',
};

const MALFUNZIONANTE_RAW = ['OUTOFORDER', 'INOPERATIVE', 'BLOCKED'];

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
const HERO_BLUEGRAY = '#35528d';
const STATUS_RED = '#b02a2a';
const SURFACE_COLOR = '#171f30';

let map;
let allPoints = [];
let activeFilter = 'all';
let stationsUsage = null;
let a22Markers = [];

// --- Fly-to tabella -> mappa ---------------------------------------------
let selectedRow = null;
let focusTimer = null;
let focusMarker = null;
let focusPopup = null;

function pointState(point) {
  return point.stato || statusLabel[point.stato_raw] || 'Sconosciuto';
}

function isMalfunzionante(point) {
  return MALFUNZIONANTE_RAW.includes((point.stato_raw || '').toUpperCase());
}

function summarize(points) {
  let active = 0;
  let inactive = 0;
  let malfunzionanti = 0;
  let charging = 0;
  points.forEach((p) => {
    const state = pointState(p);
    if (state === 'Attivo') active += 1;
    else if (state === 'Non Attivo') {
      if (isMalfunzionante(p)) malfunzionanti += 1;
      else inactive += 1;
    }
    if (p.stato_raw === 'CHARGING') charging += 1;
  });
  return { total: points.length, active, inactive, malfunzionanti, charging };
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
  const totale = cityPoints.length;
  const quota = totale ? Math.round((occupate / totale) * 100) : 0;

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

  const caption = document.createElement('div');
  caption.className = 'text-center text-muted small mt-2';
  caption.textContent = `${occupate} veicoli in carica in questo momento (${quota}% delle ${totale} colonnine cittadine)`;
  el.parentElement.appendChild(caption);
}

function renderStackedBar(cityPoints) {
  const el = document.getElementById('stacked-bar');
  if (!el || typeof echarts === 'undefined') return;
  const { total, active, inactive, malfunzionanti } = summarize(cityPoints);
  const pct = (v) => (total ? Math.round((v / total) * 100) : 0);
  // Un'etichetta dentro un segmento sottile si sovrappone a quella del
  // vicino: la mostro solo se il segmento è abbastanza largo da contenerla
  // con un po' di margine (~12% del totale). Sotto soglia, il valore resta
  // comunque raggiungibile da tooltip e legenda — mai un numero clippato.
  const canLabel = (v) => total > 0 && v / total >= 0.12;

  // Bordo 2px nel colore superficie tra i segmenti: rosso e blu-grigio non
  // raggiungono da soli il contrasto 3:1 richiesto contro lo sfondo scuro
  // (validato con lo skill dataviz), il bordo dà comunque un confine
  // percepibile indipendentemente dal contrasto assoluto del fill.
  const segmentBorder = { borderColor: SURFACE_COLOR, borderWidth: 2 };

  const chart = echarts.init(el, 'evtrento-dark');
  chart.setOption({
    tooltip: {
      trigger: 'item',
      formatter: (params) => `${params.seriesName}: <strong>${params.value}</strong> (${pct(params.value)}%)`,
    },
    legend: { bottom: 0, data: ['Attive', 'Non disponibili', 'Non funzionanti'] },
    grid: { left: 10, right: 10, top: 20, bottom: 40, containLabel: true },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', data: ['Colonnine'], show: false },
    series: [
      {
        name: 'Attive',
        type: 'bar',
        stack: 'totale',
        barWidth: 40,
        itemStyle: { color: HERO_GREEN, borderRadius: [4, 0, 0, 4], ...segmentBorder },
        label: { show: canLabel(active), position: 'insideLeft', color: '#fff', formatter: () => active },
        data: [active],
      },
      {
        name: 'Non disponibili',
        type: 'bar',
        stack: 'totale',
        barWidth: 40,
        itemStyle: { color: HERO_BLUEGRAY, ...segmentBorder },
        label: { show: canLabel(inactive), position: 'inside', color: '#fff', formatter: () => inactive },
        data: [inactive],
      },
      {
        name: 'Non funzionanti',
        type: 'bar',
        stack: 'totale',
        barWidth: 40,
        itemStyle: { color: STATUS_RED, borderRadius: [0, 4, 4, 0], ...segmentBorder },
        label: { show: canLabel(malfunzionanti), position: 'insideRight', color: '#fff', formatter: () => malfunzionanti },
        data: [malfunzionanti],
      },
    ],
  });
  window.addEventListener('resize', () => chart.resize());

  const caption = document.createElement('div');
  caption.className = 'text-center text-muted small mt-2';
  caption.innerHTML = `<strong>${total}</strong> colonnine in totale`;
  el.parentElement.appendChild(caption);
}

function renderTopUsage(city, a22Count) {
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
  if (a22Count) {
    righe.push(`
      <div class="small text-muted border-top pt-2">
        +${a22Count} colonnine sull'Autostrada A22, pubblico di transito, non incluse in queste statistiche:
        <a href="info/index.html">vedi Info</a>.
      </div>`);
  }
  box.innerHTML = righe.join('');
  if (window.EVUsage) EVUsage.wirePopovers(box);
}

// --- Tabella dettaglio ---------------------------------------------------

function renderTable(items) {
  tableBody.innerHTML = items
    .map((item) => {
      const state = pointState(item);
      return `
        <tr data-id-evse="${item.id_evse}">
          <td><span class="badge rounded-pill bg-${state === 'Attivo' ? 'success' : state === 'In ricarica' ? 'primary' : 'danger'}">${state}</span></td>
          <td>${item.cpo || '—'}${item.is_a22 ? ' <span class="badge bg-warning text-dark ms-1">A22</span>' : ''}</td>
          <td>${item.citta || 'Trento'}</td>
          <td data-sort-value="${item.potenza_w || 0}">${item.potenza_w ? `${item.potenza_w / 1000} kW` : '—'}</td>
          <td>${item.n_connettori ?? '—'}</td>
          <td>${item.corrente || '—'}</td>
          <td class="station-link" data-station-popover="${item.id_evse}" data-real-time="${item.real_time}">${item.indirizzo || '—'}</td>
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
}

function highlightMapPoint(point) {
  const el = document.createElement('div');
  el.className = 'marker-focus-ring';
  focusMarker = new maplibregl.Marker({ element: el }).setLngLat([point.lon, point.lat]).addTo(map);
  focusPopup = new maplibregl.Popup({ offset: 12, maxWidth: '280px' })
    .setLngLat([point.lon, point.lat])
    .setHTML(popupHtml(point));
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
  const state = pointState(point);
  return `<strong>${point.cpo || 'Operatore'}</strong>${point.is_a22 ? ' <span class="badge bg-warning text-dark">A22</span>' : ''}<br>${point.indirizzo || '—'}<br>Stato: ${state}${EVUsage.stationHtml(point.id_evse, { realTime: point.real_time })}`;
}

// Un popup aperto vicino al bordo della mappa può sconfinare fuori
// dall'area visibile (il pulsante di chiusura, in alto a destra, è la
// prima cosa a finire fuori): dopo l'apertura si misura la sua posizione
// reale e, se serve, si sposta la mappa quel tanto che basta per
// riportarlo tutto dentro l'area visibile.
function ensurePopupVisible(popup) {
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
    if (dx !== 0 || dy !== 0) {
      map.panBy([dx, dy], { duration: 400 });
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

function addClusterGroup(sourceId, points, color) {
  const data = toGeoJSON(points);
  if (map.getSource(sourceId)) {
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
    paint: { 'text-color': '#fff' },
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
    map.getSource(sourceId).getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      map.easeTo({ center: features[0].geometry.coordinates, zoom });
    });
  });

  map.on('click', `${sourceId}-unclustered`, (e) => {
    const feature = e.features[0];
    const point = allPoints.find((p) => p.id_evse === feature.properties.id_evse);
    if (!point) return;
    clearFocus();
    const popup = new maplibregl.Popup({ offset: 10, maxWidth: '280px' })
      .setLngLat(feature.geometry.coordinates)
      .setHTML(popupHtml(point));
    popup.on('open', () => ensurePopupVisible(popup));
    popup.addTo(map);
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
    // Solo pulizia dello stato di focus da tabella: il toggle del popup è
    // già gestito da MapLibre stesso via setPopup() — un secondo listener
    // che lo richiamasse aprirebbe/chiuderebbe il popup due volte (bug già
    // risolto in una sessione precedente).
    pin.addEventListener('click', () => clearFocus());
    const popup = new maplibregl.Popup({ offset: 12, maxWidth: '280px' }).setHTML(popupHtml(point));
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
  });
}

function renderMapLayers(points) {
  if (!map) return;

  const cityPoints = points.filter((p) => !p.is_a22);
  const a22Points = points.filter((p) => p.is_a22);

  const chargingPoints = cityPoints.filter((p) => p.stato_raw === 'CHARGING');
  const activePoints = cityPoints.filter((p) => pointState(p) === 'Attivo' && p.stato_raw !== 'CHARGING');
  const inactivePoints = cityPoints.filter((p) => pointState(p) === 'Non Attivo');

  // Il filtro "In ricarica" isola le colonnine in uso (marker blu): quando
  // è selezionato, i cluster attive/non attive spariscono e restano solo
  // i marker in ricarica. Con "Tutti"/"Attivi" le colonnine in ricarica
  // restano visibili come già prima (sono comunque colonnine attive).
  const showActive = activeFilter === 'all' || activeFilter === 'Attivo';
  const showInactive = activeFilter === 'all' || activeFilter === 'Non Attivo';
  const showCharging = activeFilter === 'all' || activeFilter === 'Attivo' || activeFilter === 'Charging';

  addClusterGroup('active', showActive ? activePoints : [], HERO_GREEN);
  addClusterGroup('inactive', showInactive ? inactivePoints : [], STATUS_RED);

  a22Markers.forEach((m) => m.remove());
  a22Markers = [];
  document.querySelectorAll('.maplibregl-marker.charging-marker').forEach((el) => el.remove());

  if (showCharging) {
    renderIndividualMarkers(chargingPoints, 'charging charging-marker');
  }
  a22Markers = renderIndividualMarkers(a22Points, 'a22');
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

  let frase = `Al momento sono occupate <strong id="hl-occupate">0</strong> colonnine su <strong>${cityPoints.length}</strong>`;
  if (kwh != null) {
    frase += `, che hanno erogato circa <strong id="hl-kwh">0</strong> kWh finora (stima)`;
  }
  headline.innerHTML = `${frase}.`;

  countUp(document.getElementById('hl-occupate'), occupate, { duration: 700 });
  if (kwh != null) countUp(document.getElementById('hl-kwh'), Math.round(kwh), { duration: 1100 });
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
  const a22Count = snapshot.points.filter((p) => p.is_a22).length;

  renderGaugeOccupied(cityPoints);
  renderStackedBar(cityPoints);
  renderTopUsage(stationsUsage && stationsUsage.city, a22Count);
  renderUsageHeadline(snapshot.points, snapshot.generated_at);
  renderTable(snapshot.points);
  document.getElementById('table-last-update').textContent = `Aggiornato: ${formatSituationDate(snapshot.generated_at)}`;
  createMap(snapshot);
  wireFilters();
  wireTableFocus();

  if (typeof AOS !== 'undefined') AOS.init({ once: true, duration: 600 });
}

loadDashboard();
