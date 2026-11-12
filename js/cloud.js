'use strict';
/* Verbindung zu Supabase.
   Die App arbeitet weiter mit demselben "state"-Objekt wie im lokalen Modus.
   Beim Speichern vergleicht diese Schicht den state mit dem letzten Serverstand
   und schickt nur Geändertes. Klappt das nicht (z. B. offline), bleibt der alte
   Serverstand gemerkt und der nächste Versuch schickt die Änderungen erneut. */
const Cloud = (() => {
  const cfg = window.APP_CONFIG || {};
  const enabled = Boolean(cfg.supabaseUrl && cfg.supabaseKey && window.supabase);
  const CACHE_KEY = 'essensplan.cloud-cache.v1';
  const SETTINGS_KEYS = ['defaultPersons', 'lunch', 'limits', 'noRepeatWeeks', 'weekdays'];
  const PAGE = 1000;

  let sb = null;
  let uid = null;
  let groupId = null;
  let snap = emptySnap();
  let opts = null;
  let channel = null;
  let saveTimer = null;
  let flushing = null;
  let flushAgain = false;
  let remoteTimer = null;
  let online = false;

  function emptySnap() {
    return { dishes: new Map(), entries: new Map(), settings: null, member: null };
  }

  /* ---------- Umwandlung zwischen App und Datenbank ---------- */

  const dishRow = d => ({
    id: d.id,
    name: d.name,
    tags: d.tags || [],
    minutes: d.minutes || null,
    servings: d.servings || 1,
    ingredients: (d.ingredients || []).map(i => ({ amount: i.amount ?? null, unit: i.unit || '', name: i.name })),
    recipe: d.recipe || '',
    link: d.link || '',
    photo: d.photo || null,
    active: d.active !== false,
  });
  const dishFromRow = r => ({ ...dishRow(r) });

  function entryRow(owner, key, e) {
    const [day, slot] = key.split('|');
    return {
      owner, day, slot,
      dish_id: e.dishId || null,
      is_none: Boolean(e.none),
      locked: Boolean(e.locked),
      persons: e.persons || null,
      eaten: e.eaten === true || e.eaten === false ? e.eaten : null,
    };
  }
  function entryFromRow(r) {
    const e = {};
    if (r.dish_id) e.dishId = r.dish_id;
    if (r.is_none) e.none = true;
    if (r.locked) e.locked = true;
    if (r.persons) e.persons = r.persons;
    if (r.eaten === true || r.eaten === false) e.eaten = r.eaten;
    return e;
  }
  const entryId = r => `${r.owner}|${r.day}|${r.slot}`;

  function settingsData(state) {
    const settings = {};
    SETTINGS_KEYS.forEach(k => { settings[k] = state.settings[k]; });
    return { settings, tags: state.tags };
  }

  /* Reiner Vergleich, ohne Netzwerk. Wird auch direkt getestet. */
  function computeOps(state, base, ownerId) {
    const ops = { dishUpserts: [], dishDeletes: [], entryUpserts: [], entryDeletes: [], settings: null, logs: [], memberName: null };

    const dishIds = new Set();
    for (const d of state.dishes) {
      const row = dishRow(d);
      dishIds.add(d.id);
      if (base.dishes.get(d.id) !== JSON.stringify(row)) ops.dishUpserts.push(row);
    }
    for (const id of base.dishes.keys()) if (!dishIds.has(id)) ops.dishDeletes.push(id);

    const entryIds = new Set();
    for (const [owner, entries] of [['group', state.plans.group || {}], [ownerId, state.plans.mine || {}]]) {
      for (const [k, e] of Object.entries(entries)) {
        const row = entryRow(owner, k, e);
        const id = entryId(row);
        entryIds.add(id);
        if (base.entries.get(id) !== JSON.stringify(row)) ops.entryUpserts.push(row);
      }
    }
    for (const id of base.entries.keys()) {
      if (entryIds.has(id)) continue;
      const [owner, day, slot] = id.split('|');
      ops.entryDeletes.push({ owner, day, slot });
    }

    const settings = JSON.stringify(settingsData(state));
    if (settings !== base.settings) ops.settings = JSON.parse(settings);
    ops.logs = state.log.filter(l => !l.synced);
    if (state.me && state.me !== base.member) ops.memberName = state.me;
    return ops;
  }

  function snapFromState(state, ownerId, settingsLoaded) {
    const s = emptySnap();
    state.dishes.forEach(d => s.dishes.set(d.id, JSON.stringify(dishRow(d))));
    for (const [owner, entries] of [['group', state.plans.group], [ownerId, state.plans.mine]]) {
      for (const [k, e] of Object.entries(entries)) {
        const row = entryRow(owner, k, e);
        s.entries.set(entryId(row), JSON.stringify(row));
      }
    }
    s.settings = settingsLoaded ? JSON.stringify(settingsData(state)) : null;
    s.member = state.me;
    return s;
  }

  /* ---------- Laden ---------- */

  async function fetchAll(build) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) return rows;
    }
  }

  async function load() {
    const [dishes, entries, settingsRes, logRes, membersRes, groupRes] = await Promise.all([
      fetchAll(() => sb.from('dishes').select('*').order('id')),
      fetchAll(() => sb.from('plan_entries').select('*').order('day')),
      sb.from('group_settings').select('data').maybeSingle(),
      sb.from('change_log').select('*').order('at', { ascending: false }).limit(300),
      sb.from('members').select('user_id, name').order('created_at'),
      sb.from('groups').select('code').maybeSingle(),
    ]);
    for (const r of [settingsRes, logRes, membersRes, groupRes]) if (r.error) throw r.error;

    const defaults = opts.defaults();
    const data = (settingsRes.data && settingsRes.data.data) || {};
    const hasSettings = Boolean(data.settings);
    const plans = { group: {}, mine: {} };
    for (const r of entries) {
      const target = r.owner === 'group' ? plans.group : r.owner === uid ? plans.mine : null;
      if (target) target[`${r.day}|${r.slot}`] = entryFromRow(r);
    }
    const me = membersRes.data.find(m => m.user_id === uid);
    const state = {
      dishes: dishes.map(dishFromRow),
      plans,
      settings: { ...defaults.settings, ...(data.settings || {}) },
      tags: Array.isArray(data.tags) ? data.tags : defaults.tags,
      log: logRes.data.map(l => ({ at: l.at, by: l.by_name, text: l.text, dishId: null, dishIds: l.dish_ids || [], synced: true })),
      members: membersRes.data.map(m => m.name),
      me: me ? me.name : null,
      groupCode: groupRes.data ? groupRes.data.code : '',
      shop: { checked: {}, extras: {} },
    };
    snap = snapFromState(state, uid, hasSettings);
    writeCache(state);
    return state;
  }

  /* ---------- Speichern ---------- */

  function schedule() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; flush(); }, 400);
    writeCache(opts.getState());
  }

  function flush() {
    if (!groupId) return Promise.resolve();
    if (flushing) { flushAgain = true; return flushing; }
    clearTimeout(saveTimer);
    saveTimer = null;
    flushing = (async () => {
      try {
        await pushChanges(opts.getState());
        online = true;
        opts.onSaved();
      } catch (err) {
        online = false;
        opts.onError(err);
      } finally {
        flushing = null;
      }
      if (flushAgain) { flushAgain = false; await flush(); }
    })();
    return flushing;
  }

  async function pushChanges(state) {
    await uploadPhotos(state);
    const ops = computeOps(state, snap, uid);
    const check = ({ error }) => { if (error) throw error; };

    if (ops.dishUpserts.length) {
      const oldPhotos = ops.dishUpserts.map(r => {
        const old = snap.dishes.get(r.id);
        return old ? JSON.parse(old).photo : null;
      });
      check(await sb.from('dishes').upsert(ops.dishUpserts.map(r => ({ ...r, group_id: groupId, updated_at: new Date().toISOString() }))));
      ops.dishUpserts.forEach(r => snap.dishes.set(r.id, JSON.stringify(r)));
      removePhotos(oldPhotos.filter((p, i) => p && p !== ops.dishUpserts[i].photo));
    }
    if (ops.entryUpserts.length) {
      check(await sb.from('plan_entries').upsert(ops.entryUpserts.map(r => ({ ...r, group_id: groupId })), { onConflict: 'group_id,owner,day,slot' }));
      ops.entryUpserts.forEach(r => snap.entries.set(entryId(r), JSON.stringify(r)));
    }
    for (const r of ops.entryDeletes) {
      check(await sb.from('plan_entries').delete().match({ group_id: groupId, owner: r.owner, day: r.day, slot: r.slot }));
      snap.entries.delete(entryId(r));
    }
    if (ops.dishDeletes.length) {
      const photos = ops.dishDeletes.map(id => JSON.parse(snap.dishes.get(id)).photo).filter(Boolean);
      check(await sb.from('dishes').delete().in('id', ops.dishDeletes));
      ops.dishDeletes.forEach(id => snap.dishes.delete(id));
      removePhotos(photos);
    }
    if (ops.settings) {
      check(await sb.from('group_settings').upsert({ group_id: groupId, data: ops.settings }));
      snap.settings = JSON.stringify(ops.settings);
    }
    if (ops.logs.length) {
      check(await sb.from('change_log').insert(ops.logs.map(l => ({
        group_id: groupId, at: l.at, by_name: l.by, text: l.text,
        dish_ids: [l.dishId, ...(l.dishIds || [])].filter(Boolean),
      }))));
      ops.logs.forEach(l => { l.synced = true; });
    }
    if (ops.memberName) {
      check(await sb.from('members').update({ name: ops.memberName }).eq('user_id', uid));
      snap.member = ops.memberName;
    }
    writeCache(state);
  }

  /* Fotos kommen als verkleinertes JPEG (data:-URL) aus dem Formular und werden hier hochgeladen. */
  async function uploadPhotos(state) {
    for (const d of state.dishes) {
      if (!d.photo || !d.photo.startsWith('data:')) continue;
      const blob = await (await fetch(d.photo)).blob();
      const path = `${groupId}/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      d.photo = sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
      opts.onPhotoUploaded();
    }
  }

  function removePhotos(urls) {
    const marker = '/object/public/photos/';
    const paths = urls.map(u => (u.includes(marker) ? decodeURIComponent(u.split(marker)[1]) : null)).filter(Boolean);
    if (paths.length) sb.storage.from('photos').remove(paths).catch(() => { /* alte Datei bleibt liegen, kein Problem */ });
  }

  /* ---------- Live-Updates ---------- */

  function subscribe() {
    if (channel) return;
    channel = sb.channel(`gruppe-${groupId}`);
    for (const table of ['dishes', 'plan_entries', 'group_settings', 'change_log', 'members']) {
      const filter = `group_id=eq.${groupId}`;
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, remoteChanged);
      channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, remoteChanged);
      // Löschungen lassen sich nicht filtern, deshalb kommen sie ohne Filter.
      channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, remoteChanged);
    }
    channel.subscribe();
  }

  function remoteChanged() {
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(reload, 500);
  }

  /* Erst eigene Änderungen wegschicken, dann neu laden. Sonst würde das Neuladen sie überschreiben. */
  async function reload() {
    if (!groupId) return;
    try {
      await flush();
      const state = await load();
      if (saveTimer || flushing) { remoteChanged(); return; }
      online = true;
      subscribe();
      opts.onRemote(state);
    } catch (err) {
      online = false;
    }
  }

  /* ---------- Zwischenspeicher für den Start ohne Netz ---------- */

  function writeCache(state) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        uid, groupId, state,
        snap: { dishes: [...snap.dishes], entries: [...snap.entries], settings: snap.settings, member: snap.member },
      }));
    } catch (e) { /* Zwischenspeicher ist optional */ }
  }

  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (!c || c.uid !== uid || !c.groupId) return null;
      return c;
    } catch (e) {
      return null;
    }
  }

  /* ---------- Start, Gruppe erstellen, beitreten ---------- */

  async function start(options) {
    opts = options;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
    const { data } = await sb.auth.getSession();
    uid = data.session ? data.session.user.id : null;
    if (!uid) return { needsGroup: true };

    try {
      const { data: m, error } = await sb.from('members').select('group_id').eq('user_id', uid).maybeSingle();
      if (error) throw error;
      if (!m) return { needsGroup: true };
      groupId = m.group_id;
      const state = await load();
      online = true;
      subscribe();
      addListeners();
      return { state };
    } catch (err) {
      const cache = readCache();
      if (!cache) throw err;
      groupId = cache.groupId;
      snap = {
        dishes: new Map(cache.snap.dishes), entries: new Map(cache.snap.entries),
        settings: cache.snap.settings, member: cache.snap.member,
      };
      addListeners();
      return { state: cache.state, offline: true };
    }
  }

  async function ensureUser() {
    if (uid) return;
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) throw error;
    uid = data.user.id;
  }

  async function enterGroup() {
    const { data, error } = await sb.from('members').select('group_id').eq('user_id', uid).single();
    if (error) throw error;
    groupId = data.group_id;
    snap = emptySnap();
    const state = await load();
    online = true;
    subscribe();
    addListeners();
    return state;
  }

  async function createGroup(name) {
    await ensureUser();
    const { error } = await sb.rpc('create_group', { member_name: name });
    if (error) throw error;
    return enterGroup();
  }

  async function joinGroup(code, name) {
    await ensureUser();
    const { error } = await sb.rpc('join_group', { group_code: code, member_name: name });
    if (error) throw error;
    return enterGroup();
  }

  let listening = false;
  function addListeners() {
    if (listening) return;
    listening = true;
    window.addEventListener('online', reload);
    document.addEventListener('visibilitychange', () => {
      // Handys trennen die Live-Verbindung im Hintergrund, deshalb beim Zurückkommen neu laden.
      if (document.visibilityState === 'visible') reload();
      else flush();
    });
  }

  return {
    enabled, start, createGroup, joinGroup, schedule, flush,
    isOnline: () => online,
    hasPending: () => Boolean(saveTimer || flushing),
    _test: { computeOps, snapFromState, entryRow, dishRow },
  };
})();
