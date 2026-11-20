'use strict';
const fs = require('fs');
const path = require('path');
const { BOOKS, FULL, EXACT, norm, lookupBook, bookName } = require('./books');

const DIR = path.join(__dirname, '..', 'data', 'bibles');
const cache = new Map();
const searchIdx = new Map();
const okId = id => /^[\w-]{1,40}$/.test(id || '');
const CH = [50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22];

function get(id) {
  if (!okId(id)) return null;
  if (cache.has(id)) return cache.get(id);
  try {
    const b = JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8'));
    b.books = b.books.map(x => x || []);
    cache.set(id, b);
    return b;
  } catch { return null; }
}

function list() {
  let files = [];
  try { files = fs.readdirSync(DIR).filter(f => f.endsWith('.json')); } catch {}
  return files.map(f => get(f.slice(0, -5))).filter(Boolean)
    .map(b => ({ id: b.id, name: b.name, abbr: b.abbr, lang: b.lang }))
    .sort((a, b) => (a.lang === 'fr' ? 0 : 1) - (b.lang === 'fr' ? 0 : 1) || a.name.localeCompare(b.name));
}

// ---------- Références ----------
const REF_RE = /^\s*([1-3]?\s*[A-Za-zÀ-ÿ'’. ]+?)\s*(\d{1,3})(?:\s*(?:[:.,]|v|\s)\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?)?\s*$/i;

function parseRef(s) {
  const m = String(s || '').replace(/[–—]/g, '-').match(REF_RE);
  if (!m) return null;
  const book = lookupBook(m[1]);
  if (book < 0) return null;
  const chapter = +m[2];
  const v1 = m[3] ? +m[3] : 1;
  const v2 = m[4] ? +m[4] : v1;
  return { book, chapter, v1, v2: Math.max(v1, v2) };
}

function getPassage(id, p) {
  const b = get(id);
  if (!b || !p) return null;
  const ch = b.books[p.book] && b.books[p.book][p.chapter - 1];
  if (!ch || !ch[p.v1 - 1]) return null;
  const texts = [];
  for (let v = p.v1; v <= Math.min(p.v2, ch.length); v++) if (ch[v - 1]) texts.push({ v, text: ch[v - 1] });
  return { id: b.id, abbr: b.abbr, name: b.name, lang: b.lang, texts };
}

function refLabel(p, lang) {
  const base = bookName(p.book, lang) + ' ' + p.chapter + ':' + p.v1;
  return p.v2 > p.v1 ? base + '-' + p.v2 : base;
}

function step(p, dir, id) {
  const b = get(id);
  if (!b) return null;
  let { book, chapter } = p;
  let v = (dir > 0 ? p.v2 : p.v1) + dir;
  const chs = b.books[book];
  if (v < 1) {
    if (chapter > 1) { chapter--; v = chs[chapter - 1].length; } else return null;
  } else if (v > chs[chapter - 1].length) {
    if (chapter < chs.length) { chapter++; v = 1; } else return null;
  }
  return { book, chapter, v1: v, v2: v };
}

// ---------- Parcours ----------
function booksInfo(id) {
  const b = get(id);
  if (!b) return [];
  return b.books.map((chs, i) => ({ i, name: bookName(i, b.lang), chapters: chs.length })).filter(x => x.chapters > 0);
}
function chapterVerses(id, bi, c) {
  const b = get(id);
  const ch = b && b.books[bi] && b.books[bi][c - 1];
  return ch ? ch.map((t, i) => ({ v: i + 1, text: t })).filter(x => x.text) : [];
}
function findBooks(id, q) {
  const k = norm(q);
  if (!k) return booksInfo(id);
  return booksInfo(id).filter(x => EXACT.get(k) === x.i || FULL[x.i][0].includes(k) || FULL[x.i][1].includes(k));
}

// ---------- Recherche plein texte ----------
const plain = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function indexFor(id) {
  if (searchIdx.has(id)) return searchIdx.get(id);
  const b = get(id);
  const out = [];
  b.books.forEach((chs, bi) => chs.forEach((vs, ci) => vs.forEach((t, vi) => out.push([bi, ci + 1, vi + 1, plain(t), t]))));
  searchIdx.set(id, out);
  return out;
}
function search(id, q, { t = 'all', offset = 0, limit = 50 } = {}) {
  const b = get(id);
  if (!b) return { total: 0, items: [] };
  const words = plain(q).split(/[^a-z0-9]+/).filter(w => w.length > 1);
  if (!words.length) return { total: 0, items: [] };
  let total = 0;
  const items = [];
  for (const [bi, c, v, n, tx] of indexFor(id)) {
    if (t === 'ot' && bi >= 39) continue;
    if (t === 'nt' && bi < 39) continue;
    if (/^\d+$/.test(t) && bi !== +t) continue;
    if (words.every(w => n.includes(w))) {
      if (total >= offset && items.length < limit) items.push({ ref: refLabel({ book: bi, chapter: c, v1: v, v2: v }, b.lang), p: { book: bi, chapter: c, v1: v, v2: v }, text: tx });
      total++;
    }
  }
  return { total, items };
}

// ---------- Import ----------
const clean = s => String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const attr = (tag, name) => { const m = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i').exec(tag); return m ? m[1] : null; };

function zefaniaList(xml) {
  const out = [];
  const bookRe = /<BIBLEBOOK([^>]*)>([\s\S]*?)<\/BIBLEBOOK>/gi;
  let bm;
  while ((bm = bookRe.exec(xml))) {
    const chapters = [];
    const chRe = /<CHAPTER([^>]*)>([\s\S]*?)<\/CHAPTER>/gi;
    let cm, cpos = 0;
    while ((cm = chRe.exec(bm[2]))) {
      const verses = [];
      const vRe = /<VERS([^>]*)>([\s\S]*?)<\/VERS>/gi;
      let vm, vpos = 0;
      while ((vm = vRe.exec(cm[2]))) {
        vpos++;
        const n = +(attr(vm[1], 'vnumber') || vpos);
        verses[n - 1] = clean(vm[2].replace(/<NOTE[\s\S]*?<\/NOTE>/gi, ''));
      }
      for (let i = 0; i < verses.length; i++) if (verses[i] == null) verses[i] = '';
      cpos++;
      chapters[+(attr(cm[1], 'cnumber') || cpos) - 1] = verses;
    }
    for (let i = 0; i < chapters.length; i++) if (!chapters[i]) chapters[i] = [];
    out.push({ names: [attr(bm[1], 'bname'), attr(bm[1], 'bsname')], num: +attr(bm[1], 'bnumber') || null, chapters });
  }
  return out;
}

function jsonList(data) {
  if (Array.isArray(data)) return data.map(b => ({ names: [b.name, b.abbrev, b.abbr, b.book], num: null, chapters: b.chapters.map(c => c.map(clean)) }));
  if (data && Array.isArray(data.books)) return data.books.map(b => ({ names: [b.name], num: null, chapters: b.chapters.map(c => c.verses.map(v => clean(v.text))) }));
  throw new Error('Format JSON non reconnu');
}

// range les livres dans l'ordre canonique : position (66) > noms > numéros > nombre de chapitres
function place(list) {
  const books = new Array(66).fill(null);
  if (list.length === 66 && list.every(e => e.num == null)) { list.forEach((e, i) => { books[i] = e.chapters; }); return { books, unknown: [] }; }
  const unknown = [];
  list.forEach((e, pos) => {
    let idx = -1;
    for (const nm of e.names) { if (nm) { idx = lookupBook(nm); if (idx >= 0) break; } }
    if (idx < 0 && e.num >= 1 && e.num <= 66) idx = e.num - 1;
    if (idx < 0 || books[idx]) { unknown.push(e.names.find(Boolean) || ('n°' + (pos + 1))); return; }
    books[idx] = e.chapters;
  });
  if (unknown.length) {
    // dernier recours : alignement sur le nombre de chapitres de chaque livre
    const b2 = new Array(66).fill(null);
    let ptr = 0, ok = true;
    for (const e of list) {
      while (ptr < 66 && CH[ptr] !== e.chapters.length) ptr++;
      if (ptr >= 66) { ok = false; break; }
      b2[ptr++] = e.chapters;
    }
    if (ok && list.length >= 60) return { books: b2, unknown: [] };
  }
  return { books, unknown };
}

function importData(buf, meta) {
  const txt = buf.toString('utf8').replace(/^﻿/, '').trim();
  let list;
  if (txt[0] === '[' || txt[0] === '{') list = jsonList(JSON.parse(txt));
  else if (txt[0] === '<') list = zefaniaList(txt);
  else throw new Error('Format non reconnu (attendu : JSON ou XML Zefania)');
  if (!list.length) throw new Error('Aucun livre trouvé dans ce fichier');
  const { books, unknown } = place(list);
  if (unknown.length) throw new Error('Livres non identifiés : ' + unknown.slice(0, 5).join(', ') + ' — envoie-moi le fichier pour que je l\'adapte');
  const present = books.filter(Boolean).length;
  if (!present) throw new Error('Aucun livre exploitable');
  const missing = books.map((b, i) => (b ? null : BOOKS[i][0])).filter(Boolean);
  const id = String(meta.id || '').toLowerCase().replace(/[^\w-]/g, '');
  if (!okId(id)) throw new Error('Identifiant invalide');
  const bible = { id, name: meta.name || id.toUpperCase(), abbr: meta.abbr || id.toUpperCase(), lang: meta.lang === 'en' ? 'en' : 'fr', books: books.map(b => b || []) };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, id + '.json'), JSON.stringify(bible));
  cache.set(id, bible);
  searchIdx.delete(id);
  return { id, name: bible.name, abbr: bible.abbr, lang: bible.lang, verses: bible.books.flat(2).length, present, missing };
}

// Restauration d'un fichier déjà normalisé (sauvegarde)
function storeRaw(buf) {
  let b;
  try { b = JSON.parse(buf.toString('utf8')); } catch { throw new Error('Fichier de Bible illisible'); }
  if (!b || !okId(b.id) || !Array.isArray(b.books) || b.books.length !== 66 || !b.name) throw new Error('Fichier de Bible invalide');
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, b.id + '.json'), JSON.stringify(b));
  cache.delete(b.id); searchIdx.delete(b.id);
  return { id: b.id, name: b.name };
}

module.exports = { list, get, parseRef, getPassage, refLabel, step, search, importData, storeRaw, booksInfo, chapterVerses, findBooks };
