const summaryCards = document.getElementById('summary-cards');
const summaryBox = document.getElementById('summary-box');
const poisTable = document.getElementById('pois-table');
const operatorsTable = document.getElementById('operators-table');
const poiProximityNote = document.getElementById('poi-proximity-note');
const poiProximityTable = document.getElementById('poi-proximity-table');

let statsPayload = null;

// Palette derivata dall'immagine hero (vedi ../theme.css). ACCENT è la
// tinta chiara sulla stessa tonalità del brand (#096277), usata ovunque il
// colore serve come tratto/testo su sfondo scuro (il brand puro fallisce
// il contrasto minimo lì) — vedi docs/app.js per i numeri di validazione.
const HERO_GREEN = '#1da542';
const ACCENT = '#28a1bd';

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
    <div class="mb-2"><strong>Ultimo snapshot:</strong> ${window.EVFormat ? EVFormat.dateTime(data.summary.generated_at) : data.summary.generated_at}</div>
  `;
}

function renderGauge(data) {
  const el = document.getElementById('gauge-active');
  if (!el || typeof echarts === 'undefined') return;
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
        axisLine: { lineStyle: { width: 16, color: [[1, 'rgba(255,255,255,0.12)']] } },
        pointer: { show: true, length: '55%', width: 4, itemStyle: { color: ACCENT } },
        anchor: { show: true, size: 10, itemStyle: { color: ACCENT, borderColor: '#fff', borderWidth: 2 } },
        axisTick: { show: false },
        splitLine: { length: 12, lineStyle: { width: 2, color: 'rgba(255,255,255,.3)' } },
        axisLabel: { distance: 22, fontSize: 12, color: '#aeb9cc' },
        title: { show: false },
        detail: {
          valueAnimation: true,
          formatter: '{value}%',
          width: '60%',
          fontSize: 32,
          fontWeight: 'bolder',
          offsetCenter: [0, '10%'],
          color: ACCENT,
        },
        data: [{ value: data.summary.share_active }],
      },
    ],
  });
  window.addEventListener('resize', () => chart.resize());
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
      <table class="table table-sm table-hover align-middle" id="operators-table-el">
        <thead><tr><th>#</th><th>Operatore</th><th>${POWER_TIER_LABELS[tier]}</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (op, i) => `
                <tr class="${i < 3 ? 'table-warning' : ''}">
                  <td data-sort-value="${i + 1}">${i + 1}</td>
                  <td><span class="station-link" data-operator-popover="${op.name}">${op.name}</span></td>
                  <td>${op.shown}</td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
  enhanceTable(document.getElementById('operators-table-el'));
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
      <table class="table table-sm table-hover align-middle" id="poi-proximity-table-el">
        <thead><tr><th>Categoria</th><th>Colonnine entro soglia</th><th>% sul totale città</th><th>Esempio</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `
                <tr>
                  <td>${r.label}</td>
                  <td data-sort-value="${r.count_entro_soglia}">${r.count_entro_soglia} / ${data.totale_colonnine_citta}</td>
                  <td data-sort-value="${r.share}">${r.share}%</td>
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
  enhanceTable(document.getElementById('poi-proximity-table-el'));
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

let dailyBlockRaw = null;
let dailyChart = null;
let dailyTableVisible = false;

function pointsInRange(points, from, to) {
  return points.filter((p) => (!from || p.date >= from) && (!to || p.date <= to));
}

function renderDailyChartPoints(points) {
  const el = document.getElementById('chart-daily-trento');
  if (!el || typeof echarts === 'undefined') return;
  if (!dailyChart) dailyChart = echarts.init(el, 'evtrento-dark');
  dailyChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['Attive %', 'In ricarica %'] },
    grid: { left: 40, right: 20, top: 40, bottom: 60 },
    xAxis: {
      type: 'category',
      data: points.map((p) => (window.EVFormat ? EVFormat.dateOnly(p.date) : p.date)),
      axisLabel: { rotate: 45, fontSize: 10 },
    },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    series: [
      { name: 'Attive %', type: 'line', smooth: true, itemStyle: { color: HERO_GREEN }, data: points.map((p) => p.share_active) },
      { name: 'In ricarica %', type: 'line', smooth: true, itemStyle: { color: ACCENT }, data: points.map((p) => p.share_charging) },
    ],
  });
}

function renderDailyTable(points) {
  const table = document.getElementById('daily-table');
  if (!table) return;
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = points
    .map(
      (p) => `
        <tr>
          <td data-sort-value="${p.date}">${window.EVFormat ? EVFormat.dateOnly(p.date) : p.date}</td>
          <td>${p.share_active}%</td>
          <td>${p.share_charging}%</td>
        </tr>`
    )
    .join('');
  enhanceTable(table);
}

function applyDailyFilter() {
  if (!dailyBlockRaw) return;
  const from = document.getElementById('daily-date-from')?.value || '';
  const to = document.getElementById('daily-date-to')?.value || '';
  const points = pointsInRange(dailyBlockRaw.points, from, to);
  renderDailyChartPoints(points);
  if (dailyTableVisible) renderDailyTable(points);
}

function renderDailyChart(containerId, block) {
  if (!block.available) return renderPlaceholder(containerId, block);
  dailyBlockRaw = block;
  applyDailyFilter();
  window.addEventListener('resize', () => dailyChart && dailyChart.resize());
}

function wireDailyFilters() {
  const fromInput = document.getElementById('daily-date-from');
  const toInput = document.getElementById('daily-date-to');
  const toggleBtn = document.getElementById('daily-table-toggle');
  const wrap = document.getElementById('daily-table-wrap');
  [fromInput, toInput].forEach((input) => input && input.addEventListener('change', applyDailyFilter));
  if (toggleBtn && wrap) {
    toggleBtn.addEventListener('click', () => {
      dailyTableVisible = !dailyTableVisible;
      wrap.classList.toggle('d-none', !dailyTableVisible);
      toggleBtn.textContent = dailyTableVisible ? 'Nascondi tabella' : 'Vedi come tabella';
      if (dailyTableVisible && dailyBlockRaw) {
        const from = fromInput?.value || '';
        const to = toInput?.value || '';
        renderDailyTable(pointsInRange(dailyBlockRaw.points, from, to));
      }
    });
  }
}

function renderWeeklyHeatmap(containerId, block) {
  if (!block.available) return renderPlaceholder(containerId, block);
  const el = document.getElementById(containerId);
  if (!el || typeof echarts === 'undefined') return;
  const chart = echarts.init(el, 'evtrento-dark');
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
      textStyle: { color: '#aeb9cc' },
      inRange: { color: ['#1c2540', ACCENT] },
    },
    series: [{ type: 'heatmap', data, label: { show: false } }],
  });
  window.addEventListener('resize', () => chart.resize());
}

function renderMonthlyTable(points) {
  const table = document.getElementById('monthly-table');
  if (!table) return;
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = points
    .map(
      (p) => `
        <tr>
          <td data-sort-value="${p.month}">${window.EVFormat ? EVFormat.monthYear(p.month) : p.month}</td>
          <td>${p.share_active}%</td>
          <td>${p.share_charging}%</td>
        </tr>`
    )
    .join('');
  enhanceTable(table);
}

function renderMonthlyChart(containerId, block) {
  if (!block.available) return renderPlaceholder(containerId, block);
  const el = document.getElementById(containerId);
  if (!el || typeof echarts === 'undefined') return;
  const chart = echarts.init(el, 'evtrento-dark');
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['Attive %', 'In ricarica %'] },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: block.points.map((p) => (window.EVFormat ? EVFormat.monthYear(p.month) : p.month)) },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    series: [
      { name: 'Attive %', type: 'bar', itemStyle: { color: HERO_GREEN }, data: block.points.map((p) => p.share_active) },
      { name: 'In ricarica %', type: 'bar', itemStyle: { color: ACCENT }, data: block.points.map((p) => p.share_charging) },
    ],
  });
  window.addEventListener('resize', () => chart.resize());

  const toggleBtn = document.getElementById('monthly-table-toggle');
  const wrap = document.getElementById('monthly-table-wrap');
  if (toggleBtn && wrap) {
    toggleBtn.addEventListener('click', () => {
      const visible = !wrap.classList.contains('d-none');
      wrap.classList.toggle('d-none', visible);
      toggleBtn.textContent = visible ? 'Vedi come tabella' : 'Nascondi tabella';
      if (!visible) renderMonthlyTable(block.points);
    });
  }
}

function renderTrends(trends) {
  wireDailyFilters();
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
  const chart = echarts.init(el, 'evtrento-dark');
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
        itemStyle: { color: ACCENT },
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
    if (window.EVUsage) EVUsage.setData(usage);
    renderHourlyProfile(usage.city);
    renderEnergyCards(usage.city);
  } else {
    renderHourlyProfile(null);
    renderEnergyCards(null);
  }
}

loadData();
