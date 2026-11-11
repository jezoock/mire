/**
 * Moteur HTTP : ce qui est téléchargé depuis les navigateurs intégrés, les jeux des sources web
 * (« Télécharger sur cet ordinateur ») et les liens collés dans Téléchargements.
 * Le téléchargement est confié à Chromium (pause et reprise comprises).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isHttpUrl, newId, safeFileName } from '@mire/shared';
import disc from '../discfiles.js';
import * as http from '../net/http.ts';
import type { AddResult, DownloadContext, Downloader, DownloaderHost, DownloadRecord } from './types.ts';

type Listener = (event: unknown, state: string) => void;

/** Sous-ensemble du `DownloadItem` d'Electron utilisé ici. */
export interface DownloadItemLike {
  getURL(): string;
  getURLChain?(): string[];
  getFilename(): string;
  getMimeType(): string;
  setSavePath(file: string): void;
  getTotalBytes(): number;
  getReceivedBytes(): number;
  isPaused(): boolean;
  canResume(): boolean;
  pause(): void;
  resume(): void;
  cancel(): void;
  on(event: 'updated', listener: Listener): unknown;
  once(event: 'done', listener: Listener): unknown;
}

/** Sous-ensemble de la session Electron des pages web. */
export interface SessionLike {
  downloadURL(url: string): void;
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface HttpDownloaderOptions {
  getSession: () => SessionLike;
  /** Dossier où arrivent les fichiers .torrent téléchargés depuis une page. */
  torrentInbox: string;
  /** Un fichier .torrent reçu devient un téléchargement torrent. */
  onTorrentFile: (file: string, ctx: DownloadContext) => void;
}

export interface HttpDownloader extends Downloader {
  addUrl(url: string, ctx?: DownloadContext): AddResult;
  handleWebDownload(dl: DownloadItemLike, ctxFromView?: DownloadContext): void;
  fetchText(url: string): Promise<string>;
}

export function createHttpDownloader(host: DownloaderHost, { getSession, torrentInbox, onTorrentFile }: HttpDownloaderOptions): HttpDownloader {
  const { items, update } = host;
  const live = new Map<string, DownloadItemLike>();
  const pendingUrls = new Map<string, DownloadContext>(); // adresse → contexte d'un téléchargement demandé par Mire

  function request(url: string, ctx: DownloadContext) {
    pendingUrls.set(url, ctx);
    getSession().downloadURL(url);
  }

  // Téléchargement demandé par Mire (jeu d'une source web, lien collé).
  function addUrl(url: string, ctx: DownloadContext = {}): AddResult {
    if (!isHttpUrl(url)) return { ok: false, error: 'Adresse invalide : elle doit commencer par http:// ou https://.' };
    request(url, ctx);
    return { ok: true };
  }

  // Relance d'une fiche existante (marque-page, nouvel essai) : la copie dans le cache garde son chemin.
  function relaunch(it: DownloadRecord) {
    update(it, { state: 'waiting', received: 0, speed: 0, error: '' });
    const keep = it.cache ? { saveAs: it.file as string, cache: true } : {};
    request(it.source, { console: it.console, retryOf: it.id, ...keep });
  }

  function retry(it: DownloadRecord) {
    if (it.file) fsp.unlink(it.file as string).catch(() => {});
    relaunch(it);
  }

  // Tout téléchargement HTTP passe par ici (navigateurs intégrés compris).
  function handleWebDownload(dl: DownloadItemLike, ctxFromView?: DownloadContext) {
    const url = dl.getURL();
    const chain = dl.getURLChain ? dl.getURLChain() : [url];
    const key = chain.find((u) => pendingUrls.has(u));
    const ctx: DownloadContext = (key ? pendingUrls.get(key) : ctxFromView) || {};
    if (key) pendingUrls.delete(key);
    const filename = safeFileName(dl.getFilename());

    // Un fichier .torrent devient un téléchargement torrent.
    if (/\.torrent$/i.test(filename) || dl.getMimeType() === 'application/x-bittorrent') {
      fs.mkdirSync(torrentInbox, { recursive: true });
      const tmp = path.join(torrentInbox, `${Date.now()}-${filename}`);
      dl.setSavePath(tmp);
      dl.once('done', (_e, state) => {
        if (state === 'completed') onTorrentFile(tmp, ctx);
      });
      return;
    }

    const dest = host.destFor(ctx);
    let file: string;
    if (ctx.saveAs) {
      // Fichier d'un jeu sur disque : il doit porter exactement le nom cité par l'index.
      file = ctx.saveAs;
      fs.mkdirSync(path.dirname(file), { recursive: true });
    } else {
      fs.mkdirSync(dest.dir, { recursive: true });
      const ext = path.extname(filename);
      file = path.join(dest.dir, filename);
      for (let n = 2; fs.existsSync(file); n++) file = path.join(dest.dir, `${path.basename(filename, ext)} (${n})${ext}`);
    }
    dl.setSavePath(file);

    const retryOf = ctx.retryOf ? items.get(ctx.retryOf) : null;
    const it = (retryOf || { id: newId(6), kind: 'http', createdAt: Date.now() }) as DownloadRecord;
    Object.assign(it, {
      name: path.basename(file),
      source: chain[0] || url,
      file,
      dir: path.dirname(file),
      console: dest.console,
      consoleName: dest.consoleName,
      state: 'downloading',
      received: 0,
      total: dl.getTotalBytes(),
      speed: 0,
      error: '',
      installers: [],
      extracted: false,
      group: ctx.group || it.group || '',
      companionsQueued: !!(ctx.companionsQueued || it.companionsQueued),
      gameBookmark: ctx.gameBookmark || it.gameBookmark || null,
      ...(ctx.cache ? { cache: true } : {}),
    });
    items.set(it.id, it);
    live.set(it.id, dl);
    update(it);
    ctx.onStart?.(it);

    let lastBytes = 0;
    let lastTime = Date.now();
    let lastSent = 0;
    dl.on('updated', (_e, state) => {
      const now = Date.now();
      if (state === 'interrupted') {
        update(it, { state: 'downloading', speed: 0 });
        return;
      }
      if (dl.isPaused()) {
        if (it.state !== 'paused') update(it, { state: 'paused', speed: 0 });
        return;
      }
      if (now - lastSent < 500) return;
      const received = dl.getReceivedBytes();
      const speed = Math.max(0, ((received - lastBytes) * 1000) / Math.max(1, now - lastTime));
      lastBytes = received;
      lastTime = now;
      lastSent = now;
      update(it, { state: 'downloading', received, total: dl.getTotalBytes(), speed });
    });
    dl.once('done', async (_e, state) => {
      live.delete(it.id);
      if (state === 'cancelled') {
        update(it, { state: 'cancelled', speed: 0 });
        return;
      }
      if (state !== 'completed') {
        update(it, { state: 'error', speed: 0, error: 'Le téléchargement a été interrompu (connexion perdue ou fichier indisponible).' });
        return;
      }
      update(it, { received: dl.getReceivedBytes(), total: dl.getReceivedBytes(), speed: 0 });
      await host.finish(it, [file]);
    });
  }

  // Texte d'un petit fichier distant (index de jeu sur disque), par la session des pages : ses cookies et
  // son identité de navigateur, pas celle de Mire.
  async function fetchText(url: string): Promise<string> {
    let buf: Buffer;
    try {
      buf = await http.getBuffer(url, { timeout: 20000, userAgent: null, fetch: (u, init) => getSession().fetch(u, init) });
    } catch (err) {
      const e = err as http.HttpError;
      if (e.kind === 'status') throw new Error(`code ${e.status}`, { cause: err });
      throw err;
    }
    if (buf.length > 2 * 1024 * 1024) throw new Error('fichier trop gros pour un index');
    return disc.decode(buf);
  }

  return {
    id: 'http',
    canHandle: (source) => isHttpUrl(source),
    add(source, ctx = {}, fiche = null) {
      if (!fiche) return addUrl(source, ctx);
      relaunch(fiche);
      return { ok: true, id: fiche.id };
    },
    isLive: (id) => live.has(id),
    pause(it) {
      const dl = live.get(it.id);
      if (dl && !dl.isPaused()) {
        dl.pause();
        update(it, { state: 'paused', speed: 0 });
      }
    },
    resume(it) {
      const dl = live.get(it.id);
      if (dl) {
        if (dl.canResume()) {
          dl.resume();
          update(it, { state: 'downloading' });
        } else retry(it);
        return;
      }
      if (['interrupted', 'error', 'cancelled'].includes(it.state)) retry(it);
    },
    async cancel(it) {
      const dl = live.get(it.id);
      live.delete(it.id);
      dl?.cancel();
    },
    async stop() {
      for (const dl of live.values()) dl.pause();
    },
    addUrl,
    handleWebDownload,
    fetchText,
  };
}
