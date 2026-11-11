/** « Télécharger sur cet ordinateur » : copie locale d'un jeu en ligne dans le dossier principal de la console. */
import fs from 'node:fs';
import path from 'node:path';
import { safeFileName } from '@mire/shared';
import { findConsole } from '../../config/index.ts';
import * as disc from '../disc/index.ts';
import type { GamesDeps } from '../types.ts';

export async function downloadGame(deps: Pick<GamesDeps, 'config' | 'downloads'>, consoleId: string, url: string) {
  const emu = findConsole(deps.config.get(), consoleId);
  const downloads = deps.downloads();
  if (!emu) return { ok: false as const, error: 'Cette console n’existe plus dans la configuration.' };
  if (!emu.romsDir) return { ok: false as const, error: `Indiquez d’abord le dossier principal de ${emu.name} (Modifier la console).` };
  const u = String(url || '');
  if (!disc.isDescriptor(u)) return { ...downloads.addUrl(u, { console: consoleId }), count: 1 };
  // Jeu sur disque : l'index et tous les fichiers qu'il cite, dans un dossier au nom du jeu.
  let files: disc.RemoteFile[];
  try {
    files = await disc.resolveRemote(u, (x) => downloads.fetchText(x));
  } catch (err) {
    return { ok: false as const, error: `Index du jeu illisible (${(err as Error).message}).` };
  }
  const base = safeFileName(path.basename(files[0].rel, path.extname(files[0].rel)), { max: Infinity, fallback: '' });
  const folder = path.join(emu.romsDir, base);
  const todo = files.filter((f) => !fs.existsSync(path.join(folder, ...f.rel.split('/'))));
  for (const f of todo) downloads.addUrl(f.url, { console: consoleId, saveAs: path.join(folder, ...f.rel.split('/')), group: base, companionsQueued: true });
  return { ok: true as const, count: todo.length, total: files.length };
}
