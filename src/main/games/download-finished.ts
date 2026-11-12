/**
 * Fin d'un téléchargement, vue des jeux : le marque-page de jeu téléchargé est terminé (sa fiche reportée sur le
 * jeu), puis l'interface est prévenue ; un jeu téléchargé pour une console est annoncé (« jeu ajouté »), une seule
 * fois pour un jeu sur disque en plusieurs fichiers.
 */
import path from 'node:path';
import type { DownloadRecord } from '../downloads/types.ts';
import type { FinishedDownload } from './bookmarks.ts';

/** Annonce « jeu ajouté » envoyée à l'interface (canal `rom-download`). */
export interface RomDownloadNotice {
  phase: 'done';
  console: string;
  consoleName: string;
  name: string;
  /** Jeu sur disque : nombre de fichiers téléchargés. */
  files?: number;
  extracted: boolean;
}

const FINAL_STATES = ['done', 'error', 'cancelled'];

/** Annonce à faire pour ce téléchargement terminé, ou `null` (pas un jeu, ou des fichiers du jeu manquent encore). */
export function romDownloadNotice(item: DownloadRecord, list: readonly DownloadRecord[]): RomDownloadNotice | null {
  if (item.console == null) return null;
  // Index qui attend ses pistes : on annoncera le jeu quand tout sera là.
  if (item.companions && !item.group) return null;
  if (item.group) {
    // Fichiers d'un même jeu sur disque : un seul message, quand le dernier est arrivé.
    const same = list.filter((d) => d.group === item.group && d.console === item.console);
    if (same.some((d) => !FINAL_STATES.includes(d.state))) return null;
    // L'index téléchargé seul depuis une page compte aussi parmi les fichiers du jeu.
    const index = list.filter(
      (d) => !d.group && d.companions && d.console === item.console && path.basename(d.name, path.extname(d.name)) === item.group,
    ).length;
    return {
      phase: 'done',
      console: item.console,
      consoleName: item.consoleName,
      name: String(item.group),
      files: same.length + index,
      extracted: same.some((d) => d.extracted),
    };
  }
  return { phase: 'done', console: item.console, consoleName: item.consoleName, name: item.name, extracted: !!item.extracted };
}

export interface DownloadFinishedDeps {
  /** Marque-page de jeu téléchargé (src/main/games/bookmarks.ts). */
  onBookmarkDownloaded(item: FinishedDownload): Promise<void>;
  /** Téléchargements connus, pour regrouper les fichiers d'un jeu sur disque. */
  list(): DownloadRecord[];
  toUi(channel: string, payload?: unknown): void;
  log?: (message: string) => void;
}

/** Ce qui se passe quand un téléchargement se termine (option `onFinished` du gestionnaire de téléchargements). */
export function onDownloadFinished(deps: DownloadFinishedDeps) {
  const log = deps.log || ((m: string) => console.error(m));
  return (item: DownloadRecord): void => {
    // Marque-page de jeu téléchargé : terminé, et sa fiche reportée sur le jeu, avant de prévenir l'interface,
    // qui recharge alors la liste et les fiches.
    if (item.gameBookmark) {
      deps
        .onBookmarkDownloaded(item)
        .catch((err: Error) => log(`Marque-page de jeu : ${err.message}`))
        .finally(() => deps.toUi('download-finished', item));
    } else deps.toUi('download-finished', item);
    const notice = romDownloadNotice(item, deps.list());
    if (notice) deps.toUi('rom-download', notice);
  };
}
