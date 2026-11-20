'use strict';
// [nom FR, nom EN, alias (abréviations courantes, sans accents)]
const BOOKS = [
  ['Genèse', 'Genesis', 'gn gen ge'],
  ['Exode', 'Exodus', 'ex exo'],
  ['Lévitique', 'Leviticus', 'lv lev le'],
  ['Nombres', 'Numbers', 'nb nm nombr num nu'],
  ['Deutéronome', 'Deuteronomy', 'dt deut de'],
  ['Josué', 'Joshua', 'jos josu jsh'],
  ['Juges', 'Judges', 'jg jug jdg jdgs'],
  ['Ruth', 'Ruth', 'rt ru'],
  ['1 Samuel', '1 Samuel', '1sa 1s 1sam'],
  ['2 Samuel', '2 Samuel', '2sa 2s 2sam'],
  ['1 Rois', '1 Kings', '1r 1ro 1ki 1k 1kgs'],
  ['2 Rois', '2 Kings', '2r 2ro 2ki 2k 2kgs'],
  ['1 Chroniques', '1 Chronicles', '1ch 1chr 1chron'],
  ['2 Chroniques', '2 Chronicles', '2ch 2chr 2chron'],
  ['Esdras', 'Ezra', 'esd ezr'],
  ['Néhémie', 'Nehemiah', 'ne neh'],
  ['Esther', 'Esther', 'est esth'],
  ['Job', 'Job', 'jb'],
  ['Psaumes', 'Psalms', 'ps psa psaume psalm pss'],
  ['Proverbes', 'Proverbs', 'pr pro prov'],
  ['Ecclésiaste', 'Ecclesiastes', 'ec ecc eccl qo qoh'],
  ['Cantique des cantiques', 'Song of Solomon', 'ct cant cantique song sos ss'],
  ['Ésaïe', 'Isaiah', 'es esa is isa'],
  ['Jérémie', 'Jeremiah', 'jr jer je'],
  ['Lamentations', 'Lamentations', 'lm lam la'],
  ['Ézéchiel', 'Ezekiel', 'ez eze ezk'],
  ['Daniel', 'Daniel', 'dn dan da'],
  ['Osée', 'Hosea', 'os hos'],
  ['Joël', 'Joel', 'jl joe'],
  ['Amos', 'Amos', 'am amo'],
  ['Abdias', 'Obadiah', 'ab abd oba ob'],
  ['Jonas', 'Jonah', 'jon jnh'],
  ['Michée', 'Micah', 'mi mic mich'],
  ['Nahum', 'Nahum', 'na nah'],
  ['Habacuc', 'Habakkuk', 'ha hab hc'],
  ['Sophonie', 'Zephaniah', 'so soph zep zph'],
  ['Aggée', 'Haggai', 'ag agg hag'],
  ['Zacharie', 'Zechariah', 'za zac zec zach'],
  ['Malachie', 'Malachi', 'ml mal'],
  ['Matthieu', 'Matthew', 'mt mat matt'],
  ['Marc', 'Mark', 'mc mr mar mk'],
  ['Luc', 'Luke', 'lc lu luk lk'],
  ['Jean', 'John', 'jn jea joh'],
  ['Actes', 'Acts', 'ac act'],
  ['Romains', 'Romans', 'rm ro rom'],
  ['1 Corinthiens', '1 Corinthians', '1co 1cor'],
  ['2 Corinthiens', '2 Corinthians', '2co 2cor'],
  ['Galates', 'Galatians', 'ga gal'],
  ['Éphésiens', 'Ephesians', 'ep eph'],
  ['Philippiens', 'Philippians', 'ph php phil'],
  ['Colossiens', 'Colossians', 'col'],
  ['1 Thessaloniciens', '1 Thessalonians', '1th 1thes 1thess'],
  ['2 Thessaloniciens', '2 Thessalonians', '2th 2thes 2thess'],
  ['1 Timothée', '1 Timothy', '1ti 1tim'],
  ['2 Timothée', '2 Timothy', '2ti 2tim'],
  ['Tite', 'Titus', 'tt tit'],
  ['Philémon', 'Philemon', 'phm phlm'],
  ['Hébreux', 'Hebrews', 'he heb'],
  ['Jacques', 'James', 'jc jac jas'],
  ['1 Pierre', '1 Peter', '1p 1pi 1pe 1pet'],
  ['2 Pierre', '2 Peter', '2p 2pi 2pe 2pet'],
  ['1 Jean', '1 John', '1j 1jn 1jo 1jea 1joh'],
  ['2 Jean', '2 John', '2j 2jn 2jo 2jea 2joh'],
  ['3 Jean', '3 John', '3j 3jn 3jo 3jea 3joh'],
  ['Jude', 'Jude', 'jd jude'],
  ['Apocalypse', 'Revelation', 'ap apo apoc rev re rv'],
];

function norm(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

const EXACT = new Map();
BOOKS.forEach((b, i) => {
  [b[0], b[1], ...b[2].split(' ')].forEach(n => { const k = norm(n); if (k && !EXACT.has(k)) EXACT.set(k, i); });
});
const FULL = BOOKS.map(b => [norm(b[0]), norm(b[1])]);

function lookupBook(token) {
  const k = norm(token);
  if (!k) return -1;
  if (EXACT.has(k)) return EXACT.get(k);
  if (k.length < 3) return -1;
  const hits = [];
  FULL.forEach((n, i) => { if (n[0].startsWith(k) || n[1].startsWith(k)) hits.push(i); });
  return hits.length === 1 ? hits[0] : -1;
}

const bookName = (i, lang) => (lang === 'fr' ? BOOKS[i][0] : BOOKS[i][1]);

module.exports = { BOOKS, FULL, EXACT, norm, lookupBook, bookName };
