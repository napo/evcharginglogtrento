const summaryCards = document.getElementById('summary-cards');
const summaryBox = document.getElementById('summary-box');
const a22Box = document.getElementById('a22-box');
const poisTable = document.getElementById('pois-table');
const operatorsTable = document.getElementById('operators-table');
const poiProximityNote = document.getElementById('poi-proximity-note');
const poiProximityTable = document.getElementById('poi-proximity-table');

let statsPayload = null;

// Palette derivata dall'immagine hero (vedi ../styles.css).
const HERO_GREEN = '#1da542';
const HERO_BLUE = '#0b98cb';

function renderSummaryCards(data) {
  const cards = [
    { label: 'Colonnine', value: data.summary.total, tone: 'primary' },
    { label: 'Attive', value: data.summary.active, tone: 'success' },
    { label: 'Non attive', value: data.summary.inactive, tone: 'danger' },
    { label: 'In ricarica', value: data.summary.charging, tone: 'info' },
  ];

  summaryCards.innerHTML = cards
    .map(
      (card) => `
      <div class="col-md-3 col-sm-6">
        <div class="card stat-card border-0 shadow-sm bg-${card.tone} text-white">
          <div class="card-body">
            <div class="small text-white-50">${card.label}</div>
            <div class="display-6 fw-semibold">${card.value}</div>
          </div>
        </div>
      </div>`
    )
    .join('');

  summaryBox.innerHTML = `
    <div class="mb-2"><strong>Totale:</strong> ${data.summary.total}</div>
    <div class="mb-2"><strong>Quota attive:</strong> ${data.summary.share_active}%</div>
    <div class="mb-2"><strong>Ultimo snapshot:</strong> ${new Date(data.summary.generated_at).toLocaleString('it-IT')}</div>
  `;
}

function renderGauge(data) {
  const el = document.getElementById('gauge-active');
  if (!el || typeof echarts === 'undefined') return;
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
        progress: { show: true, width: 16 },
        axisLine: { lineStyle: { width: 16 } },
        pointer: { show: false },
        anchor: { show: false },
        axisTick: { show: false },
        splitLine: { length: 12, lineStyle: { width: 2, color: '#aaa' } },
        axisLabel: { distance: 22, fontSize: 12, color: '#888' },
        title: { show: false },
        detail: {
          valueAnimation: true,
          formatter: '{value}%',
          width: '60%',
          fontSize: 32,
          fontWeight: 'bolder',
          offsetCenter: [0, '10%'],
          color: '#0b98cb',
        },
        data: [{ value: data.summary.share_active }],
      },
    ],
  });
  window.addEventListener('resize', () => chart.resize());
}

function renderA22(data) {
  a22Box.innerHTML = `
    <div class="mb-2"><strong>Colonnine:</strong> ${data.a22.count}</div>
    <div class="mb-2"><strong>Attive:</strong> ${data.a22.active}</div>
    <div class="mb-2"><strong>Non attive:</strong> ${data.a22.inactive}</div>
    <div class="mb-2"><strong>Quota attive:</strong> ${data.a22.share_active}%</div>
    <div class="small text-muted">Operatori principali: ${Object.entries(data.a22.operators).map(([k,v]) => `${k} (${v})`).join(', ')}</div>`;
}

function renderPois(data) {
  poisTable.innerHTML = `
    <div class="table-responsive">
      <table class="table table-sm table-hover align-middle">
        <thead><tr><th>POI</th><th>Colonnine</th><th>Attive</th><th>% attive</th></tr></thead>
        <tbody>
          ${data.pois
            .map(
              (row) => `
                <tr>
                  <td>${row.name}</td>
                  <td>${row.count}</td>
                  <td>${row.active}</td>
                  <td>${row.share_active}%</td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

const POWER_TIER_LABELS = { tutte: 'Colonnine', lenta: 'Colonnine ≤22 kW', rapida: 'Colonnine 22–50 kW', ultra: 'Colonnine >50 kW' };

function renderOperators(data, tier = 'tutte') {
  const countFor = (op) => (tier === 'tutte' ? op.count : op.by_power[tier] || 0);
  const rows = data.operators
    .map((op) => ({ ...op, shown: countFor(op) }))
    .filter((op) => op.shown > 0)
    .sort((a, b) => b.shown - a.shown);

  operatorsTable.innerHTML = `
    <div class="table-responsive">
      <table class="table table-sm table-hover align-middle">
        <thead><tr><th>#</th><th>Operatore</th><th>${POWER_TIER_LABELS[tier]}</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (op, i) => `
                <tr class="${i < 3 ? 'table-warning' : ''}">
                  <td>${i + 1}</td>
                  <td>${op.name}</td>
                  <td>${op.shown}</td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function wireOperatorsFilter() {
  const buttons = Array.from(document.querySelectorAll('#operators-power-filter button'));
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      if (statsPayload) renderOperators(statsPayload, btn.dataset.tier);
    });
  });
}

function renderPoiProximity(data) {
  if (!poiProximityTable) return;
  const categorie = data && data.categorie ? Object.values(data.categorie) : [];
  if (categorie.length === 0) {
    poiProximityNote.textContent = '';
    poiProximityTable.innerHTML = '<p class="text-muted mb-0">Dati non ancora disponibili: esegui fetch_poi.py e generate_poi_proximity.py.</p>';
    return;
  }
  poiProximityNote.textContent = `Colonnine cittadine entro ${data.soglia_metri} m dal punto più vicino, per categoria. Fonte: ${data.fonte_poi}.`;
  const rows = categorie.slice().sort((a, b) => b.share - a.share);
  poiProximityTable.innerHTML = `
    <div class="table-responsive">
      <table class="table table-sm table-hover align-middle">
        <thead><tr><th>Categoria</th><th>Colonnine entro soglia</th><th>% sul totale città</th><th>Esempio</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `
                <tr>
                  <td>${r.label}</td>
                  <td>${r.count_entro_soglia} / ${data.totale_colonnine_citta}</td>
                  <td>${r.share}%</td>
                  <td class="small text-muted">${
                    r.esempio
                      ? `${r.esempio.colonnina_indirizzo} → ${r.esempio.poi_nome} (${r.esempio.distanza_m} m)`
                      : '—'
                  }</td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

// --- Andamento dell'uso (trends.json) --------------------------------

function trendMessage(block) {
  return `Raccolta dati in corso: servono almeno ${block.days_needed} giorni di storico (oggi ${block.days_collected}).`;
}

function renderPlaceholder(containerId, block) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.classList.remove('echart-trend');
  el.innerHTML = `<div class="alert alert-light border small mb-0">${trendMessage(block)}</div>`;
}

function renderDailyChart(containerId, block) {
  if (!block.available) return renderPlaceholder(containerId, block);
  const el = document.getElementById(containerId);
  if (!el || typeof echarts === 'undefined') return;
  const chart = echarts.init(el);
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['Attive %', 'In ricarica %'] },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: block.points.map((p) => p.date) },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    series: [
      { name: 'Attive %', type: 'line', smooth: true, itemStyle: { color: HERO_GREEN }, data: block.points.map((p) => p.share_active) },
      { name: 'In ricarica %', type: 'line', smooth: true, itemStyle: { color: HERO_BLUE }, data: block.points.map((p) => p.share_charging) },
    ],
  });
  window.addEventListener('resize', () => chart.resize());
}

function renderWeeklyHeatmap(containerId, block) {
  if (!block.available) return renderPlaceholder(containerId, block);
  const el = document.getElementById(containerId);
  if (!el || typeof echarts === 'undefined') return;
  const chart = echarts.init(el);
  const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  const data = [];
  block.matrix_charging.forEach((row, dow) => {
    row.forEach((v, hour) => {
      if (v !== null) data.push([hour, dow, v]);
    });
  });
  chart.setOption({
    tooltip: { position: 'top' },
    grid: { left: 60, right: 20, top: 20, bottom: 60 },
    xAxis: { type: 'category', data: hours, splitArea: { show: true }, axisLabel: { fontSize: 10 } },
    yAxis: { type: 'category', data: block.weekday_labels, splitArea: { show: true } },
    visualMap: {
      min: 0,
      max: Math.max(10, ...data.map((d) => d[2])),
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
    },
    series: [{ type: 'heatmap', data, label: { show: false } }],
  });
  window.addEventListener('resize', () => chart.resize());
}

function renderMonthlyChart(containerId, block) {
  if (!block.available) return renderPlaceholder(containerId, block);
  const el = document.getElementById(containerId);
  if (!el || typeof echarts === 'undefined') return;
  const chart = echarts.init(el);
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['Attive %', 'In ricarica %'] },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: block.points.map((p) => p.month) },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    series: [
      { name: 'Attive %', type: 'bar', itemStyle: { color: HERO_GREEN }, data: block.points.map((p) => p.share_active) },
      { name: 'In ricarica %', type: 'bar', itemStyle: { color: HERO_BLUE }, data: block.points.map((p) => p.share_charging) },
    ],
  });
  window.addEventListener('resize', () => chart.resize());
}

function renderTrends(trends) {
  renderDailyChart('chart-daily-trento', trends.andamento_giornaliero);
  renderWeeklyHeatmap('chart-weekly-trento', trends.profilo_settimanale);
  renderMonthlyChart('chart-monthly-trento', trends.profilo_mensile);
}

// --- Profilo orario (stations_usage.json) -----------------------------

function renderHourlyProfile(city) {
  const el = document.getElementById('chart-hourly-profile');
  if (!el) return;
  if (!city || !city.profilo_orario) {
    el.classList.remove('echart-trend');
    el.innerHTML = '<div class="alert alert-light border small mb-0">Servono più rilevazioni distribuite nella giornata per costruire il profilo orario.</div>';
    return;
  }
  if (typeof echarts === 'undefined') return;
  const chart = echarts.init(el);
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: city.profilo_orario.map((p) => `${p.ora}:00`) },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    series: [
      {
        name: 'In ricarica %',
        type: 'bar',
        data: city.profilo_orario.map((p) => p.quota_charging),
        itemStyle: { color: '#0b98cb' },
      },
    ],
  });
  window.addEventListener('resize', () => chart.resize());
}

function renderEnergyCards(city) {
  const container = document.getElementById('energy-cards');
  if (!container) return;
  const energia = city && city.energia;
  if (!energia) {
    container.innerHTML = '<div class="col"><p class="text-muted mb-0">Dati non ancora disponibili.</p></div>';
    return;
  }
  const cards = [
    { label: 'Ultima ora', value: energia.ultima_ora_kwh, tone: 'info' },
    { label: 'Ultime 24 ore', value: energia.ultime_24h_kwh, tone: 'primary' },
    { label: 'Ultimi 7 giorni', value: energia.ultimi_7_giorni_kwh, tone: 'secondary' },
    { label: 'Totale storico', value: energia.totale_kwh_stimato, tone: 'success' },
  ];
  container.innerHTML = cards
    .map(
      (card) => `
      <div class="col-md-3 col-sm-6">
        <div class="card stat-card border-0 shadow-sm bg-${card.tone} bg-gradient text-white h-100">
          <div class="card-body">
            <div class="small text-white-50">${card.label}</div>
            <div class="display-6 fw-semibold">${Math.round(card.value)}</div>
            <div class="small text-white-50">kWh</div>
          </div>
        </div>
      </div>`
    )
    .join('');
}

async function loadData() {
  const [statsResponse, trendsResponse, poiResponse, usageResponse] = await Promise.all([
    fetch('data/stats.json'),
    fetch('data/trends.json').catch(() => null),
    fetch('data/poi_proximity.json').catch(() => null),
    fetch('../stations_usage.json').catch(() => null),
  ]);
  const payload = await statsResponse.json();
  statsPayload = payload;
  renderSummaryCards(payload);
  renderGauge(payload);
  renderA22(payload);
  renderPois(payload);
  renderOperators(payload);
  wireOperatorsFilter();

  if (trendsResponse && trendsResponse.ok) {
    const trends = await trendsResponse.json();
    renderTrends(trends);
  }

  if (poiResponse && poiResponse.ok) {
    renderPoiProximity(await poiResponse.json());
  } else {
    renderPoiProximity(null);
  }

  if (usageResponse && usageResponse.ok) {
    const usage = await usageResponse.json();
    renderHourlyProfile(usage.city);
    renderEnergyCards(usage.city);
  } else {
    renderHourlyProfile(null);
    renderEnergyCards(null);
  }
}

loadData();
