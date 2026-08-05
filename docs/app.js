const a22Cards = document.getElementById('a22-cards');
const tableBody = document.getElementById('points-table');
const lastUpdate = document.getElementById('last-update');
const tableLastUpdate = document.getElementById('table-last-update');
const filterButtons = Array.from(document.querySelectorAll('[data-filter]'));

const statusLabel = {
  AVAILABLE: 'Attivo',
  CHARGING: 'In ricarica',
  OUTOFORDER: 'Non Attivo',
  BLOCKED: 'Non Attivo',
  UNKNOWN: 'Sconosciuto',
};

let map;
let allPoints = [];
let activeFilter = 'all';
let stationsUsage = null;

function pointState(point) {
  return point.stato || statusLabel[point.stato_raw] || 'Sconosciuto';
}

function summarize(points) {
  let active = 0;
  let inactive = 0;
  let charging = 0;
  points.forEach((p) => {
    const state = pointState(p);
    if (state === 'Attivo') active += 1;
    else if (state === 'Non Attivo') inactive += 1;
    if (p.stato_raw === 'CHARGING') charging += 1;
  });
  return { total: points.length, active, inactive, charging };
}

function statCardsHtml(summary, tones = ['primary', 'success', 'danger', 'info'], totalLabel = 'Colonnine totali') {
  const cards = [
    { label: totalLabel, value: summary.total, tone: tones[0] },
    { label: 'Attive', value: summary.active, tone: tones[1] },
    { label: 'Non attive', value: summary.inactive, tone: tones[2] },
    { label: 'In ricarica', value: summary.charging, tone: tones[3] },
  ];
  return cards
    .map(
      (card) => `
        <div class="col-md-3 col-sm-6">
          <div class="card stat-card border-0 shadow-sm bg-${card.tone} bg-gradient text-white h-100">
            <div class="card-body">
              <div class="small text-white-50">${card.label}</div>
              <div class="display-6 fw-semibold">${card.value}</div>
            </div>
          </div>
        </div>`
    )
    .join('');
}

// Palette derivata dall'immagine hero (vedi styles.css) — stessi valori,
// qui serve la copia esadecimale perché ECharts non legge le variabili CSS.
const HERO_BLUE = '#0b98cb';
const HERO_BLUE_PALE = '#7edcfe';
const HERO_GREEN = '#1da542';
const HERO_BLUEGRAY = '#35528d';

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

function renderGaugeOccupied(cityPoints) {
  const el = document.getElementById('gauge-occupied');
  if (!el || typeof echarts === 'undefined') return;
  const occupate = cityPoints.filter((p) => p.stato_raw === 'CHARGING').length;
  const totale = cityPoints.length;
  const quota = totale ? Math.round((occupate / totale) * 100) : 0;

  const chart = echarts.init(el);
  chart.setOption({
    series: [
      {
        type: 'gauge',
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 100,
        splitNumber: 5,
        progress: { show: true, width: 16, itemStyle: { color: HERO_BLUE } },
        axisLine: { lineStyle: { width: 16, color: [[1, HERO_BLUE_PALE]] } },
        pointer: { show: false },
        anchor: { show: false },
        axisTick: { show: false },
        splitLine: { length: 12, lineStyle: { width: 2, color: '#aaa' } },
        axisLabel: { distance: 22, fontSize: 12, color: '#888' },
        title: { show: false },
        detail: {
          valueAnimation: true,
          formatter: () => `${occupate}`,
          width: '60%',
          fontSize: 32,
          fontWeight: 'bolder',
          offsetCenter: [0, '0%'],
          color: HERO_BLUE,
        },
        data: [{ value: quota, name: 'occupate' }],
      },
    ],
  });
  window.addEventListener('resize', () => chart.resize());

  const caption = document.createElement('div');
  caption.className = 'text-center text-muted small mt-n4';
  caption.textContent = `su ${totale} colonnine cittadine (${quota}%)`;
  el.parentElement.appendChild(caption);
}

function renderStackedBar(cityPoints) {
  const el = document.getElementById('stacked-bar');
  if (!el || typeof echarts === 'undefined') return;
  const { total, active, inactive } = summarize(cityPoints);

  const chart = echarts.init(el);
  chart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0, data: ['Attive', 'Non attive'] },
    grid: { left: 10, right: 10, top: 20, bottom: 40, containLabel: true },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', data: ['Colonnine'], show: false },
    series: [
      {
        name: 'Attive',
        type: 'bar',
        stack: 'totale',
        barWidth: 40,
        itemStyle: { color: HERO_GREEN, borderRadius: [4, 0, 0, 4] },
        label: { show: true, position: 'insideLeft', color: '#fff', formatter: () => active },
        data: [active],
      },
      {
        name: 'Non attive',
        type: 'bar',
        stack: 'totale',
        barWidth: 40,
        itemStyle: { color: HERO_BLUEGRAY, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'insideRight', color: '#fff', formatter: () => inactive },
        data: [inactive],
      },
    ],
  });
  window.addEventListener('resize', () => chart.resize());

  const caption = document.createElement('div');
  caption.className = 'text-center text-muted small mt-2';
  caption.innerHTML = `<strong>${total}</strong> colonnine in totale`;
  el.parentElement.appendChild(caption);
}

function renderTopUsage(city) {
  const box = document.getElementById('top-usage-box');
  if (!box) return;
  const top = city && city.colonnina_top;
  const topOperatori = city && city.operatori_per_uso;

  if (!top && (!topOperatori || topOperatori.length === 0)) {
    box.innerHTML = '<p class="text-muted small mb-0">Dati d\'uso non ancora disponibili.</p>';
    return;
  }

  const righe = [];
  if (top) {
    righe.push(`
      <div class="mb-3">
        <div class="small text-muted">Colonnina più usata</div>
        <div class="fw-semibold">${top.indirizzo}</div>
        <div class="small text-muted">${top.cpo} · ${top.n_sessioni} sessioni · ${top.energia_totale_kwh_stimata} kWh (stima)</div>
      </div>`);
  }
  if (topOperatori && topOperatori.length) {
    const leader = topOperatori[0];
    righe.push(`
      <div>
        <div class="small text-muted">Operatore di maggior successo</div>
        <div class="fw-semibold">${leader.cpo}</div>
        <div class="small text-muted">${leader.energia_totale_kwh_stimata} kWh erogati (stima) su ${leader.n_colonnine} colonnine</div>
      </div>`);
  }
  box.innerHTML = righe.join('');
}

function renderA22(points) {
  if (!a22Cards) return;
  const a22Points = points.filter((p) => p.is_a22);
  if (a22Points.length === 0) {
    a22Cards.innerHTML = '<div class="col"><p class="text-muted mb-0">Nessuna colonnina A22 nell\'ultimo snapshot.</p></div>';
    return;
  }
  a22Cards.innerHTML = statCardsHtml(summarize(a22Points), ['secondary', 'success', 'danger', 'info'], 'Colonnine A22');
}

function renderTable(items) {
  tableBody.innerHTML = items
    .slice(0, 25)
    .map((item) => {
      const state = pointState(item);
      return `
        <tr>
          <td><span class="badge rounded-pill bg-${state === 'Attivo' ? 'success' : state === 'In ricarica' ? 'primary' : 'danger'}">${state}</span></td>
          <td>${item.cpo || '—'}${item.is_a22 ? ' <span class="badge bg-warning text-dark ms-1">A22</span>' : ''}</td>
          <td>${item.citta || 'Trento'}</td>
          <td>${item.potenza_w ? `${item.potenza_w / 1000} kW` : '—'}</td>
          <td>${item.n_connettori ?? '—'}</td>
          <td>${item.corrente || '—'}</td>
          <td>${item.indirizzo || '—'}</td>
        </tr>`;
    })
    .join('');
}

function oraPiuUsata(profiloOrario) {
  if (!profiloOrario) return null;
  const best = profiloOrario.reduce(
    (acc, cur) => (cur.quota_charging > (acc ? acc.quota_charging : -1) ? cur : acc),
    null
  );
  return best && best.quota_charging > 0 ? best : null;
}

function usageSectionHtml(point) {
  if (!point.real_time) {
    return '<div class="popup-usage small text-muted mt-2">Questa colonnina non pubblica lo stato in tempo reale: l\'uso non è calcolabile.</div>';
  }

  const usage = stationsUsage && stationsUsage.stazioni ? stationsUsage.stazioni[point.id_evse] : null;
  if (!usage) {
    return '<div class="popup-usage small text-muted mt-2">Dati d\'uso non ancora disponibili.</div>';
  }
  if (usage.n_sessioni === 0) {
    return '<div class="popup-usage small text-muted mt-2">Nessuna sessione di ricarica osservata finora.</div>';
  }

  const ora = oraPiuUsata(usage.profilo_orario);
  const righe = [
    `<dt>Sessioni osservate</dt><dd>${usage.n_sessioni}</dd>`,
    usage.durata_media_minuti != null ? `<dt>Durata media</dt><dd>${usage.durata_media_minuti} min</dd>` : '',
    usage.energia_totale_kwh_stimata != null
      ? `<dt>Energia erogata (stima)</dt><dd>${usage.energia_totale_kwh_stimata} kWh</dd>`
      : '',
    ora ? `<dt>Ora più usata</dt><dd>${ora.ora}:00 (${ora.quota_charging}% delle rilevazioni)</dd>` : '',
    usage.giorno_settimana_piu_usato
      ? `<dt>Giorno più usato</dt><dd>${usage.giorno_settimana_piu_usato.giorno}</dd>`
      : '<dt>Giorno più usato</dt><dd class="text-muted">servono più giorni di storico</dd>',
    usage.giorno_record
      ? `<dt>Giorno record</dt><dd>${usage.giorno_record.data} (${usage.giorno_record.minuti_ricarica_totali} min totali)</dd>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  return `<dl class="popup-usage small mt-2 mb-0">${righe}</dl>`;
}

function createMap(snapshot) {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://styles.maptoolkit.org/street.json',
    center: [11.121, 46.074],
    zoom: 11,
    pitch: 0,
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.FullscreenControl());

  map.on('load', () => {
    const markerLayer = document.createElement('div');
    markerLayer.id = 'custom-markers';
    map.getContainer().appendChild(markerLayer);

    const points = snapshot.points.filter((p) => p.lat && p.lon);
    allPoints = points;
    renderMarkers(points);
  });
}

function renderMarkers(points) {
  if (!map) return;

  const visible = points.filter((point) => {
    const state = pointState(point);
    return activeFilter === 'all' || state === activeFilter;
  });

  const existing = document.querySelectorAll('.maplibregl-marker');
  existing.forEach((el) => el.remove());

  visible.forEach((point) => {
    const state = pointState(point);
    const pin = document.createElement('div');
    pin.className = `marker-pin ${
      state === 'Attivo' ? 'active' : state === 'In ricarica' ? 'charging' : state === 'Non Attivo' ? 'inactive' : 'unknown'
    }${point.is_a22 ? ' a22' : ''}`;

    const popup = new maplibregl.Popup({ offset: 12, maxWidth: '280px' }).setHTML(
      `<strong>${point.cpo || 'Operatore'}</strong>${point.is_a22 ? ' <span class="badge bg-warning text-dark">A22</span>' : ''}<br>${point.indirizzo || '—'}<br>Stato: ${state}${usageSectionHtml(point)}`
    );

    new maplibregl.Marker({ element: pin })
      .setLngLat([point.lon, point.lat])
      .setPopup(popup)
      .addTo(map);
    // Niente listener 'click' manuale: MapLibre attacca già un toggle del
    // popup quando si chiama .setPopup() su un marker con elemento custom —
    // un secondo listener qui annulla il primo (apre e richiude nello
    // stesso click), risultando in un popup che non si apre mai.
  });
}

function renderUsageHeadline(points) {
  const headline = document.getElementById('usage-headline');
  if (!headline) return;
  const cityPoints = points.filter((p) => !p.is_a22);
  const occupate = cityPoints.filter((p) => p.stato_raw === 'CHARGING').length;
  const kwh = stationsUsage && stationsUsage.city && stationsUsage.city.energia
    ? stationsUsage.city.energia.totale_kwh_stimato
    : null;

  let frase = `Oggi sono occupate <strong id="hl-occupate">0</strong> colonnine su <strong>${cityPoints.length}</strong>`;
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
      renderMarkers(allPoints);
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
  }

  const cityPoints = snapshot.points.filter((p) => !p.is_a22);
  renderGaugeOccupied(cityPoints);
  renderStackedBar(cityPoints);
  renderTopUsage(stationsUsage && stationsUsage.city);
  renderA22(snapshot.points);
  renderUsageHeadline(snapshot.points);
  renderTable(snapshot.points);
  const updatedText = `Aggiornato: ${new Date(snapshot.generated_at).toLocaleString('it-IT')}`;
  lastUpdate.textContent = updatedText;
  tableLastUpdate.textContent = updatedText;
  createMap(snapshot);
  wireFilters();

  if (typeof AOS !== 'undefined') AOS.init({ once: true, duration: 600 });
}

loadDashboard();
