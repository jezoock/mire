/**
 * Lecture d'un paquet de plugin (`.tgz` : tar ustar compressé en gzip), sans dépendance (D-03). Reprend `readTar` de
 * `mire-addons` (`scripts/lib/tar.mjs`) : seuls les fichiers ordinaires aux chemins relatifs sûrs sont acceptés.
 *
 * Tout ce qui n'est pas un fichier ordinaire (lien symbolique ou physique, dossier, périphérique, tube, en-tête
 * étendu pax ou GNU) est refusé, ainsi que les chemins absolus, `.`, `..`, `\`, `:`, les doublons et les tailles
 * excessives : ce qui est rendu s'écrit sous le dossier du plugin sans autre contrôle de chemin.
 */
import { gunzipSync } from 'node:zlib';
import { RepoError } from './errors.ts';

const BLOCK = 512;
/** Un plugin n'est pas un gros paquet : bornes d'un fichier, de l'archive décompressée et du nombre de fichiers. */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_ARCHIVE_SIZE = 200 * 1024 * 1024;
export const MAX_FILES = 5000;

export interface TarFile {
  path: string;
  data: Buffer;
}

/** Chemin permis : relatif, séparateurs `/`, sans `.`, `..`, `\`, `:` ni octet nul, 100 octets au plus. */
export function isArchivePath(p: string): boolean {
  if (typeof p !== 'string' || !p || Buffer.byteLength(p) > 100) return false;
  if (/[\\:\0]/.test(p) || p.startsWith('/')) return false;
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

const refuse = (message: string): never => {
  throw new RepoError('archive', message);
};

const readString = (buf: Buffer, offset: number, length: number): string => {
  const raw = buf.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? length : end).toString('utf8');
};

function readOctal(buf: Buffer, offset: number, length: number): number {
  const s = readString(buf, offset, length).trim();
  if (!/^[0-7]{1,11}$/.test(s)) refuse('Invalid tar header.');
  return parseInt(s, 8);
}

function checkHeader(h: Buffer): void {
  const stored = readOctal(h, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  if (sum !== stored) refuse('Invalid tar checksum.');
}

/** Fichiers d'un tar ; refuse toute entrée qui n'est pas un fichier ordinaire au chemin sûr. */
export function readTar(tar: Buffer): TarFile[] {
  const files: TarFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const h = tar.subarray(offset, offset + BLOCK);
    if (h.every((b) => b === 0)) return noFileAsFolder(files);
    checkHeader(h);
    const type = String.fromCharCode(h[156]);
    const prefix = readString(h, 345, 155);
    const name = readString(h, 0, 100);
    const path = prefix ? `${prefix}/${name}` : name;
    if (type !== '0' && type !== '\0') refuse(`Entry refused (not a regular file): ${path}`);
    if (!isArchivePath(path) || seen.has(path.toLowerCase())) refuse(`Path refused: ${path}`);
    const size = readOctal(h, 124, 12);
    if (size > MAX_FILE_SIZE) refuse(`File too big: ${path}`);
    total += size;
    if (total > MAX_ARCHIVE_SIZE || files.length >= MAX_FILES) refuse('Archive too big.');
    const start = offset + BLOCK;
    if (start + size > tar.length) refuse('Truncated archive.');
    files.push({ path, data: Buffer.from(tar.subarray(start, start + size)) });
    // Insensible à la casse : deux fichiers qui ne diffèrent que par elle s'écraseraient sous Windows et macOS.
    seen.add(path.toLowerCase());
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return refuse('Truncated archive (no end of tar).');
}

/** Refuse un fichier dont le chemin sert aussi de dossier à un autre (`a` et `a/b`). */
function noFileAsFolder(files: TarFile[]): TarFile[] {
  const names = new Set(files.map((f) => f.path.toLowerCase()));
  for (const f of files) {
    const parts = f.path.toLowerCase().split('/');
    for (let i = 1; i < parts.length; i++) if (names.has(parts.slice(0, i).join('/'))) refuse(`Path refused: ${f.path}`);
  }
  return files;
}

/** Fichiers d'un `.tgz` (décompression bornée). */
export function readTgz(tgz: Uint8Array): TarFile[] {
  let tar: Buffer;
  try {
    tar = gunzipSync(tgz, { maxOutputLength: MAX_ARCHIVE_SIZE + 1024 * 1024 });
  } catch {
    return refuse('Unreadable or too big gzip archive.');
  }
  return readTar(tar);
}
