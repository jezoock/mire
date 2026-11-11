/**
 * Arborescence du dossier de données de Mire (`userData` d'Electron), en un seul endroit.
 * À ne pas confondre avec `lib/paths.js` (contrôle qu'un chemin est dans un dossier autorisé).
 * Le détail de chaque fichier est décrit dans `docs/architecture.md`.
 */
import path from 'node:path';

export interface DataPaths {
  root: string;
  /** Configuration (P1-06). */
  config: string;
  /** « Reprendre », positions de reprise, volume, recherches récentes (P1-09). */
  usage: string;
  /** Infos modifiées à la main (titre, genre, images…) et leurs images. */
  metaDir: string;
  meta: string;
  metaImg: string;
  /** Infos récupérées en ligne (films, séries, jeux) et leurs images. */
  scrapeDir: string;
  scrapeDb: string;
  scrapeImg: string;
  scrapeCache: string;
  /** Liste des téléchargements et fichiers .torrent gardés pour la reprise. */
  downloads: string;
  torrents: string;
  /** Émulateurs installés par la boutique. */
  emulatorsDir: string;
  emulatorsInstalled: string;
  /** Bloqueur de publicités : moteur compilé et état des listes. */
  adblockDir: string;
  adblockEngine: string;
  adblockLists: string;
  /** Jeux en ligne téléchargés pour être lancés. */
  romCache: string;
  /** Copie exécutable de 7za quand l'original ne peut pas l'être. */
  binDir: string;
  sevenZip: string;
}

export function dataPaths(root: string): DataPaths {
  const at = (...parts: string[]) => path.join(root, ...parts);
  return {
    root,
    config: at('config.json'),
    usage: at('usage.json'),
    metaDir: at('meta'),
    meta: at('meta', 'meta.json'),
    metaImg: at('meta', 'img'),
    scrapeDir: at('scrape'),
    scrapeDb: at('scrape', 'db.json'),
    scrapeImg: at('scrape', 'img'),
    scrapeCache: at('scrape', 'cache'),
    downloads: at('telechargements.json'),
    torrents: at('torrents'),
    emulatorsDir: at('emulators'),
    emulatorsInstalled: at('emulators', 'installed.json'),
    adblockDir: at('adblock'),
    adblockEngine: at('adblock', 'moteur.bin'),
    adblockLists: at('adblock', 'listes.json'),
    romCache: at('cache', 'roms'),
    binDir: at('bin'),
    sevenZip: at('bin', '7za'),
  };
}
