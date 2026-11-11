/**
 * Fin d'un téléchargement : pour une console, une archive que son émulateur ne sait pas lire est décompressée
 * (par le service d'archives) puis supprimée ; un programme d'installation trouvé est signalé (bouton
 * « Lancer l'installation ») ; un index de jeu sur disque téléchargé seul fait venir les fichiers qu'il cite.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isHttpUrl } from '@mire/shared';
import * as disc from '../games/disc/index.ts';
import type { DownloadContext, DownloadRecord } from './types.ts';

const ARCHIVES = new Set(['.zip', '.7z']);

// Programmes d'installation, selon le système.
const INSTALLER: Partial<Record<NodeJS.Platform, (name: string) => boolean>> = {
  win32: (n) => /^(setup|install|installer|installation)[^\\/]*\.exe$/i.test(n) || /\.msi$/i.test(n),
  darwin: (n) => /\.(pkg|dmg)$/i.test(n),
  linux: (n) => /\.appimage$/i.test(n) || /^(setup|install|installer)[^/]*\.(sh|run)$/i.test(n),
};

export interface FinishDeps {
  extract(archive: string, dest: string): Promise<void>;
  update(it: DownloadRecord, patch?: Partial<DownloadRecord>): void;
  /** Extensions que l'émulateur de la console lit directement (une archive lisible reste telle quelle). */
  readableExtensions(consoleId: string | null): string[];
  addUrl(url: string, ctx: DownloadContext): unknown;
  onFinished(it: DownloadRecord): void;
  platform?: NodeJS.Platform;
}

/** Programmes d'installation trouvés dans les fichiers (dossiers parcourus sur 3 niveaux, 5 au plus). */
export async function findInstallers(paths: string[], platform: NodeJS.Platform = process.platform): Promise<string[]> {
  const test = INSTALLER[platform] || (() => false);
  const found: string[] = [];
  async function walk(p: string, depth: number) {
    if (found.length >= 5 || depth > 3) return;
    let st;
    try {
      st = await fsp.stat(p);
    } catch {
      return;
    }
    if (st.isFile()) {
      if (test(path.basename(p))) found.push(p);
      return;
    }
    if (!st.isDirectory()) return;
    let entries: string[] = [];
    try {
      entries = await fsp.readdir(p);
    } catch {
      return;
    }
    for (const e of entries) await walk(path.join(p, e), depth + 1);
  }
  for (const p of paths) await walk(p, 0);
  // Le programme le plus proche de la racine d'abord (setup.exe plutôt qu'un sous-composant).
  return found.sort((a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length);
}

/**
 * Index de jeu sur disque (.cue, .m3u…) téléchargé seul depuis une page : les fichiers qu'il cite et qui manquent
 * à côté de lui (pistes .bin, autres disques), à aller chercher sur le même site.
 */
export function companionsOf(it: DownloadRecord): Array<{ url: string; ctx: DownloadContext }> {
  const file = typeof it.file === 'string' ? it.file : '';
  if (!file || !disc.isDescriptor(file) || !isHttpUrl(it.source || '')) return [];
  const missing: string[] = disc.missingLocal(file);
  if (!missing.length) return [];
  const origin = new URL(it.source).origin;
  const group = (it.group as string) || path.basename(it.name, path.extname(it.name));
  const out = [];
  for (const rel of missing) {
    let url: string;
    try {
      url = disc.refUrl(rel, it.source);
    } catch {
      continue;
    }
    if (new URL(url).origin !== origin) continue;
    // Un index cité (disque d'une liste .m3u) sera lu à son tour une fois téléchargé.
    out.push({ url, ctx: { console: it.console, saveAs: path.join(path.dirname(file), ...rel.split('/')), group, companionsQueued: !disc.isDescriptor(rel) } });
  }
  return out;
}

/** Décompression des archives d'une console ; `null` si l'une a échoué (la fiche passe alors en erreur). */
async function unpack(it: DownloadRecord, files: string[], deps: FinishDeps): Promise<string[] | null> {
  if (it.console == null) return files;
  const readable = new Set(deps.readableExtensions(it.console).map((x) => String(x).toLowerCase()));
  const out: string[] = [];
  // Archive que l'émulateur ne lit pas : décompressée dans un dossier à son nom.
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!ARCHIVES.has(ext) || readable.has(ext) || !fs.existsSync(f)) {
      out.push(f);
      continue;
    }
    deps.update(it, { state: 'extracting' });
    const folder = f.slice(0, -ext.length);
    try {
      await deps.extract(f, folder);
      await fsp.unlink(f);
      it.extracted = true;
      out.push(folder);
    } catch (err) {
      deps.update(it, { state: 'error', error: `Téléchargement terminé, mais l'archive n'a pas pu être décompressée (${(err as Error).message}).` });
      return null;
    }
  }
  return out;
}

export async function finishDownload(it: DownloadRecord, files: string[], deps: FinishDeps): Promise<void> {
  // Copie dans le cache (lancement d'un jeu en ligne) : le fichier sert tel quel, et le jeu se lance aussitôt :
  // pas d'annonce « téléchargé » (onFinished), seul celui qui l'a demandé est prévenu (par la fiche).
  if (it.cache) {
    deps.update(it, { state: 'done', doneAt: Date.now(), speed: 0, installers: [] });
    return;
  }
  const out = await unpack(it, files, deps);
  if (!out) return;
  const installers = await findInstallers(out, deps.platform);
  deps.update(it, { state: 'done', doneAt: Date.now(), speed: 0, installers });
  if (it.kind === 'http' && it.console != null && !it.companionsQueued) {
    const companions = companionsOf(it);
    for (const c of companions) deps.addUrl(c.url, c.ctx);
    if (companions.length) deps.update(it, { companions: companions.length });
  }
  deps.onFinished(it);
}
