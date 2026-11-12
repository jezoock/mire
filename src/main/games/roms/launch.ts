/**
 * Lancement d'un jeu de console par son émulateur. Un jeu d'une source web est d'abord copié dans le cache de Mire
 * par le gestionnaire de téléchargements (visible et annulable dans Téléchargements), une fois pour toutes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isHttpUrl, safeDecode, safeFileName, slug } from '@mire/shared';
import type { Emulator } from '@mire/shared';
import { findConsole } from '../../config/index.ts';
import { substitute } from '../../lib/args.ts';
import type { LaunchResult } from '../../platform/index.ts';
import * as disc from '../disc/index.ts';
import type { GamesDeps } from '../types.ts';
import { t } from '../../i18n/current.ts';

type Deps = Pick<GamesDeps, 'config' | 'access' | 'launcher' | 'downloads' | 'romCacheDir' | 'toUi'>;

const progress = (deps: Deps, name: string) => (received: number, total: number) => deps.toUi('rom-progress', { name, phase: 'download', received, total });

/** Le jeu provient-il d'une source web de la console ? (l'interface n'est pas crue sur parole) */
export function isFromSource(emu: Emulator, url: string): boolean {
  return (emu.sources || []).some((x) => isHttpUrl(x) && url.startsWith(x.endsWith('/') ? x : `${x}/`));
}

/** Copie d'un jeu en ligne dans le cache : chemin du fichier à lancer, ou erreur. */
export async function cacheRemoteRom(deps: Deps, emu: Emulator, url: string): Promise<{ ok: true; file: string } | { ok: false; error: string }> {
  const fileName = safeFileName(safeDecode(new URL(url).pathname.split('/').pop() || ''), { max: Infinity, fallback: '' });
  const consoleDir = path.join(deps.romCacheDir(), slug(emu.name) || 'console');
  const downloads = deps.downloads();
  if (!disc.isDescriptor(fileName)) {
    const target = path.join(consoleDir, fileName);
    if (fs.existsSync(target)) return { ok: true, file: target };
    deps.toUi('rom-progress', { name: fileName, phase: 'download' });
    const r = await downloads.fetchToCache(url, target, { onProgress: progress(deps, fileName) });
    if (!r.ok) return { ok: false, error: r.error };
    deps.toUi('rom-progress', { name: fileName, phase: 'done' });
    return { ok: true, file: target };
  }
  // Jeu sur disque : l'index et ses pistes (ou ses disques) vont ensemble dans un dossier du cache.
  let files: disc.RemoteFile[];
  try {
    files = await disc.resolveRemote(url, (x) => downloads.fetchText(x));
  } catch (err) {
    return { ok: false, error: t('games.errors.indexUnreadable', { reason: (err as Error).message }) };
  }
  const folder = path.join(consoleDir, path.basename(fileName, path.extname(fileName)));
  const todo = files.filter((f) => !fs.existsSync(path.join(folder, ...f.rel.split('/'))));
  for (const [n, f] of todo.entries()) {
    const dest = path.join(folder, ...f.rel.split('/'));
    const label = todo.length > 1 ? t('games.romProgress', { name: fileName, index: String(n + 1), total: String(todo.length) }) : fileName;
    deps.toUi('rom-progress', { name: label, phase: 'download' });
    const r = await downloads.fetchToCache(f.url, dest, { onProgress: progress(deps, label) });
    if (!r.ok) return { ok: false, error: `${path.basename(dest)} : ${r.error}` };
  }
  if (todo.length) deps.toUi('rom-progress', { name: fileName, phase: 'done' });
  return { ok: true, file: path.join(folder, files[0].rel) };
}

export async function launchRom(deps: Deps, consoleId: unknown, romPath: string): Promise<LaunchResult> {
  const emu = findConsole(deps.config.get(), consoleId);
  if (!emu) return { ok: false, error: t('games.errors.consoleGone') };
  let target = romPath;
  if (isHttpUrl(romPath)) {
    if (!isFromSource(emu, romPath)) return { ok: false, error: t('games.errors.notFromSource') };
    const cached = await cacheRemoteRom(deps, emu, romPath);
    if (!cached.ok) return cached;
    target = cached.file;
  } else if (!deps.access.isAllowed(romPath)) {
    return { ok: false, error: t('games.errors.notInConsoleFolders') };
  }
  const args = substitute(Array.isArray(emu.args) && emu.args.length ? emu.args : ['{rom}'], { rom: target });
  const cwd = path.isAbsolute(emu.path) ? path.dirname(emu.path) : undefined;
  return deps.launcher.launchProcess(emu.path, args, { cwd, hideWhileRunning: true });
}
