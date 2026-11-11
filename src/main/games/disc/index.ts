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
import fs from 'node:fs';
import path from 'node:path';
import { DISC_INDEX_EXT } from '@mire/shared';

/** Fichier d'un jeu distant : son adresse et le chemin à reproduire dans le dossier du jeu. */
export interface RemoteFile {
  url: string;
  rel: string;
}

export const isDescriptor = (name: unknown): boolean => DISC_INDEX_EXT.has(path.extname(String(name).split('?')[0]).toLowerCase());

// Texte d'un index : UTF-8, ou Latin-1 pour les vieux fichiers aux noms accentués.
export function decode(buf: Uint8Array): string {
  const utf8 = Buffer.from(buf).toString('utf8').replace(/^﻿/, '');
  return utf8.includes('�') ? Buffer.from(buf).toString('latin1') : utf8;
}

// Chemin relatif sûr : pas de chemin absolu, pas de remontée hors du dossier du jeu.
export function safeRel(ref: unknown): string | null {
  const clean = String(ref || '')
    .trim()
    .replace(/\\/g, '/');
  if (!clean || clean.startsWith('/') || /^[a-z]:/i.test(clean)) return null;
  const parts: string[] = [];
  for (const p of clean.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') return null;
    parts.push(p);
  }
  return parts.length ? parts.join('/') : null;
}

const unquote = (s: string) => s.replace(/^"(.*)"$/, '$1');
const textLines = (text: string) =>
  String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
const m3uEntries = (text: string) =>
  textLines(text)
    .filter((l) => !l.startsWith('#'))
    .map(unquote);

// Adresse complète (« https:… », « file:… ») : un schéma d'au moins deux lettres, pour ne pas confondre avec « C: ».
const isAbsoluteUrl = (ref: string) => /^[a-z][a-z0-9+.-]+:/i.test(String(ref).trim());

// Fichiers cités par un index (chemins relatifs à son dossier). Les adresses complètes ne sont pas des chemins :
// elles sont écartées ici, et seuls citedUrls et resolveRemote les suivent.
export function parseRefs(name: string, text: string): string[] {
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name, path.extname(name));
  const lines = textLines(text);
  let refs: string[] = [];
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
    refs = m3uEntries(text);
  } else if (ext === '.ccd') {
    refs = [`${base}.img`, `${base}.sub`];
  } else if (ext === '.mds') {
    refs = [`${base}.mdf`];
  }
  return [
    ...new Set(
      refs
        .filter((r) => !isAbsoluteUrl(r))
        .map(safeRel)
        .filter((r): r is string => !!r),
    ),
  ];
}

// Adresse d'un fichier cité, relative à celle de l'index (chaque partie du chemin encodée).
export function refUrl(ref: string, baseUrl: string): string {
  return new URL(ref.split('/').map(encodeURIComponent).join('/'), baseUrl).href;
}

// Adresse complète normalisée comme celles de refUrl (espaces encodés…), ou null si elle est invalide.
function absoluteUrl(ref: string): string | null {
  try {
    return new URL(ref).href;
  } catch {
    return null;
  }
}

/**
 * Adresses citées par un index distant (`rel` : son nom, qui donne son type). Un .m3u peut aussi citer ses disques
 * par leur adresse complète, gardées à leur place dans la liste pour respecter l'ordre des disques.
 */
export function citedUrls(rel: string, text: string, indexUrl: string): string[] {
  if (path.extname(rel).toLowerCase() !== '.m3u') return parseRefs(rel, text).map((ref) => refUrl(ref, indexUrl));
  const urls = m3uEntries(text).map((l) => {
    if (isAbsoluteUrl(l)) return absoluteUrl(l);
    const ref = safeRel(l);
    return ref && refUrl(ref, indexUrl);
  });
  return [...new Set(urls.filter((u): u is string => !!u))];
}

/**
 * Tous les fichiers d'un jeu distant : l'index lui-même puis, récursivement, ce qu'il cite.
 * fetchText(url) → texte de l'index. Seuls les fichiers du même site et sous le dossier de l'index sont suivis,
 * y compris ceux qu'un .m3u cite par leur adresse complète.
 */
export async function resolveRemote(url: string, fetchText: (url: string) => Promise<string>, { maxFiles = 200 } = {}): Promise<RemoteFile[]> {
  const origin = new URL(url).origin;
  const rootDir = new URL('.', url).href;
  const out = new Map<string, string>();
  const relOf = (u: string) => decodeURIComponent(u.slice(rootDir.length).split('?')[0]);
  async function visit(u: string, depth: number): Promise<void> {
    if (out.has(u) || out.size >= maxFiles) return;
    const rel = safeRel(relOf(u));
    if (!rel) return;
    out.set(u, rel);
    if (depth > 3 || !isDescriptor(u)) return;
    let text = '';
    try {
      text = await fetchText(u);
    } catch {
      return;
    }
    for (const n of citedUrls(rel, text, u)) {
      if (new URL(n).origin === origin && n.startsWith(rootDir)) await visit(n, depth + 1);
    }
  }
  await visit(url, 0);
  return [...out].map(([u, rel]) => ({ url: u, rel }));
}

// Fichiers cités par un index local qui manquent à côté de lui (récursif pour les .m3u).
export function missingLocal(file: string, depth = 0): string[] {
  let text = '';
  try {
    text = decode(fs.readFileSync(file));
  } catch {
    return [];
  }
  const dir = path.dirname(file);
  const missing: string[] = [];
  for (const ref of parseRefs(file, text)) {
    const p = path.join(dir, ref);
    if (!fs.existsSync(p)) missing.push(ref);
    else if (depth < 3 && isDescriptor(p)) missing.push(...missingLocal(p, depth + 1).map((r) => path.posix.join(path.posix.dirname(ref), r)));
  }
  return [...new Set(missing)];
}
