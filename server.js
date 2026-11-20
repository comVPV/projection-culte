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
const MEDIA = path.join(DATA, 'media');
const FONTS = path.join(DATA, 'fonts');
const SONGS_FILE = path.join(DATA, 'songs.json');
const STATE_FILE = path.join(DATA, 'state.json');
fs.mkdirSync(MEDIA, { recursive: true });
fs.mkdirSync(FONTS, { recursive: true });

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, o) => { fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 1)); fs.renameSync(f + '.tmp', f); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------------- État ----------------
const DEFAULT_THEME = {
  font: '"Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  verse: { size: 58, color: '#ffffff', bg: '#101820', bgAlpha: 0.85, refColor: '#f5c542', bgImage: '' },
  lyrics: { size: 78, color: '#ffffff', outline: '#000000', weight: 700, upper: false },
  media: { panel: '#101820', bgImage: '', camWidth: 640, imgScale: 100, pipSize: 560 },
  monitor: { size: 96, color: '#ffffff', bg: '#000000', refColor: '#f5c542', bgImage: '' },
};
const saved = readJSON(STATE_FILE, {});
function mergeTheme(st = {}) {
  const t = { font: st.font || (st.verse && st.verse.font) || DEFAULT_THEME.font };
  for (const g of ['verse', 'lyrics', 'media', 'monitor']) { t[g] = { ...DEFAULT_THEME[g], ...(st[g] || {}) }; delete t[g].font; }
  return t;
}
const state = {
  live: {
    verse: { on: false, layout: 'lower' },
    lyrics: { on: false, layout: 'bottom' },
    media: { on: false, layout: 'full' },
  },
  theme: mergeTheme(saved.theme),
  prefs: { versions: ['kjv'], autoHide: true, directClick: false, ...(saved.prefs || {}) },
  plan: saved.plan || { items: [], cursor: -1 },
  guide: false,
  fonts: [],
  background: { src: '', type: '', dim: 0.35, ...(saved.background || {}) },
};
if (saved.prefs) {
  if (saved.prefs.verse) state.live.verse.layout = saved.prefs.verse;
  if (saved.prefs.lyrics) state.live.lyrics.layout = saved.prefs.lyrics;
  if (saved.prefs.media) state.live.media.layout = saved.prefs.media;
}
state.plan.cursor = -1;

const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
function refreshFonts() { state.fonts = fs.readdirSync(FONTS).filter(f => FONT_EXT.test(f)).map(f => f.replace(FONT_EXT, '')).sort((a, b) => a.localeCompare(b)); }
refreshFonts();

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJSON(STATE_FILE, { theme: state.theme, prefs: state.prefs, plan: state.plan, background: state.background }), 400);
}

const loadSongs = () => readJSON(SONGS_FILE, []);

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
  state.live.lyrics = { ...state.live.lyrics, on: true, songId, title: s.title, section: i, total: s.sections.length, lines: s.sections[i].split('\n') };
}

function hideAll() {
  state.live.verse.on = false; state.live.lyrics.on = false; state.live.media.on = false;
}

function goPlan(index, startAt) {
  const it = state.plan.items[index];
  if (!it) return;
  hideAll();
  state.plan.cursor = index;
  if (it.type === 'song') {
    const s = loadSongs().find(x => x.id === it.songId);
    if (s) showSection(it.songId, startAt === 'last' ? s.sections.length - 1 : 0);
  } else if (it.type === 'verse') {
    showVerse({ ref: it.ref, p: it.p, versions: it.versions, layout: it.layout });
  } else if (it.type === 'media') {
    state.live.media = { ...state.live.media, on: true, src: it.src, name: it.label, layout: it.layout || state.live.media.layout };
  }
}

function step(dir) {
  const ly = state.live.lyrics;
  if (ly.on && ly.songId) {
    const ns = ly.section + dir;
    if (ns >= 0 && ns < ly.total) { showSection(ly.songId, ns); return; }
  }
  const i = state.plan.cursor + dir;
  if (i >= 0 && i < state.plan.items.length) goPlan(i, dir < 0 ? 'last' : 'first');
}

function handle(cmd, a) {
  const L = state.live;
  switch (cmd) {
    case 'verse.show': showVerse(a); break;
    case 'verse.nav': navVerse(a.dir); break;
    case 'verse.hide': L.verse.on = false; break;
    case 'lyrics.show': showSection(a.songId, a.section | 0); break;
    case 'lyrics.hide': L.lyrics.on = false; break;
    case 'media.show': L.media = { ...L.media, on: true, src: a.src, name: a.name || '', layout: a.layout || L.media.layout }; break;
    case 'media.hide': L.media.on = false; break;
    case 'hide.all': hideAll(); break;
    case 'layout.set':
      if (!L[a.kind]) break;
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
      break;
    case 'step': step(a.dir > 0 ? 1 : -1); break;
    case 'plan.add': state.plan.items.push({ id: uid(), ...a.item }); break;
    case 'plan.remove': {
      const i = state.plan.items.findIndex(x => x.id === a.id);
      if (i >= 0) { state.plan.items.splice(i, 1); if (state.plan.cursor >= i) state.plan.cursor--; }
      break;
    }
    case 'plan.move': {
      const it = state.plan.items, i = it.findIndex(x => x.id === a.id), j = i + (a.dir > 0 ? 1 : -1);
      if (i >= 0 && j >= 0 && j < it.length) {
        [it[i], it[j]] = [it[j], it[i]];
        if (state.plan.cursor === i) state.plan.cursor = j; else if (state.plan.cursor === j) state.plan.cursor = i;
      }
      break;
    }
    case 'plan.go': goPlan(a.index | 0); break;
    case 'plan.clear': state.plan = { items: [], cursor: -1 }; break;
    default: throw new Error('Commande inconnue : ' + cmd);
  }
  persist();
}

// ---------------- HTTP ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function readBody(req, limit = 600e6) {
  return new Promise((res, rej) => {
    const ch = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { rej(new Error('Fichier trop gros')); req.destroy(); } else ch.push(c); });
    req.on('end', () => res(Buffer.concat(ch)));
    req.on('error', rej);
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
  const sections = [];
  for (const n of slides) {
    const xml = await zip.file(n).async('string');
    const paras = [];
    for (const pm of xml.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)) {
      let line = '';
      for (const m of pm[0].matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>|<a:br\s*\/>/g)) line += m[1] === undefined ? '\n' : dec(m[1]);
      line = line.replace(/\s+$/g, '');
      if (line.trim()) paras.push(line);
    }
    if (paras.length) sections.push(paras.join('\n'));
  }
  return sections;
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
        return send(res, 200, bible.importData(buf, { id: q.get('id'), name: q.get('name'), abbr: q.get('abbr'), lang: q.get('lang') }));
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
        s.sections = (s.sections || []).map(x => String(x).trim()).filter(Boolean);
        if (!s.sections.length) return send(res, 400, { error: 'Le chant est vide' });
        if (!s.id) s.id = uid();
        const i = songs.findIndex(x => x.id === s.id);
        if (i >= 0) songs[i] = { id: s.id, title: s.title, sections: s.sections }; else songs.push({ id: s.id, title: s.title, sections: s.sections });
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
        const sections = await pptxToSong(await readBody(req));
        if (!sections.length) return send(res, 400, { error: 'Aucun texte trouvé dans ce PowerPoint' });
        return send(res, 200, { sections });
      }
      if (p === '/api/media' && req.method === 'GET') {
        const files = fs.readdirSync(MEDIA).filter(f => MIME[path.extname(f).toLowerCase()])
          .map(f => ({ name: f, url: '/media/' + encodeURIComponent(f), type: /\.(mp4|webm)$/i.test(f) ? 'video' : 'image', t: fs.statSync(path.join(MEDIA, f)).mtimeMs }))
          .sort((a, b) => b.t - a.t);
        return send(res, 200, files);
      }
      if (p === '/api/media' && req.method === 'POST') {
        let name = safeName(q.get('name'));
        if (!MIME[path.extname(name).toLowerCase()]) return send(res, 400, { error: 'Type de fichier non géré (png, jpg, webp, gif, svg, mp4, webm)' });
        if (fs.existsSync(path.join(MEDIA, name))) name = Date.now() + '_' + name;
        fs.writeFileSync(path.join(MEDIA, name), await readBody(req));
        return send(res, 200, { name, url: '/media/' + encodeURIComponent(name) });
      }
      if (p === '/api/media' && req.method === 'DELETE') {
        try { fs.unlinkSync(path.join(MEDIA, safeName(q.get('name')))); } catch {}
        return send(res, 200, { ok: true });
      }
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
function broadcast() {
  const msg = JSON.stringify({ type: 'state', state });
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}
wss.on('connection', ws => {
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

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Projection du culte — prêt\n');
  console.log('  Régie  :  http://localhost:' + PORT + '/');
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) {
    if (i.family === 'IPv4' && !i.internal) console.log('  Réseau :  http://' + i.address + ':' + PORT + '/   (sortie : /output.html)');
  }
  console.log('\n  Ctrl+C pour arrêter.\n');
});
