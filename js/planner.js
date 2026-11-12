'use strict';
/* Reine Logik ohne Oberfläche: Datum, Planerstellung, Statistik, Einkaufsliste. */
const Planner = (() => {
  const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const pad = n => String(n).padStart(2, '0');

  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => iso(new Date());
  const addDays = (s, n) => { const d = parse(s); return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
  const weekdayIndex = s => (parse(s).getDay() + 6) % 7;
  const mondayOf = s => addDays(s, -weekdayIndex(s));
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const weekNumber = s => {
    const thursday = parse(addDays(mondayOf(s), 3));
    const jan1 = new Date(thursday.getFullYear(), 0, 1);
    return Math.floor((thursday - jan1) / 604800000) + 1;
  };
  const shortDate = s => { const d = parse(s); return `${d.getDate()}.${d.getMonth() + 1}.`; };
  const label = s => `${DAYS[weekdayIndex(s)]} ${shortDate(s)}`;
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const weekRange = monday => {
    const a = parse(monday);
    const b = parse(addDays(monday, 6));
    const first = a.getMonth() === b.getMonth() ? `${a.getDate()}.` : `${a.getDate()}. ${MONTHS[a.getMonth()]}`;
    return `${first} – ${b.getDate()}. ${MONTHS[b.getMonth()]}`;
  };

  const key = (date, slot) => `${date}|${slot}`;
  const norm = t => String(t).trim().toLowerCase();
  const hasTag = (dish, tag) => dish.tags.some(t => norm(t) === norm(tag));

  /* Alle tatsächlich belegten Einträge außer dem aktuell betrachteten. */
  function usage(entries, dishes, skipKey) {
    const byId = new Map(dishes.map(d => [d.id, d]));
    const out = [];
    for (const [k, e] of Object.entries(entries)) {
      if (k === skipKey || !e || !e.dishId || e.eaten === false) continue;
      const dish = byId.get(e.dishId);
      if (dish) out.push({ date: k.split('|')[0], dish });
    }
    return out;
  }

  /* Wählt ein Gericht in drei Stufen und lockert Regeln nur, wenn es nötig ist. */
  function pick({ dishes, entries, date, slot, rules, excludeId, rng = Math.random }) {
    let pool = dishes.filter(d => d.active !== false);
    if (!pool.length) return { dishId: null, note: 'Kein Gericht für die Auswahl aktiv' };
    if (pool.length > 1 && excludeId) pool = pool.filter(d => d.id !== excludeId);

    const used = usage(entries, dishes, key(date, slot));
    const week = mondayOf(date);
    const inWeek = used.filter(u => mondayOf(u.date) === week);
    const limits = rules.limits || [];

    const broken = d => limits.filter(l =>
      hasTag(d, l.tag) && inWeek.filter(u => hasTag(u.dish, l.tag)).length + 1 > l.max);
    const gap = d => {
      const dist = used.filter(u => u.dish.id === d.id).map(u => Math.abs(daysBetween(u.date, date)));
      return dist.length ? Math.min(...dist) : Infinity;
    };

    const repeatDays = (rules.noRepeatWeeks || 0) * 7;
    const free = pool.filter(d => !broken(d).length);
    const best = free.filter(d => gap(d) >= repeatDays);

    let cands, note = null;
    if (best.length) {
      cands = best;
    } else if (free.length) {
      const widest = Math.max(...free.map(gap));
      cands = free.filter(d => gap(d) === widest);
      note = 'Gericht kommt früher wieder als gewünscht, weil zu wenig passende Gerichte da sind';
    } else {
      const fewest = Math.min(...pool.map(d => broken(d).length));
      const least = pool.filter(d => broken(d).length === fewest);
      const widest = Math.max(...least.map(gap));
      cands = least.filter(d => gap(d) === widest);
    }

    const chosenWeights = cands.map(d => weight(d, date, used, gap(d)));
    const total = chosenWeights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    let chosen = cands[cands.length - 1];
    for (let i = 0; i < cands.length; i++) {
      r -= chosenWeights[i];
      if (r <= 0) { chosen = cands[i]; break; }
    }
    const over = broken(chosen);
    if (over.length) note = `Regel gelockert: ${over.map(l => l.tag).join(', ')} über dem Wochenlimit`;
    return { dishId: chosen.id, note, over: over.map(l => l.tag) };
  }

  /* Lange nicht gegessen zählt mehr, kürzlich häufige Tags und gleiche Nachbartage weniger. */
  function weight(dish, date, used, gapDays) {
    let w = Math.min(gapDays, 60) + 1;
    const recent = used.filter(u => { const n = daysBetween(u.date, date); return n > 0 && n <= 21; });
    for (const tag of dish.tags) {
      const count = recent.filter(u => hasTag(u.dish, tag)).length;
      w /= 1 + count * 0.1;
    }
    const neighbours = used.filter(u => Math.abs(daysBetween(u.date, date)) === 1);
    if (neighbours.some(u => u.dish.tags.some(t => hasTag(dish, t)))) w *= 0.4;
    return w;
  }

  /* slots: [{date, slot, choice}], choice ist 'auto', 'none' oder eine Gericht-ID. */
  function generate({ dishes, entries, slots, rules, rng }) {
    const next = { ...entries };
    const notes = [];
    const relaxed = new Set();
    const sorted =[...slots].sort((a, b) => a.date.localeCompare(b.date) || b.slot.localeCompare(a.slot));
    const persons = {};
    for (const s of sorted) {
      const k = key(s.date, s.slot);
      if (next[k] && next[k].persons) persons[k] = next[k].persons;
      delete next[k];
      if (s.choice === 'none') next[k] = withPersons({ none: true }, persons[k]);
      else if (s.choice !== 'auto') next[k] = withPersons({ dishId: s.choice, locked: true }, persons[k]);
    }
    for (const s of sorted) {
      if (s.choice !== 'auto') continue;
      const k = key(s.date, s.slot);
      const r = pick({ dishes, entries: next, date: s.date, slot: s.slot, rules, rng });
      if (r.dishId) next[k] = withPersons({ dishId: r.dishId }, persons[k]);
      if (r.note) notes.push(`${label(s.date)}: ${r.note}`);
      (r.over || []).forEach(tag => relaxed.add(`${mondayOf(s.date)}|${norm(tag)}`));
    }
    // Feste Gerichte können ein Limit allein überschreiten, das soll sichtbar sein.
    for (const monday of new Set(sorted.map(s => mondayOf(s.date)))) {
      for (const s of weekRuleStatus(next, dishes, monday, rules.limits || [])) {
        if (s.count > s.max && !relaxed.has(`${monday}|${norm(s.tag)}`)) {
          notes.push(`KW ${weekNumber(monday)}: ${s.tag} ${s.count}x statt höchstens ${s.max}x, wegen fester Gerichte`);
        }
      }
    }
    return { entries: next, notes };
  }
  const withPersons = (entry, persons) => (persons ? { ...entry, persons } : entry);

  function weekRuleStatus(entries, dishes, monday, limits) {
    const used = usage(entries, dishes).filter(u => mondayOf(u.date) === monday);
    return limits.map(l => ({ tag: l.tag, max: l.max, count: used.filter(u => hasTag(u.dish, l.tag)).length }));
  }

  /* Zählt automatisch vergangene Tage. "Gab es" oder "Gab es nicht" überschreibt das. */
  function wasEaten(entry, date, now) {
    if (!entry || !entry.dishId || entry.eaten === false) return false;
    return entry.eaten === true || date < now;
  }

  function dishStats(dishId, plans, now) {
    const dates = [];
    for (const entries of Object.values(plans)) {
      for (const [k, e] of Object.entries(entries)) {
        const date = k.split('|')[0];
        if (e.dishId === dishId && wasEaten(e, date, now)) dates.push(date);
      }
    }
    dates.sort();
    const byWeekday = Array(7).fill(0);
    dates.forEach(d => byWeekday[weekdayIndex(d)]++);
    return { count: dates.length, last: dates[dates.length - 1] || null, byWeekday };
  }

  /* Einheiten */
  const UNIT_ALIASES = { g: 'g', gramm: 'g', kg: 'kg', ml: 'ml', l: 'l', liter: 'l', el: 'EL', tl: 'TL', 'stück': 'Stück', stk: 'Stück' };
  const canonicalUnit = u => UNIT_ALIASES[norm(u)] || String(u).trim();
  /* Zählbares kauft man nur ganz, deshalb rundet die Einkaufsliste hier auf. */
  const WHOLE_UNITS = new Set(['Stück', 'Dose', 'Packung', 'Bund', 'Zehe']);
  const num = x => (Math.round(x * 100) / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });

  function formatAmount(amount, unit) {
    if (amount == null) return '';
    if (unit === 'g' && amount >= 1000) return `${num(amount / 1000)} kg`;
    if (unit === 'ml' && amount >= 1000) return `${num(amount / 1000)} l`;
    return `${num(amount)}${unit ? ' ' + unit : ''}`;
  }

  function scaleIngredient(ing, factor) {
    return ing.amount == null ? '' : formatAmount(ing.amount * factor, canonicalUnit(ing.unit || ''));
  }

  /* Rechnet alle Zutaten zusammen. kg zählt wie g und l wie ml, damit sie addierbar sind. */
  function shopping({ entries, dishes, from, to, defaultPersons }) {
    const byId = new Map(dishes.map(d => [d.id, d]));
    const items = new Map();
    for (const [k, e] of Object.entries(entries)) {
      const date = k.split('|')[0];
      if (date < from || date > to || !e.dishId || e.eaten === false) continue;
      const dish = byId.get(e.dishId);
      if (!dish) continue;
      const factor = (e.persons || defaultPersons) / Math.max(dish.servings || 1, 1);
      for (const ing of dish.ingredients) {
        const name = ing.name.trim();
        if (!name) continue;
        const id = norm(name);
        const item = items.get(id) || { id, name, units: {}, dishes: new Set() };
        item.dishes.add(dish.name);
        if (ing.amount != null) {
          let unit = canonicalUnit(ing.unit || '');
          let amount = ing.amount * factor;
          if (unit === 'kg') { unit = 'g'; amount *= 1000; }
          if (unit === 'l') { unit = 'ml'; amount *= 1000; }
          item.units[unit] = (item.units[unit] || 0) + amount;
        }
        items.set(id, item);
      }
    }
    return [...items.values()]
      .map(i => ({
        id: i.id,
        name: i.name,
        amount: Object.entries(i.units).map(([u, a]) => formatAmount(WHOLE_UNITS.has(u) ? Math.ceil(a - 0.001) : a, u)).join(' + '),
        dishes: [...i.dishes],
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }

  function parseAmount(text) {
    const t = String(text).trim().replace(',', '.');
    if (!t) return null;
    const value = t.includes('/') ? t.split('/').reduce((a, b) => Number(a) / Number(b)) : Number(t);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  return {
    DAYS, today, addDays, parse, weekdayIndex, mondayOf, daysBetween, weekNumber, shortDate, label, weekRange, key, hasTag,
    pick, generate, weekRuleStatus, wasEaten, dishStats, scaleIngredient, shopping, parseAmount,
  };
})();
