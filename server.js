'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const JSZip = require('jszip');
const bible = require('./lib/bible');

const PORT = +process.env.PORT || 8080;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const PUB = path.join(ROOT, 'public');
const BIBLES = path.join(DATA, 'bibles');
const PLANS_FILE = path.join(DATA, 'plans.json');
let VERSION = '0.0.0';
try { VERSION = fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim().split(/\s+/)[0]; } catch { try { VERSION = require('./package.json').version; } catch {} }
const UPDATE_RAW = process.env.CULTE_UPDATE_RAW || 'https://raw.githubusercontent.com/comVPV/projection-culte/main';
const UPDATE_ZIP = process.env.CULTE_UPDATE_ZIP || 'https://github.com/comVPV/projection-culte/archive/refs/heads/main.zip';
const MEDIA = path.join(DATA, 'media');
const FONTS = path.join(DATA, 'fonts');
const SONGS_FILE = path.join(DATA, 'songs.json');
const STATE_FILE = path.join(DATA, 'state.json');
fs.mkdirSync(MEDIA, { recursive: true });
fs.mkdirSync(FONTS, { recursive: true });
fs.mkdirSync(BIBLES, { recursive: true });

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, o) => { fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 1)); fs.renameSync(f + '.tmp', f); };
let uidN = 0;
const uid = () => Date.now().toString(36) + (uidN++).toString(36) + Math.random().toString(36).slice(2, 5);

// ---------------- État ----------------
const DEFAULT_THEME = {
  font: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  verse: { size: 58, color: '#ffffff', bg: '#101820', bgAlpha: 0.85, refColor: '#f5c542', refSize: 52, bgImage: '' },
  lyrics: { size: 78, color: '#ffffff', outline: '#000000', outlineW: 11, weight: 700, upper: false },
  media: { panel: '#101820', bgImage: '', camWidth: 640, imgScale: 100, pipSize: 560 },
  monitor: { size: 96, color: '#ffffff', bg: '#000000', refColor: '#f5c542', refSize: 52, bgImage: '', chronoSize: 90, chronoColor: '#ffffff', chronoBg: '#101820', chronoBgAlpha: 0.88, chronoPos: 'bc' },
  lower: { size: 44, color: '#ffffff', bg: '#101820', bgAlpha: 0.88, accent: '#f5c542', pos: 'left' },
};
const DEFAULT_SECTIONS = ['Bienvenue', 'Intercession', 'Louange', 'Annonces', 'Adoration', 'Enseignement', 'Réponse à la Parole', 'Sainte Cène', 'Offrandes', 'Accueil des nouveaux', 'Annonces pastorales', 'Résumé du culte', 'Bénédiction finale'];
const mkSections = (titles = DEFAULT_SECTIONS) => titles.map(t => ({ id: uid(), title: t, items: [] }));
const cloneSections = secs => (secs || []).map(s => ({ id: uid(), title: String(s.title || 'Section').slice(0, 60), items: (s.items || []).map(({ id, ...rest }) => ({ id: uid(), ...rest })) }));
function normPlan(p) {
  let pl;
  if (p && Array.isArray(p.sections) && p.sections.length) {
    pl = { name: String(p.name || 'Culte'), sections: p.sections.map(s => ({ id: s.id || uid(), title: String(s.title || 'Section'), items: (s.items || []).map(i => ({ ...i, id: i.id || uid() })) })) };
  } else {
    pl = { name: 'Culte', sections: mkSections() };
    if (p && Array.isArray(p.items)) pl.sections[0].items = p.items.map(i => ({ ...i, id: i.id || uid() }));
  }
  pl.cursor = null;
  pl.target = (pl.sections.find(s => s.id === (p && p.target)) || pl.sections[0]).id;
  return pl;
}
const saved = readJSON(STATE_FILE, {});
// Bibles fournies avec l'appli (KJV, Louis Segond 1910) : copiées dans data/bibles si absentes
(function seedBibles() {
  const src = path.join(__dirname, 'defaults', 'bibles'), dst = path.join(__dirname, 'data', 'bibles');
  try {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) if (f.endsWith('.json') && !fs.existsSync(path.join(dst, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
  } catch (e) { console.error('Bibles par défaut :', e.message); }
})();
function mergeTheme(st = {}) {
  const t = { font: st.font || (st.verse && st.verse.font) || DEFAULT_THEME.font };
  for (const g of ['verse', 'lyrics', 'media', 'monitor', 'lower']) { t[g] = { ...DEFAULT_THEME[g], ...(st[g] || {}) }; delete t[g].font; }
  return t;
}
const state = {
  live: {
    verse: { on: false, layout: 'lower' },
    lyrics: { on: false, layout: 'bottom' },
    media: { on: false, layout: 'full', kind: 'image', src: '', name: '', card: null, video: { playing: true, loop: false, muted: false, rev: 0 } },
    lower: { on: false, title: '', sub: '', sec: '', until: 0 },
  },
  theme: mergeTheme(saved.theme),
  prefs: { versions: ['lsg1910', 'kjv'], autoHide: true, directClick: false, backupDir: '', lowerSecs: 30, ...(saved.prefs || {}) },
  plan: normPlan(saved.plan),
  lowers: Array.isArray(saved.lowers) ? saved.lowers : [],
  chrono: { running: false, base: 0, startedAt: 0, visible: true, now: 0 },
  update: { current: VERSION, latest: '', available: false, checking: false, installing: false, error: '', canRollback: false },
  backup: { dir: '', last: 0, count: 0, error: '' },
  guide: false,
  fonts: [],
  background: { src: '', type: '', dim: 0.35, ...(saved.background || {}) },
};
if (saved.prefs) {
  if (saved.prefs.verse) state.live.verse.layout = saved.prefs.verse;
  if (saved.prefs.lyrics) state.live.lyrics.layout = saved.prefs.lyrics;
  if (saved.prefs.media) state.live.media.layout = saved.prefs.media;
}

const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
function refreshFonts() { state.fonts = fs.readdirSync(FONTS).filter(f => FONT_EXT.test(f)).map(f => f.replace(FONT_EXT, '')).sort((a, b) => a.localeCompare(b)); }
refreshFonts();

// Migration v0.5 : nouveau chrono (bas centre, plus grand, avec fond) et Bibles par défaut
const MIG = 5;
if ((saved.mig || 0) < MIG) {
  state.theme.monitor.chronoPos = 'bc'; state.theme.monitor.chronoSize = Math.max(90, +state.theme.monitor.chronoSize || 0);
  const v = state.prefs.versions;
  if (!Array.isArray(v) || !v.length || (v.length === 1 && v[0] === 'kjv')) state.prefs.versions = ['lsg1910', 'kjv'];
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJSON(STATE_FILE, { mig: MIG, theme: state.theme, prefs: state.prefs, plan: { ...state.plan, cursor: null }, lowers: state.lowers, background: state.background }), 400);
}

const loadSongs = () => readJSON(SONGS_FILE, []);
const loadPlans = () => readJSON(PLANS_FILE, []);

// ---------------- Commandes ----------------
function showVerse(a) {
  const ids = (a.versions && a.versions.length ? a.versions : state.prefs.versions).filter(Boolean);
  if (!ids.length) throw new Error('Choisis au moins une version de la Bible');
  const p = a.p && Number.isInteger(a.p.book) ? { book: a.p.book, chapter: a.p.chapter | 0, v1: a.p.v1 | 0, v2: (a.p.v2 || a.p.v1) | 0 } : bible.parseRef(a.ref);
  if (!p) throw new Error('Référence introuvable : « ' + (a.ref || '') + ' »');
  const versions = ids.map(id => bible.getPassage(id, p)).filter(Boolean);
  if (!versions.length) throw new Error('Passage introuvable dans la version choisie');
  const layout = a.layout || state.live.verse.layout;
  state.live.verse = { on: true, layout, ref: bible.refLabel(p, versions[0].lang), versions, p, ids };
}

function navVerse(dir) {
  const v = state.live.verse;
  if (!v.p || !v.ids) return;
  const np = bible.step(v.p, dir, v.ids[0]);
  if (!np) return;
  const versions = v.ids.map(id => bible.getPassage(id, np)).filter(Boolean);
  state.live.verse = { ...v, on: true, ref: bible.refLabel(np, versions[0].lang), versions, p: np };
}

function showSection(songId, section) {
  const s = loadSongs().find(x => x.id === songId);
  if (!s) throw new Error('Chant introuvable');
  const i = Math.max(0, Math.min(section, s.sections.length - 1));
  state.live.lyrics = { ...state.live.lyrics, on: true, songId, title: s.title, section: i, total: s.sections.length, label: (s.labels || [])[i] || '', lines: s.sections[i].split('\n') };
}

const VID = /\.(mp4|webm|mov|m4v)$/i;
const cardOf = c => {
  c = c || {};
  const f = k => String(c[k] || '').trim().slice(0, k === 'extra' ? 400 : 120);
  const card = { title: f('title'), date: f('date'), dateISO: f('dateISO'), time: f('time'), timeRaw: f('timeRaw'), place: f('place'), speaker: f('speaker'), extra: f('extra') };
  if (!card.title || !card.date || !card.time || !card.place) throw new Error('Annonce incomplète : le titre, la date, l\'heure et le lieu sont obligatoires');
  return card;
};
function showMedia(a) {
  const prev = state.live.media;
  const kind = a.kind || (a.card ? 'card' : VID.test(a.src || '') ? 'video' : 'image');
  if (kind !== 'card' && !a.src) throw new Error('Aucun fichier à afficher');
  const card = kind === 'card' ? cardOf(a.card) : null;
  state.live.media = {
    ...prev, on: true, kind, src: kind === 'card' ? '' : a.src, name: a.name || (card ? card.title : ''), layout: a.layout || prev.layout, card,
    video: { playing: true, loop: !!prev.video.loop, muted: !!prev.video.muted, rev: (prev.video.rev || 0) + 1 },
  };
}

let lowerTimer = null;
function hideLower() { clearTimeout(lowerTimer); lowerTimer = null; state.live.lower = { on: false, title: '', sub: '', sec: '', until: 0 }; }
// Affiche un bandeau, rattaché à une section : il disparaît quand on en sort, ou après lowerSecs secondes (0 = jamais)
function showLower(title, sub, sec) {
  clearTimeout(lowerTimer); lowerTimer = null;
  const secs = Math.max(0, Math.min(600, +state.prefs.lowerSecs || 0));
  const until = secs ? Date.now() + secs * 1000 : 0;
  state.live.lower = { on: true, title, sub: sub || '', sec: sec || state.plan.target || '', until };
  if (secs) lowerTimer = setTimeout(() => { lowerTimer = null; if (state.live.lower.on && state.live.lower.until === until) { hideLower(); broadcast(); } }, secs * 1000 + 50);
}
function hideAll() {
  state.live.verse.on = false; state.live.lyrics.on = false; state.live.media.on = false; hideLower();
}

function findItem(id) {
  for (const s of state.plan.sections) { const i = s.items.findIndex(x => x.id === id); if (i >= 0) return { s, i, it: s.items[i] }; }
  return null;
}
const allItems = () => state.plan.sections.flatMap(s => s.items);

function cleanItem(item) {
  const { id, ...it } = item || {};
  it.label = String(it.label || '').slice(0, 120);
  if (it.type === 'announce') {
    if (it.mode === 'card') it.card = cardOf(it.card); else { delete it.card; if (!it.src) throw new Error('Choisis un visuel pour cette annonce'); }
    if (!it.label) it.label = it.mode === 'card' ? it.card.title : (it.src.split('/').pop() || 'Annonce');
  }
  if (it.type === 'lower') { it.title = String(it.title || '').slice(0, 120); it.sub = String(it.sub || '').slice(0, 160); if (!it.title) throw new Error('Le bandeau a besoin d\'un titre'); if (!it.label) it.label = it.title; }
  if (!['song', 'verse', 'media', 'announce', 'lower', 'note'].includes(it.type)) throw new Error('Type d\'élément inconnu');
  return it;
}

function goPlan(id, startAt) {
  const f = findItem(id);
  if (!f) return;
  const it = f.it;
  const keep = state.live.lower.on && state.live.lower.sec === f.s.id ? { ...state.live.lower } : null;
  hideAll();
  if (keep) state.live.lower = keep;
  state.plan.cursor = id; state.plan.target = f.s.id;
  if (it.type === 'song') {
    const s = loadSongs().find(x => x.id === it.songId);
    if (s) showSection(it.songId, startAt === 'last' ? s.sections.length - 1 : 0);
  } else if (it.type === 'verse') {
    showVerse({ ref: it.ref, p: it.p, versions: it.versions, layout: it.layout });
  } else if (it.type === 'media') {
    showMedia({ src: it.src, name: it.label, layout: it.layout });
  } else if (it.type === 'announce') {
    if (it.mode === 'card') showMedia({ kind: 'card', card: it.card, name: it.label, layout: it.layout });
    else showMedia({ src: it.src, name: it.label, layout: it.layout });
  } else if (it.type === 'lower') {
    showLower(it.title, it.sub || '', f.s.id);
  }
}

function step(dir) {
  const ly = state.live.lyrics;
  if (ly.on && ly.songId) {
    const ns = ly.section + dir;
    if (ns >= 0 && ns < ly.total) { showSection(ly.songId, ns); return; }
  }
  const fl = allItems();
  if (!fl.length) return;
  const cur = fl.findIndex(x => x.id === state.plan.cursor);
  const i = cur < 0 ? (dir > 0 ? 0 : -1) : cur + dir;
  if (i >= 0 && i < fl.length) goPlan(fl[i].id, dir < 0 ? 'last' : 'first');
}

function loadPlan(id) {
  let secs;
  if (id === 'default') secs = mkSections();
  else if (id === 'template') { const t = loadPlans().find(x => x.template); secs = t ? cloneSections(t.sections) : mkSections(); }
  else { const e = loadPlans().find(x => x.id === id); if (!e) throw new Error('Culte introuvable'); secs = cloneSections(e.sections); state.plan.name = e.name; }
  const name = id === 'default' || id === 'template' ? 'Culte' : state.plan.name;
  state.plan = normPlan({ name, sections: secs });
}

function chronoMs() { const c = state.chrono; return c.base + (c.running ? Date.now() - c.startedAt : 0); }

function handle(cmd, a) {
  const L = state.live;
  switch (cmd) {
    case 'verse.show': showVerse(a); break;
    case 'verse.nav': navVerse(a.dir); break;
    case 'verse.hide': L.verse.on = false; break;
    case 'lyrics.show': showSection(a.songId, a.section | 0); break;
    case 'lyrics.hide': L.lyrics.on = false; break;
    case 'media.show': showMedia(a); break;
    case 'media.hide': L.media.on = false; break;
    case 'media.video': {
      const v = L.media.video;
      if (a.playing != null) v.playing = !!a.playing;
      if (a.loop != null) v.loop = !!a.loop;
      if (a.muted != null) v.muted = !!a.muted;
      if (a.restart) { v.rev++; v.playing = true; }
      break;
    }
    case 'lower.show': {
      const title = String(a.title || '').trim().slice(0, 120);
      if (!title) throw new Error('Écris au moins un titre pour le bandeau');
      showLower(title, String(a.sub || '').trim().slice(0, 160), state.plan.sections.some(x => x.id === a.sec) ? a.sec : '');
      break;
    }
    case 'lower.hide': hideLower(); break;
    case 'lowers.add': {
      const title = String(a.title || '').trim().slice(0, 120); if (!title) throw new Error('Écris au moins un titre');
      const sub = String(a.sub || '').trim().slice(0, 160);
      if (!state.lowers.some(x => x.title === title && x.sub === sub)) state.lowers.push({ id: uid(), title, sub });
      break;
    }
    case 'lowers.remove': state.lowers = state.lowers.filter(x => x.id !== a.id); break;
    case 'chrono.start': if (!state.chrono.running) { state.chrono.running = true; state.chrono.startedAt = Date.now(); } break;
    case 'chrono.pause': if (state.chrono.running) { state.chrono.base = chronoMs(); state.chrono.running = false; } break;
    case 'chrono.reset': state.chrono.base = 0; state.chrono.running = false; state.chrono.startedAt = 0; break;
    case 'chrono.visible': state.chrono.visible = !!a.on; break;
    case 'hide.all': hideAll(); break;
    case 'layout.set':
      if (!L[a.kind] || a.kind === 'lower') break;
      L[a.kind].layout = a.layout; state.prefs[a.kind] = a.layout; break;
    case 'versions.set': state.prefs.versions = a.versions || []; break;
    case 'bg.set': state.background = { ...state.background, src: a.src, type: a.type === 'video' ? 'video' : 'image' }; break;
    case 'bg.clear': state.background = { ...state.background, src: '', type: '' }; break;
    case 'bg.dim': state.background.dim = Math.max(0, Math.min(0.9, +a.value || 0)); break;
    case 'guide.set': state.guide = !!a.on; break;
    case 'theme.set':
      if (a.group === 'font') state.theme.font = String(a.value).slice(0, 200);
      else if (state.theme[a.group] && a.key in state.theme[a.group]) state.theme[a.group][a.key] = typeof a.value === 'string' ? a.value.slice(0, 300) : a.value;
      break;
    case 'theme.reset': state.theme = mergeTheme(); break;
    case 'prefs.set':
      if (['autoHide', 'directClick'].includes(a.key)) state.prefs[a.key] = !!a.value;
      if (a.key === 'lowerSecs') state.prefs.lowerSecs = Math.max(0, Math.min(600, parseInt(a.value, 10) || 0));
      if (a.key === 'backupDir') { state.prefs.backupDir = String(a.value || '').trim().slice(0, 500); syncBackup(); }
      break;
    case 'step': step(a.dir > 0 ? 1 : -1); break;
    // ----- déroulé -----
    case 'plan.add': {
      const sec = state.plan.sections.find(s => s.id === (a.sec || state.plan.target)) || state.plan.sections[0];
      if (!sec) throw new Error('Ajoute d\'abord une section');
      sec.items.push({ id: uid(), ...cleanItem(a.item) });
      state.plan.target = sec.id;
      break;
    }
    case 'plan.update': {
      const f = findItem(a.id); if (!f) break;
      f.s.items[f.i] = { id: a.id, ...cleanItem({ ...f.it, ...a.item, type: f.it.type }) };
      break;
    }
    case 'plan.remove': {
      const f = findItem(a.id);
      if (f) { f.s.items.splice(f.i, 1); if (state.plan.cursor === a.id) state.plan.cursor = null; }
      break;
    }
    case 'plan.move': {
      const f = findItem(a.id); if (!f) break;
      const secs = state.plan.sections, si = secs.indexOf(f.s), its = f.s.items;
      if (a.dir < 0) {
        if (f.i > 0) [its[f.i - 1], its[f.i]] = [its[f.i], its[f.i - 1]];
        else if (si > 0) { its.splice(f.i, 1); secs[si - 1].items.push(f.it); }
      } else {
        if (f.i < its.length - 1) [its[f.i + 1], its[f.i]] = [its[f.i], its[f.i + 1]];
        else if (si < secs.length - 1) { its.splice(f.i, 1); secs[si + 1].items.unshift(f.it); }
      }
      break;
    }
    case 'plan.go': goPlan(a.id); break;
    case 'plan.target': if (state.plan.sections.some(s => s.id === a.sec)) { state.plan.target = a.sec; if (state.live.lower.on && state.live.lower.sec !== a.sec) hideLower(); } break;
    case 'plan.name': state.plan.name = String(a.name || 'Culte').slice(0, 80); break;
    case 'plan.section.add': {
      const sec = { id: uid(), title: String(a.title || 'Nouvelle section').slice(0, 60), items: [] };
      state.plan.sections.push(sec); state.plan.target = sec.id; break;
    }
    case 'plan.section.rename': { const s = state.plan.sections.find(x => x.id === a.sec); if (s && a.title) s.title = String(a.title).slice(0, 60); break; }
    case 'plan.section.remove': {
      if (state.plan.sections.length <= 1) throw new Error('Il faut garder au moins une section');
      const i = state.plan.sections.findIndex(x => x.id === a.sec);
      if (i >= 0) {
        const [gone] = state.plan.sections.splice(i, 1);
        if (gone.items.some(x => x.id === state.plan.cursor)) state.plan.cursor = null;
        if (state.plan.target === a.sec) state.plan.target = state.plan.sections[Math.min(i, state.plan.sections.length - 1)].id;
      }
      break;
    }
    case 'plan.section.move': {
      const secs = state.plan.sections, i = secs.findIndex(x => x.id === a.sec), j = i + (a.dir > 0 ? 1 : -1);
      if (i >= 0 && j >= 0 && j < secs.length) [secs[i], secs[j]] = [secs[j], secs[i]];
      break;
    }
    case 'plan.clear': state.plan.sections.forEach(s => { s.items = []; }); state.plan.cursor = null; break;
    case 'plan.load': hideAll(); loadPlan(a.id || 'template'); break;
    default: throw new Error('Commande inconnue : ' + cmd);
  }
  persist();
}

// ---------------- Sauvegarde des Bibles ----------------
function syncBackup() {
  const b = state.backup, dir = (state.prefs.backupDir || '').trim();
  b.dir = dir; b.error = '';
  if (!dir) { b.count = 0; return; }
  try {
    if (!path.isAbsolute(dir)) throw new Error('indique le chemin complet du dossier');
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('ce dossier n\'existe pas sur cet ordinateur');
    const dest = path.join(dir, 'projection-culte-bibles');
    if (!fs.existsSync(dest)) fs.mkdirSync(dest);
    for (const f of fs.readdirSync(BIBLES).filter(f => f.endsWith('.json'))) {
      const src = path.join(BIBLES, f), dst = path.join(dest, f), ss = fs.statSync(src);
      let same = false;
      try { const ds = fs.statSync(dst); same = ds.size === ss.size && ds.mtimeMs >= ss.mtimeMs; } catch {}
      if (!same) fs.copyFileSync(src, dst);
    }
    b.last = Date.now(); b.count = fs.readdirSync(dest).filter(f => f.endsWith('.json')).length;
  } catch (e) { b.error = 'Dossier inutilisable : ' + e.message; }
}

async function bibleZip() {
  const zip = new JSZip();
  for (const f of fs.readdirSync(BIBLES).filter(f => f.endsWith('.json'))) zip.file('bibles/' + f, fs.readFileSync(path.join(BIBLES, f)));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

async function restoreZip(buf) {
  const zip = await JSZip.loadAsync(buf);
  const done = [];
  for (const n of Object.keys(zip.files)) {
    if (zip.files[n].dir || !/\.json$/i.test(n)) continue;
    try { done.push(bible.storeRaw(await zip.files[n].async('nodebuffer')).name); } catch {}
  }
  if (!done.length) throw new Error('Aucune Bible valide trouvée dans ce zip');
  syncBackup();
  return done;
}

function restoreFromFolder() {
  const dir = (state.prefs.backupDir || '').trim();
  if (!dir) throw new Error('Aucun dossier de sauvegarde défini');
  const src = path.join(dir, 'projection-culte-bibles');
  if (!fs.existsSync(src)) throw new Error('Aucune sauvegarde dans ce dossier');
  const have = new Set(fs.readdirSync(BIBLES));
  const added = [];
  for (const f of fs.readdirSync(src).filter(f => f.endsWith('.json') && !have.has(f))) { try { added.push(bible.storeRaw(fs.readFileSync(path.join(src, f))).name); } catch {} }
  return added;
}

// ---------------- Mise à jour (GitHub) ----------------
function httpGet(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? require('https') : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'culte-projection', 'Cache-Control': 'no-cache' }, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); return resolve(httpGet(new URL(res.headers.location, url).href, redirects - 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('réponse ' + res.statusCode)); }
      const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => resolve(Buffer.concat(ch))); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
  });
}
const cmpVer = (a, b) => { const x = String(a).split('.').map(n => parseInt(n) || 0), y = String(b).split('.').map(n => parseInt(n) || 0); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const OLD_DIR = path.join(ROOT, '_old');
const SKIP_UPDATE = /^(data\/|node_modules\/|_old\/|\.git|\.claude)/;

async function checkUpdate() {
  const u = state.update;
  if (u.installing) return;
  u.checking = true; u.error = ''; broadcast();
  try {
    const v = (await httpGet(UPDATE_RAW + '/VERSION?_=' + Date.now())).toString().trim().split(/\s+/)[0];
    if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error('numéro de version illisible');
    u.latest = v; u.available = cmpVer(v, VERSION) > 0;
  } catch (e) { u.error = 'Impossible de vérifier les mises à jour (' + e.message + ')'; }
  u.checking = false; u.canRollback = fs.existsSync(OLD_DIR) && fs.readdirSync(OLD_DIR).length > 0;
  broadcast();
}

function restart() {
  setTimeout(() => {
    if (process.env.CULTE_LOOP) process.exit(42);
    require('child_process').spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, detached: true, stdio: 'ignore', env: process.env }).unref();
    process.exit(0);
  }, 1200);
}

function depsOf(file) { try { return JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')).dependencies || {}); } catch { return ''; } }

function copyBack(srcDir) {
  const walk = (d, rel = '') => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(d, e.name), r);
    else { const dst = path.join(ROOT, r); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(d, e.name), dst); }
  });
  walk(srcDir);
}

async function installUpdate() {
  const u = state.update;
  if (u.installing) throw new Error('Mise à jour déjà en cours');
  u.installing = true; u.error = ''; broadcast();
  try {
    const zip = await JSZip.loadAsync(await httpGet(UPDATE_ZIP));
    const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
    const prefix = (names.find(n => /(^|\/)server\.js$/.test(n)) || '').replace(/server\.js$/, '');
    if (!names.includes(prefix + 'server.js') || !names.includes(prefix + 'VERSION')) throw new Error('archive inattendue');
    const files = names.filter(n => n.startsWith(prefix)).map(n => n.slice(prefix.length)).filter(n => n && !n.includes('..') && !SKIP_UPDATE.test(n));
    const newVer = (await zip.file(prefix + 'VERSION').async('string')).trim().split(/\s+/)[0];
    // version précédente conservée pour pouvoir revenir en arrière
    fs.rmSync(OLD_DIR, { recursive: true, force: true });
    const keep = path.join(OLD_DIR, VERSION);
    for (const f of files) { const cur = path.join(ROOT, f); if (fs.existsSync(cur)) { fs.mkdirSync(path.dirname(path.join(keep, f)), { recursive: true }); fs.copyFileSync(cur, path.join(keep, f)); } }
    const depsBefore = depsOf(path.join(ROOT, 'package.json'));
    for (const f of files) {
      const dst = path.join(ROOT, f); fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, await zip.file(prefix + f).async('nodebuffer'));
      if (/\.(command|sh)$/.test(f)) { try { fs.chmodSync(dst, 0o755); } catch {} }
    }
    if (depsOf(path.join(ROOT, 'package.json')) !== depsBefore) {
      try {
        await new Promise((res, rej) => require('child_process').exec('npm install --omit=dev --no-audit --no-fund', { cwd: ROOT, timeout: 240000, shell: true }, (err, so, se) => err ? rej(new Error(String(se || err.message).slice(0, 200))) : res()));
      } catch (e) { copyBack(keep); throw new Error('installation des composants impossible : ' + e.message); }
    }
    u.installing = false; u.available = false; u.current = newVer; u.canRollback = true; broadcast();
    restart();
    return { ok: true, version: newVer };
  } catch (e) {
    u.installing = false; u.error = 'Mise à jour impossible : ' + e.message; broadcast();
    throw new Error(u.error);
  }
}

function rollbackUpdate() {
  const vs = fs.existsSync(OLD_DIR) ? fs.readdirSync(OLD_DIR) : [];
  if (!vs.length) throw new Error('Aucune version précédente conservée');
  copyBack(path.join(OLD_DIR, vs[0]));
  restart();
  return { ok: true, version: vs[0] };
}

// ---------------- HTTP ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/mp4', '.m4v': 'video/mp4',
};

function readBody(req, limit = 600e6) {
  return new Promise((res, rej) => {
    const ch = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { rej(new Error('Fichier trop gros')); req.destroy(); } else ch.push(c); });
    req.on('end', () => res(Buffer.concat(ch)));
    req.on('error', rej);
  });
}

function saveUpload(req, file, limit = 3e9) {
  return new Promise((res, rej) => {
    const out = fs.createWriteStream(file); let n = 0, over = false, done = false;
    const fail = e => { if (done) return; done = true; out.destroy(); fs.unlink(file, () => {}); rej(e); };
    req.on('data', c => { n += c.length; if (n > limit && !over) { over = true; fail(new Error('Fichier trop gros (3 Go maximum)')); } });
    req.on('aborted', () => fail(new Error('Envoi interrompu')));
    req.on('error', fail); out.on('error', fail);
    out.on('finish', () => { if (!done) { done = true; res(n); } });
    req.pipe(out);
  });
}

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

function serveFile(req, res, base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]);
      let end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const safeName = n => path.basename(String(n || 'fichier')).replace(/[^\w.\-() ]+/g, '_').slice(0, 100);

async function pptxToSong(buf) {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1]) - parseInt(b.match(/(\d+)\.xml/)[1]));
  const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const paraText = pm => { let line = ''; for (const m of pm.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>|<a:br\s*\/>/g)) line += m[1] === undefined ? '\n' : dec(m[1]); return line.replace(/\s+$/g, ''); };
  // clé de comparaison tolérante : sans accents, ponctuation, chiffres ni casse ("Grand est ton nom (2/4)" = "grand est ton nom")
  const key = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\u0400-\u04ff\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const flat = t => t.replace(/\s*\n\s*/g, ' ');
  const pages = [];   // chaque diapo : lignes triées de haut en bas { t, title }
  for (const n of slides) {
    const xml = await zip.file(n).async('string');
    const items = [];
    const shapes = xml.match(/<p:sp[ >][\s\S]*?<\/p:sp>/g) || [xml];
    shapes.forEach((sh, si) => {
      if (/<p:ph[^>]*type="(sldNum|ftr|dt)"/.test(sh)) return;   // numéro, pied de page, date
      const isTitle = /<p:ph[^>]*type="(title|ctrTitle)"/.test(sh);
      const off = sh.match(/<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"/);
      const y = off ? +off[2] : (isTitle ? -1 : 1e9 + si);   // pas de position : ordre du fichier, titre en premier
      let k = 0;
      for (const pm of sh.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)) { const t = paraText(pm[0]); if (t.trim()) items.push({ t, title: isTitle, y, k: si * 1000 + k++ }); }
    });
    items.sort((a, b) => a.y - b.y || a.k - b.k);
    pages.push(items);
  }
  // Titre : pris une seule fois. Zone « titre » du PowerPoint, sinon la première ligne (en haut de la diapo) répétée sur au moins la moitié des diapos.
  let title = '', tkey = '';
  const count = {};
  const tit = pages.flatMap(ps => ps.filter(x => x.title).map(x => flat(x.t)));
  if (tit.length) { tit.forEach(t => { count[key(t)] = (count[key(t)] || 0) + 1; }); tkey = Object.keys(count).sort((a, b) => count[b] - count[a])[0]; title = tit.find(t => key(t) === tkey); }
  if (!tkey && pages.length >= 2) {
    for (const ps of pages) { const k = ps[0] && key(flat(ps[0].t)); if (k) count[k] = (count[k] || 0) + 1; }
    const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    if (best && count[best] >= Math.max(2, Math.ceil(pages.length * 0.5))) { tkey = best; title = flat(pages.find(ps => ps[0] && key(flat(ps[0].t)) === best)[0].t); }
  }
  const sections = [];
  for (const ps of pages) {
    const lines = ps.filter(x => !(tkey && key(flat(x.t)) === tkey)).map(x => x.t);
    if (lines.length) sections.push(lines.join('\n'));
  }
  return { title: title.trim(), sections };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname, q = u.searchParams;
  try {
    if (p.startsWith('/api/')) {
      if (p === '/api/info' && req.method === 'GET') {
        const ips = [];
        for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
        return send(res, 200, { ips, port: PORT });
      }
      if (p === '/api/bibles' && req.method === 'GET') return send(res, 200, bible.list());
      if (p === '/api/bible/import' && req.method === 'POST') {
        const buf = await readBody(req);
        const r = bible.importData(buf, { id: q.get('id'), name: q.get('name'), abbr: q.get('abbr'), lang: q.get('lang') });
        syncBackup(); broadcast();
        return send(res, 200, r);
      }
      if (p === '/api/verse' && req.method === 'GET') {
        const pr = q.get('b') != null ? { book: +q.get('b'), chapter: +q.get('c'), v1: +q.get('v1'), v2: +(q.get('v2') || q.get('v1')) } : bible.parseRef(q.get('ref'));
        if (!pr) return send(res, 200, { ok: false });
        const versions = (q.get('v') || '').split(',').map(id => bible.getPassage(id, pr)).filter(Boolean);
        return send(res, 200, versions.length ? { ok: true, ref: bible.refLabel(pr, versions[0].lang), p: pr, versions } : { ok: false });
      }
      if (p === '/api/search' && req.method === 'GET') return send(res, 200, bible.search(q.get('v'), q.get('q') || '', { t: q.get('t') || 'all', offset: +q.get('offset') || 0, limit: 50 }));
      if (p === '/api/bible/books' && req.method === 'GET') return send(res, 200, q.get('q') ? bible.findBooks(q.get('v'), q.get('q')) : bible.booksInfo(q.get('v')));
      if (p === '/api/bible/chapter' && req.method === 'GET') return send(res, 200, bible.chapterVerses(q.get('v'), +q.get('b'), +q.get('c')));
      if (p === '/api/fonts' && req.method === 'POST') {
        const name = safeName(q.get('name'));
        if (!FONT_EXT.test(name)) return send(res, 400, { error: 'Police non gérée (.ttf, .otf, .woff, .woff2)' });
        fs.writeFileSync(path.join(FONTS, name), await readBody(req));
        refreshFonts(); broadcast();
        return send(res, 200, { name: name.replace(FONT_EXT, '') });
      }
      if (p === '/api/fonts' && req.method === 'DELETE') {
        try { for (const f of fs.readdirSync(FONTS)) if (f.replace(FONT_EXT, '') === q.get('name')) fs.unlinkSync(path.join(FONTS, f)); } catch {}
        refreshFonts(); broadcast();
        return send(res, 200, { ok: true });
      }
      if (p === '/api/songs' && req.method === 'GET') return send(res, 200, loadSongs());
      if (p === '/api/songs' && req.method === 'POST') {
        const s = JSON.parse((await readBody(req)).toString('utf8'));
        const songs = loadSongs();
        s.title = String(s.title || 'Sans titre').trim();
        const pairs = (s.sections || []).map((x, k) => ({ t: String(x).trim(), l: String((s.labels || [])[k] || '').trim().slice(0, 40) })).filter(x => x.t);
        if (!pairs.length) return send(res, 400, { error: 'Le chant est vide' });
        const rec = { id: s.id || uid(), title: s.title, sections: pairs.map(x => x.t), labels: pairs.map(x => x.l) };
        const i = songs.findIndex(x => x.id === rec.id);
        if (i >= 0) songs[i] = rec; else songs.push(rec);
        s.id = rec.id;
        songs.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
        writeJSON(SONGS_FILE, songs);
        broadcast();
        return send(res, 200, { id: s.id });
      }
      if (p === '/api/songs' && req.method === 'DELETE') {
        writeJSON(SONGS_FILE, loadSongs().filter(x => x.id !== q.get('id')));
        return send(res, 200, { ok: true });
      }
      if (p === '/api/songs/import-pptx' && req.method === 'POST') {
        const { title, sections } = await pptxToSong(await readBody(req));
        if (!sections.length) return send(res, 400, { error: 'Aucun texte trouvé dans ce PowerPoint' });
        return send(res, 200, { title, sections });
      }
      if (p === '/api/media' && req.method === 'GET') {
        const files = fs.readdirSync(MEDIA).filter(f => MIME[path.extname(f).toLowerCase()])
          .map(f => ({ name: f, url: '/media/' + encodeURIComponent(f), type: VID.test(f) ? 'video' : 'image', t: fs.statSync(path.join(MEDIA, f)).mtimeMs }))
          .sort((a, b) => b.t - a.t);
        return send(res, 200, files);
      }
      if (p === '/api/media' && req.method === 'POST') {
        let name = safeName(q.get('name'));
        const ext = path.extname(name).toLowerCase();
        if (!MIME[ext] || /^\.(html|js|css|json|ttf|otf|woff2?)$/.test(ext)) return send(res, 400, { error: 'Type de fichier non géré (png, jpg, webp, gif, svg, mp4, webm, mov)' });
        if (fs.existsSync(path.join(MEDIA, name))) name = Date.now() + '_' + name;
        await saveUpload(req, path.join(MEDIA, name));
        return send(res, 200, { name, url: '/media/' + encodeURIComponent(name) });
      }
      if (p === '/api/media' && req.method === 'DELETE') {
        try { fs.unlinkSync(path.join(MEDIA, safeName(q.get('name')))); } catch {}
        return send(res, 200, { ok: true });
      }
      if (p === '/api/plans' && req.method === 'GET') return send(res, 200, loadPlans().map(x => ({ id: x.id, name: x.name, template: !!x.template, items: x.sections.reduce((n, s) => n + s.items.length, 0), t: x.t })).sort((a, b) => (b.template - a.template) || b.t - a.t));
      if (p === '/api/plans' && req.method === 'POST') {
        const b = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const plans = loadPlans();
        const entry = { id: b.template ? 'template' : uid(), name: b.template ? 'Modèle' : String(b.name || state.plan.name || 'Culte').trim().slice(0, 80), template: !!b.template, sections: cloneSections(state.plan.sections), t: Date.now() };
        const i = plans.findIndex(x => b.template ? x.template : (!x.template && x.name === entry.name));
        if (i >= 0) { entry.id = plans[i].id; plans[i] = entry; } else plans.push(entry);
        writeJSON(PLANS_FILE, plans);
        if (!b.template) { state.plan.name = entry.name; persist(); broadcast(); }
        return send(res, 200, { id: entry.id, name: entry.name });
      }
      if (p === '/api/plans' && req.method === 'DELETE') { writeJSON(PLANS_FILE, loadPlans().filter(x => x.id !== q.get('id'))); return send(res, 200, { ok: true }); }
      if (p === '/api/update/check' && req.method === 'GET') { await checkUpdate(); return send(res, 200, state.update); }
      if (p === '/api/update/install' && req.method === 'POST') return send(res, 200, await installUpdate());
      if (p === '/api/update/rollback' && req.method === 'POST') return send(res, 200, rollbackUpdate());
      if (p === '/api/backup/bibles' && req.method === 'GET') {
        const buf = await bibleZip();
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length, 'Content-Disposition': 'attachment; filename="sauvegarde-bibles-' + new Date().toISOString().slice(0, 10) + '.zip"' });
        return res.end(buf);
      }
      if (p === '/api/backup/restore' && req.method === 'POST') { const names = await restoreZip(await readBody(req)); broadcast(); return send(res, 200, { restored: names }); }
      if (p === '/api/backup/restore-folder' && req.method === 'POST') { const added = restoreFromFolder(); broadcast(); return send(res, 200, { restored: added }); }
      return send(res, 404, { error: 'Route inconnue' });
    }
    if (p === '/fonts.css') {
      const css = fs.readdirSync(FONTS).filter(f => FONT_EXT.test(f)).map(f => {
        const fmt = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' }[path.extname(f).slice(1).toLowerCase()];
        return '@font-face{font-family:"' + f.replace(FONT_EXT, '').replace(/"/g, '') + '";src:url("/fonts/' + encodeURIComponent(f) + '") format("' + fmt + '");font-display:block;}';
      }).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(css);
    }
    if (p.startsWith('/fonts/')) return serveFile(req, res, FONTS, decodeURIComponent(p.slice(7)));
    if (p.startsWith('/media/')) return serveFile(req, res, MEDIA, decodeURIComponent(p.slice(7)));
    if (p === '/') return serveFile(req, res, PUB, 'control.html');
    return serveFile(req, res, PUB, decodeURIComponent(p));
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// ---------------- WebSocket ----------------
const wss = new WebSocketServer({ server });
wss.on('error', () => {});
function broadcast() {
  state.chrono.now = Date.now();
  const msg = JSON.stringify({ type: 'state', state });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
wss.on('connection', ws => {
  state.chrono.now = Date.now();
  ws.send(JSON.stringify({ type: 'state', state }));
  ws.on('message', raw => {
    try {
      const m = JSON.parse(raw);
      handle(m.cmd, m.a || {});
    } catch (e) {
      ws.send(JSON.stringify({ type: 'toast', msg: e.message }));
    }
    broadcast();
  });
});

let listenTries = 0;
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && listenTries++ < 20) return setTimeout(() => server.listen(PORT, '0.0.0.0'), 500);
  console.error(e.code === 'EADDRINUSE' ? '\n  Le port ' + PORT + ' est déjà utilisé : l\'appli est peut-être déjà ouverte.\n' : e.message);
  process.exit(1);
});
server.on('listening', () => {
  console.log('\n  Projection du culte v' + VERSION + ' — prêt\n');
  console.log('  Régie  :  http://localhost:' + PORT + '/');
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) {
    if (i.family === 'IPv4' && !i.internal) console.log('  Réseau :  http://' + i.address + ':' + PORT + '/   (sortie : /output.html)');
  }
  console.log('\n  Ctrl+C pour arrêter.\n');
  syncBackup();
  try { state.update.canRollback = fs.existsSync(OLD_DIR) && fs.readdirSync(OLD_DIR).length > 0; } catch {}
  if (!process.env.CULTE_NO_UPDATE_CHECK) { setTimeout(checkUpdate, 4000); setInterval(checkUpdate, 6 * 3600e3); }
});
server.listen(PORT, '0.0.0.0');
