'use strict';
const P = Planner;
const STORE_KEY = 'essensplan.prototyp.v1';
const SLOT_NAMES = { dinner: 'Abendessen', lunch: 'Mittagessen' };

const $ = sel => document.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (window.crypto && crypto.randomUUID
  ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 7));

const DEFAULT_TAGS = ['Fleisch', 'Fisch', 'Vegetarisch', 'Vegan', 'Nudeln', 'Reis', 'Kartoffeln', 'Suppe', 'Schnell', 'Aufwendig', 'Groß'];
const defaultSettings = () => ({
  defaultPersons: 4,
  lunch: false,
  limits: SampleData.LIMITS.map(l => ({ ...l })),
  noRepeatWeeks: 2,
  weekdays: Array(7).fill('normal'),
});
const emptyCloudState = () => ({
  dishes: [], settings: defaultSettings(), tags: [...DEFAULT_TAGS],
  plans: { group: {}, mine: {} }, me: null, members: [], log: [],
  shop: { checked: {}, extras: {} }, groupCode: '',
});

/* ---------- Daten ---------- */

function tagsOfDishes(dishes) {
  const set = new Map();
  for (const d of dishes) for (const t of d.tags) set.set(t.toLowerCase(), t);
  return [...set.values()];
}

function freshState() {
  const dishes = SampleData.DISHES.map(d => ({
    ...d, id: uid(), link: '', photo: null, active: true,
    ingredients: d.ingredients.map(i => ({ ...i })),
  }));
  const settings = defaultSettings();
  // Drei vergangene Wochen als Beispiel, damit Statistik und Abwechslung etwas zeigen.
  let group = {};
  const monday = P.mondayOf(P.today());
  for (let w = -3; w <= 0; w++) {
    const start = P.addDays(monday, w * 7);
    const slots = [0, 1, 2, 3, 4, 5, 6].map(i => ({ date: P.addDays(start, i), slot: 'dinner', choice: 'auto' }));
    group = P.generate({ dishes, entries: group, slots, rules: settings }).entries;
  }
  const hoursAgo = h => new Date(Date.now() - h * 3600000).toISOString();
  return {
    dishes, settings,
    tags: tagsOfDishes(dishes),
    plans: { group },
    me: null,
    members: ['Anna', 'Tom'],
    log: [
      { at: hoursAgo(5), by: 'Tom', text: `hat „${dishes[1].name}“ geändert: Zutaten`, dishId: dishes[1].id },
      { at: hoursAgo(30), by: 'Anna', text: `hat „${dishes[5].name}“ hinzugefügt`, dishId: dishes[5].id },
      { at: hoursAgo(50), by: 'Anna', text: 'hat den Plan für diese Woche erstellt' },
    ],
    shop: { checked: {}, extras: {} },
  };
}

function loadState() {
  if (Cloud.enabled) return emptyCloudState();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.dishes) && s.plans && s.settings) {
        if (!Array.isArray(s.tags)) s.tags = tagsOfDishes(s.dishes);
        return s;
      }
    }
  } catch (e) { /* ohne gespeicherte Daten neu starten */ }
  return freshState();
}

let state = loadState();
const ui = {
  tab: 'plan', week: P.mondayOf(P.today()), plan: 'group',
  search: '', tags: new Set(), sort: 'name', notes: [],
  pickSearch: '', detailPersons: null, np: null, editPhoto: null, renderSheet: null,
  randomId: null, folds: new Set(),
  mustJoin: false, welcomeMode: 'create', welcomeName: '', welcomeCode: '', saveProblem: false,
};

/* Das Design gehört zum Gerät, nicht zur Gruppe. */
const THEME_KEY = 'essensplan.theme';
function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (e) { return 'system'; }
}
function applyTheme() {
  const t = getTheme();
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function save() {
  if (Cloud.enabled) { Cloud.schedule(); return true; }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    toast('Speicher voll: Die letzte Änderung konnte nicht gesichert werden. Lösche am besten ein Foto.');
    return false;
  }
}

const me = () => state.me || 'Ich';
const planKey = () => (ui.plan === 'group' ? 'group' : Cloud.enabled ? 'mine' : 'p:' + me());
function entries() {
  const k = planKey();
  if (!state.plans[k]) state.plans[k] = {};
  return state.plans[k];
}
const dishById = id => state.dishes.find(d => d.id === id);
const rules = () => state.settings;
const personsFor = e => (e && e.persons) || state.settings.defaultPersons;

function log(text, dishId, dishIds) {
  state.log.unshift({ at: new Date().toISOString(), by: me(), text, dishId: dishId || null, dishIds: dishIds || [] });
  state.log.length = Math.min(state.log.length, 300);
}
/* Änderungen am eigenen Plan sind privat und tauchen nicht im gemeinsamen Verlauf auf. */
const logPlan = text => { if (ui.plan === 'group') log(text); };

function allTags() {
  const set = new Map(state.tags.map(t => [t.toLowerCase(), t]));
  for (const t of tagsOfDishes(state.dishes)) if (!set.has(t.toLowerCase())) set.set(t.toLowerCase(), t);
  return [...set.values()].sort((a, b) => a.localeCompare(b, 'de'));
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

/* ---------- Bottom Sheets ---------- */

const sheet = $('#sheet');
function showSheet(fn) {
  ui.renderSheet = fn;
  sheet.innerHTML = `<div class="sheet-body">${fn()}</div>`;
  if (!sheet.open) {
    sheet.showModal();
    try { history.pushState({ sheet: 1 }, ''); } catch (e) { /* nur für die Zurück-Taste */ }
  }
  sheet.scrollTop = 0;
}
function refreshSheet() {
  if (sheet.open && ui.renderSheet) {
    const top = sheet.scrollTop;
    sheet.innerHTML = `<div class="sheet-body">${ui.renderSheet()}</div>`;
    sheet.scrollTop = top;
  }
}
function closeSheet() {
  if (!sheet.open || ui.mustJoin) return;
  sheet.close();
  if (history.state && history.state.sheet) history.back();
}
window.addEventListener('popstate', () => { if (sheet.open && !ui.mustJoin) sheet.close(); });
sheet.addEventListener('cancel', e => { e.preventDefault(); closeSheet(); });

const sheetHead = (title, sub) => `<div class="sheet-head"><div class="grow"><h2>${esc(title)}</h2>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}</div>
  <button class="icon ghost" data-a="close" aria-label="Schließen">✕</button></div>`;
const stepper = (value, action, extra = '') => `<div class="stepper">
  <button type="button" data-a="${action}" data-d="-1" ${extra} aria-label="Weniger">−</button><output>${esc(value)}</output>
  <button type="button" data-a="${action}" data-d="1" ${extra} aria-label="Mehr">+</button></div>`;

/* ---------- Plan ---------- */

function weekNav() {
  const m = ui.week;
  const isNow = m === P.mondayOf(P.today());
  return `<div class="week-nav">
    <button class="icon" data-a="week" data-d="-1" aria-label="Vorherige Woche">‹</button>
    <button class="ghost label" data-a="week-now" ${isNow ? 'disabled' : ''}>
      <strong>KW ${P.weekNumber(m)}${isNow ? ' · diese Woche' : ''}</strong>
      <span class="muted">${P.weekRange(m)}</span>
    </button>
    <button class="icon" data-a="week" data-d="1" aria-label="Nächste Woche">›</button>
  </div>`;
}

function renderPlan() {
  const es = entries();
  const now = P.today();
  let html = weekNav();
  if (ui.notes.length) {
    html += `<div class="card notes"><div class="row between"><strong>Nicht alle Regeln passten</strong>
      <button class="icon ghost" data-a="notes-off" aria-label="Hinweise ausblenden">✕</button></div>
      <ul>${ui.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`;
  }

  html += '<div class="days">';
  for (let i = 0; i < 7; i++) {
    const date = P.addDays(ui.week, i);
    const slots = [];
    if (state.settings.lunch || es[P.key(date, 'lunch')]) slots.push('lunch');
    slots.push('dinner');
    html += `<div class="day ${date === now ? 'today' : ''} ${date < now ? 'past' : ''}">
      <div class="day-date"><b>${P.DAYS[i]}</b><span>${P.shortDate(date)}</span></div>
      <div>${slots.map(s => slotRow(date, s, es, slots.length > 1)).join('')}</div>
    </div>`;
  }
  html += `</div>
    <div class="row"><button class="primary grow" data-a="new-plan">Neuer Plan</button>
    <button class="grow" data-a="random">Zufälliges Gericht</button></div>
    <div class="seg" role="group" aria-label="Welcher Plan">
      <button data-a="plan-kind" data-kind="group" aria-pressed="${ui.plan === 'group'}">Gemeinsam</button>
      <button data-a="plan-kind" data-kind="me" aria-pressed="${ui.plan === 'me'}">Mein Plan</button>
    </div>`;
  return html;
}

function slotRow(date, slot, es, showSlot) {
  const e = es[P.key(date, slot)];
  const dish = e && dishById(e.dishId);
  const prefix = showSlot ? `${slot === 'lunch' ? 'Mittag' : 'Abend'} · ` : '';
  let main;
  if (dish) {
    const parts = [...dish.tags];
    if (dish.minutes) parts.push(`ca. ${dish.minutes} Min`);
    parts.push(`${personsFor(e)} Pers.`);
    if (e.locked) parts.push('fest');
    if (e.eaten === false) parts.push('gab es nicht');
    main = `<button class="slot-main ${e.eaten === false ? 'struck' : ''}" data-a="dish" data-id="${dish.id}" data-persons="${personsFor(e)}">
      <strong>${esc(dish.name)}</strong><small>${prefix}${esc(parts.join(' · '))}</small></button>`;
  } else {
    main = `<button class="slot-main nothing" data-a="day" data-date="${date}" data-slot="${slot}">
      <strong>${e && e.none ? 'Kein Essen' : 'Noch nichts geplant'}</strong>${showSlot ? `<small>${prefix.slice(0, -3)}</small>` : ''}</button>`;
  }
  return `<div class="slot">${main}
    <button class="icon ghost" data-a="day" data-date="${date}" data-slot="${slot}" aria-label="Optionen für ${P.label(date)}" title="Optionen">⋮</button>
  </div>`;
}

function rollSlot(date, slot) {
  const es = entries();
  const k = P.key(date, slot);
  const cur = es[k];
  const r = P.pick({ dishes: state.dishes, entries: es, date, slot, rules: rules(), excludeId: cur && cur.dishId });
  if (!r.dishId) { toast(r.note); return; }
  es[k] = cur && cur.persons ? { dishId: r.dishId, persons: cur.persons } : { dishId: r.dishId };
  logPlan(`hat für ${P.label(date)} „${dishById(r.dishId).name}“ gerollt`);
  save();
  if (r.note) toast(r.note);
  render();
  refreshSheet();
}

function daySheet(date, slot) {
  return () => {
    const es = entries();
    const e = es[P.key(date, slot)];
    const dish = e && dishById(e.dishId);
    const now = P.today();
    let out = sheetHead(dish ? dish.name : (e && e.none ? 'Kein Essen' : 'Noch nichts geplant'), `${P.label(date)} · ${SLOT_NAMES[slot]}`);
    const d = `data-date="${date}" data-slot="${slot}"`;
    out += `<div class="sheet-actions">
      <button data-a="roll" ${d}>↻ Neu rollen</button>
      <button data-a="pick" ${d}>Aus Liste wählen</button>
      <button data-a="day-none" ${d} class="${e && e.none ? 'on' : ''}">Kein Essen</button>
      <button data-a="day-clear" ${d}>Tag leeren</button>
    </div>`;
    if (dish) {
      out += `<div><div class="set-row"><span>Personen an diesem Tag</span>${stepper(personsFor(e), 'day-persons', d)}</div>
      <label class="set-row check"><span class="grow">Fest, bleibt beim neuen Plan erhalten</span>
        <input type="checkbox" data-c="day-lock" ${d} ${e.locked ? 'checked' : ''}></label>
      ${date <= now ? `<label class="set-row check"><span class="grow">Gab es wirklich (zählt für die Statistik)</span>
        <input type="checkbox" data-c="day-eaten" ${d} ${P.wasEaten(e, date, now) ? 'checked' : ''}></label>` : ''}</div>`;
    }
    return out;
  };
}

/* ---------- Gericht auswählen ---------- */

function filterDishes(search, tags) {
  const q = search.trim().toLowerCase();
  return state.dishes.filter(d => {
    if (q && !d.name.toLowerCase().includes(q) && !d.ingredients.some(i => i.name.toLowerCase().includes(q))) return false;
    for (const t of tags) if (!P.hasTag(d, t)) return false;
    return true;
  });
}

function pickerList(date, slot) {
  const list = filterDishes(ui.pickSearch, new Set()).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (!list.length) return '<p class="empty">Kein Gericht gefunden.</p>';
  return list.map(d => `<button class="dish-row" data-a="pick-set" data-id="${d.id}" data-date="${date}" data-slot="${slot}">
    ${thumb(d)}<span class="info"><strong>${esc(d.name)}</strong><span class="muted">${esc(d.tags.join(' · '))}</span></span></button>`).join('');
}

function pickSheet(date, slot) {
  return () => `${sheetHead('Gericht wählen', `${P.label(date)} · ${SLOT_NAMES[slot]}`)}
    <input type="search" data-i="pick-search" data-date="${date}" data-slot="${slot}" placeholder="Name oder Zutat suchen" value="${esc(ui.pickSearch)}" aria-label="Gericht suchen">
    <div class="list" id="pickList">${pickerList(date, slot)}</div>`;
}

/* ---------- Neuer Plan ---------- */

function defaultStart() {
  const thisMonday = P.mondayOf(P.today());
  const base = ui.week >= thisMonday ? ui.week : thisMonday;
  const es = entries();
  const filled = [0, 1, 2, 3, 4, 5, 6].some(i => es[P.key(P.addDays(base, i), 'dinner')]);
  return filled ? P.addDays(base, 7) : base;
}

function npDates() {
  const n = Number(ui.np.range) * 7;
  return Array.from({ length: n }, (_, i) => P.addDays(ui.np.start, i));
}

function npChoice(date, slot) {
  const k = P.key(date, slot);
  if (ui.np.choices[k]) return ui.np.choices[k];
  const e = entries()[k];
  if (e && e.locked && dishById(e.dishId)) return e.dishId;
  if (slot === 'dinner') {
    const preset = state.settings.weekdays[P.weekdayIndex(date)];
    if (preset === 'none') return 'none';
    if (preset !== 'normal' && dishById(preset)) return preset;
  }
  return 'auto';
}

function choiceOptions(selected, normalLabel, normalValue) {
  const dishes = [...state.dishes].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return `<option value="${normalValue}" ${selected === normalValue ? 'selected' : ''}>${normalLabel}</option>
    <option value="none" ${selected === 'none' ? 'selected' : ''}>Kein Essen</option>
    <optgroup label="Festes Gericht">${dishes.map(d =>
      `<option value="${d.id}" ${selected === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</optgroup>`;
}

function newPlanSheet() {
  const np = ui.np;
  const ranges = [['1', '1 Woche'], ['2', '2 Wochen'], ['3', '3 Wochen'], ['4', '4 Wochen']];
  const dates = npDates();
  const es = entries();
  const slotKeys = np.lunch ? ['lunch', 'dinner'] : ['dinner'];
  const filled = dates.flatMap(d => slotKeys.map(s => es[P.key(d, s)])).filter(e => e && !e.locked).length;

  const rows = dates.map(d => {
    const select = s => `<select data-c="np-choice" data-key="${P.key(d, s)}" aria-label="${P.label(d)} ${SLOT_NAMES[s]}">
      ${choiceOptions(npChoice(d, s), 'Automatisch', 'auto')}</select>`;
    return `<span>${P.label(d)}</span>${np.lunch ? select('lunch') : ''}${select('dinner')}`;
  }).join('');

  return `${sheetHead('Neuer Plan', ui.plan === 'group' ? 'Gemeinsamer Plan' : 'Mein Plan')}
    <div class="seg" role="group" aria-label="Zeitraum">${ranges.map(([v, l]) =>
      `<button type="button" data-a="np-range" data-range="${v}" aria-pressed="${np.range === v}">${l}</button>`).join('')}</div>
    <label class="field">Beginnt am<input type="date" data-c="np-start" value="${np.start}"></label>
    <label class="check"><input type="checkbox" data-c="np-lunch" ${np.lunch ? 'checked' : ''}> Auch Mittagessen planen</label>
    <div>
      <h3>Tage festlegen</h3>
      <p class="muted">„Kein Essen“ oder ein festes Gericht wählen. Der Rest wird nach deinen Regeln gefüllt.</p>
    </div>
    <div class="day-grid ${np.lunch ? 'lunch' : ''}">
      ${np.lunch ? '<span></span><span class="head">Mittag</span><span class="head">Abend</span>' : ''}
      ${rows}
    </div>
    ${filled ? `<p class="muted">${filled} ${filled === 1 ? 'Eintrag wird' : 'Einträge werden'} ersetzt. Feste Gerichte bleiben, solange sie oben ausgewählt sind.</p>` : ''}
    <button class="primary wide" data-a="np-go">Plan erstellen</button>`;
}

function createPlan() {
  const np = ui.np;
  const dates = npDates();
  const slotKeys = np.lunch ? ['lunch', 'dinner'] : ['dinner'];
  const slots = dates.flatMap(date => slotKeys.map(slot => ({ date, slot, choice: npChoice(date, slot) })));
  const result = P.generate({ dishes: state.dishes, entries: entries(), slots, rules: rules() });
  state.plans[planKey()] = result.entries;
  ui.notes = result.notes;
  ui.week = P.mondayOf(np.start);
  if (np.lunch) state.settings.lunch = true;
  logPlan(`hat einen Plan ab ${P.label(np.start)} erstellt (${dates.length} Tage)`);
  save();
  closeSheet();
  render();
  scrollTo(0, 0);
  toast('Plan erstellt');
}

/* ---------- Zufälliges Gericht: nur ein Vorschlag, wird nirgends eingetragen ---------- */

function rollRandom() {
  const r = P.pick({ dishes: state.dishes, entries: entries(), date: P.today(), slot: 'random', rules: rules(), excludeId: ui.randomId });
  if (!r.dishId) { toast(r.note); return false; }
  ui.randomId = r.dishId;
  return true;
}

const randomSheet = () => `<div class="row between"><span class="random-label">Zufälliges Gericht</span>
    <button data-a="random-again">↻ Nochmal</button></div>
  ${dishSheet(ui.randomId)()}`;

/* ---------- Gerichte ---------- */

function thumb(d) {
  return d.photo
    ? `<img class="thumb" src="${esc(d.photo)}" alt="">`
    : `<span class="thumb" aria-hidden="true">${esc(d.name.charAt(0).toUpperCase())}</span>`;
}

function lastText(stats) {
  if (!stats.last) return 'noch nie';
  const n = P.daysBetween(stats.last, P.today());
  if (n <= 0) return 'heute';
  return n === 1 ? 'gestern' : `vor ${n} Tagen`;
}

function dishListHtml() {
  const now = P.today();
  const rows = filterDishes(ui.search, ui.tags).map(d => ({ d, s: P.dishStats(d.id, state.plans, now) }));
  if (ui.sort === 'name') rows.sort((a, b) => a.d.name.localeCompare(b.d.name, 'de'));
  if (ui.sort === 'oldest') rows.sort((a, b) => (a.s.last || '').localeCompare(b.s.last || ''));
  if (ui.sort === 'often') rows.sort((a, b) => b.s.count - a.s.count);
  if (ui.sort === 'fast') rows.sort((a, b) => (a.d.minutes || 9999) - (b.d.minutes || 9999));
  if (!rows.length) return '<p class="empty">Kein Gericht passt zu dieser Suche.</p>';
  return `<p class="muted">${rows.length} ${rows.length === 1 ? 'Gericht' : 'Gerichte'}</p>` + rows.map(({ d, s }) => `
    <button class="dish-row ${d.active === false ? 'off' : ''}" data-a="dish" data-id="${d.id}">${thumb(d)}
      <span class="info"><strong>${esc(d.name)}</strong>
      <span class="muted">${esc(d.tags.join(' · '))}${d.minutes ? ` · ca. ${d.minutes} Min` : ''}<br>
      ${s.count}x · zuletzt ${lastText(s)}${d.active === false ? ' · nicht im Zufall' : ''}</span></span>
    </button>`).join('');
}

function renderDishes() {
  return `<div class="row"><button class="primary grow" data-a="dish-new">+ Neues Gericht</button>
      <button class="grow" data-a="history">Verlauf</button></div>
    <input type="search" data-i="dish-search" placeholder="Name oder Zutat suchen" value="${esc(ui.search)}" aria-label="Gerichte suchen">
    <div class="chips scroll" role="group" aria-label="Nach Tags filtern">${allTags().map(t =>
      `<button class="chip-btn ${ui.tags.has(t) ? 'on' : ''}" data-a="tag-filter" data-tag="${esc(t)}" aria-pressed="${ui.tags.has(t)}">${esc(t)}</button>`).join('')}</div>
    <label class="field">Sortieren
      <select data-c="dish-sort">${[['name', 'A bis Z'], ['oldest', 'Am längsten nicht gegessen'], ['often', 'Am häufigsten gegessen'], ['fast', 'Am schnellsten gemacht']].map(([v, l]) =>
        `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="list" id="dishList">${dishListHtml()}</div>`;
}

function dishSheet(id) {
  return () => {
    const d = dishById(id);
    if (!d) return sheetHead('Gericht nicht gefunden');
    const stats = P.dishStats(id, state.plans, P.today());
    const persons = ui.detailPersons || state.settings.defaultPersons;
    const factor = persons / Math.max(d.servings || 1, 1);
    const maxDay = Math.max(1, ...stats.byWeekday);
    const changes = state.log.filter(l => l.dishId === id || (l.dishIds || []).includes(id)).slice(0, 5);
    const safeLink = /^https?:\/\//i.test(d.link || '') ? d.link : null;

    return `${d.photo ? `<img class="hero" src="${esc(d.photo)}" alt="Foto von ${esc(d.name)}">` : ''}
      ${sheetHead(d.name, d.minutes ? `ca. ${d.minutes} Minuten` : '')}
      <div class="chips">${d.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      <section><div class="set-row"><h3>Zutaten</h3>${stepper(persons + ' P.', 'detail-persons')}</div>
        ${d.ingredients.length ? `<ul class="ings">${d.ingredients.map(i =>
          `<li><span class="amt">${esc(P.scaleIngredient(i, factor))}</span><span>${esc(i.name)}</span></li>`).join('')}</ul>`
          : '<p class="muted">Noch keine Zutaten eingetragen.</p>'}
      </section>
      <section class="stack"><h3>Rezept</h3>
        ${d.recipe ? `<p class="steps">${esc(d.recipe)}</p>` : '<p class="muted">Noch kein Rezept eingetragen.</p>'}
        ${safeLink ? `<a href="${esc(safeLink)}" target="_blank" rel="noopener noreferrer">Rezept im Internet öffnen</a>` : ''}
      </section>
      <section class="stack"><h3>Statistik</h3>
        <div class="stat-grid">
          <div><b>${stats.count}x</b><span class="muted">gegessen</span></div>
          <div><b>${stats.last ? P.shortDate(stats.last) : '–'}</b><span class="muted">${lastText(stats)}</span></div>
          <div><b>${stats.count ? P.DAYS[stats.byWeekday.indexOf(Math.max(...stats.byWeekday))] : '–'}</b><span class="muted">häufigster Tag</span></div>
        </div>
        <div class="bars" role="img" aria-label="Häufigkeit pro Wochentag: ${P.DAYS.map((n, i) => `${n} ${stats.byWeekday[i]}`).join(', ')}">
          ${stats.byWeekday.map((n, i) => `<div><i style="height:${Math.round((n / maxDay) * 44)}px"></i>${P.DAYS[i]}</div>`).join('')}
        </div>
      </section>
      ${changes.length ? `<section><h3>Letzte Änderungen</h3>${changes.map(logItem).join('')}</section>` : ''}
      <label class="check"><input type="checkbox" data-c="dish-active" data-id="${id}" ${d.active !== false ? 'checked' : ''}> Darf gerollt werden</label>
      <div class="sheet-actions"><button data-a="dish-edit" data-id="${id}">Bearbeiten</button>
        <button class="danger" data-a="dish-del" data-id="${id}">Löschen</button></div>`;
  };
}

const fmtAmountInput = a => (a == null ? '' : String(a).replace('.', ','));
const ingRow = (i = { amount: null, unit: '', name: '' }) => `<div class="ing-row">
  <input name="amt" inputmode="decimal" pattern="[0-9]+([,.][0-9]+|\\/[0-9]+)?" title="Zahl, zum Beispiel 200, 1,5 oder 1/2" placeholder="Menge" aria-label="Menge" value="${esc(fmtAmountInput(i.amount))}">
  <input name="unit" list="units" placeholder="Einh." aria-label="Einheit" value="${esc(i.unit)}">
  <input name="ing" placeholder="Zutat" aria-label="Zutat" value="${esc(i.name)}">
  <button type="button" data-a="ing-del" aria-label="Zutat entfernen">✕</button></div>`;

function editSheet(id) {
  return () => {
    const d = id ? dishById(id) : { name: '', tags: [], minutes: '', servings: state.settings.defaultPersons, ingredients: [], recipe: '', link: '' };
    const tags = new Map(allTags().map(t => [t.toLowerCase(), t]));
    d.tags.forEach(t => tags.set(t.toLowerCase(), t));
    return `${sheetHead(id ? 'Gericht bearbeiten' : 'Neues Gericht')}
    <form id="dishForm" class="stack" data-id="${id || ''}">
      <label class="field">Name<input name="name" required maxlength="80" value="${esc(d.name)}"></label>
      <div class="field">Foto
        <div class="photo-edit" id="photoEdit">${photoEditHtml()}</div>
      </div>
      <div class="row">
        <label class="field grow">Dauer (Minuten)<input name="minutes" type="number" min="1" max="999" inputmode="numeric" value="${esc(d.minutes)}"></label>
        <label class="field grow">Rezept reicht für (Personen)<input name="servings" type="number" min="1" max="99" required inputmode="numeric" value="${esc(d.servings)}"></label>
      </div>
      <div class="stack"><strong>Tags</strong>
        <div class="chips" id="tagChips">${[...tags.values()].sort((a, b) => a.localeCompare(b, 'de')).map(t => tagChip(t, d.tags.some(x => x.toLowerCase() === t.toLowerCase()))).join('')}</div>
        <div class="row"><input id="newTag" class="grow" placeholder="Neuer Tag" maxlength="24" aria-label="Neuer Tag"><button type="button" data-a="tag-add">Hinzufügen</button></div>
      </div>
      <div><strong>Zutaten</strong>
        <div id="ingRows" style="margin-top:6px">${(d.ingredients.length ? d.ingredients : [undefined, undefined]).map(ingRow).join('')}</div>
        <button type="button" class="wide" data-a="ing-add">+ Zutat</button>
      </div>
      <label class="field">Rezept<textarea name="recipe" rows="5">${esc(d.recipe)}</textarea></label>
      <label class="field">Link, zum Beispiel zu Chefkoch<input name="link" type="url" inputmode="url" placeholder="https://" value="${esc(d.link)}"></label>
      <div class="sheet-actions">
        <button type="button" data-a="${id ? 'dish' : 'close'}" data-id="${id || ''}">Abbrechen</button>
        <button class="primary">Speichern</button>
      </div>
    </form>`;
  };
}
const tagChip = (t, on) => `<button type="button" class="chip-btn ${on ? 'on' : ''}" data-a="tag-toggle" data-tag="${esc(t)}" aria-pressed="${on}">${esc(t)}</button>`;
const photoEditHtml = () => (ui.editPhoto
  ? `<img src="${esc(ui.editPhoto)}" alt="Vorschau"><button type="button" data-a="photo-pick">Ändern</button><button type="button" class="danger" data-a="photo-del">Entfernen</button>`
  : '<button type="button" data-a="photo-pick">Foto hinzufügen</button>');

function saveDishForm(form) {
  const f = new FormData(form);
  const id = form.dataset.id;
  const tags = [...form.querySelectorAll('#tagChips .on')].map(b => b.dataset.tag);
  const ingredients = [...form.querySelectorAll('.ing-row')].map(r => ({
    amount: P.parseAmount(r.querySelector('[name=amt]').value),
    unit: r.querySelector('[name=unit]').value.trim(),
    name: r.querySelector('[name=ing]').value.trim(),
  })).filter(i => i.name);
  const data = {
    name: f.get('name').trim(),
    minutes: Number(f.get('minutes')) || null,
    servings: Math.max(1, Number(f.get('servings')) || 1),
    tags, ingredients,
    recipe: f.get('recipe').trim(),
    link: f.get('link').trim(),
    photo: ui.editPhoto,
  };
  if (!data.name) { toast('Bitte gib dem Gericht einen Namen.'); return; }
  for (const t of tags) if (!state.tags.some(x => x.toLowerCase() === t.toLowerCase())) state.tags.push(t);

  if (id) {
    const d = dishById(id);
    const labels = { name: 'Name', minutes: 'Dauer', servings: 'Personen', tags: 'Tags', ingredients: 'Zutaten', recipe: 'Rezept', link: 'Link', photo: 'Foto' };
    const changed = Object.keys(labels).filter(k => JSON.stringify(d[k] ?? null) !== JSON.stringify(data[k] ?? null)).map(k => labels[k]);
    Object.assign(d, data);
    if (changed.length) log(`hat „${d.name}“ geändert: ${changed.join(', ')}`, id);
    save();
    openDish(id);
  } else {
    const d = { ...data, id: uid(), active: true };
    state.dishes.push(d);
    log(`hat „${d.name}“ hinzugefügt`, d.id);
    save();
    openDish(d.id);
  }
  render();
  toast('Gespeichert');
}

function openDish(id, persons) {
  const d = dishById(id);
  ui.detailPersons = persons || state.settings.defaultPersons;
  if (d) showSheet(dishSheet(id));
}

/* ---------- Tags verwalten ---------- */

const dishesWithTag = tag => state.dishes.filter(d => P.hasTag(d, tag));

function tagSheet(tag) {
  return () => {
    const affected = dishesWithTag(tag).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const rule = state.settings.limits.find(l => l.tag.toLowerCase() === tag.toLowerCase());
    return `${sheetHead('Tag bearbeiten', tag)}
      <form id="tagForm" class="stack" data-tag="${esc(tag)}">
        <label class="field">Name<input id="tagName" required maxlength="24" value="${esc(tag)}"></label>
        <div class="sheet-actions">
          <button type="button" class="danger" data-a="tag-delete" data-tag="${esc(tag)}">Löschen</button>
          <button class="primary">Umbenennen</button>
        </div>
      </form>
      <section class="stack">
        <h3>Diese ${affected.length === 1 ? 'Änderung betrifft 1 Gericht' : `Änderung betrifft ${affected.length} Gerichte`}</h3>
        ${affected.length ? `<ul class="affected">${affected.map(d => `<li>${esc(d.name)}</li>`).join('')}</ul>` : '<p class="muted">Kein Gericht hat diesen Tag.</p>'}
        ${rule ? `<p class="muted">Die Regel „${esc(rule.tag)} höchstens ${rule.max}x pro Woche“ ändert sich mit: Beim Umbenennen zieht sie mit, beim Löschen fällt sie weg.</p>` : ''}
      </section>`;
  };
}

function renameTag(oldTag, newName) {
  const same = t => t.toLowerCase() === oldTag.toLowerCase();
  const name = newName.trim();
  if (!name || name === oldTag) { closeSheet(); return; }
  const target = allTags().find(t => !same(t) && t.toLowerCase() === name.toLowerCase());
  const finalName = target || name;
  const affected = dishesWithTag(oldTag);
  for (const d of affected) {
    const others = d.tags.filter(t => !same(t) && t.toLowerCase() !== finalName.toLowerCase());
    d.tags = [...others, finalName];
  }
  state.tags = state.tags.filter(t => !same(t) && t.toLowerCase() !== finalName.toLowerCase());
  state.tags.push(finalName);
  const limits = state.settings.limits;
  const oldRule = limits.find(l => same(l.tag));
  if (oldRule) {
    if (limits.some(l => l !== oldRule && l.tag.toLowerCase() === finalName.toLowerCase())) limits.splice(limits.indexOf(oldRule), 1);
    else oldRule.tag = finalName;
  }
  ui.tags.clear();
  log(`hat den Tag „${oldTag}“ in „${finalName}“ umbenannt (${affected.length} Gerichte)`, null, affected.map(d => d.id));
  save(); closeSheet(); render();
  toast(target ? `Mit „${finalName}“ zusammengelegt` : 'Tag umbenannt');
}

/* Fotos werden verkleinert, weil der lokale Speicher im Prototyp begrenzt ist. */
async function readPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url; });
    const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- Verlauf ---------- */

function logItem(l) {
  const when = new Date(l.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  return `<div class="log-item"><strong>${esc(l.by)}</strong> ${esc(l.text)}<br><span class="muted">${esc(when)}</span></div>`;
}
const historySheet = () => `${sheetHead('Verlauf', 'Wer hat was geändert')}
  <div>${state.log.length ? state.log.map(logItem).join('') : '<p class="empty">Noch keine Änderungen.</p>'}</div>`;

/* ---------- Einkauf ---------- */

const shopScope = () => `${planKey()}|${ui.week}`;

function shopItems() {
  const now = P.today();
  const from = ui.week > now ? ui.week : now;
  return P.shopping({ entries: entries(), dishes: state.dishes, from, to: P.addDays(ui.week, 6), defaultPersons: state.settings.defaultPersons });
}

function renderShop() {
  const items = shopItems();
  const scope = shopScope();
  const checked = state.shop.checked[scope] || {};
  const extras = state.shop.extras[scope] || [];
  const row = (id, main, sub, extra = '') => `<label class="shop-item ${checked[id] ? 'done' : ''}">
    <input type="checkbox" data-c="shop-check" data-id="${esc(id)}" ${checked[id] ? 'checked' : ''}>
    <span class="shop-main">${main}${sub ? `<br><span class="muted">${esc(sub)}</span>` : ''}</span>${extra}</label>`;
  const open = items.filter(i => !checked[i.id]).length + extras.filter(x => !checked[x.id]).length;
  const isCurrent = ui.week === P.mondayOf(P.today());

  return `${weekNav()}
    ${ui.plan === 'me' ? '<p class="muted">Liste für „Mein Plan“.</p>' : ''}
    <div class="card">
      <div class="row between"><h2 style="margin:0">Einkaufsliste</h2><span class="muted">${open} offen</span></div>
      ${isCurrent ? '<p class="muted">Vergangene Tage sind nicht mitgerechnet.</p>' : ''}
      ${items.length || extras.length ? '' : '<p class="empty">Für diese Tage ist nichts geplant.</p>'}
      <div>
        ${items.map(i => row(i.id, `<span class="shop-amount">${esc(i.amount)}</span> ${esc(i.name)}`, i.dishes.join(', '))).join('')}
        ${extras.map(x => row(x.id, esc(x.name), 'Eigener Eintrag',
          `<button type="button" class="icon ghost" data-a="extra-del" data-id="${x.id}" aria-label="${esc(x.name)} entfernen">✕</button>`)).join('')}
      </div>
    </div>
    <form id="extraForm" class="row"><input id="extraName" class="grow" placeholder="Eigenen Eintrag hinzufügen" maxlength="80" aria-label="Eigener Eintrag"><button>Hinzufügen</button></form>
    <div class="row"><button class="grow" data-a="shop-share">Liste teilen</button><button class="grow" data-a="shop-reset">Häkchen entfernen</button></div>`;
}

/* ---------- Mehr ---------- */

const fold = (id, title, meta, body) => `<details class="card fold" data-fold="${id}" ${ui.folds.has(id) ? 'open' : ''}>
  <summary><span>${title}</span><span class="muted">${esc(meta)}</span></summary>
  <div class="fold-body">${body}</div></details>`;

function renderMore() {
  const s = state.settings;
  const tags = allTags();
  const tagsLeft = tags.filter(t => !s.limits.some(l => l.tag.toLowerCase() === t.toLowerCase()));
  const presets = s.weekdays.filter(w => w !== 'normal').length;
  const themes = [['light', 'Hell'], ['dark', 'Dunkel'], ['system', 'System']];
  return `<section class="card"><h2>Standard</h2>
      <div class="set-row"><span>Personen pro Essen</span>${stepper(s.defaultPersons, 'default-persons')}</div>
      <label class="set-row check"><span class="grow">Mittagessen im Plan anzeigen</span><input type="checkbox" data-c="lunch" ${s.lunch ? 'checked' : ''}></label>
      <div class="set-row"><span>Design</span>
        <div class="seg grow" role="group" aria-label="Design">${themes.map(([v, l]) =>
          `<button data-a="theme" data-v="${v}" aria-pressed="${getTheme() === v}">${l}</button>`).join('')}</div></div>
    </section>

    ${fold('weekdays', 'Wochentage', presets ? `${presets} ${presets === 1 ? 'Vorgabe' : 'Vorgaben'}` : 'keine Vorgaben', `
      <p class="muted" style="margin-bottom:8px">Gilt als Vorauswahl für neue Pläne. Du kannst es beim Erstellen für einzelne Tage ändern.</p>
      <div class="day-grid">${P.DAYS.map((n, i) => `<span>${n}</span>
        <select data-c="weekday" data-i="${i}" aria-label="Voreinstellung ${n}">${choiceOptions(s.weekdays[i], 'Normal', 'normal')}</select>`).join('')}</div>`)}

    ${fold('rules', 'Regeln', `${s.limits.length} ${s.limits.length === 1 ? 'Regel' : 'Regeln'}`, `
      <p class="muted" style="margin-bottom:4px">Höchstens so oft pro Woche, feste Gerichte zählen mit:</p>
      ${s.limits.map((l, i) => `<div class="set-row"><span class="grow">${esc(l.tag)}</span>${stepper(l.max, 'limit', `data-i="${i}"`)}
        <button class="icon ghost" data-a="limit-del" data-i="${i}" aria-label="Regel für ${esc(l.tag)} löschen">✕</button></div>`).join('')}
      ${tagsLeft.length ? `<div class="row" style="margin-top:8px"><select id="limitTag" class="grow" aria-label="Tag für neue Regel">${tagsLeft.map(t => `<option>${esc(t)}</option>`).join('')}</select>
        <button data-a="limit-add">Regel hinzufügen</button></div>` : ''}
      <div class="set-row" style="margin-top:8px"><span class="grow">Gleiches Gericht frühestens wieder nach (Wochen)</span>${stepper(s.noRepeatWeeks, 'no-repeat')}</div>`)}

    ${fold('tags', 'Tags', `${tags.length} Tags`, `
      <form id="tagAddForm" class="row" style="margin-bottom:8px"><input id="tagAddName" class="grow" maxlength="24" placeholder="Neuer Tag" aria-label="Neuer Tag"><button>Hinzufügen</button></form>
      <div class="list">${tags.map(t => {
        const n = dishesWithTag(t).length;
        return `<button class="tag-row" data-a="tag-open" data-tag="${esc(t)}"><span>${esc(t)}</span><span class="muted">${n} ${n === 1 ? 'Gericht' : 'Gerichte'}</span></button>`;
      }).join('')}</div>`)}

    ${Cloud.enabled ? fold('group', 'Gruppe', me(), `
      <div class="set-row"><span>Gruppencode</span><strong class="code">${esc(state.groupCode)}</strong></div>
      <button class="wide" data-a="share-code">Einladung teilen</button>
      <h3 style="margin:12px 0 4px">Mitglieder</h3>
      <ul class="affected">${state.members.map(m => `<li>${esc(m)}${m === me() ? ' (du)' : ''}</li>`).join('')}</ul>
      <form id="renameMe" class="row" style="margin-top:10px"><input id="renameName" class="grow" required maxlength="30" value="${esc(me())}" aria-label="Dein Name"><button>Namen ändern</button></form>
      <p class="muted" style="margin-top:8px">${Cloud.isOnline() ? 'Verbunden. Änderungen sehen alle sofort.' : 'Gerade offline. Änderungen werden gespeichert, sobald wieder Netz da ist.'}</p>`)
    : fold('group', 'Gruppe', me(), `
      <p class="muted" style="margin-bottom:8px">Im Prototyp liegen alle Daten nur auf diesem Gerät. Zum Ausprobieren kannst du die Person wechseln, das sieht man dann im Verlauf.</p>
      <label class="field">Angemeldet als<select data-c="switch-me">${state.members.map(m => `<option ${m === me() ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
      <form id="memberForm" class="row" style="margin-top:8px"><input id="memberName" class="grow" maxlength="30" placeholder="Person hinzufügen" aria-label="Person hinzufügen"><button>Hinzufügen</button></form>`)}

    <section class="card stack"><h2 style="margin:0">Daten</h2>
      <button data-a="history">Verlauf ansehen</button>
      ${Cloud.enabled ? '' : '<button class="danger" data-a="reset">Alles zurücksetzen</button>'}
    </section>`;
}

function welcomeSheet() {
  return `<div><h2>Willkommen</h2><p class="muted">Das ist der Prototyp der Essensplan-App. Er enthält Beispielgerichte und drei vergangene Wochen, damit du gleich alles ausprobieren kannst.</p></div>
    <form id="welcomeForm" class="stack">
      <label class="field">Wie heißt du?<input id="welcomeName" required maxlength="30" autocomplete="given-name"></label>
      <p class="muted">In der Online-Version kommt hier noch der Gruppencode dazu.</p>
      <button class="primary">Los geht's</button>
    </form>`;
}

const allowNewGroups = () => (window.APP_CONFIG || {}).allowNewGroups !== false;

function cloudWelcomeSheet() {
  if (!allowNewGroups()) ui.welcomeMode = 'join';
  const join = ui.welcomeMode === 'join';
  return `<div><h2>Willkommen beim Essensplan</h2>
      <p class="muted">${allowNewGroups()
        ? 'Erstelle eine neue Gruppe oder tritt mit dem Code bei, den du bekommen hast.'
        : 'Gib deinen Namen und den Gruppencode ein, den du bekommen hast.'}</p></div>
    ${allowNewGroups() ? `<div class="seg" role="group" aria-label="Gruppe">
      <button type="button" data-a="welcome-mode" data-mode="create" aria-pressed="${!join}">Neue Gruppe</button>
      <button type="button" data-a="welcome-mode" data-mode="join" aria-pressed="${join}">Mit Code beitreten</button>
    </div>` : ''}
    <form id="cloudWelcome" class="stack">
      <label class="field">Dein Name<input data-i="cw-name" id="cwName" required maxlength="30" autocomplete="given-name" value="${esc(ui.welcomeName)}"></label>
      ${join ? `<label class="field">Gruppencode<input data-i="cw-code" id="cwCode" required maxlength="12" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(ui.welcomeCode)}"></label>` : ''}
      <button class="primary" id="cwGo">${join ? 'Beitreten' : 'Gruppe erstellen'}</button>
    </form>`;
}

function errorText(err) {
  const msg = String((err && err.message) || err || '');
  if (/Gruppencode/.test(msg)) return 'Diesen Gruppencode gibt es nicht. Prüfe ihn bitte noch einmal.';
  if (/permission denied for function create_group/i.test(msg)) return 'Neue Gruppen sind gerade abgeschaltet. Tritt mit einem Gruppencode bei.';
  if (/anonymous/i.test(msg)) return 'Die anonyme Anmeldung ist in Supabase noch nicht eingeschaltet (siehe Anleitung, Schritt 2).';
  if (/fetch|network|Load failed/i.test(msg)) return 'Keine Verbindung zum Server. Prüfe die Internetverbindung.';
  return `Das hat nicht geklappt: ${msg}`;
}

async function submitCloudWelcome() {
  const btn = $('#cwGo');
  const name = $('#cwName').value.trim();
  const join = ui.welcomeMode === 'join';
  const code = join ? $('#cwCode').value.trim() : '';
  if (!name || (join && !code)) return;
  btn.disabled = true;
  btn.textContent = 'Verbinde …';
  try {
    state = join ? await Cloud.joinGroup(code, name) : await Cloud.createGroup(name);
    ui.mustJoin = false;
    closeSheet();
    render();
    Cloud.schedule();
    if (location.search) history.replaceState(null, '', location.pathname);
    toast(join ? 'Du bist der Gruppe beigetreten.' : 'Gruppe erstellt. Den Code findest du unter „Mehr“.');
  } catch (err) {
    btn.disabled = false;
    btn.textContent = join ? 'Beitreten' : 'Gruppe erstellen';
    toast(errorText(err));
  }
}

/* Daten von anderen sind angekommen. Offene Formulare werden dabei nicht angefasst. */
function applyRemote(next) {
  state = next;
  render();
  const editing = sheet.querySelector('#dishForm, #tagForm, #cloudWelcome');
  if (sheet.open && !editing) refreshSheet();
}

/* ---------- Rendern ---------- */

const TITLES = { plan: 'Essensplan', dishes: 'Gerichte', shop: 'Einkauf', more: 'Einstellungen' };
function render() {
  $('#title').textContent = TITLES[ui.tab];
  const view = { plan: renderPlan, dishes: renderDishes, shop: renderShop, more: renderMore }[ui.tab];
  // Fokus und Cursor im Suchfeld erhalten, falls gerade Live-Daten ankommen.
  const active = document.activeElement;
  const focusKey = active && $('#main').contains(active) && active.dataset.i;
  const caret = focusKey ? [active.selectionStart, active.selectionEnd] : null;
  $('#main').innerHTML = view();
  if (focusKey) {
    const again = $(`#main [data-i="${focusKey}"]`);
    if (again) { again.focus(); try { again.setSelectionRange(...caret); } catch (e) { /* nicht jedes Feld kann das */ } }
  }
  document.querySelectorAll('.tabs button').forEach(b => {
    if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

/* ---------- Aktionen ---------- */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const actions = {
  tab(d) {
    if (d.tab === 'more' && ui.tab !== 'more') ui.folds.clear();
    ui.tab = d.tab; render(); scrollTo(0, 0);
  },
  theme(d) {
    try { localStorage.setItem(THEME_KEY, d.v); } catch (e) { /* gilt dann nur bis zum Neuladen */ }
    applyTheme(); render();
  },
  reload() { location.reload(); },
  'welcome-mode'(d) { ui.welcomeMode = d.mode; refreshSheet(); },
  async 'share-code'() {
    const link = `${location.origin}${location.pathname}?code=${encodeURIComponent(state.groupCode)}`;
    const text = `Tritt unserer Essensplan-Gruppe bei. Gruppencode: ${state.groupCode}\n${link}`;
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      toast('Einladung kopiert');
    } catch (err) {
      if (err.name !== 'AbortError') toast(`Gruppencode: ${state.groupCode}`);
    }
  },
  random() {
    ui.randomId = null;
    ui.detailPersons = state.settings.defaultPersons;
    if (rollRandom()) showSheet(randomSheet);
  },
  'random-again'() { if (rollRandom()) { refreshSheet(); sheet.scrollTop = 0; } },
  'tag-open'(d) { showSheet(tagSheet(d.tag)); },
  'tag-delete'(d) {
    const same = t => t.toLowerCase() === d.tag.toLowerCase();
    const affected = dishesWithTag(d.tag);
    if (!confirm(`Tag „${d.tag}“ löschen? Er wird bei ${affected.length} ${affected.length === 1 ? 'Gericht' : 'Gerichten'} entfernt.`)) return;
    for (const dish of affected) dish.tags = dish.tags.filter(t => !same(t));
    state.tags = state.tags.filter(t => !same(t));
    state.settings.limits = state.settings.limits.filter(l => !same(l.tag));
    ui.tags.clear();
    log(`hat den Tag „${d.tag}“ gelöscht (${affected.length} Gerichte)`, null, affected.map(x => x.id));
    save(); closeSheet(); render();
    toast('Tag gelöscht');
  },
  close() { closeSheet(); },
  week(d) { ui.week = P.addDays(ui.week, Number(d.d) * 7); ui.notes = []; render(); },
  'week-now'() { ui.week = P.mondayOf(P.today()); render(); },
  'plan-kind'(d) { ui.plan = d.kind; ui.notes = []; render(); },
  'notes-off'() { ui.notes = []; render(); },

  day(d) { showSheet(daySheet(d.date, d.slot)); },
  roll(d) { rollSlot(d.date, d.slot); },
  pick(d) { ui.pickSearch = ''; showSheet(pickSheet(d.date, d.slot)); },
  'pick-set'(d) {
    const es = entries();
    const k = P.key(d.date, d.slot);
    const cur = es[k];
    es[k] = { dishId: d.id, locked: true, ...(cur && cur.persons ? { persons: cur.persons } : {}) };
    logPlan(`hat für ${P.label(d.date)} „${dishById(d.id).name}“ eingetragen`);
    save(); render();
    showSheet(daySheet(d.date, d.slot));
  },
  'day-none'(d) {
    const es = entries();
    const k = P.key(d.date, d.slot);
    es[k] = { none: true };
    logPlan(`hat ${P.label(d.date)} auf „Kein Essen“ gesetzt`);
    save(); render(); refreshSheet();
  },
  'day-clear'(d) {
    delete entries()[P.key(d.date, d.slot)];
    logPlan(`hat ${P.label(d.date)} geleert`);
    save(); render(); closeSheet();
  },
  'day-persons'(d) {
    const e = entries()[P.key(d.date, d.slot)];
    if (!e) return;
    e.persons = clamp(personsFor(e) + Number(d.d), 1, 30);
    save(); render(); refreshSheet();
  },

  'new-plan'(d) {
    ui.np = { range: '1', start: defaultStart(), lunch: state.settings.lunch, choices: {} };
    showSheet(newPlanSheet);
  },
  'np-range'(d) { ui.np.range = d.range; refreshSheet(); },
  'np-go'() { createPlan(); },

  dish(d) { if (d.id) openDish(d.id, Number(d.persons) || undefined); },
  'detail-persons'(d) {
    ui.detailPersons = clamp((ui.detailPersons || state.settings.defaultPersons) + Number(d.d), 1, 30);
    refreshSheet();
  },
  'dish-new'() { ui.editPhoto = null; showSheet(editSheet(null)); },
  'dish-edit'(d) { ui.editPhoto = dishById(d.id).photo || null; showSheet(editSheet(d.id)); },
  'dish-del'(d) {
    const dish = dishById(d.id);
    if (!dish || !confirm(`„${dish.name}“ wirklich löschen? Es verschwindet auch aus allen Plänen.`)) return;
    state.dishes = state.dishes.filter(x => x.id !== d.id);
    for (const plan of Object.values(state.plans)) {
      for (const k of Object.keys(plan)) if (plan[k].dishId === d.id) delete plan[k];
    }
    state.settings.weekdays = state.settings.weekdays.map(w => (w === d.id ? 'normal' : w));
    log(`hat „${dish.name}“ gelöscht`);
    save(); closeSheet(); render();
    toast('Gericht gelöscht');
  },
  'tag-filter'(d) {
    if (ui.tags.has(d.tag)) ui.tags.delete(d.tag); else ui.tags.add(d.tag);
    render();
  },
  'tag-toggle'(d, el) {
    const on = el.classList.toggle('on');
    el.setAttribute('aria-pressed', on);
  },
  'tag-add'() {
    const input = $('#newTag');
    const name = input.value.trim();
    if (!name) return;
    const existing = [...document.querySelectorAll('#tagChips [data-tag]')].find(b => b.dataset.tag.toLowerCase() === name.toLowerCase());
    if (existing) { existing.classList.add('on'); existing.setAttribute('aria-pressed', 'true'); }
    else $('#tagChips').insertAdjacentHTML('beforeend', tagChip(name, true));
    input.value = '';
    input.focus();
  },
  'ing-add'() {
    $('#ingRows').insertAdjacentHTML('beforeend', ingRow());
    $('#ingRows').lastElementChild.querySelector('[name=amt]').focus();
  },
  'ing-del'(d, el) { el.closest('.ing-row').remove(); },
  'photo-pick'() { $('#photoFile').click(); },
  'photo-del'() { ui.editPhoto = null; $('#photoEdit').innerHTML = photoEditHtml(); },
  history() { showSheet(historySheet); },

  'extra-del'(d, el, e) {
    e.preventDefault();
    const scope = shopScope();
    state.shop.extras[scope] = (state.shop.extras[scope] || []).filter(x => x.id !== d.id);
    save(); render();
  },
  async 'shop-share'() {
    const scope = shopScope();
    const checked = state.shop.checked[scope] || {};
    const lines = [
      ...shopItems().filter(i => !checked[i.id]).map(i => `- ${i.amount ? i.amount + ' ' : ''}${i.name}`),
      ...(state.shop.extras[scope] || []).filter(x => !checked[x.id]).map(x => `- ${x.name}`),
    ];
    if (!lines.length) { toast('Die Liste ist leer.'); return; }
    const text = `Einkaufsliste KW ${P.weekNumber(ui.week)}\n${lines.join('\n')}`;
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      toast('Liste kopiert');
    } catch (err) {
      if (err.name !== 'AbortError') toast('Teilen hat nicht geklappt.');
    }
  },
  'shop-reset'() { delete state.shop.checked[shopScope()]; save(); render(); },

  'default-persons'(d) {
    state.settings.defaultPersons = clamp(state.settings.defaultPersons + Number(d.d), 1, 30);
    save(); render();
  },
  limit(d) {
    const l = state.settings.limits[Number(d.i)];
    l.max = clamp(l.max + Number(d.d), 0, 14);
    save(); render();
  },
  'limit-del'(d) { state.settings.limits.splice(Number(d.i), 1); save(); render(); },
  'limit-add'() {
    state.settings.limits.push({ tag: $('#limitTag').value, max: 2 });
    save(); render();
  },
  'no-repeat'(d) {
    state.settings.noRepeatWeeks = clamp(state.settings.noRepeatWeeks + Number(d.d), 0, 8);
    save(); render();
  },
  reset() {
    if (!confirm('Alle Gerichte, Pläne und Einstellungen zurücksetzen? Eigene Eingaben gehen dabei verloren.')) return;
    const name = state.me;
    state = freshState();
    state.me = name;
    if (name) state.members.unshift(name);
    ui.week = P.mondayOf(P.today());
    ui.notes = [];
    ui.tags.clear();
    applyTheme();
    save(); render();
    toast('Zurückgesetzt');
  },
};

document.addEventListener('click', e => {
  if (e.target === sheet) { closeSheet(); return; }
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const fn = actions[el.dataset.a];
  if (fn) fn(el.dataset, el, e);
});

const changes = {
  'day-lock'(d, el) {
    const e = entries()[P.key(d.date, d.slot)];
    if (e) { e.locked = el.checked; save(); render(); refreshSheet(); }
  },
  'day-eaten'(d, el) {
    const e = entries()[P.key(d.date, d.slot)];
    if (!e) return;
    e.eaten = el.checked;
    logPlan(`hat ${P.label(d.date)} als „${el.checked ? 'gab es' : 'gab es nicht'}“ markiert`);
    save(); render(); refreshSheet();
  },
  'np-start'(d, el) {
    if (!el.value) return;
    ui.np.start = el.value;
    refreshSheet();
  },
  'np-lunch'(d, el) { ui.np.lunch = el.checked; refreshSheet(); },
  'np-choice'(d, el) { ui.np.choices[d.key] = el.value; },
  'dish-sort'(d, el) { ui.sort = el.value; $('#dishList').innerHTML = dishListHtml(); },
  'dish-active'(d, el) { dishById(d.id).active = el.checked; save(); render(); },
  'shop-check'(d, el) {
    const scope = shopScope();
    const checked = state.shop.checked[scope] || (state.shop.checked[scope] = {});
    if (el.checked) checked[d.id] = true; else delete checked[d.id];
    save(); render();
  },
  lunch(d, el) { state.settings.lunch = el.checked; save(); render(); },
  weekday(d, el) { state.settings.weekdays[Number(d.i)] = el.value; save(); },
  'switch-me'(d, el) { state.me = el.value; save(); render(); toast(`Du bist jetzt ${el.value}.`); },
};
document.addEventListener('change', e => {
  const key = e.target.dataset && e.target.dataset.c;
  if (key && changes[key]) changes[key](e.target.dataset, e.target);
});

document.addEventListener('input', e => {
  const key = e.target.dataset && e.target.dataset.i;
  if (key === 'cw-name') ui.welcomeName = e.target.value;
  if (key === 'cw-code') ui.welcomeCode = e.target.value;
  if (key === 'dish-search') { ui.search = e.target.value; $('#dishList').innerHTML = dishListHtml(); }
  if (key === 'pick-search') { ui.pickSearch = e.target.value; $('#pickList').innerHTML = pickerList(e.target.dataset.date, e.target.dataset.slot); }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  if (form.id === 'dishForm') saveDishForm(form);
  if (form.id === 'extraForm') {
    const name = $('#extraName').value.trim();
    if (!name) return;
    const scope = shopScope();
    (state.shop.extras[scope] || (state.shop.extras[scope] = [])).push({ id: 'x-' + uid(), name });
    save(); render();
    $('#extraName').focus();
  }
  if (form.id === 'cloudWelcome') submitCloudWelcome();
  if (form.id === 'renameMe') {
    const name = $('#renameName').value.trim();
    if (!name || name === state.me) return;
    state.members = state.members.map(m => (m === state.me ? name : m));
    state.me = name;
    save(); render();
    toast('Name geändert');
  }
  if (form.id === 'tagForm') renameTag(form.dataset.tag, $('#tagName').value);
  if (form.id === 'tagAddForm') {
    const name = $('#tagAddName').value.trim();
    if (!name) return;
    if (allTags().some(t => t.toLowerCase() === name.toLowerCase())) { toast('Diesen Tag gibt es schon.'); return; }
    state.tags.push(name);
    log(`hat den Tag „${name}“ hinzugefügt`);
    save(); render();
    $('#tagAddName').focus();
  }
  if (form.id === 'memberForm') {
    const name = $('#memberName').value.trim();
    if (!name) return;
    if (!state.members.some(m => m.toLowerCase() === name.toLowerCase())) state.members.push(name);
    save(); render();
    toast(`${name} hinzugefügt`);
  }
  if (form.id === 'welcomeForm') {
    const name = $('#welcomeName').value.trim();
    if (!name) return;
    state.me = name;
    if (!state.members.includes(name)) state.members.unshift(name);
    save(); closeSheet(); render();
  }
});

/* Aufgeklappte Bereiche überstehen das Neuzeichnen, sonst klappt jeder Klick sie wieder zu. */
document.addEventListener('toggle', e => {
  const id = e.target.dataset && e.target.dataset.fold;
  if (!id) return;
  if (e.target.open) ui.folds.add(id); else ui.folds.delete(id);
}, true);

$('#photoFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    ui.editPhoto = await readPhoto(file);
    const box = $('#photoEdit');
    if (box) box.innerHTML = photoEditHtml();
  } catch (err) {
    toast('Dieses Bild konnte nicht gelesen werden.');
  }
});

async function boot() {
  applyTheme();
  if (!Cloud.enabled) {
    render();
    if (!state.me) showSheet(welcomeSheet);
    return;
  }

  const code = new URLSearchParams(location.search).get('code');
  if (code) { ui.welcomeMode = 'join'; ui.welcomeCode = code; }
  $('#main').innerHTML = '<p class="empty">Verbinde …</p>';
  try {
    const result = await Cloud.start({
      getState: () => state,
      defaults: () => ({ settings: defaultSettings(), tags: [...DEFAULT_TAGS] }),
      onRemote: applyRemote,
      onError(err) {
        if (!ui.saveProblem) toast(/fetch|network|Load failed/i.test(String(err && err.message))
          ? 'Nicht gespeichert, weil keine Verbindung da ist. Das wird automatisch nachgeholt.'
          : errorText(err));
        ui.saveProblem = true;
      },
      onSaved() {
        if (ui.saveProblem) toast('Wieder verbunden, alles gespeichert.');
        ui.saveProblem = false;
      },
      onPhotoUploaded() { /* die Foto-Adresse ändert sich, sichtbar ist nichts */ },
    });
    if (result.needsGroup) {
      render();
      ui.mustJoin = true;
      showSheet(cloudWelcomeSheet);
      return;
    }
    state = result.state;
    if (code) history.replaceState(null, '', location.pathname);
    render();
    if (result.offline) toast('Offline: Du siehst den letzten Stand. Änderungen werden später gespeichert.');
  } catch (err) {
    $('#main').innerHTML = `<div class="card stack"><h2 style="margin:0">Keine Verbindung</h2>
      <p class="muted">${esc(errorText(err))}</p><button class="primary" data-a="reload">Nochmal versuchen</button></div>`;
  }
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => { /* ohne Offline-Start geht es auch */ });
}
boot();
