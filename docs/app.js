const statCards = document.getElementById('stats-cards');
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

function renderStats(points) {
  // Le colonnine A22 hanno una card dedicata più sotto: qui solo la città,
  // così i due pubblici (residenti vs traffico autostradale) non si mescolano.
  const cityPoints = points.filter((p) => !p.is_a22);
  statCards.innerHTML = statCardsHtml(summarize(cityPoints), undefined, 'Colonnine città');
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

  let frase = `Oggi sono occupate <strong>${occupate}</strong> colonnine su <strong>${cityPoints.length}</strong>`;
  const kwh = stationsUsage && stationsUsage.city && stationsUsage.city.energia
    ? stationsUsage.city.energia.totale_kwh_stimato
    : null;
  if (kwh != null) {
    frase += `, che hanno erogato circa <strong>${Math.round(kwh)} kWh</strong> finora (stima)`;
  }
  headline.innerHTML = `${frase}.`;
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

  renderStats(snapshot.points);
  renderA22(snapshot.points);
  renderUsageHeadline(snapshot.points);
  renderTable(snapshot.points);
  const updatedText = `Aggiornato: ${new Date(snapshot.generated_at).toLocaleString('it-IT')}`;
  lastUpdate.textContent = updatedText;
  tableLastUpdate.textContent = updatedText;
  createMap(snapshot);
  wireFilters();
}

loadDashboard();
