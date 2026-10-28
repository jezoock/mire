'use strict';
/**
 * Jeux sur disque : le fichier qu'on lance (.cue, .gdi, .m3u…) n'est qu'un index qui renvoie
 * aux vrais fichiers de données (pistes .bin, autres disques). Pour qu'un jeu fonctionne, il faut
 * tous les télécharger, dans le même dossier et sous les noms exacts attendus par l'index.
 *
 *   .cue, .toc : lignes FILE / DATAFILE "piste.bin"
 *   .gdi       : pistes Dreamcast (« 1 0 4 2352 track01.bin 0 »)
 *   .m3u       : liste de disques (souvent des .cue, eux-mêmes lus à leur tour)
 *   .ccd, .mds : fichiers compagnons de même nom (.img et .sub, .mdf)
 */
const path = require('node:path');
const fs = require('node:fs');

const DESCRIPTORS = new Set(['.cue', '.gdi', '.m3u', '.ccd', '.mds', '.toc']);
const isDescriptor = (name) => DESCRIPTORS.has(path.extname(String(name).split('?')[0]).toLowerCase());

// Texte d'un index : UTF-8, ou Latin-1 pour les vieux fichiers aux noms accentués.
function decode(buf) {
  const utf8 = Buffer.from(buf).toString('utf8').replace(/^\uFEFF/, '');
  return utf8.includes('\uFFFD') ? Buffer.from(buf).toString('latin1') : utf8;
}

// Chemin relatif sûr : pas de chemin absolu, pas de remontée hors du dossier du jeu.
function safeRel(ref) {
  const clean = String(ref || '').trim().replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[a-z]:/i.test(clean)) return null;
  const parts = [];
  for (const p of clean.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') return null;
    parts.push(p);
  }
  return parts.length ? parts.join('/') : null;
}

const unquote = (s) => s.replace(/^"(.*)"$/, '$1');

// Fichiers cités par un index (chemins relatifs à son dossier).
function parseRefs(name, text) {
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name, path.extname(name));
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let refs = [];
  if (ext === '.cue' || ext === '.toc') {
    for (const l of lines) {
      const m = /^(?:FILE|DATAFILE)\s+("([^"]+)"|(\S+))/i.exec(l);
      if (m) refs.push(m[2] || m[3]);
    }
  } else if (ext === '.gdi') {
    for (const l of lines.slice(1)) {
      // numéro, secteur de départ, type, taille de secteur, fichier (entre guillemets s'il a des espaces), décalage
      const m = /^\d+\s+\d+\s+\d+\s+\d+\s+("([^"]+)"|(\S+))/.exec(l);
      if (m) refs.push(m[2] || m[3]);
    }
  } else if (ext === '.m3u') {
    refs = lines.filter((l) => !l.startsWith('#')).map(unquote);
  } else if (ext === '.ccd') {
    refs = [`${base}.img`, `${base}.sub`];
  } else if (ext === '.mds') {
    refs = [`${base}.mdf`];
  }
  return [...new Set(refs.map(safeRel).filter(Boolean))];
}

// Adresse d'un fichier cité, relative à celle de l'index (chaque partie du chemin encodée).
function refUrl(ref, baseUrl) {
  return new URL(ref.split('/').map(encodeURIComponent).join('/'), baseUrl).href;
}

/**
 * Tous les fichiers d'un jeu distant : l'index lui-même puis, récursivement, ce qu'il cite.
 * fetchText(url) → texte de l'index. Seuls les fichiers du même site sont suivis.
 * Retour : [{ url, rel }] où rel est le chemin à reproduire dans le dossier du jeu.
 */
async function resolveRemote(url, fetchText, { maxFiles = 200 } = {}) {
  const origin = new URL(url).origin;
  const rootDir = new URL('.', url).href;
  const out = new Map();
  const relOf = (u) => decodeURIComponent(u.slice(rootDir.length).split('?')[0]);
  async function visit(u, depth) {
    if (out.has(u) || out.size >= maxFiles) return;
    const rel = safeRel(relOf(u));
    if (!rel) return;
    out.set(u, rel);
    if (depth > 3 || !isDescriptor(u)) return;
    let text = '';
    try { text = await fetchText(u); } catch { return; }
    for (const ref of parseRefs(rel, text)) {
      const next = refUrl(ref, u);
      if (new URL(next).origin === origin && next.startsWith(rootDir)) await visit(next, depth + 1);
    }
  }
  await visit(url, 0);
  return [...out].map(([u, rel]) => ({ url: u, rel }));
}

// Fichiers cités par un index local qui manquent à côté de lui (récursif pour les .m3u).
function missingLocal(file, depth = 0) {
  let text = '';
  try { text = decode(fs.readFileSync(file)); } catch { return []; }
  const dir = path.dirname(file);
  const missing = [];
  for (const ref of parseRefs(file, text)) {
    const p = path.join(dir, ref);
    if (!fs.existsSync(p)) missing.push(ref);
    else if (depth < 3 && isDescriptor(p)) missing.push(...missingLocal(p, depth + 1).map((r) => path.posix.join(path.posix.dirname(ref), r)));
  }
  return [...new Set(missing)];
}

module.exports = { DESCRIPTORS, isDescriptor, decode, safeRel, parseRefs, refUrl, resolveRemote, missingLocal };
