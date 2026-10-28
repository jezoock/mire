'use strict';
/* Mire : interface. Affichage des sections, lecteurs intégrés, navigation clavier et manette. */

// `api` est fourni par preload.js (window.api).

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);
// Les fichiers locaux passent par media:// ; les sources web sont lues directement.
const mediaUrl = (p) => (/^https?:\/\//i.test(p) ? p : `media://local/?p=${encodeURIComponent(p)}`);
const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

// Couleurs des cartons de remplacement : les barres de la mire, sauf le blanc.
const BARS = ['yellow', 'cyan', 'green', 'magenta', 'red', 'blue'];
function barFor(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return BARS[h % BARS.length];
}

// Lettre affichée quand il n'y a pas d'affiche : « E03 » pour un épisode, sinon l'initiale.
function monogram(label) {
  const ep = /S\d{1,2}\s*E(\d{1,3})/i.exec(label);
  if (ep) return `E${ep[1]}`;
  const m = /[\p{L}\p{N}]/u.exec(label || '');
  return m ? m[0].toUpperCase() : '?';
}

const parentName = (dir) => { const parts = String(dir || '').split(/[\\/]/).filter(Boolean); return parts.length >= 2 ? parts[parts.length - 2] : ''; };
const GENERIC_DIR = /^(saison|season|s\d{1,2}|disc|disque|cd|dvd|partie|part|volume|vol)\b/i;

// « Saison 1 » seul ne dit rien : on ajoute le dossier parent (le nom de la série).
function folderLabel(it) {
  const parent = GENERIC_DIR.test(it.folder || '') ? parentName(it.dir) : '';
  return parent ? { title: parent, sub: it.folder } : { title: it.folder, sub: '' };
}
const folderText = (it) => { const f = folderLabel(it); return f.sub ? `${f.title}, ${f.sub}` : f.title; };

// « 01 - One More Time » → « One More Time »
const cleanTrack = (name) => name.replace(/^(?:\d{1,2}[-.])?\d{1,3}\s*[-._)]\s*|^\d{2}\s+(?=\S)/, '') || name;

function onColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#ffffff';
  const n = Number.parseInt(m[1], 16);
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#171A18' : '#ffffff';
}
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#59625B');

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h2.2v14H6zM19 5.9v12.2a.8.8 0 0 1-1.25.66l-8.4-6.1a.8.8 0 0 1 0-1.3l8.4-6.1A.8.8 0 0 1 19 5.9z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.8 5H18v14h-2.2zM5 5.9v12.2a.8.8 0 0 0 1.25.66l8.4-6.1a.8.8 0 0 0 0-1.3l-8.4-6.1A.8.8 0 0 0 5 5.9z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>',
  external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  subs: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M7 12h3M13 12h4M7 15.5h10"/></svg>',
  volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>',
  chevU: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/></svg>',
  chevD: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M5 9l7 7 7-7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M10.3 3.2h3.4l.5 2.4c.6.2 1.2.5 1.7.9l2.3-.8 1.7 2.9-1.8 1.6c.1.6.1 1.3 0 1.9l1.8 1.6-1.7 2.9-2.3-.8c-.5.4-1.1.7-1.7.9l-.5 2.4h-3.4l-.5-2.4c-.6-.2-1.2-.5-1.7-.9l-2.3.8-1.7-2.9 1.8-1.6a6 6 0 0 1 0-1.9L3.6 8.6l1.7-2.9 2.3.8c.5-.4 1.1-.7 1.7-.9z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></svg>',
  source: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16M8 3v3M14 9v3M10 15v3"/></svg>',
  layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 12.5l8 4.3 8-4.3M4 16.5l8 4.3 8-4.3"/></svg>',
  filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3.5 5.5h17l-6.5 7.5v5l-4 2v-7z"/></svg>',
  sort: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 4v16M7 20l-3-3M7 4l3 3M13 6h8M13 12h5M13 18h3"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
  power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 3.5v7.5M7.2 6.3a7.5 7.5 0 1 0 9.6 0"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/></svg>',
  shieldOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M4 4l16 16"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5s1.2-6.1 3.6-8.5z"/></svg>',
  reload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5L20 20" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

/* ------------------------------------------------------------------ */
/* État                                                                */
/* ------------------------------------------------------------------ */

const THEMES = [
  { id: 'auto', name: 'Automatique', desc: 'Clair ou sombre, comme le système' },
  { id: 'ecran', name: 'Écran éteint', desc: 'Gris-vert sombre, le thème d’origine' },
  { id: 'jour', name: 'Plein jour', desc: 'Clair, pour les pièces lumineuses' },
  { id: 'minuit', name: 'Minuit', desc: 'Bleu nuit profond' },
  { id: 'velours', name: 'Velours', desc: 'Brun chaud de salle de cinéma' },
  { id: 'contraste', name: 'Contraste élevé', desc: 'Noir et blanc, lisible de loin' },
];

const HOME_BARS = {
  search: { c: 'white', label: 'Rechercher' },
  videos: { c: 'yellow', label: 'Vidéos' },
  music: { c: 'cyan', label: 'Musique' },
  images: { c: 'green', label: 'Images' },
  streaming: { c: 'magenta', label: 'Streaming' },
  tv: { c: 'red', label: 'Télé' },
  games: { c: 'blue', label: 'Jeux' },
};

const lightQuery = matchMedia('(prefers-color-scheme: light)');
function applyTheme() {
  const t = S.config?.ui?.theme || 'ecran';
  document.documentElement.dataset.theme = t === 'auto' ? (lightQuery.matches ? 'jour' : 'ecran') : t;
}
lightQuery.addEventListener('change', () => applyTheme());

/* ---------- Menu principal : barre latérale (gauche, droite) ou carrousel (haut, bas), rétractable ou non ---------- */

const rail = $('#rail');
const railItems = $('#rail-items');
const railHandle = $('#rail-handle');
let railCloseTimer = 0;

function menuSettings() { return S.config?.ui?.menu || { position: 'left', autohide: false }; }
const isCarousel = () => ['top', 'bottom'].includes(menuSettings().position);

function applyMenu() {
  const m = menuSettings();
  const body = document.body;
  for (const p of ['left', 'right', 'top', 'bottom']) body.classList.toggle(`menu-${p}`, m.position === p);
  body.classList.toggle('menu-auto', !!m.autohide);
  body.classList.remove('menu-open');
  updateRailArrows();
  const cur = railItems.querySelector('[aria-current="page"]');
  if (cur && isCarousel()) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  if (S.section === 'web') setTimeout(syncWeb, 300);
}

function openRail() {
  if (!menuSettings().autohide) return;
  clearTimeout(railCloseTimer);
  if (document.body.classList.contains('menu-open')) return;
  document.body.classList.add('menu-open');
  if (S.section === 'web') setTimeout(syncWeb, 260);
}
function closeRailSoon(delay = 450) {
  if (!menuSettings().autohide) return;
  clearTimeout(railCloseTimer);
  railCloseTimer = setTimeout(() => {
    if (rail.contains(document.activeElement) || rail.matches(':hover')) return;
    document.body.classList.remove('menu-open');
    if (S.section === 'web') setTimeout(syncWeb, 260);
  }, delay);
}
railHandle.addEventListener('mouseenter', openRail);
rail.addEventListener('mouseenter', openRail);
rail.addEventListener('mouseleave', () => closeRailSoon());
rail.addEventListener('focusin', (e) => {
  openRail();
  // En carrousel, l'élément sélectionné vient au centre.
  const item = e.target.closest('.rail-item, .rail-sub');
  if (item && isCarousel()) item.scrollIntoView({ block: 'nearest', inline: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});
rail.addEventListener('focusout', () => setTimeout(() => { if (!rail.contains(document.activeElement)) closeRailSoon(150); }, 0));

// Carrousel : flèches de défilement, et la molette fait défiler horizontalement.
function updateRailArrows() {
  const overflow = isCarousel() && railItems.scrollWidth > railItems.clientWidth + 4;
  rail.classList.toggle('has-overflow', overflow);
  rail.classList.toggle('at-start', railItems.scrollLeft < 4);
  rail.classList.toggle('at-end', railItems.scrollLeft + railItems.clientWidth > railItems.scrollWidth - 4);
}
railItems.addEventListener('scroll', updateRailArrows, { passive: true });
window.addEventListener('resize', updateRailArrows);
railItems.addEventListener('wheel', (e) => {
  if (!isCarousel() || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
  e.preventDefault();
  railItems.scrollBy({ left: e.deltaY });
}, { passive: false });
for (const b of $$('[data-rail-scroll]')) {
  b.addEventListener('click', () => railItems.scrollBy({ left: Number(b.dataset.railScroll) * railItems.clientWidth * 0.7, behavior: 'smooth' }));
}

const TITLES = { home: 'Accueil', search: 'Rechercher', videos: 'Vidéos', music: 'Musique', images: 'Images', streaming: 'Streaming', web: 'Streaming', tv: 'Télévision', games: 'Jeux', downloads: 'Téléchargements', settings: 'Réglages' };
const SEARCHABLE = new Set(['videos', 'music', 'images', 'tv', 'games']);
const PAGE = 120;

const S = {
  config: null,
  configPath: '',
  platform: '',
  library: [],
  videos: [],
  tracks: [],
  images: [],
  scanned: false,
  scanning: false,
  section: 'home',
  query: '',
  limit: PAGE,
  list: [],
  recent: [],
  channels: null,
  tvWeb: null,
  tvLoading: false,
  tvError: null,
  romsOf: null,
  roms: null,
  romsError: null,
  draft: null,
  pendingFocus: false,
  // Vue web intégrée
  webSessions: [],
  webActive: null,
  webStates: {},
  webFocused: false,
  webFocusOnShow: false,
  // Recherche globale
  gq: '',
  tmdb: { q: '', status: 'idle', results: [] },
  romsCache: {},
  gs: {},
  // Infos et images récupérées (clé : v:chemin, a:dossier, r:chemin, g:nom)
  scrape: {},
  scraping: null,
  // Boutique
  // Sources, modifications manuelles, genres, manette
  meta: {},
  sourceStatus: {},
  autoGames: [],
  gameSourceStatus: {},
  gameList: [],
  genre: '',
  pad: null,
  adblock: null,
  catalog: null,
  storeProgress: {},
  raPick: new Set(),
  romSites: {},
  localRoms: {},
  videoSeries: null,
  videoSeason: null,
  videoSource: '',
  searchSource: {},
  videoSort: 'title',
  videoCards: [],
  gameSystem: '',
  romsOnline: false,
  romsOnlineLoading: false,
  romsSource: '',
  downloads: [],
  dlSettings: {},
};

const viewEl = $('#view');
const titleEl = $('#title');
const searchEl = $('#search');
const headerToolsEl = $('#header-tools');
const headerToolsRightEl = $('#header-tools-right');
const clockEl = $('#clock');
const toastEl = $('#toast');

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

let toastTimer = 0;
function toast(message, { action, onAction, duration = 3800 } = {}) {
  toastEl.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="toast-btn" type="button">${esc(action)}</button>` : ''}`;
  if (action) toastEl.querySelector('button').onclick = () => { hideToast(); onAction?.(); };
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? Math.max(duration, 7000) : duration);
}
function hideToast() { toastEl.classList.remove('show'); }

/* ------------------------------------------------------------------ */
/* Historique « Reprendre »                                            */
/* ------------------------------------------------------------------ */

function getRecent() {
  try { return JSON.parse(localStorage.getItem('recent') || '[]'); } catch { return []; }
}
function setRecent(list) {
  try { localStorage.setItem('recent', JSON.stringify(list.slice(0, 18))); } catch { /* stockage plein */ }
}
function addRecent(it) {
  const keep = ['path', 'name', 'kind', 'ext', 'cover', 'fanart', 'native', 'folder', 'dir', 'remote'];
  const entry = Object.fromEntries(keep.map((k) => [k, it[k] ?? null]));
  setRecent([entry, ...getRecent().filter((x) => x.path !== it.path)]);
}
function removeRecent(p) { setRecent(getRecent().filter((x) => x.path !== p)); }

/* ------------------------------------------------------------------ */
/* Navigation entre sections                                           */
/* ------------------------------------------------------------------ */

function go(section, { focus = 'keep' } = {}) {
  const changed = section !== S.section;
  if (changed && S.section === 'web') api.webHide();
  if (changed) {
    S.genre = '';
    S.focusRef = null;
    hideBackdrop();
    S.limit = PAGE;
    S.query = '';
    searchEl.value = '';
    S.romsOf = null;
    S.draft = null;
  }
  S.section = section;
  document.body.dataset.section = section;
  const railKey = section === 'web' ? (String(S.webActive || '').startsWith('rom:') ? 'games' : 'streaming') : section;
  for (const b of $$('#rail [data-go]')) {
    if (b.dataset.go === railKey) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  renderRailSessions();
  render({ resetScroll: changed });
  updateScrapeButton();
  if (isCarousel()) railItems.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  if (section === 'search') {
    $('#gsearch')?.focus();
    ensureSearchSources();
  }
  if (focus === 'content') {
    focusFirst();
    // Vue encore en chargement (télé) : le focus ira au contenu dès qu'il arrive.
    S.pendingFocus = !viewEl.contains(document.activeElement);
  }
  if (section === 'tv' && !S.channels && !S.tvLoading) loadChannels();
}

function back() {
  if (S.section === 'games' && S.romsOf != null) { closeRoms(); return; }
  if (S.section === 'web') { go('streaming', { focus: 'content' }); return; }
  if (S.section !== 'home') {
    go('home');
    $('.mire-bar')?.focus();
  }
}

function focusSelectorOf(el) {
  if (!el || !viewEl.contains(el)) return null;
  const parts = ['action', 'index', 'go', 'id']
    .filter((k) => el.dataset[k] != null)
    .map((k) => `[data-${k}="${CSS.escape(el.dataset[k])}"]`);
  if (parts.length) return parts.join('');
  return el.id ? `#${CSS.escape(el.id)}` : null;
}

// Outils placés dans l'en-tête, à gauche de la recherche : filtres et actions propres à la section.
// Un menu de l'en-tête : une icône qui ouvre une liste de choix (filtre, tri…).
function hdrMenu(icon, label, action, items, cur, on) {
  return `<div class="hdr-menu">
    <button class="icon-btn hdr-icon focusable${on ? ' on' : ''}" data-menu="${action}" aria-label="${esc(label)}" title="${esc(label)}" aria-haspopup="true" aria-expanded="false">${icon}</button>
    <div class="hdr-pop" role="menu" hidden>${items.map(([v, l]) => `<button class="hdr-opt focusable${v === cur ? ' sel' : ''}" role="menuitemradio" aria-checked="${v === cur}" data-action="${action}" data-id="${esc(v)}">${esc(l)}</button>`).join('')}</div></div>`;
}

// Genres présents dans une liste d'éléments, pour un menu de filtre.
function genrePool(items) {
  const counts = new Map();
  for (const it of items) for (const g of genresOf(it)) counts.set(g, (counts.get(g) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])).map(([g]) => g);
  if (S.genre && !counts.has(S.genre)) top.push(S.genre);
  return top;
}

function headerTools(sec) {
  if (sec === 'tv') {
    const { services, active } = S.config.tv;
    if (services.length < 2) return '';
    return `<select class="hdr-select focusable" id="tv-service" aria-label="Service de télévision">
      ${services.map((t) => `<option value="${esc(t.id)}"${t.id === active ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
  }
  // Source de recherche : restreint la recherche de l'en-tête à une source (dossiers, un serveur, le streaming…).
  const sources = searchSourcesFor(sec);
  if (sources.length > 1) {
    const cur = S.searchSource[sec] || '';
    return `<select class="hdr-select focusable" data-search-source="${sec}" aria-label="Source de recherche" title="Chercher dans une source précise">
      <option value=""${!cur ? ' selected' : ''}>Toutes les sources</option>
      ${sources.map((x) => `<option value="${esc(x)}"${cur === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  }
  return '';
}

// Sources disponibles pour la recherche d'une section.
function searchSourcesFor(sec) {
  if (sec === 'videos') return sourcesOfList(S.videos.map(withScrape));
  if (sec === 'music') return sourcesOfList(S.tracks.map(withScrape));
  if (sec === 'images') return sourcesOfList(S.images.map(withScrape));
  if (sec === 'games' && S.romsOf == null) return sourcesOfList(allLocalGames());
  return [];
}

// Outils placés à droite de la recherche, juste avant le rouage : filtres (icône → menu), tri, téléchargement.
function headerToolsRight(sec) {
  const parts = [];
  const genreMenu = (items) => {
    const genres = genrePool(items);
    if (genres.length) parts.push(hdrMenu(ICON.filter, 'Filtrer par genre', 'genre', [['', 'Tous les genres'], ...genres.map((g) => [g, g])], S.genre, !!S.genre));
  };

  if (sec === 'videos') {
    if (S.videoSeries != null) return ''; // dans une série : pas de filtres globaux
    const vids = filterQ(bySource(S.videos.map(withScrape)), () => true);
    genreMenu(vids);
    const sources = videoSources(S.videos.map(withScrape));
    if (sources.length > 1) parts.push(hdrMenu(ICON.source, 'Filtrer par source', 'video-source', [['', 'Toutes les sources'], ...sources.map((x) => [x, x])], S.videoSource, !!S.videoSource));
    parts.push(hdrMenu(ICON.sort, 'Trier', 'video-sort', [['title', 'Titre (A→Z)'], ['year', 'Année (récent)'], ['source', 'Source']], S.videoSort, S.videoSort !== 'title'));
    return parts.join('');
  }
  if (sec === 'music') { genreMenu(S.tracks.map(withScrape)); return parts.join(''); }
  if (sec === 'images') { genreMenu(S.images.map(withScrape)); return parts.join(''); }
  if (sec === 'games') {
    const inConsole = S.romsOf != null;
    // Filtre par système (liste unifiée seulement).
    if (!inConsole) {
      const systems = gameSystems(allLocalGames());
      if (systems.length > 1) parts.push(hdrMenu(ICON.layers, 'Filtrer par système', 'game-system', [['', 'Tous les systèmes'], ...systems.map((sy) => [sy.key, `${sy.name} (${sy.count})`])], S.gameSystem, !!S.gameSystem));
    }
    // Filtre par genre.
    genreMenu(inConsole ? (S.roms || []).map((r) => withScrape({ ...r, kind: 'rom' })) : allLocalGames());
    // Téléchargement : console ouverte, système filtré, sinon jeux PC.
    let target = 'pc';
    if (inConsole) target = String(S.romsOf);
    else if (S.gameSystem && S.gameSystem.startsWith('emu:')) target = S.gameSystem.slice(4);
    parts.push(`<button class="icon-btn hdr-icon focusable" data-action="games-download" data-id="${esc(target)}" aria-label="Télécharger des jeux" title="Télécharger des jeux">${ICON.download}</button>`);
    return parts.join('');
  }
  return '';
}

// Genres présents, pour le menu déroulant de l'en-tête (console ouverte, ou liste unifiée).
function gameGenrePool(inConsole) {
  const items = inConsole ? (S.roms || []).map((r) => withScrape({ ...r, kind: 'rom' })) : allLocalGames();
  const counts = new Map();
  for (const it of items) for (const g of genresOf(it)) counts.set(g, (counts.get(g) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])).map(([g]) => g);
  if (S.genre && !counts.has(S.genre)) top.push(S.genre);
  return top;
}

function render({ resetScroll = false } = {}) {
  const active = document.activeElement;
  const hadFocus = viewEl.contains(active);
  const selector = hadFocus ? focusSelectorOf(active) : null;

  const sec = S.section;
  titleEl.textContent = sec === 'games' && S.romsOf != null ? (S.config.emulators[S.romsOf]?.name || 'Jeux') : TITLES[sec];
  searchEl.hidden = !SEARCHABLE.has(sec);
  searchEl.placeholder = sec === 'tv' ? 'Rechercher une chaîne' : 'Rechercher';
  headerToolsEl.innerHTML = headerTools(sec);
  headerToolsRightEl.innerHTML = headerToolsRight(sec);

  const views = { home: viewHome, search: viewSearch, videos: viewVideos, music: viewMusic, images: viewImages, streaming: viewStreaming, web: viewWeb, tv: viewTv, games: viewGames, downloads: viewDownloads, settings: viewSettings };
  viewEl.innerHTML = views[sec]();
  if (resetScroll) viewEl.scrollTop = 0;

  if (hadFocus) {
    const again = selector && viewEl.querySelector(selector);
    if (again) again.focus({ preventScroll: true });
    else focusFirst();
  }
  if (sec === 'home') tick();
  if (sec === 'music') markPlaying();
  if (sec === 'settings') { fillDrmStatus(); fillAdblock(); }
  if (sec === 'web') {
    requestAnimationFrame(() => {
      attachWebSlot();
      showWebInSlot(S.webFocusOnShow);
      S.webFocusOnShow = false;
    });
  }
}

/* ------------------------------------------------------------------ */
/* Briques d'affichage                                                 */
/* ------------------------------------------------------------------ */

const labelOf = (it) => it.sTitle || it.displayName || (it.kind === 'audio' ? cleanTrack(it.name) : it.name);

// Ajoute à un élément l'image, le titre officiel et l'année récupérés en ligne.
function scrapeKey(it) {
  if (it.kind === 'video') return `v:${it.path}`;
  if (it.kind === 'audio') return `a:${it.dir}`;
  if (it.kind === 'rom') return `r:${it.path}`;
  if (it.kind === 'game') return `g:${fold(it.name)}`;
  if (it.kind === 'image') return `i:${it.path}`;
  return '';
}
// Clé des modifications manuelles : un morceau se modifie seul, l'album a sa propre fiche.
const metaKey = (it, kind = it.kind) => (kind === 'track' ? `t:${it.path}` : kind === 'album' ? `a:${it.dir}` : scrapeKey(it));

// Ajoute à un élément ses infos : celles que vous avez saisies passent avant celles récupérées en ligne.
function withScrape(it) {
  const key = scrapeKey(it);
  const sc = S.scrape[key] || {};
  const um = S.meta[key] || {};
  const tm = it.kind === 'audio' ? (S.meta[`t:${it.path}`] || {}) : {};
  const out = { ...it };
  if ((it.kind === 'video' && !sc.series && sc.title) || (it.kind === 'game' && sc.title)) out.sTitle = sc.title;
  // Épisode d'une série : le titre de série vient du scrap (ou du nom déduit), pour l'arborescence.
  if (it.kind === 'video' && (sc.series || it.seriesTitle)) out.sSeries = sc.title || it.seriesTitle || '';
  if (it.kind !== 'audio' && um.title) out.sTitle = um.title;
  if (tm.title) out.sTitle = tm.title;
  out.sYear = um.year || sc.year || '';
  out.sGenre = tm.genre || um.genre || sc.genre || '';
  out.sOverview = um.overview || sc.overview || '';
  out.sArtist = um.artist || sc.artist || '';
  out.sImage = sc.image || null;
  out.uImage = um.image || null;
  out.sBackdrop = um.backdrop || it.fanart || sc.backdrop || null;
  return out;
}

const genresOf = (it) => String(it.sGenre || '').split(',').map((g) => g.trim()).filter(Boolean);

// Rangée de filtres par genre (n'apparaît que si des genres sont connus).
function genreBar(items) {
  const counts = new Map();
  for (const it of items) for (const g of genresOf(it)) counts.set(g, (counts.get(g) || 0) + 1);
  if (!counts.size) return '';
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])).slice(0, 14);
  if (S.genre && !counts.has(S.genre)) top.push([S.genre, 0]);
  const chip = (id, label, n) => `<button class="chip-g focusable" data-action="genre" data-id="${esc(id)}" aria-pressed="${S.genre === id}">${esc(label)}${n ? `<span class="chip-n">${n}</span>` : ''}</button>`;
  return `<div class="genres" role="group" aria-label="Filtrer par genre">${chip('', 'Tous les genres', 0)}${top.map(([g, n]) => chip(g, g, n)).join('')}</div>`;
}
const byGenre = (items) => (S.genre ? items.filter((it) => genresOf(it).includes(S.genre)) : items);

function art(it, ratio, extra = '') {
  const label = labelOf(it);
  const src = it.kind === 'image' ? (it.native ? it.path : null) : (it.uImage || it.cover || it.image || it.sImage || null);
  return `<span class="art ${ratio} ${extra}"><span class="art-fallback" style="--mono:var(--bar-${barFor(it.dir || label)})" aria-hidden="true">${esc(monogram(label))}</span>${src ? `<img loading="lazy" decoding="async" alt="" src="${esc(mediaUrl(src))}">` : ''}</span>`;
}

function tile(it, i, action, ratio, { sub = '', noText = false } = {}) {
  const label = labelOf(it);
  const text = noText ? '' : `<span class="tile-t">${esc(label)}</span>${sub ? `<span class="tile-s">${esc(sub)}</span>` : ''}`;
  return `<button class="tile focusable" data-action="${action}" data-index="${i}"${noText ? ` aria-label="${esc(label)}" title="${esc(label)}"` : ''}>${art(it, ratio)}${text}</button>`;
}

function filterQ(items, text) {
  const q = fold(S.query);
  if (!q) return items;
  const words = q.split(/\s+/).filter(Boolean);
  return items.filter((it) => { const h = fold(text(it)); return words.every((w) => h.includes(w)); });
}

function moreButton(total) {
  const rest = total - S.limit;
  if (rest <= 0) return '';
  return `<div class="more-wrap"><button class="btn focusable" data-action="more">Afficher ${Math.min(rest, PAGE)} de plus</button><span class="more-n">${plural(rest, 'élément restant', 'éléments restants')}</span></div>`;
}

function gridGrouped(items, tileFn, gridClass, unit) {
  const grouped = !S.query;
  const counts = new Map();
  if (grouped) for (const it of items) counts.set(it.dir, (counts.get(it.dir) || 0) + 1);
  let html = `<div class="grid ${gridClass}">`;
  let last = null;
  items.slice(0, S.limit).forEach((it, i) => {
    if (grouped && it.dir !== last) {
      last = it.dir;
      const f = folderLabel(it);
      html += `<h2 class="group-h">${esc(f.title)}${f.sub ? `<span class="group-sub">${esc(f.sub)}</span>` : ''}<span class="group-n">${plural(counts.get(it.dir), ...unit)}</span></h2>`;
    }
    html += tileFn(it, i, grouped);
  });
  return `${html}</div>${moreButton(items.length)}`;
}

function loading(text) {
  return `<div class="loading"><span class="loader bars7" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>${esc(text)}</div>`;
}

function emptyBlock(title, text, actions = '') {
  return `<div class="empty">${title ? `<h2>${esc(title)}</h2>` : ''}<p>${esc(text)}</p>${actions ? `<div class="empty-actions">${actions}</div>` : ''}</div>`;
}

const KIND_WORDS = { video: ['vidéos', 'Vos vidéos'], audio: ['musiques', 'Votre musique'], image: ['images', 'Vos images'] };
const hasSources = (kind) => S.config.library.sources.some((x) => x.kind === kind);

function libraryGate(kind) {
  // Un marque-page de streaming compte comme contenu vidéo, même sans dossier de vidéos configuré.
  if (kind === 'video' && (S.config.bookmarks || []).length) {
    if (!S.scanned) return loading('Analyse de la bibliothèque…');
    return null;
  }
  if (!hasSources(kind)) {
    return emptyBlock(
      `Aucune source de ${KIND_WORDS[kind][0]}`,
      'Ajoutez un dossier de votre disque, un partage réseau (\\\\NAS\\Films, smb://nas/films) ou l’adresse d’un serveur web. Vous pouvez en ajouter autant que vous voulez.',
      `<button class="btn btn-primary focusable" data-action="src-add-folder" data-kind="${kind}">Ajouter un dossier</button><button class="btn focusable" data-action="src-add-url" data-kind="${kind}">Ajouter une adresse</button><button class="btn btn-ghost focusable" data-action="open-file">Ouvrir un fichier</button>`,
    );
  }
  if (!S.scanned) return loading('Analyse de la bibliothèque…');
  return null;
}

function noResults(kindEmptyText) {
  if (S.query) return emptyBlock('', `Aucun résultat pour « ${S.query} ».`);
  return emptyBlock('', kindEmptyText, '<button class="btn focusable" data-action="manage-sources">Gérer les sources</button><button class="btn btn-ghost focusable" data-action="rescan">Analyser à nouveau</button>');
}

/* ------------------------------------------------------------------ */
/* Vues                                                                */
/* ------------------------------------------------------------------ */

function viewHome() {
  const c = S.config;
  const home = c.ui.home;
  const count = (k) => S.library.filter((x) => x.kind === k).length;
  const libMeta = (k, one, many) => {
    if (!hasSources(k)) return 'Aucune source';
    if (!S.scanned) return 'Analyse en cours';
    return plural(count(k), one, many);
  };
  const g = c.games.length + S.autoGames.length;
  const e = c.emulators.length;
  const meta = {
    search: 'Partout, streaming compris',
    videos: libMeta('video', 'vidéo'),
    music: libMeta('audio', 'morceau', 'morceaux'),
    images: libMeta('image', 'image'),
    streaming: plural(c.web.length, 'service'),
    tv: (c.tv.services.find((t) => t.id === c.tv.active)?.name) || 'À détecter',
    games: g || e ? `${plural(g, 'jeu', 'jeux')}, ${plural(e, 'console')}` : 'À configurer',
  };
  const bars = home.bars.filter((id) => HOME_BARS[id]);
  const mire = bars.length
    ? `<nav class="mire" aria-label="Menu principal">${bars.map((id) => `<button class="mire-bar focusable" data-action="go" data-go="${id}" style="--c:var(--bar-${HOME_BARS[id].c})"><span class="mire-label">${HOME_BARS[id].label}</span><span class="mire-meta">${esc(meta[id])}</span></button>`).join('')}</nav>`
    : '';

  const services = home.services.map((id) => c.web.find((w) => w.id === id)).filter(Boolean);
  const open = new Set(S.webSessions.map((x) => x.id));
  const servicesRow = services.length
    ? `<section class="row"><h2 class="row-h">Vos services</h2><div class="fav-grid">${services.map((w) => {
      const color = safeColor(w.color);
      return `<button class="fav focusable" data-action="open-web" data-id="${esc(w.id)}" style="--brand:${color};--on:${onColor(color)}"><span class="fav-name">${esc(w.name)}</span>${open.has(w.id) ? '<span class="fav-open">Ouvert</span>' : ''}</button>`;
    }).join('')}</div></section>`
    : '';

  S.recent = home.recent ? getRecent().map(withScrape) : [];
  const recentRow = S.recent.length
    ? `<section class="row"><h2 class="row-h">Reprendre</h2><div class="strip">${S.recent.map((it, i) => tile(it, i, 'play-recent', it.kind === 'video' ? 'r-poster' : 'r-square', { sub: folderText(it) })).join('')}</div></section>`
    : '';

  const clock = home.clock ? '<time class="home-clock" id="home-clock"></time><p class="home-date" id="home-date"></p>' : '';
  const empty = !clock && !mire && !servicesRow && !recentRow
    ? emptyBlock('Accueil vide', 'Tous les éléments de l’accueil sont masqués. Choisissez ce qui doit apparaître ici.')
    : '';

  return `<section class="home${home.clock ? '' : ' no-clock'}">
    ${clock}
    ${mire}
    ${servicesRow}
    ${recentRow}
    ${empty}
    <div class="home-foot"><button class="btn btn-ghost btn-sm focusable" data-action="personalize">Personnaliser l’accueil</button></div>
  </section>`;
}

function viewVideos() {
  const gate = libraryGate('video');
  if (gate) return gate;
  const vids = S.videos.map(withScrape);

  // Arborescence : série → saison → épisodes. On descend avec S.videoSeries puis S.videoSeason.
  const seriesKeyOf = (v) => (v.sSeries || v.seriesTitle) ? fold(v.sSeries || v.seriesTitle) : null;
  if (S.videoSeries != null) {
    const eps = vids.filter((v) => seriesKeyOf(v) === S.videoSeries);
    if (!eps.length) { S.videoSeries = null; S.videoSeason = null; }
    else return viewSeries(eps);
  }

  const items = sortVideos(byGenre(filterQ(bySearchSource('videos', bySource(vids)), (v) => `${v.name} ${v.sTitle || ''} ${v.sSeries || ''} ${folderText(v)} ${v.sGenre}`)));
  S.list = items;
  if (!items.length) return S.query ? noResults('Aucune vidéo.') : noResults('Aucune vidéo trouvée dans vos sources.');

  // Les épisodes d'une même série sont réunis en une seule tuile « série ».
  const seen = new Set();
  const cards = [];
  for (const v of items) {
    const sk = seriesKeyOf(v);
    if (sk) { if (seen.has(sk)) continue; seen.add(sk); cards.push({ series: true, key: sk, item: v, count: items.filter((x) => seriesKeyOf(x) === sk).length }); }
    else cards.push({ series: false, item: v });
  }
  S.videoCards = cards;
  const first = cards[0] ? (cards[0].series ? { kind: 'series', item: cards[0].item, count: cards[0].count } : { kind: 'video', item: cards[0].item }) : null;
  const tiles = cards.slice(0, S.limit).map((c, i) => c.series
    ? seriesTile(c, i)
    : tile(c.item, i, 'play-video', 'r-poster', { sub: [c.item.sYear, genresOf(c.item)[0]].filter(Boolean).join(', ') })).join('');
  return `<div class="focus-info" id="focus-info">${first ? focusInfoHtml(first) : ''}</div>
    <div class="grid grid-poster">${tiles}</div>${moreButton(cards.length)}`;
}

// Tuile d'une série : affiche de la série et nombre d'épisodes.
function seriesTile(c, i) {
  const it = c.item;
  const img = it.uImage || it.sImage || it.cover;
  const art = img ? `<img class="art-img" loading="lazy" src="${esc(mediaUrl(img))}" alt="">` : `<span class="art-mono">${esc(monogram(it.sSeries || it.seriesTitle || it.name))}</span>`;
  return `<button class="tile focusable" data-action="open-series" data-index="${i}">
    <span class="art r-poster">${art}<span class="tile-badge">${plural(c.count, 'épisode')}</span></span>
    <span class="tile-t">${esc(it.sSeries || it.seriesTitle || it.name)}</span><span class="tile-s">Série${it.sYear ? `, ${esc(it.sYear)}` : ''}</span></button>`;
}

// Vue d'une série : ses saisons, ou les épisodes d'une saison.
function viewSeries(eps) {
  const title = eps[0].sSeries || eps[0].seriesTitle || 'Série';
  const back = `<div class="btn-row back"><button class="btn btn-ghost focusable" data-action="back-videos">Retour aux vidéos</button></div>`;
  const seasons = [...new Set(eps.map((e) => e.season || 0))].sort((a, b) => a - b);

  if (S.videoSeason == null && seasons.length > 1) {
    // Plusieurs saisons : on les liste.
    const tiles = seasons.map((sn, i) => {
      const n = eps.filter((e) => (e.season || 0) === sn).length;
      return `<button class="tile focusable" data-action="open-season" data-index="${i}" data-season="${sn}">
        <span class="art r-poster"><span class="art-mono">${sn ? 'S' + sn : '?'}</span><span class="tile-badge">${plural(n, 'épisode')}</span></span>
        <span class="tile-t">${sn ? 'Saison ' + sn : 'Épisodes'}</span></button>`;
    }).join('');
    return `${back}<section class="games-hero" id="focus-info">${focusInfoHtml({ kind: 'series', item: eps[0], count: eps.length })}</section>
      <h2 class="sec-h">${esc(title)} <span class="count">${plural(seasons.length, 'saison')}</span></h2>
      <div class="grid grid-poster">${tiles}</div>`;
  }

  // Une seule saison, ou saison choisie : les épisodes.
  const season = S.videoSeason != null ? S.videoSeason : seasons[0];
  const list = eps.filter((e) => (e.season || 0) === (season || 0)).sort((a, b) => (a.episode || 0) - (b.episode || 0));
  S.list = list;
  const seasonBack = seasons.length > 1 ? `<button class="btn btn-ghost focusable" data-action="back-season">Retour aux saisons</button>` : '';
  const tiles = list.map((e, i) => tile(e, i, 'play-video', 'r-poster', { sub: [e.episode ? `Épisode ${e.episode}` : '', genresOf(e)[0]].filter(Boolean).join(', ') })).join('');
  return `<div class="btn-row back"><button class="btn btn-ghost focusable" data-action="back-videos">Retour aux vidéos</button>${seasonBack}</div>
    <section class="games-hero" id="focus-info">${focusInfoHtml({ kind: 'series', item: eps[0], count: eps.length })}</section>
    <h2 class="sec-h">${esc(title)}${season ? ` — Saison ${season}` : ''} <span class="count">${plural(list.length, 'épisode')}</span></h2>
    <div class="grid grid-poster">${tiles}</div>`;
}

// Source comme critère : filtre (ne garder qu'une source) et tri.
function bySource(vids) {
  if (!S.videoSource) return vids;
  return vids.filter((v) => sourceOf(v) === S.videoSource);
}
function sourceOf(v) {
  if (v.bookmark || v.downloadBookmark) return 'Streaming';
  if (v.remote) return 'En ligne';
  if (v.auto || v.manualIndex != null || v.kind === 'game') return 'Jeux PC';
  return v.dir ? sourceRoot(v) : 'Dossiers';
}
// Racine d'un chemin : le dossier ou le serveur d'où vient l'élément (pour grouper par source).
function sourceRoot(v) {
  const p = String(v.dir || v.path || '');
  if (/^https?:\/\//i.test(p)) { try { return new URL(p).hostname.replace(/^www\./, ''); } catch { return 'En ligne'; } }
  return 'Dossiers';
}
function videoSources(vids) {
  return [...new Set(vids.map(sourceOf))];
}

// Sources présentes dans une liste, pour le menu « source de recherche » de l'en-tête.
function sourcesOfList(items) {
  return [...new Set(items.map(sourceOf))];
}
// Restreint une liste à la source de recherche choisie pour la section.
function bySearchSource(sec, items) {
  const src = S.searchSource[sec];
  if (!src) return items;
  return items.filter((it) => sourceOf(it) === src);
}
function sortVideos(items) {
  const s = S.videoSort || 'title';
  const arr = [...items];
  if (s === 'title') arr.sort((a, b) => collator.compare(labelOf(a), labelOf(b)));
  else if (s === 'year') arr.sort((a, b) => (Number(b.sYear) || 0) - (Number(a.sYear) || 0));
  else if (s === 'source') arr.sort((a, b) => collator.compare(sourceOf(a), sourceOf(b)) || collator.compare(labelOf(a), labelOf(b)));
  return arr;
}

// Panneau d'infos de l'élément sélectionné (Vidéos, Images, Jeux).
function remoteRomButton(ref) {
  if (ref?.kind !== 'rom' || !ref.item?.remote) return '';
  return `<button class="btn btn-sm focusable" data-action="rom-dl" data-path="${esc(ref.item.path)}">Télécharger sur cet ordinateur</button>`;
}

// Bouton Supprimer pour un jeu présent sur l'ordinateur (jeu PC manuel ou fichier de console local).
function deleteRomButton(ref) {
  const it = ref?.item;
  if (!it) return '';
  if (ref.kind === 'rom' && it.remote) return '';
  if (ref.kind === 'game' && it.auto) return ''; // trouvé dans un dossier : se retire via le dossier
  const payload = { kind: ref.kind, path: it.path, label: labelOf(it), manualIndex: it.manualIndex, emuIndex: it.emuIndex != null ? it.emuIndex : (ref.kind === 'rom' ? S.romsOf : undefined) };
  return `<button class="btn btn-ghost btn-sm focusable danger" data-action="game-delete" data-ref="${esc(JSON.stringify(payload))}">Supprimer</button>`;
}

function focusInfoHtml(ref) {
  if (ref?.kind === 'console') {
    const e = S.config.emulators[ref.index];
    if (!e) return '';
    const n = ref.count != null ? ref.count : (S.romsCache[ref.index] || []).length;
    const line = [e.system, n ? plural(n, 'jeu', 'jeux') : ''].filter(Boolean).join(', ');
    return `<div class="fi-text"><h2 class="fi-title">${esc(e.name)}</h2><p class="fi-line">${esc(line)}</p></div>
      <button class="btn btn-ghost btn-sm focusable" data-action="edit-console" data-index="${ref.index}">Modifier la console</button>`;
  }
  if (ref?.kind === 'gamebm') {
    const it = ref.item;
    const line = ['En attente de téléchargement', it.sYear, it.systemName].filter(Boolean).join(', ');
    return `<div class="fi-text"><h2 class="fi-title">${esc(it.sTitle || it.name)}</h2><p class="fi-line">${esc(line)}</p>${it.sOverview ? `<p class="fi-overview">${esc(it.sOverview)}</p>` : ''}</div>
      <div class="fi-actions"><button class="btn btn-primary btn-sm focusable" data-action="gamebm-download" data-id="${esc(it.bookmarkId)}">Télécharger</button><button class="btn btn-ghost btn-sm focusable danger" data-action="gamebm-remove" data-id="${esc(it.bookmarkId)}">Retirer</button></div>`;
  }
  if (ref?.kind === 'series') {
    const it = ref.item;
    const title = it.sSeries || it.seriesTitle || it.name;
    const img = it.uImage || it.sImage || it.cover;
    const line = ['Série', it.sYear, it.sGenre, ref.count ? plural(ref.count, 'épisode') : ''].filter(Boolean).join(', ');
    return `<div class="fi-text"><h2 class="fi-title">${esc(title)}</h2><p class="fi-line">${esc(line)}</p>${it.sOverview ? `<p class="fi-overview">${esc(it.sOverview)}</p>` : ''}</div>
      <div class="fi-actions"><button class="btn btn-ghost btn-sm focusable" data-action="edit-focused">Modifier</button></div>`;
  }
  const it = ref?.item;
  if (!it) return '';
  const title = labelOf(it);
  const emuName = ref.kind === 'rom' ? (S.config.emulators[it.emuIndex != null ? it.emuIndex : S.romsOf]?.name || '') : '';
  const place = ref.kind === 'rom' ? `${emuName}${it.remote ? ', disponible en ligne' : ''}` : ref.kind === 'game' ? (it.auto ? 'Jeu PC trouvé dans vos dossiers' : 'Jeu PC') : folderText(it);
  const line = [it.sYear, it.sGenre, place].filter(Boolean).join(', ');
  let overview = it.sOverview;
  if (!overview && ref.kind === 'video') overview = S.config.search.tmdbToken ? 'Pas encore d’infos pour cette vidéo. Le rouage en haut à droite permet de les récupérer en ligne.' : 'Ajoutez une clé TMDB (rouage en haut à droite, ou Réglages) pour récupérer les affiches, genres et résumés.';
  return `<div class="fi-text"><h2 class="fi-title">${esc(title)}</h2><p class="fi-line">${esc(line)}</p>${overview ? `<p class="fi-overview">${esc(overview)}</p>` : ''}</div>
    <div class="fi-actions">${remoteRomButton(ref)}<button class="btn btn-ghost btn-sm focusable" data-action="edit-focused">Modifier</button>${deleteRomButton(ref)}</div>`;
}
function updateFocusInfo(el) {
  const box = $('#focus-info');
  const ref = el && refFromEl(el);
  if (!box || !ref || (!ref.item && ref.kind !== 'console')) return;
  const k = ref.kind === 'console' ? `c:${ref.index}` : metaKey(ref.item, ref.kind);
  if (box.dataset.key !== k) { box.dataset.key = k; box.innerHTML = focusInfoHtml(ref); S.focusRef = ref; }
}

// Retrouve l'élément (vidéo, morceau, jeu…) représenté par une vignette ou une ligne.
function refFromEl(el) {
  const t = el?.closest?.('[data-action]');
  if (!t) return null;
  const i = Number(t.dataset.index);
  switch (t.dataset.action) {
    case 'play-video': return { kind: 'video', item: S.list[i] };
    case 'open-series': { const c = S.videoCards[i]; return c ? { kind: 'series', item: c.item, count: c.count } : null; }
    case 'gs-video': return { kind: 'video', item: S.gs.videos?.[i] };
    case 'play-track': return { kind: 'track', item: S.list[i] };
    case 'gs-track': return { kind: 'track', item: S.gs.tracks?.[i] };
    case 'play-album': return { kind: 'album', item: S.list[i] };
    case 'show-image': return { kind: 'image', item: S.list[i] };
    case 'gs-image': return { kind: 'image', item: S.gs.images?.[i] };
    case 'launch-rom': return { kind: 'rom', item: S.list[i], emu: S.romsOf };
    case 'launch-rom-u': { const it = S.list[i]; return it ? { kind: 'rom', item: it, emu: it.emuIndex } : null; }
    case 'gs-rom': return { kind: 'rom', item: S.gs.roms?.[i], emu: S.gs.roms?.[i]?.emu };
    case 'launch-game': return { kind: 'game', item: S.gameList[i] };
    case 'gamebm': { const it = S.gameList[i]; return it ? { kind: 'gamebm', item: it } : null; }
    case 'gs-game': return { kind: 'game', item: S.gs.games?.[i] };
    case 'open-emu': return { kind: 'console', index: i };
    case 'play-recent': {
      const it = S.recent[i];
      return it ? { kind: it.kind === 'audio' ? 'track' : it.kind, item: it } : null;
    }
    default: return null;
  }
}

function viewMusic() {
  const gate = libraryGate('audio');
  if (gate) return gate;
  const all = filterQ(bySearchSource('music', S.tracks.map(withScrape)), (t) => `${t.name} ${t.sTitle || ''} ${folderText(t)} ${t.sGenre} ${t.sArtist}`);
  const items = byGenre(all);
  S.list = items;
  if (!all.length) return noResults('Aucune musique trouvée dans vos sources.');
  if (!items.length) return emptyBlock('', 'Aucun morceau de ce genre.');

  const grouped = !S.query;
  const shown = items.slice(0, S.limit);
  let html = '';
  if (grouped) {
    const counts = new Map();
    for (const t of items) counts.set(t.dir, (counts.get(t.dir) || 0) + 1);
    let last = null;
    let n = 0;
    shown.forEach((t, i) => {
      if (t.dir !== last) {
        if (last !== null) html += '</div>';
        last = t.dir;
        n = 0;
        const m = /^(.+?)\s+-\s+(.+)$/.exec(t.folder);
        const sc = S.scrape[`a:${t.dir}`] || {};
        const um = S.meta[`a:${t.dir}`] || {};
        const albumName = um.title || (m ? m[2] : (sc.title || folderLabel(t).title));
        const artist = um.artist || (m ? m[1] : (sc.artist || folderLabel(t).sub));
        const details = [artist, um.year || sc.year, um.genre || sc.genre, plural(counts.get(t.dir), 'morceau', 'morceaux')].filter(Boolean).join(', ');
        html += `<div class="album">
          ${art({ ...t, kind: 'audio', name: albumName, sImage: sc.image || null, uImage: um.image || null }, 'album-cover')}
          <div><h2 class="album-name">${esc(albumName)}</h2><p class="album-n">${esc(details)}</p></div>
          <div class="album-actions"><button class="btn focusable" data-action="play-album" data-index="${i}">Lire l’album</button><button class="btn btn-ghost focusable" data-action="edit-album" data-index="${i}">Modifier</button></div>
        </div><div class="tracks">`;
      }
      n += 1;
      html += `<button class="track focusable" data-action="play-track" data-index="${i}"><span class="tk-n">${n}</span><span class="tk-t">${esc(labelOf(t))}</span><span class="tk-e">${esc(t.remote ? 'web' : t.ext.slice(1))}</span></button>`;
    });
    html += '</div>';
  } else {
    html = `<div class="tracks">${shown.map((t, i) => `<button class="track flat focusable" data-action="play-track" data-index="${i}"><span class="tk-t">${esc(labelOf(t))}</span><span class="tk-f">${esc(folderText(t))}</span><span class="tk-e">${esc(t.remote ? 'web' : t.ext.slice(1))}</span></button>`).join('')}</div>`;
  }
  return html + moreButton(items.length);
}

function viewImages() {
  const gate = libraryGate('image');
  if (gate) return gate;
  const all = filterQ(bySearchSource('images', S.images.map(withScrape)), (v) => `${v.name} ${v.sTitle || ''} ${v.folder} ${v.sGenre}`);
  const items = byGenre(all);
  S.list = items;
  if (!all.length) return noResults('Aucune image trouvée dans vos sources.');
  return `<div class="focus-info" id="focus-info">${focusInfoHtml({ kind: 'image', item: items[0] })}</div>`
    + (items.length ? gridGrouped(items, (it, i) => tile(it, i, 'show-image', 'r-square', { noText: true }), 'grid-square', ['image']) : emptyBlock('', 'Aucune image de ce genre.'));
}

function viewStreaming() {
  const web = S.config.web;
  if (!web.length) {
    return emptyBlock('Aucun service', 'Ajoutez des sites dans Réglages, section « Sites, jeux et consoles ».', '<button class="btn focusable" data-action="go" data-go="settings">Ouvrir les réglages</button>');
  }
  const open = new Set(S.webSessions.map((x) => x.id));
  const svcTile = (w) => {
    const color = safeColor(w.color);
    const how = open.has(w.id) ? 'Ouvert, reprendre où vous en étiez' : w.mode === 'browser' ? 'S’ouvre dans le navigateur' : 'S’ouvre dans Mire';
    return `<button class="svc focusable${open.has(w.id) ? ' is-open' : ''}" data-action="open-web" data-id="${esc(w.id)}" style="--brand:${color};--on:${onColor(color)}"><span class="svc-name">${esc(w.name)}</span><span class="svc-how">${how}</span></button>`;
  };
  const groups = [
    ['Films et séries', web.filter((w) => w.group === 'video')],
    ['Musique', web.filter((w) => w.group === 'music')],
    ['Autres sites', web.filter((w) => w.group !== 'video' && w.group !== 'music')],
  ].filter(([, list]) => list.length);
  const body = groups.map(([title, list]) => `<h2 class="sec-h">${title}</h2><div class="svc-grid">${list.map(svcTile).join('')}</div>`).join('');
  return `${body}
  <p class="hint">Les sites s’ouvrent dans Mire et gardent vos connexions d’une fois sur l’autre. En haut de la page : retour, rechargement, plein écran et fermeture. Au clavier : <kbd>F11</kbd> plein écran, <kbd>F9</kbd> revenir aux menus de Mire, <kbd>Alt</kbd>+<kbd>←</kbd> page précédente, <kbd>Ctrl</kbd>+<kbd>W</kbd> fermer le site.</p>`;
}

function viewTv() {
  const active = S.config.tv.services.find((t) => t.id === S.config.tv.active);
  if (!S.config.tv.active) {
    return emptyBlock('Choisissez votre service de télévision', 'Mire n’a pas reconnu votre box automatiquement. Choisissez votre fournisseur ci-dessus (ou dans le rouage de la page).', '<button class="btn focusable" data-action="tv-detect">Détecter ma box</button>');
  }
  // Service par portail web (SFR, Bouygues, Molotov…) : on l'ouvre dans la vue intégrée.
  if (active?.kind === 'web' && S.tvWeb) return emptyBlock(active.name, 'Ce service s’ouvre dans la vue intégrée de Mire.', `<button class="btn btn-primary focusable" data-action="tv-open-web">Ouvrir ${esc(active.name)}</button>`);
  if (S.tvLoading || (!S.channels && !S.tvError)) return loading('Chargement des chaînes…');
  if (S.tvError) {
    return emptyBlock('Télévision indisponible', S.tvError,
      '<button class="btn btn-primary focusable" data-action="tv-reload">Réessayer</button>');
  }
  const items = filterQ(S.channels, (c) => `${c.number ?? ''} ${c.name} ${c.group}`);
  S.list = items;
  if (!items.length) return emptyBlock('', `Aucune chaîne ne correspond à « ${S.query} ».`);
  const tiles = items.slice(0, S.limit).map((c, i) => {
    const variants = c.variants.map((v) => v.label).filter(Boolean).join(', ');
    const lead = c.number != null ? `<span class="ch-num">${c.number}</span>` : c.logo ? `<img class="ch-logo" alt="" src="${esc(c.logo)}">` : '';
    return `<button class="ch focusable" data-action="play-channel" data-index="${i}">${lead}<span class="ch-txt"><span class="ch-name">${esc(c.name)}</span>${variants ? `<span class="ch-var">${esc(variants)}</span>` : ''}</span></button>`;
  }).join('');
  return `<div class="ch-grid">${tiles}</div>${moreButton(items.length)}
  <p class="hint">Les chaînes s’ouvrent dans le lecteur externe (mpv ou VLC). Certaines chaînes ne sont diffusées que sur le décodeur et ne se lancent pas sur ordinateur.</p>`;
}

function viewGames() {
  if (S.romsOf != null) return viewRoms();
  const c = S.config;
  // Une seule liste : jeux PC + jeux de console présents sur l'ordinateur. Filtrable par système.
  const all = allLocalGames();
  const bySystem = S.gameSystem ? all.filter((g) => g.systemKey === S.gameSystem) : all;
  const shown = filterQ(bySearchSource('games', bySystem), (g) => `${g.name} ${g.displayName || ''} ${g.sTitle || ''} ${g.sGenre}`);
  const list = byGenre(shown);
  S.gameList = list;
  S.list = list;
  const first = list[0] ? refOfGame(list[0], 0) : null;

  const tiles = list.slice(0, S.limit).map((g, i) => {
    if (g.kind === 'gamebm') return gameBmTile(g, i);
    return tile(g, i, g.kind === 'rom' ? 'launch-rom-u' : 'launch-game', 'r-game', { sub: gameSub(g) });
  }).join('');
  const grid = tiles ? `<div class="grid grid-game">${tiles}</div>` : emptyBlock('', `Aucun jeu ne correspond à « ${S.query} ».`);

  const emptyAll = !all.length;
  const hint = emptyAll
    ? emptyBlock('Aucun jeu pour l’instant', 'Ajoutez un jeu PC, un dossier de jeux PC ou une console (avec ses jeux) dans les réglages de cette page (rouage en haut à droite). Les consoles ouvrent aussi « Ajouter des jeux » pour en télécharger.', '<button class="btn btn-primary focusable" data-action="open-store">Ouvrir la Boutique</button>')
    : '';

  return `<section class="games-hero" id="focus-info">${first ? focusInfoHtml(first) : ''}</section>
    ${emptyAll ? hint : grid}
    ${emptyAll ? '' : moreButton(list.length)}`;
}

// Jeux de console présents sur l'ordinateur, pour la liste unifiée. Chargé en tâche de fond.
async function loadLocalRoms() {
  for (const [i] of S.config.emulators.entries()) {
    try { const r = await api.listRoms(i); if (r?.ok) S.localRoms[i] = r.roms; } catch { /* console ignorée */ }
  }
  if (S.section === 'games' && S.romsOf == null) render();
}

function gameBmTile(g, i) {
  const img = g.uImage || g.sImage;
  const art = img ? `<img class="art-img" loading="lazy" src="${esc(mediaUrl(img))}" alt="">` : `<span class="art-mono">${esc(monogram(g.sTitle || g.name))}</span>`;
  return `<button class="tile focusable" data-action="gamebm" data-index="${i}" title="En attente de téléchargement — appuyez pour télécharger">
    <span class="art r-game">${art}<span class="tile-badge dl">${ICON.download} À télécharger</span></span>
    <span class="tile-t">${esc(g.sTitle || g.name)}</span><span class="tile-s">${esc([g.sYear, g.systemName].filter(Boolean).join(', '))}</span></button>`;
}

const gameSub = (g) => (g.kind === 'rom' ? [g.sYear, g.systemName].filter(Boolean).join(', ') : [g.sYear, genresOf(g)[0]].filter(Boolean).join(', '));
const refOfGame = (g, i) => (g.kind === 'rom' ? { kind: 'rom', item: g, emu: g.emuIndex } : g.kind === 'gamebm' ? { kind: 'gamebm', item: g } : { kind: 'game', item: g });

// Jeux PC (manuels + trouvés dans les dossiers) et jeux de console présents en local, dans une seule liste.
function allLocalGames() {
  const pc = pcGameEntries().map((g) => ({ ...g, systemKey: 'pc', systemName: 'Jeux PC' }));
  const roms = [];
  for (const [i, emu] of S.config.emulators.entries()) {
    for (const r of (S.localRoms[i] || [])) roms.push(withScrape({ ...r, kind: 'rom', emuIndex: i, systemKey: `emu:${i}`, systemName: emu.name }));
  }
  // Marque-pages de jeux en attente de téléchargement : des cartes avec un bouton Télécharger.
  const pending = (S.config.gameBookmarks || []).filter((b) => !b.done).map((b) => {
    const emuIndex = typeof b.console === 'number' ? b.console : null;
    const systemKey = b.console === 'pc' ? 'pc' : emuIndex != null ? `emu:${emuIndex}` : 'pending';
    const systemName = b.console === 'pc' ? 'Jeux PC' : emuIndex != null ? (S.config.emulators[emuIndex]?.name || 'Console') : 'À télécharger';
    return withScrape({ kind: 'gamebm', name: b.title, path: `gbm:${b.id}`, bookmarkId: b.id, dlSource: b.source, systemKey, systemName, pending: true });
  });
  return [...pc, ...roms, ...pending].sort((a, b) => collator.compare(labelOf(a), labelOf(b)));
}

// Jeux PC seuls (ajoutés à la main, puis trouvés dans les dossiers).
function pcGameEntries() {
  const manual = S.config.games.map((g, i) => ({ name: g.name, path: g.path, image: g.image || null, args: g.args, manualIndex: i, dir: g.path, kind: 'game' }));
  const known = new Set(manual.map((g) => g.path));
  const auto = S.autoGames.filter((g) => !known.has(g.path)).map((g) => ({ ...g, image: null, dir: g.path, kind: 'game', auto: true }));
  return [...manual, ...auto].map(withScrape).sort((a, b) => collator.compare(labelOf(a), labelOf(b)));
}
const gameEntries = pcGameEntries; // compatibilité (recherche globale, éditeur)

// Systèmes présents dans la liste (pour le filtre), jeux PC d'abord puis les consoles.
function gameSystems(all) {
  const out = [];
  const pc = all.filter((g) => g.systemKey === 'pc').length;
  if (pc) out.push({ key: 'pc', name: 'Jeux PC', count: pc });
  for (const [i, emu] of S.config.emulators.entries()) {
    const n = all.filter((g) => g.systemKey === `emu:${i}`).length;
    out.push({ key: `emu:${i}`, name: emu.name, count: n, emuIndex: i });
  }
  return out;
}

function viewRoms() {
  const emu = S.config.emulators[S.romsOf];
  const sites = S.romSites[S.romsOf] || [];
  const locations = emu ? [emu.romsDir, ...(emu.sources || [])].filter(Boolean) : [];
  const remoteLocs = locations.filter((l) => /^https?:\/\//i.test(l));
  const backBtn = `<div class="btn-row back">
    <button class="btn btn-ghost focusable" data-action="back-games">Retour aux jeux</button>
    <button class="btn btn-ghost focusable" data-action="edit-console" data-index="${S.romsOf}">Modifier la console</button>
    <button class="btn btn-primary focusable" data-action="rom-sites" data-index="${S.romsOf}">Ajouter des jeux</button></div>`;
  const siteSearch = S.query && sites.length ? `<div class="site-search"><span>Chercher « ${esc(S.query)} » sur</span>${sites.map((x, n) => `<button class="btn btn-sm focusable" data-action="rom-site-search" data-index="${S.romsOf}" data-id="${n}">${esc(x.name)}</button>`).join('')}</div>` : '';
  if (S.romsError) return backBtn + emptyBlock('Jeux introuvables', S.romsError, '<button class="btn focusable" data-action="edit-console" data-index="' + S.romsOf + '">Modifier la console</button>');
  if (!S.roms) return backBtn + loading('Recherche des jeux…');

  const all = filterQ(S.roms.map((r) => withScrape({ ...r, kind: 'rom', emuIndex: S.romsOf })), (r) => `${r.displayName} ${r.sTitle || ''} ${r.sGenre}`);
  const items = byGenre(all);
  const fileOf = (r) => decodeURIComponent(String(r.path).split(/[\\/]/).pop().split('?')[0]).toLowerCase();
  const localNames = new Set(items.filter((r) => !r.remote).map(fileOf));
  const local = items.filter((r) => !r.remote);
  const online = items.filter((r) => r.remote && !localNames.has(fileOf(r)));
  const shownLocal = local.slice(0, S.limit);
  const shownOnline = online.slice(0, S.limit);
  S.list = [...shownLocal, ...shownOnline];

  const localTiles = shownLocal.map((r, i) => tile(r, i, 'launch-rom', 'r-game', { sub: [r.sYear, genresOf(r)[0]].filter(Boolean).join(', ') })).join('');
  const onlineTiles = shownOnline.map((r, i) => tile(r, shownLocal.length + i, 'launch-rom', 'r-game', { sub: [r.sYear, genresOf(r)[0]].filter(Boolean).join(', ') || 'En ligne' })).join('');
  const localBlock = `<h2 class="sec-h">Sur cet ordinateur <span class="count">${local.length}</span></h2>${local.length ? `<div class="grid grid-game">${localTiles}</div>` : `<p class="hint">Aucun jeu dans le dossier de la console pour l’instant.${remoteLocs.length ? ' Activez la liste en ligne ci-dessous, ou « Ajouter des jeux ».' : ' « Ajouter des jeux » ouvre des sites où en télécharger.'}</p>`}`;

  // Jeux en ligne : listés seulement sur demande (une ou plusieurs sources distantes).
  let onlineBlock = '';
  if (remoteLocs.length) {
    if (!S.romsOnline) {
      onlineBlock = `<div class="sec-h-row"><h2 class="sec-h">Disponibles en ligne</h2><button class="btn btn-sm btn-primary focusable" data-action="rom-online" data-index="${S.romsOf}">Afficher les jeux en ligne</button></div>
        <p class="hint">${plural(remoteLocs.length, 'source en ligne', 'sources en ligne')} pour cette console. L’affichage peut prendre un moment selon la source.</p>`;
    } else if (S.romsOnlineLoading) {
      onlineBlock = `<h2 class="sec-h">Disponibles en ligne</h2>${loading('Lecture de la source en ligne…')}`;
    } else {
      const picker = remoteLocs.length > 1 ? `<select class="input src-pick focusable" data-action="rom-source" aria-label="Source en ligne">
          <option value=""${!S.romsSource ? ' selected' : ''}>Toutes les sources</option>
          ${remoteLocs.map((l) => `<option value="${esc(l)}"${S.romsSource === l ? ' selected' : ''}>${esc(sourceLabel(l))}</option>`).join('')}</select>` : '';
      onlineBlock = `<div class="sec-h-row"><h2 class="sec-h">Disponibles en ligne <span class="count">${online.length}</span></h2>
          <div class="sec-tools">${picker}${online.length ? '<button class="btn btn-sm focusable" data-action="rom-dl-all">Tout télécharger</button>' : ''}</div></div>
        <p class="hint">Un appui lance le jeu (gardé en cache) ; « Télécharger sur cet ordinateur » en fait une copie dans le dossier de la console.</p>
        ${online.length ? `<div class="grid grid-game online">${onlineTiles}</div>` : '<p class="hint">Aucun jeu en ligne trouvé pour cette source.</p>'}`;
    }
  }
  const warn = S.romsWarnings?.length ? `<p class="hint warn">${esc(S.romsWarnings.join(' '))}</p>` : '';
  return `${backBtn}${warn}${siteSearch}<section class="games-hero" id="focus-info">${focusInfoHtml({ kind: 'console', index: S.romsOf, count: local.length })}</section>${localBlock}${onlineBlock}${moreButton(Math.max(local.length, online.length))}`;
}

const sourceLabel = (l) => { try { return new URL(l).hostname.replace(/^www\./, ''); } catch { return l; } };

/* ---------- Téléchargements ---------- */

const DL_ACTIVE = new Set(['waiting', 'downloading', 'extracting']);
const DL_STATE = { pending: 'En attente de téléchargement', waiting: 'En attente', downloading: 'En cours', paused: 'En pause', extracting: 'Décompression', done: 'Terminé', error: 'Erreur', cancelled: 'Annulé', interrupted: 'Interrompu', external: 'Confié au logiciel de torrent' };
const fmtBytes = (n) => {
  if (!n) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const k = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** k).toLocaleString('fr-FR', { maximumFractionDigits: k > 1 ? 1 : 0 })} ${u[k]}`;
};
const fmtEta = (ms) => {
  if (!ms || !Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  return m < 1 ? 'moins d’une minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

function dlMeta(d) {
  const parts = [DL_STATE[d.state] || d.state];
  if (d.total) parts.push(d.state === 'done' ? fmtBytes(d.total) : `${fmtBytes(d.received || 0)} sur ${fmtBytes(d.total)}`);
  else if (d.received) parts.push(fmtBytes(d.received));
  if (d.state === 'downloading' && d.speed) parts.push(`${fmtBytes(d.speed)}/s`);
  if (d.kind === 'torrent' && DL_ACTIVE.has(d.state)) parts.push(plural(d.peers || 0, 'pair', 'pairs'));
  if (d.state === 'downloading' && d.eta) parts.push(`reste ${fmtEta(d.eta)}`);
  parts.push(d.consoleName ? `vers ${d.consoleName}` : d.dir ? 'vers Téléchargements' : '');
  if (d.group) parts.push(`fait partie de « ${d.group} »`);
  if (d.companions) parts.push(`${plural(d.companions, 'fichier du jeu ajouté', 'fichiers du jeu ajoutés')}`);
  if (d.extracted) parts.push('archive décompressée');
  return parts.filter(Boolean).join(' · ');
}

function dlRow(d) {
  const pct = d.total ? Math.min(100, Math.round(((d.received || 0) / d.total) * 100)) : d.state === 'done' ? 100 : 0;
  const b = (action, label, extra = '') => `<button class="btn btn-sm focusable" data-action="${action}" data-id="${esc(d.id)}"${extra}>${label}</button>`;
  const actions = [];
  if (DL_ACTIVE.has(d.state) && d.state !== 'extracting') actions.push(b('dl-pause', 'Pause'), b('dl-cancel', 'Annuler'));
  if (d.state === 'paused') actions.push(b('dl-resume', 'Reprendre'), b('dl-cancel', 'Annuler'));
  if (['error', 'interrupted', 'cancelled'].includes(d.state)) actions.push(b('dl-resume', 'Réessayer'), b('dl-remove', 'Retirer'));
  if (d.state === 'done') {
    for (const f of (d.installers || []).slice(0, 2)) actions.push(`<button class="btn btn-sm btn-primary focusable" data-action="dl-install" data-id="${esc(d.id)}" data-file="${esc(f)}" title="${esc(f)}">Lancer ${esc(f.split(/[\\/]/).pop())}</button>`);
    actions.push(b('dl-reveal', 'Ouvrir le dossier'), b('dl-remove', 'Retirer'));
  }
  if (d.state === 'pending') actions.push(`<button class="btn btn-sm btn-primary focusable" data-action="dl-start" data-id="${esc(d.id)}">Télécharger</button>`, b('dl-remove', 'Retirer'));
  if (d.state === 'external') actions.push(b('dl-remove', 'Retirer'));
  return `<div class="dl-row is-${esc(d.state)}" id="dl-${esc(d.id)}" data-state="${esc(d.state)}">
    <span class="dl-kind">${d.kind === 'torrent' ? 'Torrent' : 'HTTP'}</span>
    <div class="dl-main">
      <div class="dl-name" title="${esc(d.name || '')}">${esc(d.name || 'Téléchargement')}</div>
      <div class="dl-meta" id="dl-${esc(d.id)}-meta">${esc(dlMeta(d))}</div>
      ${d.error ? `<div class="dl-error">${esc(d.error)}</div>` : ''}
      ${d.state !== 'external' ? `<div class="dl-bar"><i id="dl-${esc(d.id)}-bar" style="width:${pct}%"></i></div>` : ''}
    </div>
    <div class="dl-actions">${actions.join('')}</div>
  </div>`;
}

function viewDownloads() {
  const list = S.downloads;
  const running = list.filter((d) => DL_ACTIVE.has(d.state) || d.state === 'paused' || d.state === 'pending');
  const others = list.filter((d) => !running.includes(d));
  const dests = [['', 'Dossier des téléchargements'], ...S.config.emulators.map((e, i) => [String(i), `Console : ${e.name}`])];
  const client = S.dlSettings.torrentClient === 'system' ? 'confiés à votre logiciel de torrent' : 'téléchargés par le client intégré de Mire';
  return `<section class="dl-add">
      <div class="field-row"><input class="input focusable" id="dl-url" placeholder="Coller un lien : https://… ou magnet:?…" aria-label="Lien à télécharger">
      <select class="input focusable dl-dest" id="dl-dest" aria-label="Destination">${dests.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      <button class="btn btn-primary focusable" data-action="dl-add">Télécharger</button></div>
      <div class="btn-row"><button class="btn btn-sm focusable" data-action="dl-torrent">Ouvrir un fichier .torrent</button></div>
      <p class="hint">Les liens magnet et fichiers .torrent sont ${client} (réglable avec le rouage). Les téléchargements des sites ouverts dans Mire arrivent ici aussi ; depuis « Ajouter des jeux », ils vont dans le dossier de la console.</p>
    </section>
    <h2 class="sec-h">En cours <span class="count">${running.length}</span></h2>
    ${running.length ? `<div class="dl-list">${running.map(dlRow).join('')}</div>` : '<p class="hint">Aucun téléchargement en cours.</p>'}
    <div class="sec-h-row"><h2 class="sec-h">Terminés et autres <span class="count">${others.length}</span></h2>${others.length ? '<button class="btn btn-sm btn-ghost focusable" data-action="dl-clear">Vider la liste</button>' : ''}</div>
    ${others.length ? `<div class="dl-list">${others.map(dlRow).join('')}</div>` : '<p class="hint">Rien pour l’instant.</p>'}`;
}

function updateDlBadge() {
  const n = S.downloads.filter((d) => DL_ACTIVE.has(d.state)).length;
  const badge = $('#dl-badge');
  if (badge) { badge.hidden = !n; badge.textContent = String(n); }
}

async function loadDownloads() {
  const r = await api.downloadsList();
  S.downloads = r?.items || [];
  S.dlSettings = r?.settings || {};
  updateDlBadge();
}

let dlRenderTimer = 0;
api.onDownload((d) => {
  const i = S.downloads.findIndex((x) => x.id === d.id);
  if (d.removed) { if (i >= 0) S.downloads.splice(i, 1); }
  else if (i >= 0) S.downloads[i] = d;
  else S.downloads.unshift(d);
  updateDlBadge();
  if (S.section !== 'downloads') return;
  // Même état : seules la barre et la ligne d'infos changent. Sinon la page est redessinée.
  const row = $(`#dl-${CSS.escape(d.id)}`);
  if (row && !d.removed && row.dataset.state === d.state) {
    const pct = d.total ? Math.min(100, Math.round(((d.received || 0) / d.total) * 100)) : 0;
    const bar = $(`#dl-${CSS.escape(d.id)}-bar`);
    if (bar) bar.style.width = `${pct}%`;
    const meta = $(`#dl-${CSS.escape(d.id)}-meta`);
    if (meta) meta.textContent = dlMeta(d);
    return;
  }
  clearTimeout(dlRenderTimer);
  dlRenderTimer = setTimeout(() => render(), 80);
});
api.onTvDetected(({ name }) => {
  if (name) toast(`Service de télévision détecté : ${name}.`, { duration: 5000 });
  api.getConfig().then((r) => { S.config = r.config; if (S.section === 'tv') { S.channels = null; S.tvWeb = null; loadChannels(); } });
});
api.onDownloadAdded((r) => {
  if (!r.ok) toast(r.error || 'Ce téléchargement n’a pas pu démarrer.', { duration: 8000 });
  else toast(r.external ? 'Lien confié à votre logiciel de torrent.' : 'Téléchargement ajouté : suivez-le dans Téléchargements.', { duration: 4000 });
});
// Fin d'un torrent qui contient un programme d'installation : on propose de le lancer.
api.onDownloadFinished(async (d) => {
  // Un jeu bookmarké vient d'être téléchargé : on recharge config (sa carte « à télécharger » disparaît) et les jeux.
  if (d.gameBookmark) { S.config = (await api.getConfig()).config; if (d.console != null) { const r = await api.listRoms(d.console).catch(() => null); if (r?.ok) S.localRoms[d.console] = r.roms; } if (S.section === 'games') render(); }
  if (d.console == null) toast(`${d.name} est téléchargé.`, { duration: 5000 });
  const installer = (d.installers || [])[0];
  if (d.kind !== 'torrent' || !installer) return;
  if (topDialog()) { toast(`${d.name} contient un programme d’installation : lancez-le depuis Téléchargements.`, { duration: 8000 }); return; }
  const res = await openForm({
    title: 'Téléchargement terminé',
    help: `« ${d.name} » contient un programme d’installation : ${installer.split(/[\\/]/).pop()}. Voulez-vous le lancer maintenant ?`,
    fields: [],
    actions: [{ id: 'run', label: 'Lancer l’installation', kind: 'primary' }, { id: 'later', label: 'Plus tard', kind: 'ghost' }],
  });
  if (res?.action === 'run') {
    const r = await api.downloadsRunInstaller(d.id, installer);
    if (!r?.ok) toast(r?.error || 'Le programme d’installation n’a pas pu être lancé.', { duration: 8000 });
  }
});

function pathField(id, label, value, placeholder, kind) {
  return `<div class="field"><label for="${id}">${esc(label)}</label><div class="field-row"><input class="input focusable" id="${id}" value="${esc(value)}" placeholder="${esc(placeholder)}"><button type="button" class="btn focusable" data-action="browse" data-id="${id}" data-kind="${kind}">Parcourir</button></div></div>`;
}

const SOURCE_GROUPS = [
  ['video', 'Vidéos', ['vidéo']], ['audio', 'Musique', ['morceau', 'morceaux']], ['image', 'Images', ['image']], ['game', 'Jeux PC', ['jeu', 'jeux']],
];
const sourceKindLabel = (loc) => (/^https?:\/\//i.test(loc) ? 'Web' : /^(\\\\|\/\/|smb:)/i.test(loc) ? 'Réseau' : 'Dossier');

function sourcesHtml(kinds = ['video', 'audio', 'image', 'game']) {
  const single = kinds.length === 1;
  return SOURCE_GROUPS.filter(([kind]) => kinds.includes(kind)).map(([kind, label, unit]) => {
    const list = kind === 'game' ? S.config.gameSources : S.config.library.sources.filter((x) => x.kind === kind);
    const status = kind === 'game' ? S.gameSourceStatus : S.sourceStatus;
    const rows = list.length ? list.map((src) => {
      const st = status[src.id];
      const state = !st ? (S.scanning ? 'Analyse…' : '') : st.ok ? plural(st.count, ...unit) : st.error;
      return `<li class="${st && !st.ok ? 'is-error' : ''}"><span class="src-type">${sourceKindLabel(src.location)}</span><span class="src-loc">${esc(src.location)}</span><span class="src-state">${esc(state)}</span><button type="button" class="btn btn-ghost btn-sm focusable" data-action="src-remove" data-kind="${kind}" data-id="${esc(src.id)}">Retirer</button></li>`;
    }).join('') : '<li class="none">Aucune source.</li>';
    return `<div class="src-group">${single ? '' : `<h3 class="set-sub">${label}</h3>`}<ul class="folder-list src-list">${rows}</ul>
      <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="src-add-folder" data-kind="${kind}">Ajouter un dossier</button><button type="button" class="btn btn-ghost btn-sm focusable" data-action="src-add-url" data-kind="${kind}">Ajouter une adresse réseau ou web</button></div></div>`;
  }).join('');
}
function renderSources() {
  for (const box of $$('.sources-box')) box.innerHTML = sourcesHtml(box.dataset.kinds.split(','));
}

async function addSource(kind, location) {
  if (!location) return;
  const next = structuredClone(S.config);
  const exists = (kind === 'game' ? next.gameSources : next.library.sources.filter((x) => x.kind === kind)).some((x) => x.location === location);
  if (exists) { toast('Cette source est déjà dans la liste.'); return; }
  if (kind === 'game') next.gameSources.push({ location });
  else next.library.sources.push({ kind, location });
  S.config = await api.saveConfig(next);
  const check = await api.checkLocation(location);
  const why = check?.error ? check.error.charAt(0).toLowerCase() + check.error.slice(1) : 'elle est inaccessible pour le moment.';
  toast(check?.ok ? 'Source ajoutée. Analyse en cours…' : `Source ajoutée, mais ${why}`, { duration: check?.ok ? 3500 : 9000 });
  renderSources();
  S.scanned = false;
  if (S.section !== 'settings' && !panel.open) render();
  scan();
}

async function askSourceAddress(kind) {
  const res = await openForm({
    title: 'Ajouter une adresse',
    help: 'Partage réseau : \\\\NAS\\Films ou smb://nas/films. Serveur web : l’adresse d’une page qui liste les fichiers (http://192.168.1.10/films/) ou d’une liste de lecture M3U.',
    fields: [{ id: 'location', label: 'Adresse', value: '', placeholder: '\\\\NAS\\Films' }],
    actions: [{ id: 'ok', label: 'Ajouter', kind: 'primary' }, { id: 'cancel', label: 'Annuler', kind: 'ghost' }],
  });
  if (res?.action === 'ok' && res.values.location) await addSource(kind, res.values.location.trim());
}

function themeCards() {
  const current = S.config.ui.theme || 'ecran';
  const preview = (id) => `<span class="tc-pane" data-theme="${id}"><span class="tc-rail"></span><span class="tc-body"><span class="tc-clock">20:45</span><span class="tc-bars bars7" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="tc-line"></span></span></span>`;
  return THEMES.map((t) => `<button type="button" class="theme-card focusable" data-action="theme" data-id="${t.id}" aria-pressed="${t.id === current}">
    <span class="tc-preview">${t.id === 'auto' ? preview('ecran') + preview('jour') : preview(t.id)}</span>
    <span class="tc-name">${esc(t.name)}</span><span class="tc-desc">${esc(t.desc)}</span>
  </button>`).join('');
}

function startOptions() {
  const cur = S.config.ui.start || 'home';
  const sections = [['home', 'Accueil'], ['search', 'Rechercher'], ['videos', 'Vidéos'], ['music', 'Musique'], ['images', 'Images'], ['streaming', 'Streaming'], ['tv', 'Télévision'], ['games', 'Jeux']];
  const opt = (v, l) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  return `<optgroup label="Sections">${sections.map(([v, l]) => opt(v, l)).join('')}</optgroup>
    <optgroup label="Directement sur un service">${S.config.web.map((w) => opt(`web:${w.id}`, w.name)).join('')}</optgroup>`;
}

// Liste ordonnable : éléments affichés dans l'ordre choisi, puis éléments masqués.
function orderItems(kind) {
  const chosen = S.config.ui.home[kind];
  if (kind === 'bars') {
    const all = Object.keys(HOME_BARS);
    return [...chosen, ...all.filter((id) => !chosen.includes(id))].map((id) => ({ id, label: HOME_BARS[id].label, color: `var(--bar-${HOME_BARS[id].c})`, on: chosen.includes(id) }));
  }
  const all = S.config.web.map((w) => w.id);
  return [...chosen, ...all.filter((id) => !chosen.includes(id))]
    .map((id) => S.config.web.find((w) => w.id === id))
    .filter(Boolean)
    .map((w) => ({ id: w.id, label: w.name, color: safeColor(w.color), on: chosen.includes(w.id) }));
}

function orderList(kind) {
  const items = orderItems(kind);
  const visible = items.filter((x) => x.on).length;
  return items.map((x, i) => `<li class="${x.on ? '' : 'off'}">
    <label class="check"><input type="checkbox" class="focusable" data-order="${kind}" data-id="${esc(x.id)}"${x.on ? ' checked' : ''}><span class="ol-chip" style="background:${x.color}"></span>${esc(x.label)}</label>
    <span class="ol-moves">
      <button type="button" class="icon-btn focusable" data-action="order-move" data-kind="${kind}" data-id="${esc(x.id)}" data-dir="-1" aria-label="Monter ${esc(x.label)}"${x.on && i > 0 ? '' : ' disabled'}>${ICON.chevU}</button>
      <button type="button" class="icon-btn focusable" data-action="order-move" data-kind="${kind}" data-id="${esc(x.id)}" data-dir="1" aria-label="Descendre ${esc(x.label)}"${x.on && i < visible - 1 ? '' : ' disabled'}>${ICON.chevD}</button>
    </span>
  </li>`).join('');
}

// Enregistre tout de suite une modification de l'apparence ou de l'accueil.
async function saveUi(mutate) {
  const next = structuredClone(S.config);
  mutate(next.ui);
  const saved = await api.saveConfig(next);
  if (saved && saved.ui) S.config = saved;
  applyTheme();
}

function refreshOrderList(kind, focusId, dir) {
  const ul = $(`#order-${kind}`);
  if (!ul) return;
  ul.innerHTML = orderList(kind);
  if (focusId) {
    const sel = dir ? `[data-action="order-move"][data-id="${CSS.escape(focusId)}"][data-dir="${dir}"]` : `[data-order="${kind}"][data-id="${CSS.escape(focusId)}"]`;
    const el = ul.querySelector(sel);
    (el && !el.disabled ? el : ul.querySelector(`[data-order="${kind}"][data-id="${CSS.escape(focusId)}"]`))?.focus();
  }
}

function onUiChange(e) {
  const t = e.target;
  if (t.dataset.order) {
    const { order: kind, id } = t.dataset;
    const on = t.checked;
    saveUi((ui) => {
      const list = ui.home[kind].filter((x) => x !== id);
      ui.home[kind] = on ? [...list, id] : list;
    }).then(() => refreshOrderList(kind, id));
    return;
  }
  if (t.dataset.ui === 'clock' || t.dataset.ui === 'recent') {
    const key = t.dataset.ui;
    saveUi((ui) => { ui.home[key] = t.checked; });
    return;
  }
  if (t.dataset.ui === 'adblock') {
    api.adblockSetEnabled(t.checked).then((st) => { afterAdblockChange(st); toast(t.checked ? 'Bloqueur activé. Les sites ouverts se rechargent.' : 'Bloqueur désactivé.'); });
    return;
  }
  if (t.dataset.ui === 'backdrop') {
    saveUi((ui) => { ui.backdrop = t.checked; }).then(() => { if (!t.checked) hideBackdrop(); });
    return;
  }
  if (t.dataset.ui === 'start') {
    saveUi((ui) => { ui.start = t.value; }).then(() => toast('Page de démarrage enregistrée'));
  }
  if (t.dataset.ui === 'menu-autohide') {
    saveUi((ui) => { ui.menu = { ...ui.menu, autohide: t.checked }; }).then(applyMenu);
  }
}
viewEl.addEventListener('change', onUiChange);

function viewSettings() {
  const c = S.config;
  const advanced = JSON.stringify({ web: c.web, games: c.games, emulators: c.emulators }, null, 2);

  return `<form class="settings" id="settings-form" autocomplete="off" spellcheck="false">
    <section class="set-block set-wide" id="set-theme">
      <h2>Apparence</h2>
      <p class="set-help">Le thème s’applique tout de suite.</p>
      <div class="theme-grid" id="theme-grid">${themeCards()}</div>
      ${menuBlock()}
    </section>

    <section class="set-block" id="set-home">
      <h2>Page d’accueil</h2>
      <p class="set-help">Les changements s’appliquent tout de suite. Les flèches changent l’ordre d’affichage.</p>
      <div class="field"><label for="set-start">Au démarrage, ouvrir</label><select class="input focusable" id="set-start" data-ui="start">${startOptions()}</select></div>
      <label class="check"><input type="checkbox" class="focusable" data-ui="clock"${c.ui.home.clock ? ' checked' : ''}> Afficher l’heure et la date</label>
      <label class="check"><input type="checkbox" class="focusable" data-ui="recent"${c.ui.home.recent ? ' checked' : ''}> Afficher « Reprendre »</label>
      <h3 class="set-sub">Barres de la mire</h3>
      <ul class="order-list" id="order-bars">${orderList('bars')}</ul>
      <h3 class="set-sub">Services affichés sur l’accueil</h3>
      <ul class="order-list" id="order-services">${orderList('services')}</ul>
    </section>

    <section class="set-block" id="set-sources">
      <h2>Sources</h2>
      <p class="set-help">Autant de sources que vous voulez pour chaque type : dossiers du disque, partages réseau (\\\\NAS\\Films, smb://nas/films) ou serveurs web (une page qui liste les fichiers, ou une liste M3U). Les changements s’appliquent tout de suite. Les dossiers de jeux de chaque console se règlent avec « Modifier la console », dans Jeux.</p>
      <div class="sources-box" data-kinds="video,audio,image,game">${sourcesHtml()}</div>
      <div class="btn-row"><button type="button" class="btn btn-ghost focusable" data-action="rescan">Analyser à nouveau</button></div>
    </section>

    <section class="set-block">
      <h2>Lecteur externe</h2>
      <p class="set-help">Sert pour la télévision et pour les fichiers que le lecteur intégré ne lit pas (AVI, WMV, pistes audio AC3 ou DTS…). Laissez vide pour détecter mpv ou VLC automatiquement.</p>
      ${pathField('set-player', 'Programme', c.externalPlayer.path, 'Détection automatique', 'program')}
    </section>

    <section class="set-block">
      <h2>Navigateur de secours</h2>
      <p class="set-help">Tous les sites s’ouvrent dans Mire. Ce navigateur ne sert qu’aux sites dont le « mode » vaut "browser" dans la liste ci-dessous, par exemple si un service refuse de fonctionner dans Mire. Laissez vide pour utiliser Edge ou Chrome automatiquement.</p>
      ${pathField('set-browser', 'Navigateur', c.browser.path, 'Détection automatique', 'program')}
    </section>

    <section class="set-block">
      <h2>Télévision</h2>
      <p class="set-help">Le service de télévision se choisit dans la page Télévision (rouage en haut à droite). Mire reconnaît votre box automatiquement au premier lancement.</p>
    </section>

    <section class="set-block">
      <h2>Affichage</h2>
      <label class="check"><input type="checkbox" class="focusable" id="set-fs"${c.ui.fullscreen ? ' checked' : ''}> Afficher Mire en plein écran</label>
      <label class="check"><input type="checkbox" class="focusable" data-ui="backdrop"${c.ui.backdrop !== false ? ' checked' : ''}> Afficher le fond d’écran de l’élément sélectionné dans les listes</label>
    </section>

    <section class="set-block">
      <h2>Recherche dans les catalogues de streaming</h2>
      <p class="set-help">Avec une clé gratuite de TMDB, Rechercher affiche les films et séries correspondants et indique sur quel service les regarder (données JustWatch). Créez un compte sur themoviedb.org, puis copiez le « jeton d’accès en lecture à l’API » depuis Paramètres, rubrique API.</p>
      <div class="field"><label for="set-tmdb">Clé ou jeton TMDB</label><input class="input focusable" id="set-tmdb" type="password" value="${esc(c.search.tmdbToken)}" placeholder="Facultatif"></div>
      <div class="field"><label for="set-region">Pays des disponibilités</label><select class="input focusable" id="set-region">${[['FR', 'France'], ['BE', 'Belgique'], ['CH', 'Suisse'], ['LU', 'Luxembourg'], ['CA', 'Canada']].map(([v, l]) => `<option value="${v}"${v === (c.search.region || 'FR') ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    </section>

    <section class="set-block">
      <h2>Infos et affiches</h2>
      <p class="set-help">Mire cherche en ligne une image et quelques infos pour vos fichiers : affiches et résumés des films et séries (TMDB, avec la clé ci-dessus), pochettes d’albums (MusicBrainz), jaquettes des jeux de console (libretro) et des jeux PC (Steam). Les images restent dans les données de Mire ; rien n’est écrit dans vos dossiers. Une image placée à côté d’un fichier reste prioritaire.</p>
      <label class="check"><input type="checkbox" class="focusable" id="set-scrape-auto"${c.scrape?.auto !== false ? ' checked' : ''}> Récupérer automatiquement après chaque analyse de la bibliothèque</label>
      <div class="btn-row"><button type="button" class="btn focusable" data-action="scrape-all">Tout récupérer à nouveau</button><button type="button" class="btn btn-ghost focusable" data-action="scrape-clear">Effacer les infos récupérées</button></div>
    </section>

    <section class="set-block" id="set-adblock">
      <h2>Bloqueur de publicités</h2>
      <p class="set-help">Bloque les publicités, le pistage, les fenêtres surgissantes et les redirections vers des pages de pub dans les sites ouverts dans Mire. Il utilise les listes d’Adblock Plus (EasyList, EasyPrivacy, Liste FR) et celles d’uBlock Origin, mises à jour tous les quatre jours. Les changements s’appliquent tout de suite.</p>
      <label class="check"><input type="checkbox" class="focusable" data-ui="adblock"${c.adblock?.enabled !== false ? ' checked' : ''}> Bloquer les publicités dans les sites</label>
      <p class="set-help" id="adblock-status">Vérification…</p>
      <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="adblock-update">Mettre à jour les listes</button></div>
      <h3 class="set-sub">Sites où le bloqueur est désactivé</h3>
      <ul class="folder-list" id="adblock-allow"></ul>
      <h3 class="set-sub">Listes de filtres supplémentaires</h3>
      <ul class="folder-list" id="adblock-lists"></ul>
      <div class="field-row"><input class="input focusable" id="adblock-new" placeholder="Adresse d’une liste au format Adblock Plus ou uBlock (https://…)"><button type="button" class="btn btn-sm focusable" data-action="adblock-add-list">Ajouter</button></div>
    </section>

    <section class="set-block">
      <h2>Lecture protégée</h2>
      <p class="set-help" id="drm-status">Vérification…</p>
    </section>

    <section class="set-block">
      <h2>Sites, jeux et consoles</h2>
      <p class="set-help">Liste au format JSON. Pour un site, « search » est son adresse de recherche ({q} est remplacé par les mots cherchés) et « background »: true laisse la lecture continuer quand on quitte le site. Pour un jeu, « image » peut pointer vers une jaquette. Pour une console, {rom} est remplacé par le chemin du jeu. Le fichier README donne des exemples.</p>
      <textarea class="input code focusable" id="set-adv" rows="18">${esc(advanced)}</textarea>
    </section>

    <section class="set-block">
      <h2>Configuration</h2>
      <p class="set-help">Toute votre installation (sites de streaming, consoles, jeux PC, sources, sites de téléchargement) tient dans un fichier. Exportez-le pour le sauvegarder ou le réutiliser sur un autre ordinateur. À l’import, « remplacer » écrase la configuration actuelle, « compléter » ajoute ce qui manque sans rien supprimer.</p>
      <div class="btn-row"><button type="button" class="btn focusable" data-action="config-export">Exporter la configuration</button>
      <button type="button" class="btn focusable" data-action="config-import" data-mode="replace">Importer (remplacer)</button>
      <button type="button" class="btn btn-ghost focusable" data-action="config-import" data-mode="merge">Importer (compléter)</button></div>
    </section>

    <div class="set-actions">
      <button type="submit" class="btn btn-primary focusable">Enregistrer</button>
      <button type="button" class="btn btn-ghost focusable" data-action="reveal-config">Afficher le fichier de configuration</button>
      <span class="config-path">${esc(S.configPath)}</span>
    </div>
  </form>`;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function scan() {
  if (S.scanning) return;
  S.scanning = true;
  if (['home', 'videos', 'music', 'images'].includes(S.section)) render();
  let items = [];
  try {
    const [lib, games] = await Promise.all([api.scanLibrary(), api.scanGameSources()]);
    items = Array.isArray(lib?.items) ? lib.items : [];
    S.sourceStatus = lib?.status || {};
    S.autoGames = Array.isArray(games?.games) ? games.games : [];
    S.gameSourceStatus = games?.status || {};
  } catch { items = []; }
  const byDirName = (a, b) => collator.compare(a.dir, b.dir) || collator.compare(a.name, b.name);
  S.library = items;
  S.videos = items.filter((x) => x.kind === 'video').sort(byDirName);
  S.tracks = items.filter((x) => x.kind === 'audio').sort(byDirName);
  S.images = items.filter((x) => x.kind === 'image').sort(byDirName);
  S.scanning = false;
  S.scanned = true;
  if (['home', 'videos', 'music', 'images', 'games'].includes(S.section)) render();
  if (S.section === 'settings') renderSources();
  if (S.config.scrape?.auto !== false) startScrape(['videos', 'music', 'games'], { quiet: true });
}

async function openFileDialog() {
  const items = await api.openMediaDialog();
  if (items?.length) openItems(items);
}

function playList(list, i) {
  const it = list[i];
  if (!it) return;
  if (it.kind === 'video') openVideo(list, i);
  else if (it.kind === 'audio') playQueue(list, i);
  else openImages(list, i);
}

function playInContext(item) {
  const pool = item.kind === 'video' ? S.videos : item.kind === 'audio' ? S.tracks : S.images;
  let list = pool.filter((x) => x.dir === item.dir);
  let idx = list.findIndex((x) => x.path === item.path);
  if (idx < 0) { list = [item]; idx = 0; }
  playList(list, idx);
}

function openItems(items) {
  if (!items?.length) { toast('Aucun fichier lisible dans la sélection.'); return; }
  const kind = items[0].kind;
  const list = items.filter((x) => x.kind === kind);
  if (list.length === 1) playInContext(list[0]);
  else playList(list, 0);
}

async function playRecent(i) {
  const it = S.recent[i];
  if (!it) return;
  if (it.remote || /^https?:\/\//i.test(it.path)) { playInContext(it); return; }
  const [fresh] = await api.fromPaths([it.path]);
  if (!fresh) {
    toast(`Fichier introuvable : ${it.name}. Il a été retiré de la liste.`);
    removeRecent(it.path);
    if (S.section === 'home') render();
    return;
  }
  playInContext(fresh);
}

async function openBookmark(id) {
  const r = await api.bookmarkOpen(id);
  if (!r?.ok) { toast(r?.error || 'Ouverture impossible.', { duration: 7000 }); return; }
  audio.pause();
  const wid = `bm:${id}`;
  S.webActive = wid;
  if (r.state) S.webStates[wid] = r.state;
  S.webFocusOnShow = true;
  if (S.section === 'web') render(); else go('web');
}

// Marque-page de la page de streaming affichée : crée une entrée vidéo, scrapée aussitôt.
// Marque-page d'un jeu depuis le navigateur de téléchargement : fiche de la page, ou lien collé.
async function bookmarkCurrentGame() {
  const st = S.webStates[S.webActive];
  const url = st?.bookmarkUrl || st?.url;
  const curConsole = st?.rom?.console;
  if (S.section === 'web') api.webHide();
  const res = await openForm({
    title: 'Ajouter ce jeu (à télécharger)',
    help: 'La page du jeu (sa fiche torrent), un lien de téléchargement direct, ou un lien magnet. Le jeu apparaîtra dans la liste avec un bouton Télécharger.',
    fields: [
      { id: 'title', label: 'Titre du jeu', value: (st?.title || '').replace(/\s*[-|–].*$/, '').trim(), full: true },
      { id: 'source', label: 'Lien (page, téléchargement direct, ou magnet)', value: url || '', full: true },
    ],
    actions: [{ id: 'add', label: 'Ajouter', kind: 'primary' }, { id: 'cancel', label: 'Annuler', kind: 'ghost' }],
  });
  if (res?.action !== 'add') { if (S.section === 'web') syncWeb(); return; }
  const v = res.values;
  if (!v.source.trim()) { toast('Indiquez un lien.'); if (S.section === 'web') syncWeb(); return; }
  toast('Ajout du jeu et recherche des infos…', { duration: 3000 });
  const r = await api.gameBookmarkAdd({ source: v.source.trim(), title: v.title.trim(), console: curConsole });
  if (!r?.ok) { toast(r?.error || 'Ajout impossible.', { duration: 7000 }); if (S.section === 'web') syncWeb(); return; }
  S.config = r.config;
  S.scrape = (await api.scrapeData()) || {};
  await loadDownloads();
  // Système non déterminé : on le demande (console ouverte par défaut).
  if (r.needSystem) await askBookmarkConsole(r.bookmark.id, curConsole);
  if (S.section === 'web') syncWeb();
  toast(`Jeu ajouté à la liste${r.scraped ? ' (infos récupérées)' : ''}. Téléchargez-le quand vous voulez.`, { duration: 6000 });
}

// Demande à quel système rattacher un jeu bookmarké (console ouverte par défaut).
async function askBookmarkConsole(id, def) {
  const options = [['pc', 'Jeux PC'], ...S.config.emulators.map((e, i) => [String(i), e.name])];
  if (!options.length) return;
  const res = await openForm({
    title: 'Système du jeu',
    help: 'Le système n’a pas pu être déterminé automatiquement. À quel système ce jeu appartient-il ?',
    fields: [{ id: 'console', type: 'select', label: 'Système', value: def != null ? String(def) : options[0][0], options, full: true }],
    actions: [{ id: 'ok', label: 'Valider', kind: 'primary' }],
  });
  const val = res?.values?.console;
  if (val != null) { const r = await api.gameBookmarkSetConsole(id, val); if (r?.config) S.config = r.config; }
}

async function downloadGameBookmark(id) {
  if (!id) return;
  const r = await api.gameBookmarkDownload(id);
  if (!r?.ok) { toast(r?.error || 'Téléchargement impossible.', { duration: 7000 }); return; }
  await loadDownloads();
  toast('Téléchargement lancé. Suivez-le dans Téléchargements.', { duration: 5000 });
  render();
}

async function bookmarkCurrentPage() {
  const st = S.webStates[S.webActive];
  const url = st?.bookmarkUrl || st?.url;
  if (!url) { toast('Aucune page à mettre en marque-page.'); return; }
  const suggested = (st.title || '').replace(/\s*[-|–].*$/, '').trim();
  // La vue web est une couche native au-dessus de l'interface : on la cache pour voir la fenêtre.
  if (S.section === 'web') api.webHide();
  const res = await openForm({
    title: 'Ajouter cette page aux vidéos',
    help: (() => { try { return decodeURI(url); } catch { return url; } })(),
    fields: [
      { id: 'title', label: 'Titre à rechercher (film ou série)', value: suggested, full: true },
      { id: 'type', type: 'select', label: 'Type', value: 'movie', options: [['movie', 'Film'], ['tv', 'Série']], full: true },
      { id: 'season', label: 'Saison (séries)', value: '', placeholder: 'ex. 1' },
      { id: 'episode', label: 'Épisode (séries)', value: '', placeholder: 'ex. 3' },
    ],
    actions: [{ id: 'add', label: 'Ajouter et récupérer les infos', kind: 'primary' }, { id: 'cancel', label: 'Annuler', kind: 'ghost' }],
  });
  if (res?.action !== 'add') { if (S.section === 'web') syncWeb(); return; }
  const v = res.values;
  if (!v.title.trim()) { toast('Donnez un titre à rechercher.'); return; }
  toast('Ajout et récupération des infos…', { duration: 3000 });
  const r = await api.bookmarkAdd({ url, title: v.title.trim(), type: v.type, season: v.season, episode: v.episode });
  if (!r?.ok) { toast(r?.error || 'Ajout impossible.', { duration: 7000 }); return; }
  S.config = r.config;
  S.scrape = (await api.scrapeData()) || {};
  await scan(); // la nouvelle entrée apparaît dans les Vidéos
  if (S.section === 'web') syncWeb(); // on reste sur la page, la vue web revient
  toast(r.scraped ? `Ajouté aux vidéos et infos récupérées : ${v.title.trim()}.` : `Ajouté aux vidéos : ${v.title.trim()}. Infos non trouvées (à corriger via Modifier).`, { duration: 6000 });
}

async function openExternal(it, start = 0) {
  const r = await api.playExternal(it.path, it.name, start);
  toast(r.ok ? `${it.name} s’ouvre dans le lecteur externe` : r.error, { duration: r.ok ? 3000 : 7000 });
}

async function openWeb(id, url) {
  const w = S.config.web.find((x) => x.id === id);
  if (!w) return;
  const firstTime = !S.webSessions.some((x) => x.id === id);
  if (firstTime) toast(`Ouverture de ${w.name}…`, { duration: 2500 });
  const r = await api.webOpen(id, url);
  if (!r?.ok) { toast(r?.error || 'Ouverture impossible.', { duration: 7000 }); return; }
  if (!r.integrated) { toast(`${w.name} s’ouvre dans le navigateur`); return; }
  if (!w.background) audio.pause();
  S.webActive = id;
  if (r.state) S.webStates[id] = r.state;
  S.webFocusOnShow = true;
  go('web');
}

// Service de télé par portail web (SFR, Bouygues, Molotov) : ouvert dans la vue intégrée.
async function openTvWeb(web) {
  const id = 'tv:web';
  const res = await api.webOpen(id, web.url, { name: web.name, color: '#E23B3B' });
  if (!res?.ok) { toast(res?.error || 'Ouverture impossible.', { duration: 7000 }); return; }
  audio.pause();
  S.webActive = id;
  if (res.state) S.webStates[id] = res.state;
  S.webFocusOnShow = true;
  if (S.section === 'web') render(); else go('web');
}

// Nettoyage : vérifie que les jeux existent encore (fichiers locaux, et sources en ligne si demandé).
async function cleanupGames() {
  const online = await confirmDialog('Nettoyer la base de jeux', 'Mire vérifie que chaque jeu est toujours là. Vérifier aussi que les sources en ligne répondent ? (plus long)', 'Vérifier aussi en ligne');
  toast('Vérification des jeux…', { duration: 3000 });
  const r = await api.gamesCleanup(online);
  if (!r?.ok) { toast('Nettoyage impossible.', { duration: 6000 }); return; }
  if (r.config) S.config = r.config;
  await loadLocalRoms();
  try { const g = await api.scanGameSources(); if (Array.isArray(g?.games)) S.autoGames = g.games; } catch { /* dossiers inchangés */ }
  const parts = [];
  if (r.removedManual) parts.push(`${plural(r.removedManual, 'jeu PC retiré', 'jeux PC retirés')} (fichier absent)`);
  if (r.missingRemote?.length) parts.push(`${plural(r.missingRemote.length, 'source en ligne injoignable', 'sources en ligne injoignables')}`);
  toast(parts.length ? `Nettoyage terminé : ${parts.join(', ')}.` : 'Nettoyage terminé : tous les jeux sont disponibles.', { duration: 7000 });
  if (panel.open) refreshPanel();
  render();
}

async function openRomBrowser(i, { site, url } = {}) {
  const name = i === 'pc' ? 'Jeux PC' : S.config.emulators[i]?.name;
  if (name == null) return;
  const r = await api.romSites(i);
  S.romSites[i] = r?.sites || [];
  if (!S.romSites[i].length) {
    if (i === 'pc') { toast('Aucun site de jeux PC configuré. Ajoutez-en dans les réglages de la page Jeux, onglet Jeux PC.', { duration: 7000 }); openPageSettings('pc'); }
    else { toast(`Aucun site n’est configuré pour ${name}. Ajoutez-en dans « Modifier la console ».`, { duration: 7000 }); editConsole(i); }
    return;
  }
  const id = `rom:${i}`;
  if (!S.webSessions.some((x) => x.id === id)) toast(`Ouverture des sites de jeux pour ${name}…`, { duration: 2500 });
  const res = await api.webOpen(id, url, { site: site != null ? site : undefined });
  if (!res?.ok) { toast(res?.error || 'Ouverture impossible.', { duration: 7000 }); return; }
  audio.pause();
  S.webActive = id;
  if (res.state) S.webStates[id] = res.state;
  S.webFocusOnShow = true;
  if (S.section === 'web') render(); else go('web');
}

function searchUrlFor(w, q) {
  return w.search ? w.search.split('{q}').join(encodeURIComponent(q)) : '';
}

function pickVariant(c) {
  const pref = (S.config.tv.services.find((t) => t.id === S.config.tv.active)?.quality) || 'hd';
  const order = { hd: ['hd', 'sd', 'other', 'ld'], sd: ['sd', 'other', 'hd', 'ld'], ld: ['ld', 'sd', 'other', 'hd'] }[pref] || ['hd', 'sd', 'other', 'ld'];
  return [...c.variants].sort((a, b) => order.indexOf(a.q) - order.indexOf(b.q))[0];
}

async function playChannel(c) {
  if (!c) return;
  const v = pickVariant(c);
  toast(`Ouverture de ${c.name}…`, { duration: 2500 });
  audio.pause();
  const r = await api.playExternal(v.url, c.number != null ? `${c.number}. ${c.name}` : c.name, 0);
  if (!r.ok) toast(r.error, { duration: 7000 });
}

async function loadChannels() {
  S.tvLoading = true;
  S.tvError = null;
  if (S.section === 'tv') render();
  const r = await api.tvChannels();
  S.tvLoading = false;
  S.tvWeb = null;
  if (r?.ok && r.web) { S.tvWeb = r.web; S.channels = null; S.tvError = null; }
  else if (r?.ok) S.channels = r.channels;
  else { S.channels = null; S.tvError = r?.error || 'Erreur inconnue.'; }
  if (S.section === 'tv') {
    render();
    if (S.pendingFocus || document.activeElement === document.body) focusFirst();
    S.pendingFocus = false;
  }
  if (S.section === 'search') refreshSearch();
}

async function launchEntry(g) {
  if (!g) return;
  if (g.manualIndex != null) { launchGame(g.manualIndex); return; }
  toast(`Lancement de ${labelOf(g)}…`, { duration: 2500 });
  audio.pause();
  const r = await api.launchGamePath(g.path);
  if (!r.ok) toast(r.error, { duration: 7000 });
}

async function launchGame(i) {
  const g = S.config.games[i];
  if (!g) return;
  toast(`Lancement de ${g.name}…`, { duration: 2500 });
  audio.pause();
  const r = await api.launchGame(i);
  if (!r.ok) toast(r.error, { duration: 7000 });
}

async function addGame() {
  const cfg = await api.addGame();
  if (cfg && cfg.games) {
    S.config = cfg;
    render();
    toast('Jeu ajouté. Vous pouvez lui donner une jaquette dans Réglages.');
  }
}

async function openEmu(i) {
  S.genre = '';
  S.romsOf = i;
  S.roms = null;
  S.romsError = null;
  S.romsOnline = false;
  S.romsOnlineLoading = false;
  S.romsSource = '';
  S.query = '';
  searchEl.value = '';
  S.limit = PAGE;
  render({ resetScroll: true });
  const r = await api.listRoms(i);
  if (S.romsOf !== i) return;
  api.romSites(i).then((x) => { S.romSites[i] = x?.sites || []; });
  if (r.ok) { S.roms = r.roms; S.romsWarnings = r.errors || []; S.localRoms[i] = r.roms; }
  else S.romsError = r.error;
  render();
  // Option : afficher d'emblée les jeux en ligne.
  const emu = S.config.emulators[i];
  const hasRemote = emu && [emu.romsDir, ...(emu.sources || [])].filter(Boolean).some((l) => /^https?:\/\//i.test(l));
  if (S.config.gamesOpts?.autoOnline && hasRemote) {
    S.romsOnline = true; S.romsOnlineLoading = true; render();
    const rr = await api.romListSource(i); if (S.romsOf !== i) return;
    S.romsOnlineLoading = false;
    if (rr?.ok) { S.roms = rr.roms; S.romsWarnings = rr.errors || []; }
    render();
  }
  const banner = S.config.emulators[i]?.banner;
  if (banner) showBackdrop(banner);
  (viewEl.querySelector('.tile') || viewEl.querySelector('.focusable'))?.focus();
}

function closeRoms() {
  const i = S.romsOf;
  S.romsOf = null;
  S.genre = '';
  setTimeout(updateScrapeButton);
  S.query = '';
  searchEl.value = '';
  S.limit = PAGE;
  render({ resetScroll: true });
  (viewEl.querySelector(`[data-action="open-emu"][data-index="${i}"]`) || viewEl.querySelector('.focusable'))?.focus();
}

async function launchRom(rom, emuIndex) {
  if (!rom) return;
  const i = emuIndex != null ? emuIndex : S.romsOf;
  toast(`Lancement de ${rom.displayName}…`, { duration: 2500 });
  audio.pause();
  const r = await api.launchRom(i, rom.path);
  if (!r.ok) toast(r.error, { duration: 7000 });
}

async function addSourceFolder(kind) {
  const p = await api.pickFolder();
  if (p) await addSource(kind, p);
}

async function removeSource(kind, id) {
  const next = structuredClone(S.config);
  if (kind === 'game') next.gameSources = next.gameSources.filter((x) => x.id !== id);
  else next.library.sources = next.library.sources.filter((x) => x.id !== id);
  S.config = await api.saveConfig(next);
  renderSources();
  toast('Source retirée');
  scan();
}

async function saveSettings() {
  let adv;
  try { adv = JSON.parse($('#set-adv').value); } catch (e) {
    toast(`La liste JSON contient une erreur : ${e.message}`, { duration: 8000 });
    $('#set-adv').focus();
    return;
  }
  if (!adv || typeof adv !== 'object') { toast('La liste JSON doit être un objet { "web": [...], "games": [...], "emulators": [...] }.'); return; }
  for (const k of ['web', 'games', 'emulators']) {
    if (k in adv && !Array.isArray(adv[k])) { toast(`« ${k} » doit être une liste entre crochets [ ].`); return; }
  }

  const prev = S.config;
  const next = structuredClone(prev);
  next.externalPlayer.path = $('#set-player').value.trim();
  next.browser.path = $('#set-browser').value.trim();
  next.ui.fullscreen = $('#set-fs').checked;
  next.search.tmdbToken = $('#set-tmdb').value.trim();
  next.scrape = { ...(next.scrape || {}), auto: $('#set-scrape-auto').checked };
  next.search.region = $('#set-region').value;
  for (const k of ['web', 'games', 'emulators']) if (k in adv) next[k] = adv[k];

  const saved = await api.saveConfig(next);
  if (!saved || saved.ok === false) { toast(saved?.error || 'Enregistrement impossible.'); return; }
  S.config = saved;

  const foldersChanged = false;
  S.romsCache = {};
  S.tmdb = { q: '', status: 'idle', results: [] };
  $('#set-adv').value = JSON.stringify({ web: saved.web, games: saved.games, emulators: saved.emulators }, null, 2);
  toast(foldersChanged ? 'Réglages enregistrés. Analyse de la bibliothèque…' : 'Réglages enregistrés');
  if (foldersChanged) { S.scanned = false; scan(); }
}

/* ------------------------------------------------------------------ */
/* Vue web intégrée                                                    */
/* ------------------------------------------------------------------ */

// Sites ouverts dans le menu : les services sous Streaming, les sites de jeux d'une console sous Jeux.
function renderRailSessions() {
  const item = (x) => {
    const current = S.section === 'web' && S.webActive === x.id;
    return `<button class="rail-sub focusable" data-web="${esc(x.id)}" style="--c:${safeColor(x.color)}"${current ? ' aria-current="page"' : ''} title="${esc(x.name)}"><span class="dot"></span><span class="lbl">${esc(x.name)}</span></button>`;
  };
  const isRom = (x) => String(x.id).startsWith('rom:');
  const box = $('#rail-sessions');
  const games = $('#rail-sessions-games');
  if (box) box.innerHTML = S.webSessions.filter((x) => !isRom(x)).map(item).join('');
  if (games) games.innerHTML = S.webSessions.filter(isRom).map(item).join('');
}

function viewWeb() {
  const st = S.webStates[S.webActive] || {};
  const rom = String(S.webActive || '').startsWith('rom:') ? st.rom : null;
  const site = rom ? rom.sites[rom.site] : null;
  // Un marque-page n'est pas un site enregistré : on reconstitue son entrée depuis la configuration.
  const bm = String(S.webActive || '').startsWith('bm:') ? (S.config.bookmarks || []).find((b) => `bm:${b.id}` === S.webActive) : null;
  const w = rom ? { name: rom.consoleName, color: '#6E88F7', search: site?.search || '' }
    : bm ? { name: bm.title || bm.site, color: '#9B6CF7', search: '' }
    : S.config.web.find((x) => x.id === S.webActive);
  if (!w) return emptyBlock('Aucun site ouvert', 'Choisissez un service dans Streaming.', '<button class="btn focusable" data-action="go" data-go="streaming">Ouvrir Streaming</button>');
  const color = safeColor(w.color);
  // Ajouter des jeux : liste des sites de la console et recherche sur le site choisi.
  const romTools = rom ? `<label class="wb-label" for="wb-sites">Site</label>
      <select class="input wb-select focusable" id="wb-sites" aria-label="Site où chercher des jeux">${rom.sites.map((x, n) => `<option value="${n}"${n === rom.site ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : '';
  return `<div class="webbar${st.loading ? ' loading' : ''}" style="--brand:${color}">
    <button class="icon-btn focusable" id="wb-back" data-action="web-nav" data-id="back" aria-label="Page précédente"${st.canGoBack ? '' : ' disabled'}>${ICON.chevL}</button>
    <button class="icon-btn focusable" id="wb-fwd" data-action="web-nav" data-id="forward" aria-label="Page suivante"${st.canGoForward ? '' : ' disabled'}>${ICON.chevR}</button>
    <button class="icon-btn focusable" data-action="web-nav" data-id="reload" aria-label="Recharger la page">${ICON.reload}</button>
    <div class="wb-title${rom ? ' rom' : ''}"><span class="wb-site">${esc(rom ? `Jeux : ${w.name}` : w.name)}</span>${rom ? romTools : `<span class="wb-page" id="wb-page">${esc(st.title || '')}</span>`}</div>
    <div class="wb-tools">
      <button class="icon-btn wb-btn focusable${w.search ? ' on' : ''}" id="wb-learn" data-action="web-learn" aria-label="${w.search ? 'Recherche mémorisée' : 'Mémoriser la recherche'}" title="${w.search ? 'Recherche mémorisée : ce site apparaît dans Rechercher. Pour la refaire, cherchez le mot « mire » sur le site puis appuyez ici.' : 'Mémoriser la recherche : cherchez le mot « mire » sur le site, puis appuyez ici.'}">${ICON.search}</button>
      ${S.adblock?.enabled ? `<button class="icon-btn wb-btn focusable${st.adOn === false ? ' off' : ''}" id="wb-ad" data-action="web-adblock" aria-label="${esc(adLabel(st))}" title="${esc(adLabel(st))}. Appuyez pour désactiver ou réactiver le bloqueur sur ce site.">${st.adOn === false ? ICON.shieldOff : ICON.shield}<span class="badge" id="wb-ad-n"${st.adOn === false || !st.blocked ? ' hidden' : ''}>${st.blocked || 0}</span></button>` : ''}
      ${rom ? `<button class="icon-btn wb-btn focusable" data-action="game-bookmark" aria-label="Ajouter ce jeu (à télécharger)" title="Ajouter ce jeu à la liste, à télécharger plus tard">${ICON.star}</button>` : `<button class="icon-btn wb-btn focusable" data-action="web-bookmark" aria-label="Ajouter cette page aux vidéos" title="Ajouter cette page aux vidéos (film ou série)">${ICON.star}</button>`}
      <button class="icon-btn wb-btn focusable" data-action="web-nav" data-id="immersive" aria-label="Plein écran" title="Plein écran (F11)">${ICON.fullscreen}</button>
      <button class="icon-btn wb-btn focusable" data-action="web-nav" data-id="browser" aria-label="Ouvrir dans le navigateur" title="Ouvrir cette page dans votre navigateur habituel, si le site refuse de fonctionner dans Mire">${ICON.globe}</button>
      <button class="icon-btn wb-btn focusable" data-action="web-close" aria-label="Fermer le site" title="Fermer le site (Ctrl+W)">${ICON.close}</button>
    </div>
  </div>
  <div class="web-slot" id="web-slot">${loading(`Chargement de ${w.name}…`)}</div>`;
}

let slotObserver = null;
function slotRect() {
  const r = $('#web-slot')?.getBoundingClientRect();
  if (!r) return null;
  let { left, top, right, bottom } = r;
  if (document.body.classList.contains('menu-auto') && document.body.classList.contains('menu-open')) {
    const m = rail.getBoundingClientRect();
    const pos = menuSettings().position;
    if (pos === 'left') left = Math.max(left, m.right);
    if (pos === 'right') right = Math.min(right, m.left);
    if (pos === 'top') top = Math.max(top, m.bottom);
    if (pos === 'bottom') bottom = Math.min(bottom, m.top);
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
function webShouldShow() {
  return S.section === 'web' && !!S.webActive && videoLayer.hidden && imageLayer.hidden;
}
function showWebInSlot(focus = false) {
  if (!webShouldShow()) { api.webHide(); return; }
  const rect = slotRect();
  if (rect) api.webShow(S.webActive, rect, focus);
}
function attachWebSlot() {
  slotObserver?.disconnect();
  const slot = $('#web-slot');
  if (!slot) return;
  slotObserver = new ResizeObserver(() => { const rect = slotRect(); if (rect && webShouldShow()) api.webBounds(rect); });
  slotObserver.observe(slot);
}
// Une couche plein écran (vidéo locale, images) passe devant : la vue web se cache, puis revient.
function syncWeb() {
  if (webShouldShow()) showWebInSlot(false);
  else if (S.section === 'web') api.webHide();
}

const adLabel = (st) => (st.adOn === false ? 'Bloqueur désactivé sur ce site' : `${plural(st.blocked || 0, 'publicité bloquée', 'publicités bloquées')} sur cette page`);
function setAdButton(st) {
  const ad = $('#wb-ad');
  if (!ad) return;
  const off = st.adOn === false;
  ad.classList.toggle('off', off);
  ad.innerHTML = `${off ? ICON.shieldOff : ICON.shield}<span class="badge" id="wb-ad-n"${off || !st.blocked ? ' hidden' : ''}>${st.blocked || 0}</span>`;
  ad.title = `${adLabel(st)}. Appuyez pour désactiver ou réactiver le bloqueur sur ce site.`;
  ad.setAttribute('aria-label', adLabel(st));
}

function updateWebBar(st) {
  const bar = $('.webbar');
  if (!bar) return;
  setAdButton(st);
  bar.classList.toggle('loading', !!st.loading);
  const page = $('#wb-page');
  if (page) page.textContent = st.title || '';
  const backBtn = $('#wb-back');
  const fwdBtn = $('#wb-fwd');
  if (backBtn) backBtn.disabled = !st.canGoBack;
  if (fwdBtn) fwdBtn.disabled = !st.canGoForward;
}

async function learnSearch() {
  const r = await api.webLearnSearch(S.webActive);
  if (!r?.ok) { toast(r?.error || 'Impossible de mémoriser la recherche.', { duration: 9000 }); return; }
  S.config = r.config;
  const btn = $('#wb-learn');
  if (btn) { btn.classList.add('on'); btn.setAttribute('aria-label', 'Recherche mémorisée'); btn.title = 'Recherche mémorisée : ce site apparaît dans Rechercher.'; }
  toast('Recherche mémorisée : ce site apparaîtra dans les résultats de Rechercher.', { duration: 6000 });
}

api.onWebState((st) => {
  const prev = S.webStates[st.id];
  S.webStates[st.id] = st;
  if (S.section !== 'web' || st.id !== S.webActive) return;
  // Site de jeux changé (choix du site, recherche mémorisée) : la barre est redessinée.
  if (st.rom && (!prev?.rom || prev.rom.site !== st.rom.site || JSON.stringify(prev.rom.sites) !== JSON.stringify(st.rom.sites))) {
    const bar = $('.webbar');
    if (bar) { const tmp = document.createElement('div'); tmp.innerHTML = viewWeb(); bar.replaceWith(tmp.firstElementChild); }
    return;
  }
  updateWebBar(st);
});
viewEl.addEventListener('change', (e) => {
  if (e.target.matches('[data-action="rom-source"]')) {
    S.romsSource = e.target.value;
    S.romsOnline = true;
    S.romsOnlineLoading = true;
    S.limit = PAGE;
    render();
    api.romListSource(S.romsOf, S.romsSource || undefined).then((r) => {
      S.romsOnlineLoading = false;
      if (r?.ok) { S.roms = r.roms; S.romsWarnings = r.errors || []; } else toast(r?.error || 'Source illisible.', { duration: 7000 });
      render();
    });
    return;
  }
  if (e.target.id !== 'wb-sites') return;
  const i = Number(String(S.webActive).slice(4));
  openRomBrowser(i, { site: Number(e.target.value) });
});
api.onWebSessions((list) => {
  S.webSessions = Array.isArray(list) ? list : [];
  renderRailSessions();
  if (S.section === 'streaming') render();
});
api.onWebClosed(({ id }) => {
  delete S.webStates[id];
  if (S.webActive === id) {
    S.webActive = null;
    if (S.section === 'web') go('streaming', { focus: 'content' });
  }
});
api.onWebError(({ message }) => toast(message, { duration: 8000 }));
api.onWebBlocked(({ id, count }) => {
  if (S.webStates[id]) S.webStates[id].blocked = count;
  if (S.section === 'web' && id === S.webActive && S.webStates[id]) setAdButton(S.webStates[id]);
});
let lastAdToast = 0;
api.onWebAdblocked(({ host }) => {
  if (Date.now() - lastAdToast < 4000) return;
  lastAdToast = Date.now();
  toast(`Redirection publicitaire bloquée${host ? ` (${host})` : ''}`, { duration: 3000 });
});
api.onWebFocus((focused) => { S.webFocused = !!focused; });
api.onMireFocus(() => {
  S.webFocused = false;
  document.body.classList.remove('mouse');
  const target = $$('.webbar .focusable').find(isShown) || $('.rail-item[aria-current]');
  target?.focus();
});

/* ------------------------------------------------------------------ */
/* Recherche globale                                                   */
/* ------------------------------------------------------------------ */

function getQueries() { try { return JSON.parse(localStorage.getItem('queries') || '[]'); } catch { return []; } }
function rememberQuery(q) {
  if (!q) return;
  const list = [q, ...getQueries().filter((x) => fold(x) !== fold(q))].slice(0, 10);
  try { localStorage.setItem('queries', JSON.stringify(list)); } catch { /* rien */ }
}

function viewSearch() {
  return `<div class="gsearch">
    <input class="gsearch-input focusable" id="gsearch" type="search" value="${esc(S.gq)}" placeholder="Film, série, chanson, chaîne, jeu…" aria-label="Rechercher partout" autocomplete="off" spellcheck="false">
  </div>
  <div id="gresults">${searchResultsHtml()}</div>`;
}

// Charge en arrière-plan ce qui n'est pas encore en mémoire : chaînes et listes de jeux des consoles.
async function ensureSearchSources() {
  if (!S.channels && !S.tvLoading && !S.tvError) loadChannels();
  const missing = S.config.emulators.map((_, i) => i).filter((i) => !S.romsCache[i]);
  if (!missing.length) return;
  await Promise.all(missing.map(async (i) => {
    const r = await api.listRoms(i);
    S.romsCache[i] = r?.ok ? r.roms : [];
  }));
  if (S.section === 'search' && S.gq) refreshSearch();
}

function allRoms() {
  const out = [];
  S.config.emulators.forEach((e, i) => { for (const r of S.romsCache[i] || []) out.push({ ...r, emu: i, emuName: e.name }); });
  return out;
}

function localResults(q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  const match = (text) => { const h = fold(text); return words.every((w) => h.includes(w)); };
  return {
    videos: S.videos.map(withScrape).filter((v) => match(`${v.name} ${v.sTitle || ''} ${folderText(v)}`)).slice(0, 24),
    tracks: S.tracks.filter((t) => match(`${t.name} ${folderText(t)}`)).slice(0, 12),
    images: S.images.filter((i) => match(`${i.name} ${i.folder}`)).slice(0, 24),
    channels: (S.channels || []).filter((c) => match(`${c.number ?? ''} ${c.name}`)).slice(0, 12),
    games: gameEntries().filter((g) => match(`${g.name} ${g.sTitle || ''} ${g.sGenre}`)).slice(0, 12),
    roms: allRoms().map((r) => withScrape({ ...r, kind: 'rom' })).filter((r) => match(`${r.displayName} ${r.emuName}`)).slice(0, 24),
  };
}

function gsSection(title, count, body, id = '') {
  return `<section class="gs-sec"${id ? ` id="${id}"` : ''}><h2 class="row-h">${esc(title)}${count != null ? `<span class="group-n">${count}</span>` : ''}</h2>${body}</section>`;
}

function siteTiles(q) {
  return `<div class="site-grid">${S.config.web.map((w) => {
    const color = safeColor(w.color);
    const how = w.search ? `Chercher « ${q} »` : 'Ouvrir le site (recherche à mémoriser)';
    return `<button class="site focusable" data-action="gs-site" data-id="${esc(w.id)}" style="--brand:${color};--on:${onColor(color)}"><span class="site-name">${esc(w.name)}</span><span class="site-how">${esc(how)}</span></button>`;
  }).join('')}</div>`;
}

function tmdbRowInner() {
  const t = S.tmdb;
  if (!S.config.search.tmdbToken) {
    return `<div class="gs-note"><p>Ajoutez une clé TMDB gratuite pour voir ici les films et séries correspondants, avec le service où les regarder.</p><button class="btn btn-sm focusable" data-action="go" data-go="settings">Ajouter la clé</button></div>`;
  }
  if (t.q !== S.gq || t.status === 'loading' || t.status === 'idle') return loading('Recherche dans les catalogues…');
  if (t.status === 'error') return `<div class="gs-note"><p>${esc(t.error)}</p></div>`;
  if (!t.results.length) return '<div class="gs-note"><p>Aucun film ni série trouvé.</p></div>';
  const tiles = t.results.map((r, i) => {
    const chips = r.providers.slice(0, 3).map((pv) => {
      const w = pv.webId && S.config.web.find((x) => x.id === pv.webId);
      return w ? `<span class="pchip mine" style="--pc:${safeColor(w.color)};--pon:${onColor(safeColor(w.color))}">${esc(w.name)}</span>` : `<span class="pchip">${esc(pv.name)}</span>`;
    }).join('') + (r.providers.length > 3 ? `<span class="pchip">+${r.providers.length - 3}</span>` : '');
    const kind = r.type === 'tv' ? 'Série' : 'Film';
    return `<button class="tile focusable" data-action="gs-tmdb" data-index="${i}">
      <span class="art r-poster"><span class="art-fallback" style="--mono:var(--bar-${barFor(r.title)})" aria-hidden="true">${esc(monogram(r.title))}</span>${r.poster ? `<img loading="lazy" alt="" src="${esc(r.poster)}">` : ''}</span>
      <span class="tile-t">${esc(r.title)}</span><span class="tile-s">${esc([kind, r.year].filter(Boolean).join(', '))}</span>
      <span class="pchips">${chips || '<span class="pchip none">Pas en abonnement</span>'}</span>
    </button>`;
  }).join('');
  return `<div class="strip">${tiles}</div><p class="attrib">Catalogue : TMDB. Disponibilités : JustWatch.</p>`;
}

function searchResultsHtml() {
  const q = S.gq;
  if (!q) {
    const recent = getQueries();
    return `<div class="gs-intro">
      <p>Une seule recherche couvre vos fichiers, les chaînes de la Freebox, vos jeux et vos services de streaming.</p>
      ${recent.length ? `<div class="qchips">${recent.map((x, i) => `<button class="qchip focusable" data-action="gs-recent" data-index="${i}">${esc(x)}</button>`).join('')}</div>` : ''}
    </div>`;
  }
  const r = localResults(q);
  S.gs = r;
  let html = '';
  if (r.videos.length) html += gsSection('Vos vidéos', r.videos.length, `<div class="strip">${r.videos.map((it, i) => tile(it, i, 'gs-video', 'r-poster', { sub: folderText(it) })).join('')}</div>`);
  html += gsSection('Films et séries en streaming', null, tmdbRowInner(), 'gs-tmdb');
  html += gsSection('Chercher sur vos sites', null, siteTiles(q));
  if (r.tracks.length) html += gsSection('Votre musique', r.tracks.length, `<div class="tracks">${r.tracks.map((t, i) => `<button class="track flat focusable" data-action="gs-track" data-index="${i}"><span class="tk-t">${esc(cleanTrack(t.name))}</span><span class="tk-f">${esc(folderText(t))}</span><span class="tk-e">${esc(t.ext.slice(1))}</span></button>`).join('')}</div>`);
  if (r.channels.length) html += gsSection('Télévision', r.channels.length, `<div class="ch-grid">${r.channels.map((c, i) => `<button class="ch focusable" data-action="gs-channel" data-index="${i}">${c.number != null ? `<span class="ch-num">${c.number}</span>` : ''}<span class="ch-txt"><span class="ch-name">${esc(c.name)}</span></span></button>`).join('')}</div>`);
  const gameTiles = r.games.map((g, i) => tile(g, i, 'gs-game', 'r-game', { sub: 'Jeu PC' }))
    .concat(r.roms.map((rom, i) => tile({ ...rom, kind: 'rom' }, i, 'gs-rom', 'r-game', { sub: rom.emuName })));
  if (gameTiles.length) html += gsSection('Jeux', gameTiles.length, `<div class="strip">${gameTiles.join('')}</div>`);
  if (r.images.length) html += gsSection('Vos images', r.images.length, `<div class="strip strip-square">${r.images.map((it, i) => tile(it, i, 'gs-image', 'r-square', { noText: true })).join('')}</div>`);
  return html;
}

// Réaffiche les résultats sans toucher au champ de saisie, en gardant le focus.
function refreshSearch() {
  const box = $('#gresults');
  if (!box) return;
  const active = document.activeElement;
  const sel = box.contains(active) ? focusSelectorOf(active) : null;
  box.innerHTML = searchResultsHtml();
  if (sel) (box.querySelector(sel) || box.querySelector('.focusable') || $('#gsearch'))?.focus({ preventScroll: true });
  fetchTmdb();
}

let tmdbSeq = 0;
async function fetchTmdb() {
  const q = S.gq;
  if (!q || !S.config.search.tmdbToken) return;
  if (S.tmdb.q === q && S.tmdb.status !== 'idle') return;
  const seq = ++tmdbSeq;
  S.tmdb = { q, status: 'loading', results: [] };
  updateTmdbRow();
  await new Promise((r) => { setTimeout(r, 350); });
  if (seq !== tmdbSeq) return;
  const r = await api.searchStreaming(q);
  if (seq !== tmdbSeq) return;
  if (r?.ok) S.tmdb = { q, status: 'done', results: r.results || [] };
  else S.tmdb = { q, status: 'error', results: [], error: r?.error || 'Recherche impossible.' };
  updateTmdbRow();
}
function updateTmdbRow() {
  const sec = $('#gs-tmdb');
  if (!sec) return;
  const active = document.activeElement;
  const sel = sec.contains(active) ? focusSelectorOf(active) : null;
  sec.innerHTML = `<h2 class="row-h">Films et séries en streaming</h2>${tmdbRowInner()}`;
  if (sel) (sec.querySelector(sel) || sec.querySelector('.focusable'))?.focus({ preventScroll: true });
}

let gsTimer = 0;
viewEl.addEventListener('input', (e) => {
  if (e.target.id !== 'gsearch') return;
  clearTimeout(gsTimer);
  gsTimer = setTimeout(() => { S.gq = e.target.value.trim(); refreshSearch(); }, 180);
});
viewEl.addEventListener('keydown', (e) => {
  if (e.target.id !== 'gsearch' || e.key !== 'Enter') return;
  e.preventDefault();
  e.stopPropagation();
  clearTimeout(gsTimer);
  S.gq = e.target.value.trim();
  rememberQuery(S.gq);
  refreshSearch();
  $('#gresults .focusable')?.focus();
});

function openTmdbResult(r) {
  rememberQuery(S.gq);
  const mine = r.providers.filter((pv) => pv.webId);
  if (mine.length) {
    const w = S.config.web.find((x) => x.id === mine[0].webId);
    openWeb(w.id, searchUrlFor(w, r.title) || undefined);
    if (mine.length > 1) {
      const w2 = S.config.web.find((x) => x.id === mine[1].webId);
      setTimeout(() => toast(`Aussi disponible sur ${w2.name}`, { action: `Ouvrir ${w2.name}`, onAction: () => openWeb(w2.id, searchUrlFor(w2, r.title) || undefined) }), 2600);
    }
    return;
  }
  if (r.providers.length) toast(`Disponible sur ${r.providers.map((pv) => pv.name).join(', ')}, qui n’est pas configuré dans Mire.`, { duration: 7000 });
  else toast('Ce titre n’est proposé en abonnement sur aucun service en France pour le moment (d’après JustWatch).', { duration: 7000 });
}

async function fillAdblock(fresh) {
  const st = fresh || await api.adblockStatus();
  S.adblock = st;
  const el = $('#adblock-status');
  if (!el || !st) return;
  const date = st.updated ? new Date(st.updated).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  let text = st.updating ? 'Mise à jour des listes en cours…'
    : st.ready ? `${plural(st.loaded, 'liste chargée', 'listes chargées')}${date ? `, mises à jour le ${date}` : ''}.`
      : 'Les listes se téléchargent au premier lancement (connexion Internet nécessaire).';
  if (st.failed?.length) text += ` Indisponible pour l’instant : ${st.failed.map((u) => u.split('/').pop()).join(', ')}.`;
  el.textContent = text;
  const row = (value, kind) => `<li><span class="src-loc">${esc(value)}</span><button type="button" class="btn btn-ghost btn-sm focusable" data-action="adblock-remove" data-kind="${kind}" data-id="${esc(value)}">Retirer</button></li>`;
  $('#adblock-allow').innerHTML = st.allowlist.length ? st.allowlist.map((h) => row(h, 'allowlist')).join('') : '<li class="none">Aucun : le bloqueur agit partout. Le bouton « Pubs bloquées » de la barre d’un site permet de le désactiver sur ce site.</li>';
  $('#adblock-lists').innerHTML = st.customLists.length ? st.customLists.map((u) => row(u, 'customLists')).join('') : '<li class="none">Aucune.</li>';
}

// Les réglages du bloqueur sont enregistrés par le processus principal : on relit la configuration.
async function afterAdblockChange(st) {
  S.config = (await api.getConfig()).config;
  await fillAdblock(st || undefined);
}

async function fillDrmStatus() {
  const el = $('#drm-status');
  if (!el) return;
  const d = await api.drmStatus();
  if (!d || !$('#drm-status')) return;
  let text;
  if (!d.ecs) {
    text = 'Cette version d’Electron ne contient pas Widevine : Netflix, Prime Video et Amazon Music ne pourront pas lire leurs contenus. Réinstallez Mire avec npm install (voir le README).';
  } else if (d.widevine?.version) {
    text = `Widevine est installé (version ${d.widevine.version}).`;
    if (d.platform !== 'linux') text += ' Si Netflix ou Prime Video refusent la lecture, signez Mire une fois avec npm run drm:signer (voir le README).';
  } else {
    text = 'Widevine s’installe au premier lancement (connexion Internet nécessaire). Redémarrez Mire si la lecture échoue.';
  }
  el.textContent = text;
}

/* ------------------------------------------------------------------ */
/* Infos et images en ligne                                            */
/* ------------------------------------------------------------------ */

const gearBtn = $('#page-gear');
const SCRAPE_KIND = { videos: 'videos', music: 'music', games: 'games' };

// Le rouage de l'en-tête ouvre les réglages de la page ; il signale aussi une récupération d'infos en cours.
function updateScrapeButton() {
  gearBtn.hidden = S.section === 'settings';
  const p = S.scraping;
  gearBtn.classList.toggle('is-busy', !!p?.running);
  gearBtn.title = p?.running ? (p.total ? `Récupération des infos : ${p.done} sur ${p.total}` : 'Récupération des infos…') : 'Réglages de cette page';
  const st = $('#scrape-state');
  if (st) st.textContent = scrapeStateText();
  const runBtn = $('#scrape-run');
  if (runBtn) runBtn.textContent = p?.running ? 'Arrêter' : 'Récupérer les infos';
}
function scrapeStateText() {
  const p = S.scraping;
  if (p?.running) return p.total ? `Récupération en cours : ${p.done} sur ${p.total}.` : 'Préparation de la récupération…';
  return '';
}

function scrapeJobs(kinds) {
  const albums = [];
  const seen = new Set();
  for (const t of S.tracks) if (!seen.has(t.dir)) { seen.add(t.dir); albums.push({ dir: t.dir, folder: t.folder }); }
  return {
    kinds,
    videos: kinds.includes('videos') ? S.videos.map((v) => ({ path: v.path, name: v.name, dir: v.dir })) : [],
    albums: kinds.includes('music') ? albums : [],
    pcGames: kinds.includes('games') ? gameEntries().map((g) => ({ name: g.name, path: g.path })) : [],
  };
}

async function startScrape(kinds, { quiet = false, force = false } = {}) {
  if (S.scraping?.running) return;
  S.scrapeQuiet = quiet;
  S.scraping = { running: true, done: 0, total: 0 };
  updateScrapeButton();
  const r = await api.scrapeRun({ ...scrapeJobs(kinds), force });
  if (r && r.ok === false && r.error) toast(r.error);
}

async function reloadScrape() {
  S.scrape = (await api.scrapeData()) || {};
  S.meta = (await api.metaAll()) || {};
  S.romsCache = {};
  if (['home', 'videos', 'music', 'games', 'search'].includes(S.section)) {
    if (S.section === 'search') refreshSearch(); else render();
  }
}

api.onRomDownload((p) => {
  const pct = p.total ? ` : ${Math.round(((p.received || 0) / p.total) * 100)} %` : '…';
  if (p.phase === 'start' || p.phase === 'progress') toast(`Téléchargement de ${p.name} pour ${p.consoleName}${p.phase === 'start' ? '…' : pct}`, { duration: 5000 });
  else if (p.phase === 'extract') toast(`Décompression de ${p.name}…`, { duration: 5000 });
  else if (p.phase === 'cancelled') toast(`Téléchargement de ${p.name} annulé`);
  else if (p.phase === 'error') toast(p.message || `Le téléchargement de ${p.name} a échoué.`, { duration: 8000 });
  else if (p.phase === 'done') {
    delete S.romsCache[p.console];
    const detail = [p.files > 1 ? `${p.files} fichiers` : '', p.extracted ? 'archive décompressée' : ''].filter(Boolean).join(', ');
    toast(`${p.name} ajouté à ${p.consoleName}${detail ? ` (${detail})` : ''}. Il apparaît dans la liste des jeux de la console.`, { duration: 7000 });
    if (S.section === 'games' && S.romsOf === p.console) openEmu(p.console);
  }
});

api.onRomProgress((p) => {
  if (p.phase === 'done') { toast(`${p.name} est prêt, lancement…`, { duration: 2500 }); return; }
  const pct = p.total ? ` : ${Math.round((p.received / p.total) * 100)} %` : '…';
  toast(`Téléchargement de ${p.name}${pct}`, { duration: 5000 });
});

api.onScrapeProgress((p) => {
  S.scraping = p;
  updateScrapeButton();
  if (!p.running) {
    reloadScrape();
    const skipped = p.skipped?.length ? ` Ignorées : ${p.skipped.join(', ')}.` : '';
    if (!S.scrapeQuiet || p.found) {
      if (!p.total) toast(`Tout est déjà à jour.${skipped}`);
      else toast(`${plural(p.found || 0, 'élément complété', 'éléments complétés')}, ${plural(p.missing || 0, 'introuvable', 'introuvables')}.${skipped}`, { duration: 6000 });
    }
  }
});

gearBtn.addEventListener('click', () => openPageSettings());

/* ---------- Réglages de la page (rouage de l'en-tête) ---------- */

const panel = $('#panel');
const panelBody = $('#panel-body');
const panelTabs = $('#panel-tabs');
const P = { section: null, tab: null };

const PANEL_TITLES = { home: 'Accueil', search: 'Rechercher', videos: 'Vidéos', music: 'Musique', images: 'Images', streaming: 'Streaming', web: 'Streaming', tv: 'Télévision', games: 'Jeux', downloads: 'Téléchargements' };

// Champ enregistré dès qu'il change (data-cfg="chemin.dans.la.config").
const cfgInput = (path, label, value, placeholder = '', type = 'text') => `<div class="field"><label for="cfg-${path}">${esc(label)}</label><input class="input focusable" id="cfg-${path}" data-cfg="${path}" type="${type}" value="${esc(value || '')}" placeholder="${esc(placeholder)}"></div>`;

function scrapeBlock(kind, help) {
  return `<section class="pset"><h3 class="pset-h">Infos et images</h3><p class="set-help">${help}</p>
    <div class="btn-row"><button type="button" class="btn btn-primary btn-sm focusable" id="scrape-run" data-action="scrape-section" data-kind="${kind}">${S.scraping?.running ? 'Arrêter' : 'Récupérer les infos'}</button><button type="button" class="btn btn-ghost btn-sm focusable" data-action="scrape-section" data-kind="${kind}" data-force="1">Tout récupérer à nouveau</button></div>
    <p class="set-help" id="scrape-state">${esc(scrapeStateText())}</p>
    <label class="check"><input type="checkbox" class="focusable" data-cfg-bool="scrape.auto"${S.config.scrape?.auto !== false ? ' checked' : ''}> Récupérer automatiquement après chaque analyse</label>
    <p class="set-help">Pour corriger un élément mal reconnu : « Modifier » (ou clic droit, touche E, bouton X), puis « Rechercher en ligne » et choisissez la bonne fiche.</p></section>`;
}

function menuBlock() {
  const m = S.config.ui.menu;
  const pos = [['left', 'À gauche'], ['right', 'À droite'], ['top', 'En haut'], ['bottom', 'En bas']];
  return `<section class="pset"><h3 class="pset-h">Menu principal</h3>
    <p class="set-help">À gauche ou à droite, le menu est une barre latérale ; en haut ou en bas, c’est un carrousel qu’on fait défiler. Appliqué immédiatement.</p>
    <div class="seg" role="group" aria-label="Position du menu">${pos.map(([v, l]) => `<button type="button" class="seg-btn focusable" data-action="menu-pos" data-id="${v}" aria-pressed="${m.position === v}">${l}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" class="focusable" data-ui="menu-autohide"${m.autohide ? ' checked' : ''}> Menu rétractable : il se cache et réapparaît quand on approche du bord ou qu’on y revient avec les flèches</label></section>`;
}

function panelSpec(section) {
  const c = S.config;
  switch (section) {
    case 'home':
      return [
        { id: 'home', label: 'Accueil', html: () => `<section class="pset"><h3 class="pset-h">Page d’accueil</h3>
          <div class="field"><label for="set-start">Au démarrage, ouvrir</label><select class="input focusable" id="set-start" data-ui="start">${startOptions()}</select></div>
          <label class="check"><input type="checkbox" class="focusable" data-ui="clock"${c.ui.home.clock ? ' checked' : ''}> Afficher l’heure et la date</label>
          <label class="check"><input type="checkbox" class="focusable" data-ui="recent"${c.ui.home.recent ? ' checked' : ''}> Afficher « Reprendre »</label>
          <h3 class="set-sub">Barres de la mire</h3><ul class="order-list" id="order-bars">${orderList('bars')}</ul>
          <h3 class="set-sub">Services affichés sur l’accueil</h3><ul class="order-list" id="order-services">${orderList('services')}</ul></section>` },
        { id: 'menu', label: 'Menu', html: menuBlock },
      ];
    case 'search':
      return [{ id: 'search', label: 'Recherche', html: () => `<section class="pset"><h3 class="pset-h">Catalogues de streaming</h3>
        <p class="set-help">Avec une clé gratuite de TMDB, la recherche montre les films et séries et le service où les regarder.</p>
        ${cfgInput('search.tmdbToken', 'Clé ou jeton TMDB', c.search.tmdbToken, 'Facultatif', 'password')}
        <div class="field"><label for="cfg-region">Pays des disponibilités</label><select class="input focusable" id="cfg-region" data-cfg="search.region">${[['FR', 'France'], ['BE', 'Belgique'], ['CH', 'Suisse'], ['LU', 'Luxembourg'], ['CA', 'Canada']].map(([v, l]) => `<option value="${v}"${v === (c.search.region || 'FR') ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="btn-row"><button type="button" class="btn btn-ghost btn-sm focusable" data-action="clear-queries">Effacer les recherches récentes</button></div></section>` }];
    case 'videos':
    case 'music':
    case 'images': {
      const kind = { videos: 'video', music: 'audio', images: 'image' }[section];
      const tabs = [{ id: 'sources', label: 'Sources', html: () => `<section class="pset"><p class="set-help">Dossiers, partages réseau (\\\\NAS\\Films, smb://nas/films) ou serveurs web. Appliqué immédiatement.</p><div class="sources-box" data-kinds="${kind}">${sourcesHtml([kind])}</div>
        <div class="btn-row"><button type="button" class="btn btn-ghost btn-sm focusable" data-action="rescan">Analyser à nouveau</button></div></section>` }];
      if (section === 'videos') tabs.push({ id: 'infos', label: 'Infos et affiches', html: () => scrapeBlock('videos', c.search.tmdbToken ? 'Affiches, résumés, genres et fonds d’écran depuis TMDB.' : 'Ajoutez une clé TMDB (Réglages ou page Rechercher) pour récupérer affiches, résumés, genres et fonds d’écran.') });
      if (section === 'music') tabs.push({ id: 'infos', label: 'Infos et pochettes', html: () => scrapeBlock('music', 'Pochettes, artistes, années et genres depuis MusicBrainz.') });
      tabs.push({ id: 'display', label: 'Affichage', html: () => `<section class="pset"><label class="check"><input type="checkbox" class="focusable" data-ui="backdrop"${c.ui.backdrop !== false ? ' checked' : ''}> Afficher le fond d’écran de l’élément sélectionné</label>
        ${section === 'videos' ? cfgInput('externalPlayer.path', 'Lecteur externe (formats non lus par Mire, télévision)', c.externalPlayer.path, 'Détection automatique (mpv, puis VLC)') : ''}</section>` });
      return tabs;
    }
    case 'streaming':
    case 'web':
      return [
        { id: 'adblock', label: 'Bloqueur de pubs', html: () => adblockBlock() },
        { id: 'sites', label: 'Sites', html: () => `<section class="pset"><h3 class="pset-h">Ajouter un site</h3>
          <p class="set-help">Le site apparaît dans Streaming, rubrique « Autres sites ». Pour le modifier ou le retirer, voir Réglages, « Sites, jeux et consoles ».</p>
          <div class="field"><label for="ns-name">Nom</label><input class="input focusable" id="ns-name" placeholder="Arte"></div>
          <div class="field"><label for="ns-url">Adresse</label><input class="input focusable" id="ns-url" placeholder="https://www.arte.tv/fr/"></div>
          <div class="btn-row"><button type="button" class="btn btn-primary btn-sm focusable" data-action="add-site">Ajouter</button></div></section>` },
      ];
    case 'tv':
      return [{ id: 'tv', label: 'Télévision', html: () => tvBlock() }];
    case 'downloads':
      return [{ id: 'downloads', label: 'Téléchargements', html: () => `<section class="pset"><h3 class="pset-h">Torrents</h3>
        <div class="field"><label for="cfg-tclient">Client torrent</label><select class="input focusable" id="cfg-tclient" data-cfg="downloads.torrentClient">
          <option value="mire"${S.config.downloads?.torrentClient !== 'system' ? ' selected' : ''}>Intégré à Mire (progression suivie ici)</option>
          <option value="system"${S.config.downloads?.torrentClient === 'system' ? ' selected' : ''}>Logiciel installé sur l’ordinateur (qBittorrent, Transmission…)</option></select></div>
        <p class="set-help">Avec un logiciel installé, Mire lui confie le lien ou le fichier : le téléchargement se suit alors dans ce logiciel.</p>
        <label class="check"><input type="checkbox" class="focusable" data-cfg-bool="downloads.seed"${S.config.downloads?.seed ? ' checked' : ''}> Continuer à partager un torrent une fois téléchargé (tant que Mire est ouvert)</label></section>
        <section class="pset"><h3 class="pset-h">Dossier</h3>
        <div class="field"><label for="cfg-dldir">Dossier des téléchargements</label><div class="field-row"><input class="input focusable" id="cfg-dldir" data-cfg="downloads.dir" value="${esc(S.config.downloads?.dir || '')}" placeholder="Téléchargements/Mire"><button type="button" class="btn focusable" data-action="dl-pick-dir">Parcourir</button></div></div>
        <p class="set-help">Les jeux téléchargés pour une console vont toujours dans le dossier principal de cette console.</p></section>` }];
    case 'games':
      return [
        { id: 'consoles', label: 'Consoles', html: () => consolesBlock() },
        { id: 'store', label: 'Boutique', html: () => viewStore() },
        { id: 'pc', label: 'Jeux PC', html: () => `<section class="pset"><h3 class="pset-h">Dossiers de jeux PC</h3><p class="set-help">Analysés automatiquement : un jeu par raccourci ou par sous-dossier.</p><div class="sources-box" data-kinds="game">${sourcesHtml(['game'])}</div>
          <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="add-game">Ajouter un jeu à la main</button></div></section>
          <section class="pset"><h3 class="pset-h">Sites pour télécharger des jeux PC</h3>
          <p class="set-help">Mire ne propose aucun site d’office. Ajoutez ceux que vous voulez : « Ajouter des jeux PC » les ouvrira dans un navigateur intégré, avec recherche et téléchargement, comme pour les consoles. Un par ligne : « Nom | adresse | adresse de recherche avec {q} ».</p>
          <textarea class="input focusable" id="pc-sites" rows="4" placeholder="Nom | https://… | https://…?q={q}">${esc(sitesToText(c.pcSites))}</textarea>
          <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="save-pc-sites">Enregistrer les sites</button></div></section>` },
        { id: 'infos', label: 'Infos et jaquettes', html: () => scrapeBlock('games', 'Jaquettes, genres, années et fonds : libretro pour les consoles, Steam pour les jeux PC.') },
        { id: 'maint', label: 'Entretien', html: () => `<section class="pset"><h3 class="pset-h">Liste des jeux</h3>
          <p class="set-help">La liste des jeux réunit vos jeux PC et les jeux de console présents sur l’ordinateur, filtrables par système. Pour un jeu venant d’une source en ligne, ouvrez la console puis « Afficher les jeux en ligne ».</p>
          <label class="check"><input type="checkbox" class="focusable" data-cfg-bool="gamesOpts.autoOnline"${c.gamesOpts?.autoOnline ? ' checked' : ''}> Afficher d’emblée les jeux en ligne en ouvrant une console (sans cliquer sur « Afficher »)</label>
          <h3 class="set-sub">Nettoyage</h3>
          <p class="set-help">Vérifie que chaque jeu est toujours disponible : fichiers locaux présents, et sources en ligne joignables si vous le demandez. Les jeux PC dont le fichier a disparu sont retirés de la liste.</p>
          <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="games-cleanup">Nettoyer la base de jeux</button></div></section>` },
      ];
    default:
      return null;
  }
}

function tvBlock() {
  const c = S.config;
  const rows = c.tv.services.map((t) => `<li class="tv-row${t.id === c.tv.active ? ' active' : ''}">
      <label class="radio"><input type="radio" name="tv-svc" class="focusable" data-action="tv-service-radio" data-id="${esc(t.id)}"${t.id === c.tv.active ? ' checked' : ''}>
        <span class="tv-name">${esc(t.name)}<span class="tv-sub">${t.kind === 'web' ? 'portail web' : 'playlist M3U'}${t.id === c.tv.active ? ' · actif' : ''}</span></span></label>
    </li>`).join('');
  const active = c.tv.services.find((t) => t.id === c.tv.active);
  return `<section class="pset"><h3 class="pset-h">Service de télévision</h3>
    <p class="set-help">Au premier lancement, Mire reconnaît votre box sur le réseau. Vous pouvez aussi choisir le service à la main.</p>
    <ul class="folder-list">${rows}</ul>
    <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="tv-detect">Détecter ma box</button>${active ? '<button type="button" class="btn btn-sm focusable" data-action="tv-reload">Recharger</button>' : ''}</div></section>
    ${active && active.kind === 'playlist' ? `<section class="pset"><h3 class="pset-h">${esc(active.name)}</h3>
      <div class="field"><label for="tv-url">Adresse de la playlist</label><input class="input focusable" id="tv-url" data-tv-url="${esc(active.id)}" value="${esc(active.url || '')}"></div></section>` : ''}
    <section class="pset"><h3 class="pset-h">Lecteur</h3>${cfgInput('externalPlayer.path', 'Lecteur externe (mpv, VLC)', c.externalPlayer.path, 'Détection automatique')}</section>`;
}

function consolesBlock() {
  const list = S.config.emulators;
  const rows = list.length ? list.map((e, i) => `<li class="con-row">
      <span class="con-thumb"${e.banner ? ` style="background-image:url('${esc(mediaUrl(e.banner)).replace(/'/g, '%27')}')"` : ''}></span>
      <span class="con-name">${esc(e.name)}<span class="con-sub">${esc([e.system || '', plural((e.sources || []).length + (e.romsDir ? 1 : 0), 'source')].filter(Boolean).join(', '))}</span></span>
      <button type="button" class="btn btn-ghost btn-sm focusable" data-action="edit-console" data-index="${i}">Modifier</button>
    </li>`).join('') : '<li class="none">Aucune console. L’onglet Boutique les installe en un clic.</li>';
  return `<section class="pset"><p class="set-help">« Modifier » change l’émulateur, les dossiers et sources de jeux, et la bannière affichée dans Jeux.</p><ul class="folder-list con-list">${rows}</ul></section>`;
}

function adblockBlock() {
  const c = S.config;
  return `<section class="pset" id="set-adblock">
    <p class="set-help">Bloque publicités, pistage, fenêtres surgissantes et redirections publicitaires dans les sites, avec les listes d’Adblock Plus et d’uBlock Origin.</p>
    <label class="check"><input type="checkbox" class="focusable" data-ui="adblock"${c.adblock?.enabled !== false ? ' checked' : ''}> Bloquer les publicités dans les sites</label>
    <p class="set-help" id="adblock-status">Vérification…</p>
    <div class="btn-row"><button type="button" class="btn btn-sm focusable" data-action="adblock-update">Mettre à jour les listes</button></div>
    <h3 class="set-sub">Sites où le bloqueur est désactivé</h3><ul class="folder-list" id="adblock-allow"></ul>
    <h3 class="set-sub">Listes de filtres supplémentaires</h3><ul class="folder-list" id="adblock-lists"></ul>
    <div class="field-row"><input class="input focusable" id="adblock-new" placeholder="Adresse d’une liste au format Adblock Plus ou uBlock (https://…)"><button type="button" class="btn btn-sm focusable" data-action="adblock-add-list">Ajouter</button></div>
  </section>`;
}

function renderPanel(keepFocus = true) {
  const tabs = panelSpec(P.section);
  if (!tabs) return;
  if (!tabs.some((t) => t.id === P.tab)) P.tab = tabs[0].id;
  const active = document.activeElement;
  const sel = keepFocus && panelBody.contains(active) ? focusSelectorOf(active) : null;
  const scroll = panelBody.scrollTop;
  panelTabs.innerHTML = tabs.length > 1 ? tabs.map((t) => `<button type="button" class="tab focusable" role="tab" data-panel-tab="${t.id}" aria-selected="${t.id === P.tab}">${esc(t.label)}</button>`).join('') : '';
  panelTabs.hidden = tabs.length < 2;
  panelBody.innerHTML = tabs.find((t) => t.id === P.tab).html();
  panelBody.scrollTop = scroll;
  if (P.tab === 'adblock') fillAdblock();
  if (sel) panelBody.querySelector(sel)?.focus({ preventScroll: true });
}

function openPageSettings(tab) {
  const section = S.section === 'games' && S.romsOf != null ? 'games' : S.section;
  if (!panelSpec(section)) { go('settings'); return; }
  P.section = section;
  P.tab = tab || (section === P.lastSection ? P.tab : null);
  P.lastSection = section;
  $('#panel-title').textContent = `Réglages : ${PANEL_TITLES[section] || ''}`;
  renderPanel(false);
  if (S.section === 'web') api.webHide();
  openModal(panel);
  (panelTabs.querySelector('[aria-selected="true"]') || panelBody.querySelector('.focusable'))?.focus();
}
function refreshPanel() { if (panel.open) renderPanel(); }

panel.addEventListener('close', () => {
  if (S.section === 'web') syncWeb();
  if (['videos', 'music', 'images', 'games', 'home', 'tv', 'streaming', 'downloads'].includes(S.section)) render();
  gearBtn.focus({ preventScroll: true });
});
panelBody.addEventListener('change', (e) => onUiChange(e));
panel.addEventListener('click', (e) => {
  if (e.target === panel || e.target.closest('[data-panel-close]')) { panel.close(); return; }
  const tab = e.target.closest('[data-panel-tab]');
  if (tab) { P.tab = tab.dataset.panelTab; renderPanel(false); panelTabs.querySelector(`[data-panel-tab="${P.tab}"]`)?.focus(); }
});

// Champs enregistrés dès qu'ils changent.
async function setCfg(pathStr, value) {
  const next = structuredClone(S.config);
  const keys = pathStr.split('.');
  let o = next;
  for (const k of keys.slice(0, -1)) { o[k] = o[k] || {}; o = o[k]; }
  o[keys[keys.length - 1]] = value;
  S.config = await api.saveConfig(next);
  if (pathStr.startsWith('tv.')) { S.channels = null; S.tvError = null; }
  if (pathStr.startsWith('search.')) S.tmdb = { q: '', status: 'idle', results: [] };
  if (pathStr.startsWith('downloads.')) S.dlSettings = { ...S.dlSettings, ...(S.config.downloads || {}) };
  toast('Enregistré', { duration: 1500 });
}
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset?.tvUrl) {
    const id = t.dataset.tvUrl;
    const services = S.config.tv.services.map((x) => (x.id === id ? { ...x, url: t.value.trim() } : x));
    api.saveConfig({ ...S.config, tv: { ...S.config.tv, services } }).then((cfg) => { S.config = cfg; S.channels = null; S.tvError = null; toast('Adresse enregistrée', { duration: 1500 }); });
  } else if (t.dataset?.cfg) setCfg(t.dataset.cfg, t.value.trim());
  else if (t.dataset?.cfgBool) setCfg(t.dataset.cfgBool, t.checked);
});

/* ---------- Boîte de dialogue générique : champs, images, listes de sources ---------- */

const dlg = $('#dlg');
const dlgForm = $('#dlg-form');

// Plusieurs fenêtres peuvent être ouvertes (réglages de page, puis modification, puis choix d'une fiche) :
// la dernière ouverte est celle qui reçoit le clavier et la manette.
function openModal(d) { d.dataset.opened = String(Date.now() + Math.random()); d.showModal(); }
function topDialog() {
  return [...document.querySelectorAll('dialog[open]')].sort((a, b) => Number(a.dataset.opened || 0) - Number(b.dataset.opened || 0)).pop() || null;
}

function fieldHtml(f) {
  const id = `dlgf-${f.id}`;
  const cls = `field${f.full ? ' full' : ''}`;
  const dl = f.options?.length && f.type !== 'select' ? `<datalist id="dl-${f.id}">${f.options.map((o) => `<option value="${esc(o)}"></option>`).join('')}</datalist>` : '';
  if (f.type === 'select') return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label><select class="input focusable" id="${id}">${(f.options || []).map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}"${val === f.value ? ' selected' : ''}>${esc(lab)}</option>`; }).join('')}</select></div>`;
  if (f.type === 'textarea') return `<div class="${cls} full"><label for="${id}">${esc(f.label)}</label><textarea class="input focusable" id="${id}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea></div>`;
  if (f.type === 'image') {
    return `<div class="${cls}"><span class="flabel">${esc(f.label)}</span><div class="img-field"><span class="img-prev${f.wide ? ' wide' : ''}" data-img="${f.id}">${f.value ? `<img alt="" src="${esc(mediaUrl(f.value))}">` : '<span>Aucune</span>'}</span>
      <div class="img-btns"><button type="button" class="btn btn-sm focusable" data-dlg="pick:${f.id}">Choisir une image</button><button type="button" class="btn btn-ghost btn-sm focusable" data-dlg="clear:${f.id}">Retirer</button></div></div></div>`;
  }
  if (f.type === 'list') {
    return `<div class="${cls} full"><span class="flabel">${esc(f.label)}</span><ul class="dlg-list" data-list="${f.id}"></ul>
      <div class="field-row"><input class="input focusable" id="${id}-new" placeholder="${esc(f.placeholder || '')}"><button type="button" class="btn btn-sm focusable" data-dlg="list-add:${f.id}">Ajouter</button><button type="button" class="btn btn-ghost btn-sm focusable" data-dlg="list-folder:${f.id}">Choisir un dossier</button></div></div>`;
  }
  const browse = f.browse ? `<button type="button" class="btn btn-sm focusable" data-dlg="browse-${f.browse}:${f.id}">Parcourir</button>` : '';
  const input = `<input class="input focusable" id="${id}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}"${dl ? ` list="dl-${f.id}"` : ''}${f.required ? ' required' : ''}>`;
  return `<div class="${cls}"><label for="${id}">${esc(f.label)}</label>${browse ? `<div class="field-row">${input}${browse}</div>` : input}${dl}</div>`;
}

// Question oui/non (annuler un téléchargement, tout télécharger…).
async function confirmDialog(title, help, yesLabel) {
  const res = await openForm({ title, help, fields: [], actions: [{ id: 'yes', label: yesLabel, kind: 'primary' }, { id: 'no', label: 'Non', kind: 'ghost' }] });
  return res?.action === 'yes';
}

function openForm({ title, help = '', fields, actions, onAction, wide = false }) {
  $('#dlg-title').textContent = title;
  $('#dlg-help').textContent = help;
  dlg.classList.toggle('wide', wide);
  const box = $('#dlg-fields');
  box.innerHTML = fields.map(fieldHtml).join('');
  $('#dlg-actions').innerHTML = actions.map((a) => `<button type="${a.kind === 'primary' ? 'submit' : 'button'}" class="btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'ghost' ? 'btn-ghost' : ''} focusable" data-dlg="${a.id}">${esc(a.label)}</button>`).join('');
  const lists = {};
  const renderList = (id) => {
    const ul = box.querySelector(`[data-list="${id}"]`);
    if (!ul) return;
    ul.innerHTML = lists[id].length
      ? lists[id].map((v, n) => `<li><span class="src-type">${sourceKindLabel(v)}</span><span class="src-loc">${esc(v)}</span><button type="button" class="btn btn-ghost btn-sm focusable" data-dlg="list-del:${id}:${n}">Retirer</button></li>`).join('')
      : '<li class="none">Aucune source supplémentaire.</li>';
  };
  for (const f of fields) if (f.type === 'list') { lists[f.id] = [...(f.value || [])]; renderList(f.id); }

  const form = {
    values() {
      const v = {};
      for (const f of fields) {
        if (f.type === 'list') v[f.id] = [...lists[f.id]];
        else if (f.type !== 'image') { const el = $(`#dlgf-${f.id}`); if (el) v[f.id] = el.value.trim(); }
      }
      return v;
    },
    set(id, value) { const el = $(`#dlgf-${id}`); if (el) el.value = value ?? ''; },
    setImage(id, src) { const el = box.querySelector(`[data-img="${id}"]`); if (el) el.innerHTML = src ? `<img alt="" src="${esc(mediaUrl(src))}">` : '<span>Aucune</span>'; },
    help(text) { $('#dlg-help').textContent = text; },
  };

  return new Promise((resolve) => {
    let done = false;
    const finish = (action) => {
      if (done) return;
      done = true;
      const values = form.values();
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
      dlg.close();
      resolve({ action, values });
    };
    async function onClick(e) {
      const b = e.target.closest('[data-dlg]');
      if (!b) return;
      e.preventDefault();
      const [act, id, n] = b.dataset.dlg.split(':');
      if (act === 'cancel') { finish('cancel'); return; }
      if (act === 'list-del') { lists[id].splice(Number(n), 1); renderList(id); return; }
      if (act === 'list-add') {
        const input = $(`#dlgf-${id}-new`);
        const v = input.value.trim();
        if (v && !lists[id].includes(v)) { lists[id].push(v); renderList(id); }
        input.value = '';
        return;
      }
      if (act === 'list-folder') { const p = await api.pickFolder(); if (p && !lists[id].includes(p)) { lists[id].push(p); renderList(id); } return; }
      if (act === 'browse-file') { const p = await api.pickFile('program'); if (p) form.set(id, p); return; }
      if (act === 'browse-folder') { const p = await api.pickFolder(); if (p) form.set(id, p); return; }
      if (b.type === 'submit' && !dlgForm.reportValidity()) return;
      const keepOpen = onAction ? await onAction(b.dataset.dlg, form) : false;
      if (!keepOpen) finish(b.dataset.dlg);
    }
    function onCancel(e) { e.preventDefault(); finish('cancel'); }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    openModal(dlg);
    (box.querySelector('input, textarea') || dlg.querySelector('[data-dlg]'))?.focus();
  });
}
dlgForm.addEventListener('submit', (e) => e.preventDefault());

/* ---------- Choisir la bonne fiche parmi celles trouvées en ligne ---------- */

const pickDlg = $('#pick');
function pickCandidate(items, { title, help }) {
  $('#pick-title').textContent = title;
  $('#pick-help').textContent = help || '';
  const grid = $('#pick-grid');
  grid.innerHTML = items.map((c, n) => `<button type="button" class="pick-card focusable" data-pick="${n}">
      <span class="pick-art">${c.image ? `<img alt="" loading="lazy" src="${esc(c.image)}"${c.fallback ? ` data-fallback="${esc(c.fallback)}"` : ''}>` : ''}<span class="pick-mono">${esc(monogram(c.title))}</span></span>
      <span class="pick-title">${esc(c.title)}</span>
      <span class="pick-sub">${esc([c.year, c.sub].filter(Boolean).join(', '))}</span>
    </button>`).join('');
  // Image manquante : on essaie la vignette de secours, sinon on garde l'initiale.
  for (const img of grid.querySelectorAll('img')) {
    img.addEventListener('error', () => { if (img.dataset.fallback) { img.src = img.dataset.fallback; delete img.dataset.fallback; } else img.remove(); });
  }
  return new Promise((resolve) => {
    const done = (v) => { pickDlg.removeEventListener('click', onClick); pickDlg.removeEventListener('cancel', onCancel); pickDlg.close(); resolve(v); };
    function onClick(e) {
      const b = e.target.closest('[data-pick]');
      if (b) { done(items[Number(b.dataset.pick)]); return; }
      if (e.target.closest('[data-pick-cancel]')) done(null);
    }
    function onCancel(e) { e.preventDefault(); done(null); }
    pickDlg.addEventListener('click', onClick);
    pickDlg.addEventListener('cancel', onCancel);
    openModal(pickDlg);
    grid.querySelector('.pick-card')?.focus();
  });
}

/* ---------- Modifier un média ou un jeu ---------- */

const EDIT_FIELDS = {
  video: ['title', 'year', 'genre', 'overview', 'image', 'backdrop'],
  album: ['title', 'artist', 'year', 'genre', 'image', 'backdrop'],
  track: ['title', 'genre'],
  image: ['title', 'genre'],
  rom: ['title', 'year', 'genre', 'overview', 'image', 'backdrop'],
  game: ['title', 'year', 'genre', 'overview', 'image', 'backdrop'],
};
const FIELD_LABELS = { title: 'Titre', artist: 'Artiste', year: 'Année', genre: 'Genre', overview: 'Résumé', image: 'Image', backdrop: 'Fond d’écran' };

// Genres déjà utilisés, proposés dans la liste du champ Genre.
function knownGenres(kind) {
  const pool = kind === 'video' ? S.videos : kind === 'album' || kind === 'track' ? S.tracks : kind === 'image' ? S.images : kind === 'game' ? gameEntries() : (S.roms || Object.values(S.localRoms).flat()).map((r) => ({ ...r, kind: 'rom' }));
  const set = new Set();
  for (const it of pool) for (const g of genresOf(withScrape(it))) set.add(g);
  return [...set].sort(collator.compare);
}

// Valeurs « d'origine » (fichier et infos en ligne), sans les modifications manuelles.
function baseValues(kind, it) {
  const sc = kind === 'track' ? {} : S.scrape[kind === 'album' ? `a:${it.dir}` : scrapeKey(it)] || {};
  const m = kind === 'album' ? /^(.+?)\s+-\s+(.+)$/.exec(it.folder || '') : null;
  const title = {
    video: sc.series ? it.name : (sc.title || it.name),
    album: m ? m[2] : (sc.title || it.folder),
    track: cleanTrack(it.name),
    image: it.name,
    rom: sc.title || it.displayName || it.name,
    game: sc.title || it.name,
  }[kind];
  return {
    title,
    artist: kind === 'album' ? (m ? m[1] : sc.artist || '') : '',
    year: sc.year || '',
    genre: sc.genre || '',
    overview: sc.overview || '',
    image: it.cover || it.image || sc.image || '',
    backdrop: it.fanart || sc.backdrop || '',
  };
}

// Un jeu présent sur l'ordinateur peut être supprimé (jeu PC manuel ou fichier de console local).
function deletableGame(ref) {
  const it = ref?.item;
  if (!it) return false;
  if (ref.kind === 'rom') return !it.remote;
  if (ref.kind === 'game') return !it.auto;
  return false;
}
async function deleteGameRef(ref) {
  const it = ref.item;
  const payload = { kind: ref.kind, path: it.path, label: labelOf(it), manualIndex: it.manualIndex, emuIndex: it.emuIndex != null ? it.emuIndex : (ref.kind === 'rom' ? S.romsOf : undefined) };
  const ok = await confirmDialog(`Supprimer « ${payload.label} » ?`, ref.kind === 'rom' ? 'Le fichier du jeu sera supprimé de l’ordinateur.' : 'Le jeu sera retiré de la liste.', 'Supprimer');
  if (!ok) return;
  const r = await api.gameDelete(payload);
  if (!r?.ok) { toast(r?.error || 'Suppression impossible.', { duration: 8000 }); return; }
  if (r.config) S.config = r.config;
  if (ref.kind === 'rom' && payload.emuIndex != null) { const rr = await api.listRoms(payload.emuIndex); if (rr?.ok) { S.localRoms[payload.emuIndex] = rr.roms; if (S.romsOf === payload.emuIndex) S.roms = rr.roms; } }
  else S.autoGames = S.autoGames.filter((g) => g.path !== payload.path);
  toast('Jeu supprimé');
  render();
}

async function editRef(ref) {
  if (!ref) return;
  if (ref.kind === 'console') { editConsole(ref.index); return; }
  if (!ref.item || !EDIT_FIELDS[ref.kind]) return;
  const kind = ref.kind;
  const it = ref.item;
  const key = metaKey(it, kind);
  const base = baseValues(kind, it);
  const cur = () => ({ ...base, ...(S.meta[key] || {}) });
  const v = cur();
  const manualGame = kind === 'game' && it.manualIndex != null ? S.config.games[it.manualIndex] : null;
  const fields = EDIT_FIELDS[kind].map((f) => {
    if (f === 'image' || f === 'backdrop') return { id: f, type: 'image', label: FIELD_LABELS[f], value: v[f], wide: f === 'backdrop' };
    if (f === 'overview') return { id: f, type: 'textarea', label: FIELD_LABELS[f], value: v[f] };
    if (f === 'genre') return { id: f, label: 'Genre (plusieurs : séparés par des virgules)', value: v[f], options: knownGenres(kind), full: true };
    return { id: f, label: FIELD_LABELS[f], value: v[f], full: f === 'title' };
  });
  if (manualGame) {
    fields.push({ id: 'gpath', label: 'Programme ou raccourci', value: manualGame.path, browse: 'file', full: true });
    fields.push({ id: 'gargs', label: 'Arguments', value: joinArgs(manualGame.args || []), full: true });
  }
  const canScrape = ['video', 'album', 'rom', 'game'].includes(kind);
  const actions = [
    { id: 'save', label: 'Enregistrer', kind: 'primary' },
    ...(canScrape ? [{ id: 'scrape', label: 'Rechercher en ligne' }] : []),
    { id: 'reset', label: 'Réinitialiser', kind: 'ghost' },
    { id: 'cancel', label: 'Annuler', kind: 'ghost' },
  ];
  const kindWord = { video: 'la vidéo', album: 'l’album', track: 'le morceau', image: 'l’image', rom: 'le jeu', game: 'le jeu' }[kind];
  const res = await openForm({
    title: `Modifier ${kindWord}`,
    help: (() => { const p = it.path || it.dir || ''; try { return it.remote ? decodeURI(p) : p; } catch { return p; } })(),
    fields,
    actions,
    wide: fields.length > 3,
    async onAction(action, form) {
      const [act, field] = action.split(':');
      if (act === 'pick') {
        const m = await api.metaPickImage(key, field);
        if (m) { S.meta[key] = m; form.setImage(field, m[field]); }
        return true;
      }
      if (act === 'clear') {
        const m = await api.metaSet(key, { [field]: '' });
        if (m) S.meta[key] = m; else delete S.meta[key];
        form.setImage(field, base[field]);
        return true;
      }
      if (act === 'scrape') {
        const val = form.values();
        form.help('Recherche des fiches…');
        const job = {
          video: { kind: 'video', item: { path: it.path, name: it.name, dir: it.dir } },
          album: { kind: 'album', item: { dir: it.dir, folder: it.folder } },
          rom: { kind: 'rom', item: { path: it.path, name: it.name, displayName: it.displayName, emu: ref.emu } },
          game: { kind: 'pc', item: { name: it.name, path: it.path } },
        }[kind];
        const found = await api.scrapeCandidates({ ...job, query: val.title, year: val.year, artist: val.artist });
        if (!found?.ok) { form.help(found?.error || 'La recherche n’a pas abouti.'); return true; }
        if (!found.items.length) { form.help('Aucune fiche trouvée avec ce titre. Essayez une autre orthographe, puis « Rechercher en ligne ».'); return true; }
        const pick = await pickCandidate(found.items, {
          title: 'Choisir la bonne fiche',
          help: `${plural(found.items.length, 'fiche trouvée', 'fiches trouvées')} pour « ${val.title} ». Les plus proches du titre sont en premier.`,
        });
        if (!pick) { form.help('Aucune fiche choisie.'); return true; }
        form.help(`Récupération de « ${pick.title} »…`);
        const r = await api.scrapeOne({ ...job, override: { pick } });
        if (!r?.ok) { form.help(r?.error || 'Impossible de récupérer cette fiche.'); return true; }
        S.scrape = (await api.scrapeData()) || {};
        const nb = baseValues(kind, it);
        Object.assign(base, nb);
        for (const f of EDIT_FIELDS[kind]) {
          if (f === 'image' || f === 'backdrop') { if (!S.meta[key]?.[f]) form.setImage(f, nb[f]); } else form.set(f, nb[f]);
        }
        // Les champs prennent les nouvelles valeurs : on retire les anciennes saisies qui les masqueraient.
        if (S.meta[key]) {
          const cleared = await api.metaSet(key, { title: '', year: '', genre: '', overview: '', artist: '' });
          if (cleared) S.meta[key] = cleared; else delete S.meta[key];
        }
        form.help(`Fiche « ${pick.title} » récupérée : vérifiez les champs, puis enregistrez.`);
        return true;
      }
      if (act === 'reset') { await api.metaReset(key); delete S.meta[key]; return false; }
      if (act === 'save') {
        const val = form.values();
        const patch = {};
        for (const f of EDIT_FIELDS[kind]) if (f !== 'image' && f !== 'backdrop') patch[f] = val[f] === base[f] ? '' : val[f];
        const m = await api.metaSet(key, patch);
        if (m) S.meta[key] = m; else delete S.meta[key];
        if (manualGame) {
          const next = structuredClone(S.config);
          next.games[it.manualIndex] = { ...manualGame, path: val.gpath || manualGame.path, args: parseArgs(val.gargs || '') };
          S.config = await api.saveConfig(next);
        }
        return false;
      }
      return false;
    },
  });
  if (res && res.action !== 'cancel') {
    if (res.action === 'save') toast('Modifications enregistrées');
    if (res.action === 'reset') toast('Infos d’origine rétablies');
  }
  // Les fiches modifiées pendant l'édition (images) sont à jour : on réaffiche la vue en gardant le focus.
  S.focusRef = null;
  if (S.section === 'search') refreshSearch(); else render();
}

/* ---------- Modifier une console : programme, dossiers et sources de jeux ---------- */

const LIBRETRO_SYSTEMS = [
  'Nintendo - Nintendo Entertainment System', 'Nintendo - Super Nintendo Entertainment System', 'Nintendo - Game Boy', 'Nintendo - Game Boy Color',
  'Nintendo - Game Boy Advance', 'Nintendo - Nintendo 64', 'Nintendo - Nintendo DS', 'Nintendo - Nintendo 3DS', 'Nintendo - GameCube', 'Nintendo - Wii', 'Nintendo - Wii U',
  'Sega - Mega Drive - Genesis', 'Sega - Master System - Mark III', 'Sega - Game Gear', 'Sega - Saturn', 'Sega - Dreamcast',
  'Sony - PlayStation', 'Sony - PlayStation 2', 'Sony - PlayStation Portable', 'NEC - PC Engine - TurboGrafx 16', 'Atari - 2600', 'SNK - Neo Geo Pocket Color',
];
const joinArgs = (args) => (args || []).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
const parseArgs = (txt) => [...String(txt).matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] != null ? m[1] : m[2]));

const sitesToText = (list) => (list || []).map((x) => [x.name, x.url, x.search].filter(Boolean).join(' | ')).join('\n');
function parseSites(text) {
  return String(text || '').split('\n').map((line) => line.split('|').map((x) => x.trim())).filter((p) => p.some(Boolean)).map((p) => {
    const url = p.find((x) => /^https?:\/\//i.test(x) && !x.includes('{q}')) || '';
    const search = p.find((x) => /^https?:\/\//i.test(x) && x.includes('{q}')) || '';
    const name = p.find((x) => x && !/^https?:\/\//i.test(x)) || (url ? new URL(url).hostname : '');
    return { name, url, search };
  }).filter((x) => x.url);
}

async function editConsole(i) {
  const e = S.config.emulators[i];
  if (!e) return;
  let banner = e.banner || '';
  const siteInfo = await api.romSites(i);
  const sitesText = sitesToText(siteInfo?.sites);
  const res = await openForm({
    title: `Modifier la console ${e.name}`,
    help: 'Les sources supplémentaires peuvent être des dossiers, des partages réseau ou des adresses web (une page qui liste les fichiers). Un jeu d’une source web est téléchargé une fois dans le cache de Mire avant d’être lancé.',
    wide: true,
    fields: [
      { id: 'name', label: 'Nom', value: e.name, required: true },
      { id: 'system', label: 'Système (pour les jaquettes et genres)', value: e.system || '', options: LIBRETRO_SYSTEMS },
      { id: 'path', label: 'Émulateur', value: e.path, browse: 'file', full: true, required: true },
      { id: 'args', label: 'Arguments ({rom} = chemin du jeu)', value: joinArgs(e.args?.length ? e.args : ['{rom}']), full: true },
      { id: 'romsDir', label: 'Dossier principal des jeux (téléchargements et imports)', value: e.romsDir || '', browse: 'folder', full: true },
      { id: 'sources', type: 'list', label: 'Sources supplémentaires', value: e.sources || [], placeholder: '\\\\NAS\\Jeux\\SNES, smb://nas/jeux ou http://…/snes/' },
      { id: 'extensions', label: 'Extensions des jeux (séparées par des virgules)', value: (e.extensions || []).join(', '), full: true },
      { id: 'imagesDir', label: 'Dossier de jaquettes (facultatif)', value: e.imagesDir || '', browse: 'folder', full: true },
      { id: 'banner', type: 'image', label: 'Bannière (affichée dans Jeux)', value: e.banner || '', wide: true },
      { id: 'romSites', type: 'textarea', rows: 5, label: 'Sites pour « Ajouter des jeux » : un par ligne, « Nom | adresse | adresse de recherche avec {q} » (la recherche est facultative, la loupe permet de la mémoriser). Videz le champ pour revenir aux sites proposés par Mire.', value: sitesText },
    ],
    actions: [{ id: 'save', label: 'Enregistrer', kind: 'primary' }, { id: 'delete', label: 'Supprimer la console', kind: 'ghost' }, { id: 'cancel', label: 'Annuler', kind: 'ghost' }],
    async onAction(action, form) {
      if (action === 'pick:banner') { const p = await api.pickImageFile('Choisir la bannière de la console'); if (p) { banner = p; form.setImage('banner', p); } return true; }
      if (action === 'clear:banner') { banner = ''; form.setImage('banner', ''); return true; }
      return false;
    },
  });
  if (!res || res.action === 'cancel') return;
  const next = structuredClone(S.config);
  if (res.action === 'delete') {
    const confirm = await openForm({
      title: `Supprimer la console ${e.name} ?`,
      help: 'Seule la console disparaît de Mire : l’émulateur et vos jeux restent sur le disque.',
      fields: [],
      actions: [{ id: 'yes', label: 'Supprimer', kind: 'primary' }, { id: 'cancel', label: 'Annuler', kind: 'ghost' }],
    });
    if (confirm?.action !== 'yes') return;
    next.emulators.splice(i, 1);
    S.config = await api.saveConfig(next);
    S.romsCache = {};
    refreshPanel();
    if (S.romsOf === i) closeRoms(); else if (!panel.open) render();
    toast('Console supprimée');
    return;
  }
  const v = res.values;
  next.emulators[i] = {
    ...e,
    name: v.name || e.name,
    system: v.system,
    path: v.path || e.path,
    args: parseArgs(v.args || '{rom}'),
    romsDir: v.romsDir,
    sources: v.sources,
    extensions: v.extensions.split(/[,;\s]+/).filter(Boolean).map((x) => (x.startsWith('.') ? x : `.${x}`).toLowerCase()),
    imagesDir: v.imagesDir,
    banner,
  };
  // Sites : on ne garde une liste propre à la console que si elle diffère de celle proposée par Mire.
  const parsedSites = parseSites(v.romSites);
  if (!v.romSites.trim() || JSON.stringify(parsedSites) === JSON.stringify(siteInfo?.defaults || [])) delete next.emulators[i].romSites;
  else next.emulators[i].romSites = parsedSites;
  delete S.romSites[i];
  S.config = await api.saveConfig(next);
  S.romsCache = {};
  toast('Console enregistrée');
  refreshPanel();
  if (S.romsOf === i) openEmu(i); else if (!panel.open) render();
}

/* ---------- Fond d'écran de l'élément sélectionné ---------- */

const backdropEl = $('#backdrop');
let bdTimer = 0;
let bdCurrent = '';
function backdropFor(ref) {
  const it = ref?.item;
  if (!it) return null;
  if (ref.kind === 'image') return it.native ? it.path : null;
  if (ref.kind === 'album' || ref.kind === 'track') return it.sBackdrop || it.uImage || it.cover || it.sImage || null;
  return it.sBackdrop || null;
}
function showBackdrop(src) {
  if (S.config?.ui?.backdrop === false || !src || src === bdCurrent) return;
  clearTimeout(bdTimer);
  bdTimer = setTimeout(() => {
    bdCurrent = src;
    const url = mediaUrl(src);
    const img = new Image();
    img.onload = () => {
      if (bdCurrent !== src) return;
      const [a, b] = backdropEl.children;
      const next = a.classList.contains('on') ? b : a;
      const prev = next === a ? b : a;
      next.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
      next.classList.add('on');
      prev.classList.remove('on');
      backdropEl.classList.add('show');
    };
    img.src = url;
  }, 140);
}
function hideBackdrop() {
  clearTimeout(bdTimer);
  bdCurrent = '';
  backdropEl.classList.remove('show');
  for (const l of backdropEl.children) l.classList.remove('on');
}
function onHoverItem(target) {
  const ref = refFromEl(target);
  if (!ref) return;
  if (ref.kind === 'console') {
    updateFocusInfo(target);
    const banner = S.config.emulators[ref.index]?.banner;
    if (banner) showBackdrop(banner);
    return;
  }
  if (!ref.item) return;
  updateFocusInfo(target);
  const it = ref.item.sBackdrop !== undefined ? ref.item : withScrape(ref.item);
  const consoleBanner = ref.kind === 'rom' ? S.config.emulators[S.romsOf]?.banner : null;
  showBackdrop(backdropFor({ ...ref, item: it }) || consoleBanner);
}

viewEl.addEventListener('focusin', (e) => onHoverItem(e.target));
viewEl.addEventListener('mouseover', (e) => { const t = e.target.closest('.tile, .track, .emu, .album-actions [data-action="play-album"]'); if (t) onHoverItem(t); });
// Clic droit sur un média ou un jeu : le modifier.
viewEl.addEventListener('contextmenu', (e) => {
  const ref = refFromEl(e.target);
  if (!ref) return;
  e.preventDefault();
  editRef(ref);
});

/* ------------------------------------------------------------------ */
/* Boutique                                                            */
/* ------------------------------------------------------------------ */

async function loadCatalog() {
  S.catalog = await api.storeCatalog();
  if (panel.open && P.tab === 'store') refreshPanel();
}

function fmtSize(n) {
  if (!n) return '';
  if (n > 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} Go`;
  return `${Math.round(n / 1e6)} Mo`;
}

function progressHtml(id) {
  const p = S.storeProgress[id];
  if (!p || p.phase === 'done' || p.phase === 'error') return '';
  const pct = p.total ? Math.round((p.received / p.total) * 100) : null;
  const text = p.phase === 'download' && p.total ? `${p.label}, ${fmtSize(p.received)} sur ${fmtSize(p.total)}` : p.label || 'Préparation…';
  return `<div class="st-progress"><div class="st-bar${pct == null ? ' indeterminate' : ''}" style="width:${pct == null ? 35 : pct}%"></div></div><p class="st-status">${esc(text)}</p>`;
}

function viewStore() {
  const c = S.catalog;
  if (!c) { loadCatalog(); return loading('Chargement de la boutique…'); }
  const unavailable = c.platform === 'other';
  const emuCards = c.emulators.map((e) => {
    const busy = !!S.storeProgress[e.id] && !['done', 'error'].includes(S.storeProgress[e.id].phase);
    const shownVersion = e.version && e.version !== 'latest' ? `, version ${e.version.replace(/^v/, '')}` : '';
    const status = !e.available ? 'Non disponible sur ce système' : e.installed ? `Installé${shownVersion}` : 'Non installé';
    let systems;
    let actions;
    if (e.retroarch) {
      systems = `<div class="st-systems">${e.systems.map((sy) => {
        const on = S.raPick.has(sy.id);
        return `<button class="st-sys focusable${sy.installed ? ' is-installed' : ''}" data-action="ra-pick" data-id="${sy.id}" aria-pressed="${on}">${esc(sy.name)}${sy.installed ? '<span class="st-ok">ajoutée</span>' : ''}</button>`;
      }).join('')}</div>`;
      actions = `<button class="btn btn-primary focusable" data-action="store-install" data-id="${e.id}"${busy || !e.available || !S.raPick.size ? ' disabled' : ''}>${S.raPick.size ? `Ajouter ${plural(S.raPick.size, 'console')}` : 'Choisissez des consoles'}</button>`;
    } else {
      systems = `<div class="st-systems">${e.systems.map((sy) => `<span class="st-chip">${esc(sy.name)}</span>`).join('')}</div>`;
      actions = `<button class="btn ${e.installed ? '' : 'btn-primary '}focusable" data-action="store-install" data-id="${e.id}"${busy || !e.available ? ' disabled' : ''}>${e.installed ? 'Mettre à jour' : 'Installer'}</button>`;
    }
    if (e.installed) actions += `<button class="btn btn-ghost focusable" data-action="store-uninstall" data-id="${e.id}"${busy ? ' disabled' : ''}>Désinstaller</button>`;
    return `<article class="st-card" data-store-card="${e.id}">
      <div class="st-head"><h3 class="st-name">${esc(e.name)}</h3><span class="st-state${e.installed ? ' ok' : ''}">${esc(status)}</span></div>
      <p class="st-desc">${esc(e.desc)}</p>
      ${systems}
      <div class="st-prog" id="prog-${e.id}">${progressHtml(e.id)}</div>
      <div class="st-actions">${actions}</div>
      ${e.bios ? `<div class="st-bios">
        <h4 class="st-bios-h">BIOS</h4>
        <p class="st-bios-hint">${esc(e.bios.hint)}</p>
        <p class="st-bios-files">${e.bios.files.length ? `Présents : ${esc(e.bios.files.join(', '))}` : 'Aucun fichier pour l’instant.'}</p>
        <p class="st-bios-dir" title="${esc(e.bios.dir)}">Dossier : ${esc(e.bios.dir)}</p>
        <div class="st-actions"><button class="btn btn-sm focusable" data-action="bios-add" data-id="${e.id}">Charger un BIOS…</button><button class="btn btn-sm btn-ghost focusable" data-action="bios-open" data-id="${e.id}">Ouvrir le dossier</button></div>
      </div>` : ''}
    </article>`;
  }).join('');

  const gameCards = c.games.map((g) => {
    const id = `game:${g.id}`;
    const busy = !!S.storeProgress[id] && !['done', 'error'].includes(S.storeProgress[id].phase);
    const btn = g.installed
      ? '<span class="st-state ok">Dans votre ludothèque</span>'
      : g.ready
        ? `<button class="btn btn-primary btn-sm focusable" data-action="store-game" data-id="${g.id}"${busy ? ' disabled' : ''}>Télécharger</button>`
        : `<span class="st-state">Ajoutez d’abord la console ${esc(g.systemName)}</span>`;
    return `<article class="st-game">
      <span class="art r-game st-art"><span class="art-fallback" style="--mono:var(--bar-${barFor(g.system)})" aria-hidden="true">${esc(monogram(g.name))}</span></span>
      <div class="st-gtext"><h3 class="st-gname">${esc(g.name)}</h3><p class="st-gmeta">${esc(g.systemName)}, par ${esc(g.author)}</p><p class="st-desc">${esc(g.desc)}</p>
        <div class="st-prog" id="prog-${id.replace(':', '-')}">${progressHtml(id)}</div>${btn}</div>
    </article>`;
  }).join('');

  const consoles = S.config.emulators.map((e, i) => ({ e, i })).filter(({ e }) => e.romsDir);
  const importer = consoles.length
    ? `<div class="st-import"><div class="field"><label for="st-console">Console</label><select class="input focusable" id="st-console">${consoles.map(({ e, i }) => `<option value="${i}">${esc(e.name)}</option>`).join('')}</select></div>
       <button class="btn focusable" data-action="store-import">Choisir des fichiers</button></div>`
    : '<p class="set-help">Ajoutez d’abord une console ci-dessus.</p>';

  return `<div class="st-root"><span>Dossier des jeux : <strong>${esc(c.romsRoot)}</strong></span><button class="btn btn-ghost btn-sm focusable" data-action="store-root">Changer</button></div>
    ${unavailable ? '<p class="hint">Sur ce système, installez les émulateurs depuis leur site officiel, puis déclarez-les dans Réglages.</p>' : ''}
    <h2 class="sec-h">Émulateurs</h2>
    <p class="set-help">Téléchargés depuis leurs sites officiels. Chaque console installée apparaît dans « Ma ludothèque », avec son dossier de jeux.</p>
    <div class="st-grid">${emuCards}</div>
    <h2 class="sec-h">Jeux libres</h2>
    <p class="set-help">Des jeux récents créés pour ces vieilles consoles, que leurs auteurs distribuent gratuitement.</p>
    <div class="st-games">${gameCards}</div>
    <h2 class="sec-h">Vos propres jeux</h2>
    <p class="set-help">Copiez dans la bonne console vos sauvegardes personnelles de cartouches et de disques. Mire ne fournit pas de jeux du commerce.</p>
    ${importer}`;
}

api.onStoreProgress((p) => {
  S.storeProgress[p.id] = p;
  const box = document.getElementById(`prog-${p.id.replace(':', '-')}`);
  if (p.phase === 'done' || p.phase === 'error') {
    if (p.phase === 'error') toast(p.message || 'Échec de l’installation.', { duration: 9000 });
    return; // la vue est rafraîchie à la fin de l'appel
  }
  if (box) box.innerHTML = progressHtml(p.id);
});

async function afterStoreChange(r, okMessage) {
  if (r?.config) S.config = r.config;
  else S.config = (await api.getConfig()).config;
  S.romsCache = {};
  await loadCatalog();
  if (!panel.open && S.section === 'games') render();
  if (r?.ok && okMessage) toast(okMessage, { duration: 6000 });
}

/* Délégation des clics dans la vue */
async function onActionClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t || !e.currentTarget.contains(t)) return;
  const i = t.dataset.index != null ? Number(t.dataset.index) : -1;

  switch (t.dataset.action) {
    case 'go': go(t.dataset.go, { focus: 'content' }); break;
    case 'open-file': openFileDialog(); break;
    case 'more': {
      const first = S.limit;
      S.limit += PAGE;
      render();
      viewEl.querySelector(`[data-index="${first}"]`)?.focus();
      break;
    }
    case 'play-video': openVideo(S.list, i); break;
    case 'play-track': {
      const t0 = S.list[i];
      if (S.query) playQueue(S.list, i);
      else { const album = S.list.filter((x) => x.dir === t0.dir); playQueue(album, album.indexOf(t0)); }
      break;
    }
    case 'play-album': {
      const t0 = S.list[i];
      playQueue(S.list.filter((x) => x.dir === t0.dir), 0);
      break;
    }
    case 'show-image': openImages(S.list, i); break;
    case 'play-recent': playRecent(i); break;
    case 'open-web': openWeb(t.dataset.id); break;
    case 'play-channel': playChannel(S.list[i]); break;
    case 'tv-reload': S.channels = null; S.tvWeb = null; loadChannels(); break;
    case 'tv-detect': {
      toast('Recherche de votre box sur le réseau…', { duration: 3000 });
      const r = await api.tvDetect();
      S.config = (await api.getConfig()).config;
      if (r?.id) { S.channels = null; S.tvWeb = null; loadChannels(); toast(`${r.name} détecté.`); }
      else toast('Aucune box reconnue. Choisissez votre service dans la liste.', { duration: 6000 });
      render();
      break;
    }
    case 'tv-open-web': if (S.tvWeb) openTvWeb(S.tvWeb); break;
    case 'games-cleanup': cleanupGames(); break;
    case 'launch-game': launchEntry(S.gameList[i]); break;
    case 'gamebm': downloadGameBookmark(S.gameList[i]?.bookmarkId); break;
    case 'gamebm-download': downloadGameBookmark(t.dataset.id); break;
    case 'gamebm-remove': {
      const ok = await confirmDialog('Retirer ce jeu ?', 'Le marque-page et son téléchargement en attente seront retirés.', 'Retirer');
      if (!ok) break;
      const r = await api.gameBookmarkRemove(t.dataset.id);
      if (r?.config) S.config = r.config;
      await loadDownloads();
      toast('Jeu retiré');
      render();
      break;
    }
    case 'add-game': addGame(); break;
    case 'open-emu': openEmu(i); break;
    case 'launch-rom': launchRom(S.list[i]); break;
    case 'launch-rom-u': { const it = S.list[i]; launchRom(it, it.emuIndex); break; }
    case 'back-games': closeRoms(); break;
    case 'game-system': {
      S.gameSystem = t.dataset.id;
      S.genre = '';
      S.limit = PAGE;
      render({ resetScroll: true });
      viewEl.querySelector(`[data-action="game-system"][data-id="${CSS.escape(t.dataset.id)}"]`)?.focus();
      break;
    }
    case 'rom-online': {
      S.romsOnline = true;
      S.romsOnlineLoading = true;
      S.limit = PAGE;
      render();
      const r = await api.romListSource(S.romsOf, S.romsSource || undefined);
      if (S.romsOf !== i && S.romsOf !== null) { /* console changée entre-temps */ }
      S.romsOnlineLoading = false;
      if (r?.ok) { S.roms = r.roms; S.romsWarnings = r.errors || []; }
      else toast(r?.error || 'Impossible de lire la source en ligne.', { duration: 7000 });
      render();
      break;
    }
    case 'game-delete': {
      const ref = JSON.parse(t.dataset.ref);
      const ok = await confirmDialog(`Supprimer « ${ref.label} » ?`, ref.kind === 'rom' ? 'Le fichier du jeu sera supprimé de l’ordinateur.' : 'Le jeu sera retiré de la liste.', 'Supprimer');
      if (!ok) break;
      const r = await api.gameDelete(ref);
      if (!r?.ok) { toast(r?.error || 'Suppression impossible.', { duration: 8000 }); break; }
      if (r.config) S.config = r.config;
      if (ref.kind === 'rom' && ref.emuIndex != null) { const rr = await api.listRoms(ref.emuIndex); if (rr?.ok) S.localRoms[ref.emuIndex] = rr.roms; if (S.romsOf === ref.emuIndex) S.roms = rr.roms; }
      else S.autoGames = S.autoGames.filter((g) => g.path !== ref.path);
      toast('Jeu supprimé');
      render();
      break;
    }
    case 'games-cleanup': cleanupGames(); break;
    case 'src-add-folder': addSourceFolder(t.dataset.kind); break;
    case 'src-add-url': askSourceAddress(t.dataset.kind); break;
    case 'src-remove': removeSource(t.dataset.kind, t.dataset.id); break;
    case 'manage-sources': {
      go('settings');
      const block = $('#set-sources');
      block?.scrollIntoView({ block: 'start' });
      block?.querySelector('.focusable')?.focus({ preventScroll: true });
      break;
    }
    case 'genre': {
      S.genre = t.dataset.id;
      S.limit = PAGE;
      render();
      viewEl.querySelector(`[data-action="genre"][data-id="${CSS.escape(S.genre)}"]`)?.focus();
      break;
    }
    case 'edit-focused': editRef(S.focusRef || refFromEl(viewEl.querySelector('.tile, .track'))); break;
    case 'edit-album': editRef({ kind: 'album', item: S.list[i] }); break;
    case 'edit-console': editConsole(i); break;
    case 'browse': {
      const p = await api.pickFile(t.dataset.kind);
      if (p) $(`#${t.dataset.id}`).value = p;
      break;
    }
    case 'reveal-config': api.revealConfig(); break;
    case 'open-store': openPageSettings('store'); break;
    case 'rom-sites': openRomBrowser(i); break;
    case 'pc-sites': case 'games-download': {
      if (t.dataset.id && t.dataset.id !== 'pc') { openRomBrowser(Number(t.dataset.id)); break; }
      if (!(S.config.pcSites || []).length) { toast('Ajoutez d’abord un site dans les réglages de la page Jeux, onglet Jeux PC.', { duration: 7000 }); openPageSettings('pc'); break; }
      openRomBrowser('pc');
      break;
    }
    case 'save-pc-sites': {
      const sites = parseSites($('#pc-sites').value);
      S.config = await api.saveConfig({ ...S.config, pcSites: sites });
      toast(`${plural(sites.length, 'site enregistré', 'sites enregistrés')}.`);
      break;
    }
    case 'config-export': {
      const r = await api.configExport();
      if (r?.ok) toast('Configuration exportée.');
      else if (r && !r.canceled) toast('Export impossible.', { duration: 6000 });
      break;
    }
    case 'config-import': {
      const mode = t.dataset.mode || 'replace';
      const r = await api.configImport(mode);
      if (r?.ok) { S.config = r.config; S.autoGames = []; S.localRoms = {}; toast('Configuration importée.'); scan(); loadLocalRoms(); go(S.section); }
      else if (r && !r.canceled) toast(r?.error || 'Import impossible.', { duration: 8000 });
      break;
    }
    case 'tv-service-radio': api.tvSetActive(t.dataset.id).then((cfg) => { S.config = cfg; S.channels = null; S.tvWeb = null; S.tvError = null; refreshPanel(); if (S.section === 'tv') loadChannels(); }); break;
    case 'rom-dl': {
      const r = await api.romDownload(S.romsOf, t.dataset.path);
      if (!r?.ok) toast(r?.error || 'Téléchargement impossible.', { duration: 6000 });
      else if (r.total > 1 && !r.count) toast('Tous les fichiers de ce jeu sont déjà sur l’ordinateur.');
      else toast(r.total > 1 ? `${plural(r.count, 'fichier', 'fichiers')} à télécharger pour ce jeu (l’index et ses pistes), dans un dossier à son nom. Suivez-les dans Téléchargements.` : 'Téléchargement ajouté : il ira dans le dossier de la console. Suivez-le dans Téléchargements.', { duration: 7000 });
      break;
    }
    case 'rom-dl-all': {
      const online = S.list.filter((r) => r.remote);
      const all = (S.roms || []).filter((r) => r.remote);
      const fileOf = (r) => decodeURIComponent(String(r.path).split('/').pop().split('?')[0]).toLowerCase();
      const localNames = new Set((S.roms || []).filter((r) => !r.remote).map((r) => String(r.path).split(/[\\/]/).pop().toLowerCase()));
      const todo = all.filter((r) => !localNames.has(fileOf(r)));
      if (!todo.length) break;
      const ok = await confirmDialog(`Télécharger ${plural(todo.length, 'jeu', 'jeux')} dans le dossier de ${S.config.emulators[S.romsOf]?.name || 'la console'} ?`, 'Selon leur taille, cela peut prendre de la place et du temps. Vous pourrez suivre et mettre en pause chaque téléchargement dans Téléchargements.', 'Tout télécharger');
      if (!ok) break;
      let n = 0;
      for (const r of todo) { const res = await api.romDownload(S.romsOf, r.path); if (res?.ok) n++; }
      void online;
      toast(`${plural(n, 'téléchargement ajouté', 'téléchargements ajoutés')}. Suivez-les dans Téléchargements.`, { duration: 6000 });
      break;
    }
    case 'dl-add': {
      const url = $('#dl-url').value.trim();
      if (!url) { toast('Collez d’abord un lien (https://… ou magnet:?…).'); break; }
      const dest = $('#dl-dest').value;
      const r = await api.downloadsAddUrl(url, dest === '' ? {} : { console: Number(dest) });
      if (!r?.ok) { toast(r?.error || 'Ce lien n’a pas pu être ajouté.', { duration: 8000 }); break; }
      $('#dl-url').value = '';
      toast(r.external ? 'Lien confié à votre logiciel de torrent.' : 'Téléchargement ajouté.');
      break;
    }
    case 'dl-torrent': {
      const dest = $('#dl-dest')?.value || '';
      const r = await api.downloadsAddTorrentFile(dest === '' ? {} : { console: Number(dest) });
      if (r && !r.ok && !r.canceled) toast(r.error || 'Ce fichier .torrent n’a pas pu être ajouté.', { duration: 8000 });
      break;
    }
    case 'dl-pause': await api.downloadsPause(t.dataset.id); break;
    case 'dl-resume': await api.downloadsResume(t.dataset.id); break;
    case 'dl-start': { await api.downloadsResume(t.dataset.id); toast('Téléchargement lancé.'); break; }
    case 'dl-cancel': {
      const d = S.downloads.find((x) => x.id === t.dataset.id);
      const ok = await confirmDialog(`Annuler « ${d?.name || 'ce téléchargement'} » ?`, 'Les fichiers déjà téléchargés pour lui seront supprimés.', 'Annuler le téléchargement');
      if (ok) await api.downloadsCancel(t.dataset.id, true);
      break;
    }
    case 'dl-remove': await api.downloadsRemove(t.dataset.id); break;
    case 'dl-clear': { const r = await api.downloadsClear(); S.downloads = r || []; render(); updateDlBadge(); break; }
    case 'dl-reveal': await api.downloadsReveal(t.dataset.id); break;
    case 'dl-install': {
      const r = await api.downloadsRunInstaller(t.dataset.id, t.dataset.file);
      if (!r?.ok) toast(r?.error || 'Le programme d’installation n’a pas pu être lancé.', { duration: 8000 });
      break;
    }
    case 'dl-pick-dir': {
      const dir = await api.downloadsPickDir();
      if (dir) { await setCfg('downloads.dir', dir); S.dlSettings.dir = dir; refreshPanel(); }
      break;
    }
    case 'bios-add': {
      const r = await api.biosAdd(t.dataset.id);
      if (r?.ok) { toast(`${plural(r.copied.length, 'fichier copié', 'fichiers copiés')} dans le dossier des BIOS.`); await loadCatalog(); }
      else if (r && !r.canceled) toast(r.error || 'Copie impossible.', { duration: 8000 });
      break;
    }
    case 'bios-open': { const r = await api.biosOpen(t.dataset.id); if (r && !r.ok && r.error) toast(r.error); break; }
    case 'rom-site-search': {
      const site = (S.romSites[i] || [])[Number(t.dataset.id)];
      if (!site) break;
      if (!site.search) { openRomBrowser(i, { site: Number(t.dataset.id) }); setTimeout(() => toast(`La recherche de ${site.name} n’est pas encore connue : cherchez le mot « mire » sur le site, puis appuyez sur la loupe.`, { duration: 9000 }), 2600); break; }
      openRomBrowser(i, { site: Number(t.dataset.id), url: searchUrlFor(site, S.query) });
      break;
    }
    case 'scrape-section': {
      if (S.scraping?.running) { api.scrapeCancel(); break; }
      startScrape([t.dataset.kind], { force: t.dataset.force === '1' });
      updateScrapeButton();
      break;
    }
    case 'menu-pos': {
      const pos = t.dataset.id;
      await saveUi((ui) => { ui.menu = { ...ui.menu, position: pos }; });
      applyMenu();
      for (const b of $$('[data-action="menu-pos"]')) b.setAttribute('aria-pressed', String(b.dataset.id === pos));
      break;
    }
    case 'clear-queries': try { localStorage.removeItem('queries'); } catch { /* rien */ } toast('Recherches récentes effacées'); break;
    case 'add-site': {
      const name = $('#ns-name').value.trim();
      let url = $('#ns-url').value.trim();
      if (!name || !url) { toast('Indiquez un nom et une adresse.'); break; }
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      const next = structuredClone(S.config);
      next.web.push({ name, url, mode: 'integrated', color: '#59625B', search: '' });
      S.config = await api.saveConfig(next);
      $('#ns-name').value = '';
      $('#ns-url').value = '';
      toast(`${name} ajouté dans Streaming`);
      break;
    }
    case 'scrape-fix': editRef({ kind: 'video', item: S.list.find((x) => x.path === t.dataset.id) }); break;
    case 'ra-pick': {
      const id = t.dataset.id;
      if (S.raPick.has(id)) S.raPick.delete(id); else S.raPick.add(id);
      if (panel.open) refreshPanel(); else render();
      break;
    }
    case 'store-install': {
      const id = t.dataset.id;
      const systems = id === 'retroarch' ? [...S.raPick] : [];
      S.storeProgress[id] = { phase: 'resolve', label: 'Préparation…' };
      refreshPanel();
      const r = await api.storeInstall(id, systems);
      delete S.storeProgress[id];
      if (r?.ok && id === 'retroarch') S.raPick.clear();
      await afterStoreChange(r, r?.ok ? 'Installé. Les consoles sont prêtes dans « Ma ludothèque ».' : '');
      break;
    }
    case 'store-uninstall': {
      const r = await api.storeUninstall(t.dataset.id);
      await afterStoreChange(r, 'Émulateur désinstallé. Vos jeux sont conservés.');
      break;
    }
    case 'store-game': {
      const id = `game:${t.dataset.id}`;
      S.storeProgress[id] = { phase: 'download', label: 'Téléchargement…' };
      refreshPanel();
      const r = await api.storeGame(t.dataset.id);
      delete S.storeProgress[id];
      await afterStoreChange(r, r?.ok ? 'Jeu ajouté à votre ludothèque.' : '');
      if (!r?.ok && r?.error) toast(r.error, { duration: 7000 });
      break;
    }
    case 'store-import': {
      const idx = Number($('#st-console')?.value);
      const r = await api.storeImport(idx);
      if (r?.ok && r.count) { S.romsCache = {}; toast(`${plural(r.count, 'jeu copié', 'jeux copiés')} dans ${r.console}.`); }
      else if (r && !r.ok) toast(r.error, { duration: 7000 });
      break;
    }
    case 'store-root': {
      const cfg = await api.storePickRoot();
      if (cfg) { S.config = cfg; await loadCatalog(); toast('Les prochaines consoles utiliseront ce dossier.'); }
      break;
    }
    case 'theme': {
      const id = t.dataset.id;
      await saveUi((ui) => { ui.theme = id; });
      for (const card of $$('.theme-card', viewEl)) card.setAttribute('aria-pressed', String(card.dataset.id === id));
      break;
    }
    case 'order-move': {
      const { kind, id } = t.dataset;
      const dir = Number(t.dataset.dir);
      await saveUi((ui) => {
        const list = [...ui.home[kind]];
        const k = list.indexOf(id);
        const j = k + dir;
        if (k < 0 || j < 0 || j >= list.length) return;
        [list[k], list[j]] = [list[j], list[k]];
        ui.home[kind] = list;
      });
      refreshOrderList(kind, id, t.dataset.dir);
      break;
    }
    case 'personalize': {
      go('settings');
      const block = $('#set-home');
      block?.scrollIntoView({ block: 'start' });
      block?.querySelector('.focusable')?.focus({ preventScroll: true });
      break;
    }
    case 'scrape-all': startScrape(['videos', 'music', 'games'], { force: true }); toast('Récupération lancée : le bouton en haut des sections Vidéos, Musique et Jeux montre l’avancement.', { duration: 6000 }); break;
    case 'scrape-clear': await api.scrapeClear(); await reloadScrape(); toast('Infos récupérées effacées'); break;
    case 'web-nav': api.webNav(t.dataset.id); break;
    case 'web-adblock': {
      const r = await api.adblockToggleSite();
      if (!r) break;
      S.config = (await api.getConfig()).config;
      S.adblock = r;
      const cur = S.webStates[S.webActive] || {};
      cur.adOn = r.adOn;
      cur.blocked = 0;
      setAdButton(cur);
      toast(r.adOn ? 'Bloqueur réactivé sur ce site. La page se recharge.' : 'Bloqueur désactivé sur ce site. La page se recharge.');
      break;
    }
    case 'adblock-update': {
      toast('Mise à jour des listes de filtres…', { duration: 2500 });
      const el = $('#adblock-status');
      if (el) el.textContent = 'Mise à jour des listes en cours…';
      const st = await api.adblockUpdate();
      if (st?.ok === false) toast(st.error, { duration: 8000 });
      else { await afterAdblockChange(st); toast('Listes de filtres à jour'); }
      break;
    }
    case 'adblock-remove': {
      const st = S.adblock || await api.adblockStatus();
      const kind = t.dataset.kind;
      const next = st[kind].filter((x) => x !== t.dataset.id);
      await afterAdblockChange(await api.adblockSetLists({ [kind]: next }));
      if (kind === 'customLists') toast('Liste retirée. Elle ne servira plus après la prochaine mise à jour des listes.');
      break;
    }
    case 'adblock-add-list': {
      const input = $('#adblock-new');
      const url = input.value.trim();
      if (!/^https?:\/\//i.test(url)) { toast('Indiquez l’adresse complète de la liste (https://…).'); break; }
      const st = S.adblock || await api.adblockStatus();
      await afterAdblockChange(await api.adblockSetLists({ customLists: [...new Set([...st.customLists, url])] }));
      input.value = '';
      toast('Liste ajoutée. Mise à jour des listes…', { duration: 2500 });
      const st2 = await api.adblockUpdate();
      if (st2?.ok === false) toast(st2.error, { duration: 8000 }); else await afterAdblockChange(st2);
      break;
    }
    case 'web-close': api.webClose(S.webActive); break;
    case 'web-bookmark': bookmarkCurrentPage(); break;
    case 'game-bookmark': bookmarkCurrentGame(); break;
    case 'open-series': {
      const c = S.videoCards[i];
      if (c) { S.videoSeries = c.key; S.videoSeason = null; S.limit = PAGE; render({ resetScroll: true }); }
      break;
    }
    case 'open-season': {
      S.videoSeason = Number(t.dataset.season);
      S.limit = PAGE;
      render({ resetScroll: true });
      break;
    }
    case 'back-videos': S.videoSeries = null; S.videoSeason = null; render({ resetScroll: true }); break;
    case 'back-season': S.videoSeason = null; render({ resetScroll: true }); break;
    case 'video-source': S.videoSource = t.dataset.id; S.limit = PAGE; render({ resetScroll: true }); break;
    case 'video-sort': S.videoSort = t.dataset.id; S.limit = PAGE; render({ resetScroll: true }); break;
    case 'web-learn': learnSearch(); break;
    case 'gs-recent': {
      const q = getQueries()[i];
      if (q) { const input = $('#gsearch'); input.value = q; S.gq = q; refreshSearch(); }
      break;
    }
    case 'gs-video': rememberQuery(S.gq); playInContext(S.gs.videos[i]); break;
    case 'gs-track': rememberQuery(S.gq); playInContext(S.gs.tracks[i]); break;
    case 'gs-image': rememberQuery(S.gq); openImages(S.gs.images, i); break;
    case 'gs-channel': rememberQuery(S.gq); playChannel(S.gs.channels[i]); break;
    case 'gs-game': rememberQuery(S.gq); launchEntry(S.gs.games?.[i]); break;
    case 'gs-rom': {
      rememberQuery(S.gq);
      const rom = S.gs.roms[i];
      if (rom) {
        toast(`Lancement de ${rom.displayName}…`, { duration: 2500 });
        audio.pause();
        api.launchRom(rom.emu, rom.path).then((r) => { if (!r.ok) toast(r.error, { duration: 7000 }); });
      }
      break;
    }
    case 'gs-tmdb': { const r = S.tmdb.results?.[i]; if (r) openTmdbResult(r); break; }
    case 'gs-site': {
      rememberQuery(S.gq);
      const w = S.config.web.find((x) => x.id === t.dataset.id);
      if (!w) break;
      const url = searchUrlFor(w, S.gq);
      if (!url) setTimeout(() => toast(`Pour chercher sur ${w.name} depuis Mire : cherchez le mot « mire » sur le site, puis appuyez sur « Mémoriser la recherche ».`, { duration: 10000 }), 2600);
      openWeb(w.id, url || undefined);
      break;
    }
    case 'rescan': S.scanned = false; scan(); toast('Analyse de la bibliothèque…', { duration: 2000 }); break;
    default: break;
  }
}
viewEl.addEventListener('click', onActionClick);
panelBody.addEventListener('click', onActionClick);
viewEl.addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });

$('#rail').addEventListener('click', (e) => {
  const sub = e.target.closest('.rail-sub');
  if (sub) { openWeb(sub.dataset.web); return; }
  const b = e.target.closest('.rail-item');
  if (!b) return;
  if (b.hasAttribute('data-quit')) { api.quit(); return; }
  if (b.hasAttribute('data-open-file')) { openFileDialog(); return; }
  go(b.dataset.go);
});

let searchTimer = 0;
// Menus déroulants de l'en-tête (filtres Jeux, service de télé).
headerToolsEl.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'tv-service') {
    api.tvSetActive(t.value).then((cfg) => { S.config = cfg; S.channels = null; S.tvWeb = null; S.tvError = null; loadChannels(); });
    return;
  }
  if (t.dataset.searchSource) {
    S.searchSource[t.dataset.searchSource] = t.value;
    S.limit = PAGE;
    render({ resetScroll: true });
  }
});
headerToolsRightEl.addEventListener('click', (e) => {
  // Téléchargement de jeux.
  const dl = e.target.closest('[data-action="games-download"]');
  if (dl) {
    if (dl.dataset.id === 'pc') onActionClick({ target: dl, currentTarget: headerToolsRightEl });
    else openRomBrowser(Number(dl.dataset.id));
    return;
  }
  // Ouvrir/fermer un menu (filtre, tri).
  const toggle = e.target.closest('[data-menu]');
  if (toggle) {
    const pop = toggle.nextElementSibling;
    const open = pop.hidden;
    closeHeaderMenus();
    if (open) { pop.hidden = false; toggle.setAttribute('aria-expanded', 'true'); pop.querySelector('.hdr-opt')?.focus(); }
    return;
  }
  // Choix dans un menu : l'action est traitée par onActionClick, puis le menu se ferme.
  const opt = e.target.closest('.hdr-opt');
  if (opt) { onActionClick({ target: opt, currentTarget: headerToolsRightEl }); closeHeaderMenus(); }
});
function closeHeaderMenus() {
  for (const pop of headerToolsRightEl.querySelectorAll('.hdr-pop')) pop.hidden = true;
  for (const t of headerToolsRightEl.querySelectorAll('[data-menu]')) t.setAttribute('aria-expanded', 'false');
}
document.addEventListener('click', (e) => { if (!e.target.closest('.hdr-menu')) closeHeaderMenus(); });

searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { S.query = searchEl.value.trim(); S.limit = PAGE; render({ resetScroll: true }); }, 140);
});
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); clearTimeout(searchTimer); S.query = searchEl.value.trim(); render(); focusFirst(); }
});

/* ------------------------------------------------------------------ */
/* Volume partagé                                                      */
/* ------------------------------------------------------------------ */

const audio = new Audio();
audio.preload = 'auto';
const video = $('#video');
let volume = 0.9;

function setRangeFill(el, ratio) { el.style.setProperty('--p', `${clamp(ratio, 0, 1) * 100}%`); }

function setVolume(v, silent = false) {
  volume = clamp(Math.round(v * 100) / 100, 0, 1);
  audio.volume = volume;
  video.volume = volume;
  for (const el of [$('#mini-vol'), $('#vp-vol')]) { el.value = String(volume); setRangeFill(el, volume); }
  try { localStorage.setItem('volume', String(volume)); } catch { /* rien */ }
  if (!silent && !videoLayer.hidden) osd(`Volume ${Math.round(volume * 100)} %`);
}

/* ------------------------------------------------------------------ */
/* Musique                                                             */
/* ------------------------------------------------------------------ */

const Q = { list: [], i: -1 };
const mini = $('#mini');
const miniPlay = $('#mini-play');
const miniRange = $('#mini-range');
let miniSeeking = false;

function playQueue(list, i) {
  Q.list = list;
  Q.i = i;
  loadTrack();
}

function loadTrack() {
  const t = Q.list[Q.i];
  if (!t) return;
  if (!t.native) { openExternal(t); return; }
  audio.src = mediaUrl(t.path);
  audio.play().catch(() => { /* lecture bloquée */ });
  addRecent(t);

  mini.hidden = false;
  document.body.classList.add('has-mini');
  $('#mini-title').textContent = cleanTrack(t.name);
  $('#mini-sub').textContent = Q.list.length > 1 ? `${folderText(t)}, ${Q.i + 1} sur ${Q.list.length}` : folderText(t);
  const cover = $('#mini-cover');
  const coverPath = t.cover || S.scrape[`a:${t.dir}`]?.image;
  if (coverPath) { cover.hidden = false; cover.src = mediaUrl(coverPath); } else { cover.hidden = true; cover.removeAttribute('src'); }
  markPlaying();
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: cleanTrack(t.name), album: t.folder });
}

function stepTrack(d) {
  if (!Q.list.length) return;
  if (d < 0 && audio.currentTime > 3) { audio.currentTime = 0; return; }
  const j = Q.i + d;
  if (j < 0) { audio.currentTime = 0; return; }
  if (j >= Q.list.length) { audio.pause(); audio.currentTime = 0; return; }
  Q.i = j;
  loadTrack();
}

function toggleAudio() {
  if (!audio.getAttribute('src')) return;
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

function stopMusic() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  Q.list = [];
  Q.i = -1;
  mini.hidden = true;
  document.body.classList.remove('has-mini');
  markPlaying();
  if (document.activeElement === document.body || mini.contains(document.activeElement)) focusFirst();
}

function markPlaying() {
  if (S.section !== 'music') return;
  const cur = Q.list[Q.i]?.path;
  for (const el of $$('.track', viewEl)) el.classList.toggle('is-playing', !!cur && S.list[Number(el.dataset.index)]?.path === cur);
}

audio.addEventListener('ended', () => stepTrack(1));
audio.addEventListener('play', () => { miniPlay.innerHTML = ICON.pause; });
audio.addEventListener('pause', () => { miniPlay.innerHTML = ICON.play; });
audio.addEventListener('timeupdate', () => {
  if (miniSeeking) return;
  const d = audio.duration;
  const r = Number.isFinite(d) && d > 0 ? audio.currentTime / d : 0;
  miniRange.value = String(Math.round(r * 1000));
  setRangeFill(miniRange, r);
  $('#mini-cur').textContent = fmtTime(audio.currentTime);
  $('#mini-dur').textContent = fmtTime(d);
});
audio.addEventListener('error', () => {
  if (!audio.getAttribute('src')) return;
  const t = Q.list[Q.i];
  if (!t) return;
  toast(`${t.name} : format non lu par le lecteur intégré, ouverture dans le lecteur externe`, { duration: 5000 });
  api.playExternal(t.path, t.name, 0);
});

miniPlay.addEventListener('click', toggleAudio);
$('#mini-prev').addEventListener('click', () => stepTrack(-1));
$('#mini-next').addEventListener('click', () => stepTrack(1));
$('#mini-close').addEventListener('click', stopMusic);
miniRange.addEventListener('input', () => {
  miniSeeking = true;
  const r = Number(miniRange.value) / 1000;
  setRangeFill(miniRange, r);
  $('#mini-cur').textContent = fmtTime(r * (audio.duration || 0));
});
miniRange.addEventListener('change', () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(miniRange.value) / 1000) * audio.duration;
  miniSeeking = false;
});
$('#mini-vol').addEventListener('input', (e) => setVolume(Number(e.target.value), true));

/* ------------------------------------------------------------------ */
/* Lecteur vidéo                                                       */
/* ------------------------------------------------------------------ */

const videoLayer = $('#video-layer');
const vpPlay = $('#vp-play');
const vpSeek = $('#vp-seek');
const vpSubs = $('#vp-subs');
const V = { list: [], i: -1, blobs: [], subIndex: -1, subLabels: [], hideTimer: 0, silentTimer: 0, lastSave: 0, returnSel: null, seeking: false, cuesUp: null };

// Remonte les sous-titres quand les commandes sont affichées, pour qu'ils ne passent pas dessous.
function liftCues(up) {
  if (V.cuesUp === up) return;
  V.cuesUp = up;
  for (const t of video.textTracks) {
    if (!t.cues) continue;
    for (const c of t.cues) c.line = up ? -5 : 'auto';
  }
}

function osd(text) {
  const el = $('#vp-osd');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(osd.timer);
  osd.timer = setTimeout(() => el.classList.remove('show'), 900);
}

function wakeVideo() {
  videoLayer.classList.remove('idle');
  liftCues(true);
  clearTimeout(V.hideTimer);
  V.hideTimer = setTimeout(() => {
    if (!video.paused) { videoLayer.classList.add('idle'); liftCues(false); }
  }, 3000);
}

function clearSubtitleTracks() {
  for (const tr of $$('track', video)) tr.remove();
  for (const u of V.blobs) URL.revokeObjectURL(u);
  V.blobs = [];
  V.subLabels = [];
  V.subIndex = -1;
  V.cuesUp = null;
  vpSubs.hidden = true;
}

function setSubtitle(k) {
  V.subIndex = k;
  [...video.textTracks].forEach((t, j) => { t.mode = j === k ? 'showing' : 'disabled'; });
  $('#vp-subs-lbl').textContent = k >= 0 ? `Sous-titres : ${V.subLabels[k]}` : 'Sous-titres : non';
}

function cycleSubtitles() {
  if (!V.subLabels.length) return;
  const k = V.subIndex + 1 >= V.subLabels.length ? -1 : V.subIndex + 1;
  setSubtitle(k);
  osd(k >= 0 ? `Sous-titres : ${V.subLabels[k]}` : 'Sous-titres désactivés');
}

async function loadSubtitles(it) {
  const subs = await api.subtitles(it.path);
  if (V.list[V.i] !== it || !Array.isArray(subs) || !subs.length) return;
  for (const s of subs) {
    const url = URL.createObjectURL(new Blob([s.vtt], { type: 'text/vtt' }));
    V.blobs.push(url);
    V.subLabels.push(s.label);
    const tr = document.createElement('track');
    tr.kind = 'subtitles';
    tr.label = s.label;
    if (s.lang) tr.srclang = s.lang;
    tr.src = url;
    tr.addEventListener('load', () => { const up = V.cuesUp; V.cuesUp = null; liftCues(!!up); });
    video.appendChild(tr);
  }
  vpSubs.hidden = false;
  // Français activé d'office s'il existe.
  const fr = subs.findIndex((s) => ['fr', 'fre', 'fra'].includes(s.lang) || /fr|fran/i.test(s.label));
  setSubtitle(fr);
}

function saveResume(it) {
  const t = video.currentTime;
  const d = video.duration;
  if (!it || !Number.isFinite(d) || d < 300) return;
  const key = `resume:${it.path}`;
  try {
    if (t > 30 && t < d - 90) localStorage.setItem(key, String(Math.floor(t)));
    else localStorage.removeItem(key);
  } catch { /* rien */ }
}

function checkSilence() {
  if (videoLayer.hidden || video.paused) return;
  if (typeof video.webkitAudioDecodedByteCount === 'number' && video.webkitAudioDecodedByteCount === 0 && video.currentTime > 2) {
    toast('Pas de son ? La piste audio de ce fichier n’est sans doute pas lisible ici.', {
      action: 'Ouvrir dans le lecteur externe',
      onAction: () => { const it = V.list[V.i]; const t = video.currentTime; closeVideo(); openExternal(it, t); },
      duration: 10000,
    });
  }
}

function openVideo(list, i) {
  const it = list[i];
  if (!it) return;
  if (it.bookmark) { openBookmark(it.bookmarkId); return; }
  if (!it.native) { openExternal(it); return; }
  if (videoLayer.hidden) V.returnSel = focusSelectorOf(document.activeElement);
  else saveResume(V.list[V.i]);

  V.list = list;
  V.i = i;
  audio.pause();
  clearSubtitleTracks();
  videoLayer.hidden = false;
  syncWeb();
  $('#vp-title').textContent = it.sTitle ? `${it.sTitle}${it.sYear ? ` (${it.sYear})` : ''}` : it.name;
  $('#vp-sub').textContent = list.length > 1 ? `${folderText(it)}, ${i + 1} sur ${list.length}` : folderText(it);
  $('#vp-prev').disabled = i <= 0;
  $('#vp-next').disabled = i >= list.length - 1;
  vpSeek.value = '0';
  setRangeFill(vpSeek, 0);

  const saved = Number(localStorage.getItem(`resume:${it.path}`)) || 0;
  video.src = mediaUrl(it.path);
  video.addEventListener('loadedmetadata', () => {
    if (V.list[V.i] !== it) return;
    if (saved > 30 && saved < video.duration - 90) {
      video.currentTime = saved;
      toast(`Reprise à ${fmtTime(saved)}`, { action: 'Reprendre au début', onAction: () => { video.currentTime = 0; } });
    }
  }, { once: true });
  video.play().catch(() => {});
  addRecent(it);
  loadSubtitles(it);
  clearTimeout(V.silentTimer);
  V.silentTimer = setTimeout(checkSilence, 7000);
  videoLayer.focus();
  wakeVideo();
}

function closeVideo() {
  if (videoLayer.hidden) return;
  saveResume(V.list[V.i]);
  video.pause();
  video.removeAttribute('src');
  video.load();
  clearSubtitleTracks();
  clearTimeout(V.silentTimer);
  clearTimeout(V.hideTimer);
  videoLayer.hidden = true;
  videoLayer.classList.remove('idle');
  V.list = [];
  V.i = -1;
  syncWeb();
  if (S.section === 'home') render();
  const back = V.returnSel && viewEl.querySelector(V.returnSel);
  if (back) back.focus(); else focusFirst();
}

function stepVideo(d) {
  const j = V.i + d;
  if (j >= 0 && j < V.list.length) openVideo(V.list, j);
}

function togglePlay() {
  if (video.paused) video.play().catch(() => {}); else video.pause();
  osd(video.paused ? 'Pause' : 'Lecture');
}

function seekBy(s) {
  if (!Number.isFinite(video.duration)) return;
  video.currentTime = clamp(video.currentTime + s, 0, video.duration - 0.5);
  osd(`${s > 0 ? '+' : '−'}${Math.abs(s)} s  ${fmtTime(video.currentTime)}`);
}

video.addEventListener('play', () => { vpPlay.innerHTML = ICON.pause; wakeVideo(); });
video.addEventListener('pause', () => { vpPlay.innerHTML = ICON.play; wakeVideo(); });
video.addEventListener('timeupdate', () => {
  const d = video.duration;
  if (!V.seeking) {
    const r = Number.isFinite(d) && d > 0 ? video.currentTime / d : 0;
    vpSeek.value = String(Math.round(r * 1000));
    setRangeFill(vpSeek, r);
  }
  $('#vp-time').textContent = `${fmtTime(video.currentTime)} / ${fmtTime(d)}`;
  if (Date.now() - V.lastSave > 5000) { V.lastSave = Date.now(); saveResume(V.list[V.i]); }
});
video.addEventListener('ended', () => {
  const it = V.list[V.i];
  if (it) try { localStorage.removeItem(`resume:${it.path}`); } catch { /* rien */ }
  if (V.i < V.list.length - 1) openVideo(V.list, V.i + 1); else closeVideo();
});
video.addEventListener('error', () => {
  if (videoLayer.hidden || !video.getAttribute('src')) return;
  const it = V.list[V.i];
  closeVideo();
  toast(`Format non lu par le lecteur intégré : ${it.name} s’ouvre dans le lecteur externe`, { duration: 5000 });
  api.playExternal(it.path, it.name, 0).then((r) => { if (!r.ok) toast(r.error, { duration: 7000 }); });
});
video.addEventListener('click', togglePlay);
video.addEventListener('dblclick', () => api.toggleFullscreen());

vpSeek.addEventListener('input', () => {
  V.seeking = true;
  const r = Number(vpSeek.value) / 1000;
  setRangeFill(vpSeek, r);
  $('#vp-time').textContent = `${fmtTime(r * (video.duration || 0))} / ${fmtTime(video.duration)}`;
});
vpSeek.addEventListener('change', () => {
  if (Number.isFinite(video.duration)) video.currentTime = (Number(vpSeek.value) / 1000) * video.duration;
  V.seeking = false;
  videoLayer.focus();
});
$('#vp-vol').addEventListener('input', (e) => setVolume(Number(e.target.value), true));
$('#vp-vol').addEventListener('change', () => videoLayer.focus());
videoLayer.addEventListener('mousemove', wakeVideo);
videoLayer.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'close') closeVideo();
  else if (act === 'play') togglePlay();
  else if (act === 'prev') stepVideo(-1);
  else if (act === 'next') stepVideo(1);
  else if (act === 'subs') cycleSubtitles();
  else if (act === 'fs') api.toggleFullscreen();
  else if (act === 'external') { const it = V.list[V.i]; const t = video.currentTime; closeVideo(); openExternal(it, t); }
  if (!videoLayer.hidden) videoLayer.focus();
});

function videoKey(key, fromPad) {
  wakeVideo();
  const a = document.activeElement;
  if (!fromPad && (key === 'Enter' || key === ' ') && a && a !== videoLayer && videoLayer.contains(a) && a.matches('button')) return false;
  switch (key) {
    case ' ': case 'k': case 'Enter': case 'MediaPlayPause': togglePlay(); return true;
    case 'ArrowLeft': seekBy(-10); return true;
    case 'ArrowRight': seekBy(10); return true;
    case 'j': seekBy(-60); return true;
    case 'l': seekBy(60); return true;
    case 'ArrowUp': setVolume(volume + 0.05); return true;
    case 'ArrowDown': setVolume(volume - 0.05); return true;
    case 'm': video.muted = !video.muted; osd(video.muted ? 'Son coupé' : 'Son rétabli'); return true;
    case 'f': api.toggleFullscreen(); return true;
    case 's': case 'Y': cycleSubtitles(); return true;
    case 'n': case 'PageDown': stepVideo(1); return true;
    case 'p': case 'PageUp': stepVideo(-1); return true;
    case 'Escape': case 'Backspace': closeVideo(); return true;
    default: return false;
  }
}

/* ------------------------------------------------------------------ */
/* Visionneuse d'images                                                */
/* ------------------------------------------------------------------ */

const imageLayer = $('#image-layer');
const ivImg = $('#iv-img');
const I = { list: [], i: 0, timer: 0, hideTimer: 0, returnSel: null };

function wakeImages() {
  imageLayer.classList.remove('idle');
  clearTimeout(I.hideTimer);
  I.hideTimer = setTimeout(() => imageLayer.classList.add('idle'), 3000);
}

function showImage() {
  const it = I.list[I.i];
  if (!it) return;
  ivImg.src = mediaUrl(it.path);
  $('#iv-title').textContent = it.name;
  $('#iv-count').textContent = `${I.i + 1} sur ${I.list.length}, ${it.folder}`;
  const nxt = I.list[I.i + 1];
  if (nxt?.native) new Image().src = mediaUrl(nxt.path);
}

function openImages(list, i) {
  const it = list[i];
  if (!it) return;
  if (!it.native) { openExternal(it); return; }
  I.returnSel = focusSelectorOf(document.activeElement);
  I.list = list.filter((x) => x.native);
  I.i = Math.max(0, I.list.indexOf(it));
  imageLayer.hidden = false;
  syncWeb();
  showImage();
  addRecent(it);
  imageLayer.focus();
  wakeImages();
}

function stepImage(d) {
  if (!I.list.length) return;
  I.i = (I.i + d + I.list.length) % I.list.length;
  showImage();
}

function toggleSlideshow(force) {
  const on = force ?? !I.timer;
  clearInterval(I.timer);
  I.timer = on ? setInterval(() => stepImage(1), 5000) : 0;
  $('#iv-slide-lbl').textContent = on ? 'Arrêter le diaporama' : 'Diaporama';
  $('#iv-slide [data-icon]').innerHTML = on ? ICON.pause : ICON.play;
}

function closeImages() {
  toggleSlideshow(false);
  clearTimeout(I.hideTimer);
  imageLayer.hidden = true;
  imageLayer.classList.remove('idle');
  ivImg.removeAttribute('src');
  syncWeb();
  if (S.section === 'home') render();
  const back = I.returnSel && viewEl.querySelector(I.returnSel);
  if (back) back.focus(); else focusFirst();
}

ivImg.addEventListener('error', () => { if (!imageLayer.hidden && ivImg.getAttribute('src')) toast('Cette image ne peut pas être affichée.'); });
imageLayer.addEventListener('mousemove', wakeImages);
imageLayer.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'close') closeImages();
  else if (act === 'prev') stepImage(-1);
  else if (act === 'next') stepImage(1);
  else if (act === 'slideshow') toggleSlideshow();
  if (!imageLayer.hidden) imageLayer.focus();
});

function imageKey(key, fromPad) {
  wakeImages();
  const a = document.activeElement;
  if (!fromPad && (key === 'Enter' || key === ' ') && a && a !== imageLayer && imageLayer.contains(a)) return false;
  switch (key) {
    case 'ArrowLeft': case 'PageUp': stepImage(-1); return true;
    case 'ArrowRight': case 'PageDown': stepImage(1); return true;
    case ' ': case 'Enter': case 'MediaPlayPause': toggleSlideshow(); return true;
    case 'f': api.toggleFullscreen(); return true;
    case 'Escape': case 'Backspace': closeImages(); return true;
    default: return false;
  }
}

/* ------------------------------------------------------------------ */
/* Navigation spatiale (flèches, manette)                              */
/* ------------------------------------------------------------------ */

const isShown = (el) => el.getClientRects().length > 0 && !el.disabled;

// Premier élément du contenu ; le panneau d'infos et les onglets ne passent qu'en dernier recours.
function focusFirst() {
  const all = $$('.focusable', viewEl).filter(isShown);
  const el = all.find((x) => !x.closest('.focus-info, .tabs')) || all[0] || $('.rail-item[aria-current]');
  el?.focus();
}

const overlap = (a1, a2, b1, b2) => Math.max(0, Math.max(a1, b1) - Math.min(a2, b2));

function moveFocus(dir, scope = document) {
  const els = $$('.focusable', scope).filter(isShown);
  const cur = document.activeElement;
  if (!els.includes(cur)) { ($$('.focusable', viewEl).find(isShown) || els[0])?.focus(); return; }
  const r = cur.getBoundingClientRect();
  let best = null;
  let bestScore = Infinity;
  for (const el of els) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    let main;
    let cross;
    if (dir === 'right') { if (b.left < r.right - 2) continue; main = b.left - r.right; cross = overlap(r.top, r.bottom, b.top, b.bottom); }
    else if (dir === 'left') { if (b.right > r.left + 2) continue; main = r.left - b.right; cross = overlap(r.top, r.bottom, b.top, b.bottom); }
    else if (dir === 'down') { if (b.top < r.bottom - 2) continue; main = b.top - r.bottom; cross = overlap(r.left, r.right, b.left, b.right); }
    else { if (b.bottom > r.top + 2) continue; main = r.top - b.bottom; cross = overlap(r.left, r.right, b.left, b.right); }
    const align = dir === 'left' || dir === 'right' ? Math.abs(b.top - r.top) : Math.abs(b.left - r.left);
    const score = Math.max(0, main) + cross * 3 + align * 0.02;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) {
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

function handleKey(key, fromPad = false) {
  const dlg = topDialog();
  if (dlg) {
    const inField = document.activeElement?.matches?.('input, textarea, select');
    const dirs = inField ? { ArrowUp: 'up', ArrowDown: 'down' } : { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (dirs[key]) { moveFocus(dirs[key], dlg); return true; }
    if (key === 'Escape' && fromPad) { dlg.dispatchEvent(new Event('cancel', { cancelable: true })); return true; }
    if (key === 'Enter' && fromPad) { document.activeElement?.click(); return true; }
    return false;
  }
  if (!videoLayer.hidden) return videoKey(key, fromPad);
  if (!imageLayer.hidden) return imageKey(key, fromPad);

  const a = document.activeElement;
  const tag = a?.tagName;
  const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['checkbox', 'range', 'button'].includes(a.type));
  if (typing) {
    if (key === 'Escape') { a.blur(); focusFirst(); return true; }
    if (tag === 'INPUT' && (key === 'ArrowDown' || key === 'ArrowUp')) { moveFocus(key === 'ArrowDown' ? 'down' : 'up'); return true; }
    if (!fromPad) return false;
  }

  if (S.section === 'web' && key === 'ArrowDown' && a?.closest('.webbar')) { api.webFocus(); return true; }
  switch (key) {
    case 'ArrowUp': moveFocus('up'); return true;
    case 'ArrowDown': moveFocus('down'); return true;
    case 'ArrowLeft': moveFocus('left'); return true;
    case 'ArrowRight': moveFocus('right'); return true;
    case 'Enter':
      // Validation identique au clavier, à la télécommande et à la manette.
      if (fromPad || (a && (a.tagName === 'BUTTON' || (a.tagName === 'INPUT' && a.type === 'checkbox')))) { a?.click(); return true; }
      return false;
    case 'Escape': case 'Backspace': back(); return true;
    case 'PageDown': viewEl.scrollBy({ top: viewEl.clientHeight * 0.8 }); return true;
    case 'PageUp': viewEl.scrollBy({ top: -viewEl.clientHeight * 0.8 }); return true;
    case 'MediaPlayPause': toggleAudio(); return true;
    case '/': go('search'); return true;
    case 'e': case 'ContextMenu': { const ref = refFromEl(a); if (ref) { editRef(ref); return true; } return false; }
    case 'Delete': { const ref = refFromEl(a); if (deletableGame(ref)) { deleteGameRef(ref); return true; } return false; }
    default: return false;
  }
}

document.addEventListener('keydown', (e) => {
  document.body.classList.remove('mouse');
  S.pendingFocus = false;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (handleKey(e.key, false)) e.preventDefault();
});
window.addEventListener('mousemove', (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) document.body.classList.add('mouse'); }, { passive: true });
window.addEventListener('mousedown', () => document.body.classList.add('mouse'));

/* Manette (API Gamepad) : croix ou stick gauche, A valider, B retour, Start lecture/pause, LB/RB précédent/suivant. */
const pad = { prev: {}, repeatAt: {} };

/* ---------- Manette : commandes selon le contexte, et rappel des boutons à l'écran ---------- */

// Dans un site, la manette pilote la page : croix = flèches, A = Entrée, X ou Start = Espace,
// B = page précédente, Y = Échap, LB/RB = élément précédent/suivant, Select ou Home = revenir aux menus de Mire.
const WEB_PAD = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', a: 'Enter', x: 'Space', start: 'Space', b: 'Back', y: 'Escape', lb: 'ShiftTab', rb: 'Tab' };
const VIDEO_PAD = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', a: 'Enter', start: ' ', b: 'Escape', y: 's', lb: 'PageUp', rb: 'PageDown', lt: 'j', rt: 'l' };
const IMAGE_PAD = { left: 'ArrowLeft', right: 'ArrowRight', lb: 'ArrowLeft', rb: 'ArrowRight', a: ' ', start: ' ', b: 'Escape' };
const LIST_PAD = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', a: 'Enter', b: 'Escape', y: '/', lt: 'PageUp', rt: 'PageDown', start: 'MediaPlayPause' };
const SECTION_ORDER = ['home', 'search', 'videos', 'music', 'images', 'streaming', 'tv', 'games'];

function padContext() {
  if (topDialog()) return 'dialog';
  if (!videoLayer.hidden) return 'video';
  if (!imageLayer.hidden) return 'image';
  if (S.section === 'web' && webShouldShow()) return 'web';
  return 'list';
}

function cycleSection(d) {
  const cur = SECTION_ORDER.indexOf(S.section === 'web' ? 'streaming' : S.section);
  const next = SECTION_ORDER[(Math.max(0, cur) + d + SECTION_ORDER.length) % SECTION_ORDER.length];
  go(next, { focus: next === 'search' ? 'keep' : 'content' });
}

function padPress(k) {
  const ctx = padContext();
  if (ctx === 'web') {
    if (k === 'select' || k === 'home') { if (S.webFocused) api.webNav('mire'); else api.webFocus(); return; }
    if (S.webFocused && WEB_PAD[k]) { api.webKey(WEB_PAD[k]); return; }
    if (LIST_PAD[k]) handleKey(LIST_PAD[k], true);
    return;
  }
  if (ctx === 'dialog') {
    const box = topDialog();
    const dir = { up: 'up', down: 'down', left: 'left', right: 'right' }[k];
    if (dir) moveFocus(dir, box);
    else if (k === 'a') document.activeElement?.click?.();
    else if (k === 'b') box.dispatchEvent(new Event('cancel', { cancelable: true }));
    return;
  }
  if (ctx === 'video') { if (VIDEO_PAD[k]) handleKey(VIDEO_PAD[k], true); return; }
  if (ctx === 'image') { if (IMAGE_PAD[k]) handleKey(IMAGE_PAD[k], true); return; }
  if (k === 'x') { const ref = refFromEl(document.activeElement); if (ref) editRef(ref); return; }
  if (k === 'lb' || k === 'rb') { cycleSection(k === 'lb' ? -1 : 1); return; }
  if (k === 'select') { $('.rail-item[aria-current]')?.focus(); return; }
  if (LIST_PAD[k]) handleKey(LIST_PAD[k], true);
}

function padFamily(id) {
  const s = String(id || '').toLowerCase();
  if (/xbox|xinput|045e/.test(s)) return 'xbox';
  // Les manettes Sony s'annoncent souvent comme « Wireless Controller … Vendor: 054c ».
  if (/054c|playstation|dualsense|dualshock|^wireless controller/.test(s)) return 'ps';
  if (/057e|nintendo|switch|pro controller|joy-con/.test(s)) return 'nintendo';
  return 'xbox';
}
// Libellés des boutons par famille (selon leur position : en bas = valider, à droite = retour…).
const PAD_GLYPHS = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', select: 'Affichage' },
  ps: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', select: 'Créer' },
  nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', select: '−' },
};
const PAD_HINTS = {
  list: [['a', 'Ouvrir'], ['b', 'Retour'], ['x', 'Modifier'], ['y', 'Rechercher'], ['lb rb', 'Section']],
  video: [['a', 'Pause'], ['lt rt', '1 min'], ['lb rb', 'Autre vidéo'], ['y', 'Sous-titres'], ['b', 'Fermer']],
  image: [['a', 'Diaporama'], ['lb rb', 'Image'], ['b', 'Fermer']],
  dialog: [['a', 'Valider'], ['b', 'Annuler']],
};
const padbar = $('#padbar');
let padCtxShown = '';
function updatePadbar(force = false) {
  const ctx = S.pad ? padContext() : '';
  const key = `${ctx}|${S.pad?.family || ''}`;
  if (!force && key === padCtxShown) return;
  padCtxShown = key;
  const hints = PAD_HINTS[ctx];
  document.body.classList.toggle('has-pad', !!(S.pad && hints));
  if (!S.pad || !hints) { padbar.hidden = true; return; }
  const g = PAD_GLYPHS[S.pad.family];
  padbar.innerHTML = hints.map(([btns, label]) => `<span class="ph">${btns.split(' ').map((b) => `<span class="pb${g[b].length > 2 ? ' long' : ''}">${esc(g[b])}</span>`).join('')}${esc(label)}</span>`).join('');
  padbar.hidden = false;
}

const PAD_NAMES = { xbox: 'Xbox', ps: 'PlayStation', nintendo: 'Nintendo' };
function setPad(gp) {
  const family = padFamily(gp.id);
  const isNew = !S.pad || S.pad.id !== gp.id;
  S.pad = { id: gp.id, family };
  if (isNew) toast(`Manette ${PAD_NAMES[family]} détectée. Les commandes s’affichent en bas de l’écran.`, { duration: 4500 });
  updatePadbar(true);
}
window.addEventListener('gamepadconnected', (e) => setPad(e.gamepad));
window.addEventListener('gamepaddisconnected', () => {
  const left = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  if (left.length) setPad(left[0]);
  else { S.pad = null; updatePadbar(true); toast('Manette déconnectée'); }
});

function pollPads(now) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const usable = document.visibilityState === 'visible' && (document.hasFocus() || (S.section === 'web' && S.webFocused));
  if (pads.length && !S.pad) setPad(pads[0]);
  if (pads.length && usable) {
    const gp = pads[0];
    const btn = (n) => !!gp.buttons[n]?.pressed || (gp.buttons[n]?.value || 0) > 0.5;
    const ax = gp.axes[0] || 0;
    const ay = gp.axes[1] || 0;
    const state = {
      up: btn(12) || ay < -0.6, down: btn(13) || ay > 0.6, left: btn(14) || ax < -0.6, right: btn(15) || ax > 0.6,
      a: btn(0), b: btn(1), x: btn(2), y: btn(3), lb: btn(4), rb: btn(5), lt: btn(6), rt: btn(7), select: btn(8), start: btn(9), home: btn(16),
    };
    for (const [k, pressed] of Object.entries(state)) {
      const repeats = ['up', 'down', 'left', 'right', 'lt', 'rt'].includes(k);
      if (pressed && !pad.prev[k]) {
        document.body.classList.remove('mouse');
        S.pendingFocus = false;
        padPress(k);
        pad.repeatAt[k] = now + 380;
      } else if (pressed && repeats && now >= pad.repeatAt[k]) {
        padPress(k);
        pad.repeatAt[k] = now + 110;
      }
      pad.prev[k] = pressed;
    }
    // Stick droit : défilement de la liste.
    const ry = gp.axes[3] || 0;
    if (Math.abs(ry) > 0.3 && padContext() === 'list') viewEl.scrollBy(0, ry * 22);
  }
  updatePadbar();
  requestAnimationFrame(pollPads);
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => (videoLayer.hidden ? audio.play().catch(() => {}) : video.play().catch(() => {})));
  ms.setActionHandler('pause', () => (videoLayer.hidden ? audio.pause() : video.pause()));
  ms.setActionHandler('previoustrack', () => (videoLayer.hidden ? stepTrack(-1) : stepVideo(-1)));
  ms.setActionHandler('nexttrack', () => (videoLayer.hidden ? stepTrack(1) : stepVideo(1)));
}

/* ------------------------------------------------------------------ */
/* Glisser-déposer, horloge, images manquantes                         */
/* ------------------------------------------------------------------ */

const dropEl = $('#drop');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  dragDepth += 1;
  dropEl.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth -= 1;
  if (dragDepth <= 0) { dragDepth = 0; dropEl.hidden = true; }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropEl.hidden = true;
  const paths = [...(e.dataTransfer?.files || [])].map((f) => api.pathForFile(f)).filter(Boolean);
  if (paths.length) openItems(await api.fromPaths(paths));
});

// Une vignette qui ne se charge pas laisse place au carton titre.
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el?.tagName !== 'IMG') return;
  if (el.closest('.art')) el.remove();
  else if (el.id === 'mini-cover') el.hidden = true;
}, true);

function tick() {
  const now = new Date();
  const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  clockEl.textContent = time;
  const hc = $('#home-clock');
  if (hc) {
    hc.textContent = time;
    hc.dateTime = now.toISOString();
    $('#home-date').textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }
}

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */

(async function init() {
  for (const el of $$('[data-icon]')) el.innerHTML = ICON[el.dataset.icon] || '';
  const res = await api.getConfig();
  S.config = res.config;
  S.configPath = res.configPath;
  S.platform = res.platform;
  applyTheme();
  applyMenu();
  S.scrape = (await api.scrapeData()) || {};
  S.meta = (await api.metaAll()) || {};
  S.adblock = await api.adblockStatus();
  loadDownloads();
  loadLocalRoms();

  const storedVolume = Number(localStorage.getItem('volume'));
  setVolume(Number.isFinite(storedVolume) && localStorage.getItem('volume') !== null ? storedVolume : 0.9, true);

  go('home');
  $('.mire-bar')?.focus();
  tick();
  setInterval(tick, 5000);

  api.onOpenFiles(openItems);
  S.webSessions = (await api.webSessions()) || [];
  renderRailSessions();
  const pending = await api.takePendingFiles();
  if (pending?.length) openItems(pending);

  requestAnimationFrame(pollPads);
  scan();

  // Page de démarrage choisie dans Réglages.
  const start = S.config.ui.start || 'home';
  if (!pending?.length) {
    if (start.startsWith('web:')) openWeb(start.slice(4));
    else if (start !== 'home' && TITLES[start]) go(start, { focus: 'content' });
  }
})();
