/** Élément de bibliothèque d'un fichier ouvert explicitement (boîte de dialogue, glisser-déposer, ligne de commande). */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { KIND, NATIVE, COVER_RE } from '@mire/shared';
import type { LibraryItem } from './types.ts';

export interface ItemFromPathOptions {
  /** Autorise le fichier ouvert et sa pochette (politique d'accès). */
  allowFile: (file: string) => void;
}

// Pochette : image du même nom que le fichier, ou image de dossier (cover.jpg, folder.png…).
async function findCover(dir: string, name: string): Promise<string | null> {
  try {
    const names = await fsp.readdir(dir);
    const base = name.toLowerCase();
    const found = names.find(
      (n) => KIND[path.extname(n).toLowerCase()] === 'image' && (path.basename(n, path.extname(n)).toLowerCase() === base || COVER_RE.test(n)),
    );
    return found ? path.join(dir, found) : null;
  } catch {
    return null;
  }
}

export async function itemFromPath(p: unknown, { allowFile }: ItemFromPathOptions): Promise<LibraryItem | null> {
  if (typeof p !== 'string') return null;
  try {
    const st = await fsp.stat(p);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  const ext = path.extname(p).toLowerCase();
  const kind = KIND[ext];
  if (!kind) return null;
  allowFile(p);

  const dir = path.dirname(p);
  const name = path.basename(p, path.extname(p));
  let cover: string | null = null;
  if (kind !== 'image') {
    cover = await findCover(dir, name);
    if (cover) allowFile(cover);
  }
  return { path: p, name, ext, kind, folder: path.basename(dir), dir, native: NATIVE.has(ext), cover };
}
