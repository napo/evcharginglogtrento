const cardsContainer = document.getElementById('curiosities-cards');
const emptyState = document.getElementById('empty-state');
const daysNote = document.getElementById('days-note');

const tones = ['primary', 'success', 'info', 'warning', 'secondary', 'danger'];

let usoItemsAll = [];

function osmLink(lat, lon) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

function listItemHtml(rank, indirizzo, sottotitolo, lat, lon) {
  return `
    <div class="list-group-item d-flex justify-content-between align-items-start gap-3">
      <div>
        <span class="badge bg-secondary me-2">#${rank}</span>
        <strong>${indirizzo}</strong>
        <div class="small text-muted">${sottotitolo}</div>
      </div>
      <a href="${osmLink(lat, lon)}" target="_blank" rel="noopener" class="small text-nowrap">Vedi su mappa ↗</a>
    </div>`;
}

function renderCuriosities(curiosita) {
  if (!curiosita || curiosita.length === 0) return false;
  cardsContainer.innerHTML = curiosita
    .map(
      (c, i) => `
      <div class="col-md-6">
        <div class="card shadow-sm h-100 border-0 border-start border-4 border-${tones[i % tones.length]}">
          <div class="card-body">
            <h2 class="h6 text-uppercase text-muted">${c.titolo}</h2>
            <p class="mb-0">${c.testo}</p>
          </div>
        </div>
      </div>`
    )
    .join('');
  return true;
}

function renderTop3Block(prefix, block) {
  const col = document.getElementById(`top3-${prefix}-col`);
  if (!block || !block.items || block.items.length === 0) return false;

  col.classList.remove('d-none');
  document.getElementById(`top3-${prefix}-title`).textContent = block.titolo;
  document.getElementById(`top3-${prefix}-desc`).textContent = block.descrizione || '';
  document.getElementById(`top3-${prefix}-list`).innerHTML = block.items
    .map((item) => listItemHtml(item.rank, item.indirizzo, `${item.cpo} · ${item.valore}`, item.lat, item.lon))
    .join('');
  return true;
}

function renderUsoItems(tier) {
  const filtered = tier === 'tutte' ? usoItemsAll : usoItemsAll.filter((it) => it.fascia_potenza === tier);
  const top3 = filtered.slice(0, 3);
  const list = document.getElementById('top3-uso-list');
  list.innerHTML = top3.length
    ? top3.map((item, i) => listItemHtml(i + 1, item.indirizzo, `${item.cpo} · ${item.valore}`, item.lat, item.lon)).join('')
    : '<div class="list-group-item text-muted small">Nessuna colonnina in questa fascia di potenza.</div>';
}

function wireUsoFilter() {
  const buttons = Array.from(document.querySelectorAll('#uso-power-filter button'));
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderUsoItems(btn.dataset.tier);
    });
  });
}

function renderUsoBlock(block) {
  const col = document.getElementById('top3-uso-col');
  if (!block || !block.items || block.items.length === 0) return false;
  col.classList.remove('d-none');
  document.getElementById('top3-uso-title').textContent = block.titolo;
  document.getElementById('top3-uso-desc').textContent = block.descrizione || '';
  usoItemsAll = block.items;
  renderUsoItems('tutte');
  return true;
}

function renderOperatorsSection(stats, perOperatore) {
  const section = document.getElementById('operators-section');
  if (!stats || !stats.operators || stats.operators.length === 0) return;
  section.classList.remove('d-none');

  document.getElementById('operators-top3-list').innerHTML = stats.operators
    .slice(0, 3)
    .map(
      (op, i) => `
      <div class="list-group-item d-flex justify-content-between align-items-center">
        <div><span class="badge bg-secondary me-2">#${i + 1}</span><strong>${op.name}</strong></div>
        <span class="text-muted small">${op.count} colonnine</span>
      </div>`
    )
    .join('');

  const select = document.getElementById('operator-select');
  const drilldownList = document.getElementById('operator-drilldown-list');
  const operatorNames = Object.keys(perOperatore || {}).sort();

  if (operatorNames.length === 0) {
    select.innerHTML = '<option>Nessun operatore con storico sufficiente</option>';
    select.disabled = true;
    drilldownList.innerHTML = '';
    return;
  }

  select.disabled = false;
  select.innerHTML = operatorNames.map((name) => `<option value="${name}">${name}</option>`).join('');
  const renderDrilldown = () => {
    const items = (perOperatore[select.value] || {}).items || [];
    drilldownList.innerHTML = items.length
      ? items.map((item) => listItemHtml(item.rank, item.indirizzo, item.valore, item.lat, item.lon)).join('')
      : '<div class="list-group-item text-muted small">Nessun dato.</div>';
  };
  select.addEventListener('change', renderDrilldown);
  renderDrilldown();
}

async function loadCuriosities() {
  const [curiosResponse, statsResponse] = await Promise.all([
    fetch('../data/curiosities.json'),
    fetch('../data/stats.json').catch(() => null),
  ]);
  if (!curiosResponse.ok) {
    emptyState.classList.remove('d-none');
    return;
  }
  const payload = await curiosResponse.json();
  daysNote.textContent = `Calcolate su ${payload.days_collected} giorn${payload.days_collected === 1 ? 'o' : 'i'} di storico raccolto finora.`;

  const hasCuriosita = renderCuriosities(payload.curiosita);
  const top3 = payload.top3 || {};
  const hasUso = renderUsoBlock(top3.uso);
  const hasPotenza = renderTop3Block('potenza', top3.potenza);
  wireUsoFilter();

  if (statsResponse && statsResponse.ok) {
    renderOperatorsSection(await statsResponse.json(), payload.per_operatore);
  }

  if (!hasCuriosita && !hasUso && !hasPotenza) {
    emptyState.classList.remove('d-none');
  }
}

loadCuriosities();
