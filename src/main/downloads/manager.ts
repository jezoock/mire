/**
 * Gestionnaire de téléchargements : fiches (persistance atomique), commandes, liste, réglages et événements.
 * Le transfert lui-même est confié à des moteurs interchangeables (`Downloader`) : HTTP (http.ts) et torrent
 * (torrent.ts). Le post-traitement (décompression, programme d'installation, fichiers compagnons) est dans finish.ts.
 *
 * Pour une console, les fichiers vont dans son dossier principal ; une archive que son émulateur ne sait pas lire
 * est décompressée. Un programme d'installation trouvé dans un téléchargement terminé est signalé.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isHttpUrl, newId } from '@mire/shared';
import { findConsole } from '../config/index.ts';
import { consoleIdAt } from '../config/migrations/v6.ts';
import { createJsonStore } from '../storage/json-store.ts';
import { dataPaths } from '../storage/paths.ts';
import { finishDownload } from './finish.ts';
import { createHttpDownloader, type DownloadItemLike, type SessionLike } from './http.ts';
import { createTorrentDownloader, torrentLabel, type ShellLike } from './torrent.ts';
import type { AddResult, CacheResult, Destination, DownloadContext, Downloader, DownloaderHost, DownloadRecord, DownloadSettings } from './types.ts';

const ACTIVE = new Set(['waiting', 'downloading', 'extracting']);
const PENDING = 'pending'; // marque-page de téléchargement : en attente, ne démarre qu'à la demande
const FINISHED = ['done', 'cancelled', 'error', 'external', 'interrupted'];

interface ConsoleLike {
  id?: unknown;
  name?: string;
  romsDir?: string;
  extensions?: string[];
}

export interface DownloadsOptions {
  dataDir: string;
  getConfig: () => { emulators: ConsoleLike[]; downloads?: Partial<DownloadSettings> };
  getSession: () => SessionLike;
  /** Service d'archives (src/main/archive). */
  extract(archive: string, dest: string): Promise<void>;
  shell: ShellLike & { showItemInFolder(file: string): void };
  defaultDir: string;
  onChange(it: DownloadRecord | { id: string; removed: true }): void;
  onFinished(it: DownloadRecord): void;
}

export function createDownloads({ dataDir, getConfig, getSession, extract, shell, defaultDir, onChange, onFinished }: DownloadsOptions) {
  const { downloads: listFile, torrents: torrentDir } = dataPaths(dataDir);
  const listStore = createJsonStore<{ items: DownloadRecord[] }>(listFile, { defaults: { items: [] }, debounceMs: 300, space: 1 });
  const items = new Map<string, DownloadRecord>(); // id → fiche affichée (enregistrée sur le disque)
  // Commande « télécharger dans le cache puis prévenir » : id de la fiche → qui attend sa fin.
  const waiters = new Map<string, { resolve: (r: CacheResult) => void; onProgress?: (received: number, total: number) => void }>();

  const settings = (): DownloadSettings => ({ dir: '', torrentClient: 'mire', seed: false, ...(getConfig().downloads || {}) });
  const baseDir = () => settings().dir || defaultDir;

  function load() {
    let migrated = false;
    try {
      for (const it of listStore.load().items || []) {
        // Après un redémarrage : les HTTP inachevés sont à relancer ; les torrents reprennent tout seuls.
        if (it.state !== PENDING && it.kind === 'http' && (ACTIVE.has(it.state) || it.state === 'paused'))
          Object.assign(it, { state: 'interrupted', speed: 0 });
        if (it.kind === 'torrent' && it.state === 'extracting') it.state = 'done';
        // Fiche d'avant la configuration v6 : console désignée par sa position, que la migration a conservée.
        if (typeof it.console === 'number') {
          it.console = consoleIdAt(getConfig().emulators || [], it.console) as string | null;
          migrated = true;
        }
        items.set(it.id, it);
      }
    } catch {
      /* liste illisible : on repart d'une liste vide */
    }
    if (migrated) save();
  }
  // La liste est relevée au moment de l'écriture (après le délai de regroupement), comme avant.
  const snapshot = () => ({ items: [...items.values()].map(({ installers, ...rest }) => ({ ...rest, installers: installers || [] })) });
  function save() {
    listStore.set({ toJSON: snapshot } as unknown as { items: DownloadRecord[] });
  }
  function update(it: DownloadRecord, patch: Partial<DownloadRecord> = {}) {
    Object.assign(it, patch);
    save();
    onChange(it);
    settleWaiter(it);
  }

  function settleWaiter(it: DownloadRecord) {
    const w = waiters.get(it.id);
    if (!w) return;
    if (it.state === 'downloading') w.onProgress?.(it.received, it.total);
    const result: CacheResult | null =
      it.state === 'done'
        ? { ok: true, file: it.file as string, id: it.id }
        : it.state === 'cancelled'
          ? { ok: false, cancelled: true, error: 'Téléchargement annulé.', id: it.id }
          : it.state === 'error'
            ? { ok: false, error: it.error, id: it.id }
            : null;
    if (!result) return;
    waiters.delete(it.id);
    w.resolve(result);
  }

  // Dossier de destination : celui de la console, sinon le dossier des téléchargements.
  function destFor(ctx?: DownloadContext): Destination {
    const emu = findConsole(getConfig(), ctx?.console);
    if (emu?.romsDir) return { dir: emu.romsDir, console: ctx!.console as string, consoleName: emu.name || '', extensions: emu.extensions || [] };
    return { dir: baseDir(), console: null, consoleName: '', extensions: [] };
  }

  const host: DownloaderHost = {
    items,
    update,
    destFor,
    settings,
    finish: (it, files) =>
      finishDownload(it, files, {
        extract,
        update,
        readableExtensions: (consoleId) => destFor({ console: consoleId }).extensions,
        addUrl: (url, ctx) => http.addUrl(url, ctx),
        onFinished,
      }),
  };
  const torrent = createTorrentDownloader(host, { shell, torrentDir });
  const http = createHttpDownloader(host, {
    getSession,
    torrentInbox: path.join(torrentDir, 'recus'),
    onTorrentFile: (file, ctx) => {
      torrent.addTorrent(file, ctx);
    },
  });
  const downloaders: Downloader[] = [torrent, http];
  const engineOf = (it: DownloadRecord) => (it.kind === 'torrent' ? torrent : http);
  const isLive = (id: string) => downloaders.some((d) => d.isLive(id));

  /* ---------- Commandes ---------- */

  function list() {
    return [...items.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function pause(id: string) {
    const it = items.get(id);
    if (it && isLive(id)) engineOf(it).pause(it);
    return list();
  }

  // Marque-page de téléchargement : enregistre une fiche « en attente » sans rien télécharger.
  // source : lien http direct, lien magnet, ou chemin d'un fichier .torrent.
  function addPending(source: unknown, ctx: DownloadContext = {}): AddResult {
    const src = String(source || '');
    const kind = torrent.canHandle(src) ? 'torrent' : 'http';
    const isMagnet = /^magnet:\?/i.test(src);
    const name = ctx.name || (isMagnet ? torrentLabel(src) : nameFromSource(src));
    const dest = destFor(ctx);
    const it: DownloadRecord = {
      id: newId(6),
      kind,
      createdAt: Date.now(),
      name,
      source: src,
      dir: dest.dir,
      console: dest.console,
      consoleName: dest.consoleName,
      state: PENDING,
      received: 0,
      total: 0,
      speed: 0,
      error: '',
      installers: [],
      torrentFile: kind === 'torrent' && !isMagnet ? src : null,
      gameBookmark: ctx.gameBookmark || null,
    };
    items.set(it.id, it);
    update(it);
    return { ok: true, id: it.id };
  }

  // Lance un téléchargement en attente.
  function startPending(id: string) {
    const it = items.get(id);
    if (!it || it.state !== PENDING) return list();
    const r = engineOf(it).add(it.source, { console: it.console }, it);
    if (r instanceof Promise) r.catch(() => {});
    return list();
  }

  async function resume(id: string) {
    const it = items.get(id);
    if (!it) return list();
    if (it.state === PENDING && !isLive(id)) return startPending(id);
    await engineOf(it).resume(it);
    return list();
  }

  async function cancel(id: string, removeFiles = true) {
    const it = items.get(id);
    if (!it) return list();
    await engineOf(it).cancel(it, removeFiles);
    update(it, { state: 'cancelled', speed: 0, peers: 0 });
    return list();
  }

  function remove(id: string) {
    const it = items.get(id);
    if (!it || isLive(id)) return list();
    items.delete(id);
    save();
    onChange({ id, removed: true });
    return list();
  }

  function clearFinished() {
    for (const [id, it] of items) if (!isLive(id) && FINISHED.includes(it.state)) items.delete(id);
    save();
    return list();
  }

  // Ouvrir le dossier, ou lancer le programme d'installation trouvé.
  async function reveal(id: string) {
    const it = items.get(id);
    if (!it) return { ok: false };
    const file = typeof it.file === 'string' ? it.file : '';
    const target = it.kind === 'http' && file && fs.existsSync(file) ? file : it.name && it.dir ? path.join(it.dir, it.name) : it.dir;
    if (target && fs.existsSync(target)) shell.showItemInFolder(target);
    else if (it.dir) await shell.openPath(it.dir);
    return { ok: true };
  }
  async function runInstaller(id: string, file?: string) {
    const it = items.get(id);
    if (!it || !file || !(it.installers || []).includes(file)) return { ok: false, error: 'Programme d’installation introuvable.' };
    const err = await shell.openPath(file);
    return err ? { ok: false, error: err } : { ok: true };
  }

  /**
   * Télécharge `url` vers `file` (copie d'un jeu en ligne dans le cache) et se résout quand le fichier est là,
   * ou que le téléchargement a échoué ou été annulé. Le téléchargement est visible et annulable dans
   * Téléchargements. Un fichier déjà présent n'est pas retéléchargé.
   */
  function fetchToCache(url: string, file: string, opts: { onProgress?: (received: number, total: number) => void } = {}): Promise<CacheResult> {
    if (!isHttpUrl(url)) return Promise.resolve({ ok: false, error: 'Adresse invalide : elle doit commencer par http:// ou https://.' });
    if (fs.existsSync(file)) return Promise.resolve({ ok: true, file, cached: true });
    return new Promise((resolve) => {
      http.addUrl(url, { saveAs: file, cache: true, onStart: (it) => waiters.set(it.id, { resolve, onProgress: opts.onProgress }) });
    });
  }

  // Au démarrage : les torrents qui étaient en cours reprennent.
  async function start() {
    load();
    for (const it of items.values()) {
      if (it.kind === 'torrent' && it.state !== PENDING && ACTIVE.has(it.state)) torrent.addTorrent(it.source, {}, it).catch(() => {});
    }
  }

  async function stop() {
    for (const d of [http, torrent]) await d.stop();
  }

  return {
    start,
    stop,
    flush: () => listStore.flush(),
    addUrl: (url: string, ctx?: DownloadContext) => http.addUrl(url, ctx),
    addTorrent: (source: string, ctx?: DownloadContext) => torrent.addTorrent(source, ctx),
    addPending,
    startPending,
    fetchToCache,
    fetchText: (url: string) => http.fetchText(url),
    handleWebDownload: (dl: DownloadItemLike, ctx?: DownloadContext) => http.handleWebDownload(dl, ctx),
    pause,
    resume,
    cancel,
    remove,
    clearFinished,
    reveal,
    runInstaller,
    list,
    settings,
  };
}

export type Downloads = ReturnType<typeof createDownloads>;

function nameFromSource(src: string): string {
  try {
    return decodeURIComponent(path.basename(new URL(src).pathname)) || src;
  } catch {
    return path.basename(src) || src;
  }
}
