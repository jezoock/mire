/**
 * Moteur torrent : client intégré (WebTorrent, connexions TCP et DHT comme les clients de bureau, chargé à la
 * demande), ou bien lien magnet / fichier .torrent confié au logiciel de torrent installé.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { newId } from '@mire/shared';
import type { AddResult, DownloadContext, Downloader, DownloaderHost, DownloadRecord } from './types.ts';
import { t } from '../i18n/current.ts';

export interface ShellLike {
  openExternal(url: string): Promise<void>;
  openPath(file: string): Promise<string>;
}

export interface TorrentDownloaderOptions {
  shell: ShellLike;
  /** Dossier des fichiers .torrent gardés par Mire. */
  torrentDir: string;
}

export interface TorrentDownloader extends Downloader {
  addTorrent(source: string, ctx?: DownloadContext, existing?: DownloadRecord | null): Promise<AddResult>;
}

const isMagnet = (source: string) => /^magnet:\?/i.test(source);

export function torrentLabel(source: string): string {
  if (isMagnet(source)) {
    try {
      return new URLSearchParams(source.slice(8)).get('dn') || t('downloads.torrentName');
    } catch {
      return t('downloads.torrentName');
    }
  }
  return path
    .basename(source)
    .replace(/^\d+-/, '')
    .replace(/\.torrent$/i, '');
}

async function infoHashOf(source: string, magnet: boolean): Promise<string | null> {
  try {
    // parse-torrent est une dépendance de WebTorrent, chargée seulement ici.
    const { default: parseTorrent } = await import('parse-torrent' as string);
    const parsed = await parseTorrent(magnet ? source : await fsp.readFile(source));
    return parsed?.infoHash || null;
  } catch {
    return null;
  }
}

export function createTorrentDownloader(host: DownloaderHost, { shell, torrentDir }: TorrentDownloaderOptions): TorrentDownloader {
  const { items, update } = host;
  const live = new Map<string, any>(); // id → torrent WebTorrent
  let client: any = null;
  let clientLoading: Promise<any> | null = null;

  async function getClient() {
    if (client) return client;
    if (!clientLoading) {
      clientLoading = (async () => {
        // uTP (module natif facultatif) n'est pas installé : on tait l'avertissement de WebTorrent.
        const warn = console.warn;
        console.warn = () => {};
        let WebTorrent: any;
        try {
          ({ default: WebTorrent } = await import('webtorrent' as string));
        } finally {
          console.warn = warn;
        }
        client = new WebTorrent({ utp: false });
        client.on('error', (err: Error) => console.error('Torrents :', err.message));
        return client;
      })();
    }
    return clientLoading;
  }

  // source : lien magnet, ou chemin d'un fichier .torrent.
  async function addTorrent(source: string, ctx: DownloadContext = {}, existing: DownloadRecord | null = null): Promise<AddResult> {
    const magnet = isMagnet(source);
    if (!magnet && !fs.existsSync(source)) return { ok: false, error: t('downloads.errors.torrentFileNotFound') };

    // Logiciel installé : Mire lui confie le lien ou le fichier, sans suivre la progression.
    if (host.settings().torrentClient === 'system' && !existing) {
      try {
        if (magnet) await shell.openExternal(source);
        else {
          const err = await shell.openPath(source);
          if (err) throw new Error(err);
        }
      } catch (err) {
        return {
          ok: false,
          error: t('downloads.errors.noTorrentApp', { reason: (err as Error).message }),
        };
      }
      const it: DownloadRecord = {
        id: newId(6),
        kind: 'torrent',
        createdAt: Date.now(),
        name: torrentLabel(source),
        source,
        dir: '',
        console: null,
        consoleName: '',
        state: 'external',
        received: 0,
        total: 0,
        speed: 0,
        peers: 0,
        error: '',
        installers: [],
      };
      items.set(it.id, it);
      update(it);
      return { ok: true, id: it.id, external: true };
    }

    let c: any;
    try {
      c = await getClient();
    } catch (err) {
      return { ok: false, error: t('downloads.errors.torrentClientFailed', { reason: (err as Error).message }) };
    }

    // Même torrent (même empreinte) : on reprend sa fiche au lieu d'en créer une seconde.
    const hash = await infoHashOf(source, magnet);
    if (hash && !existing) {
      const same = [...items.values()].find((x) => x.kind === 'torrent' && x.infoHash === hash);
      if (same && live.has(same.id)) return { ok: true, id: same.id, duplicate: true };
      if (same) {
        existing = same;
        const d = host.destFor(ctx);
        Object.assign(existing, { dir: d.dir, console: d.console, consoleName: d.consoleName, received: 0 });
      }
    }
    if (hash) {
      const stale = await c.get(hash);
      if (stale) await new Promise<void>((resolve) => stale.destroy({ destroyStore: false }, () => resolve()));
    }
    const dest = existing ? { dir: existing.dir, console: existing.console, consoleName: existing.consoleName } : host.destFor(ctx);
    fs.mkdirSync(dest.dir, { recursive: true });
    const it = (existing || { id: newId(6), kind: 'torrent', createdAt: Date.now() }) as DownloadRecord;
    Object.assign(it, {
      name: it.name || torrentLabel(source),
      source,
      dir: dest.dir,
      console: dest.console,
      consoleName: dest.consoleName,
      state: 'waiting',
      speed: 0,
      peers: 0,
      error: '',
      installers: it.installers || [],
      infoHash: hash || it.infoHash,
    });
    items.set(it.id, it);
    update(it);

    let torrent: any;
    try {
      // Un lien magnet garde ses traqueurs et adresses de pairs : on repart toujours de lui. Un fichier
      // .torrent disparu (fichier reçu temporaire) est remplacé par la copie gardée par Mire.
      const kept = typeof it.torrentFile === 'string' && fs.existsSync(it.torrentFile) ? it.torrentFile : source;
      const addSource = magnet || fs.existsSync(source) ? source : kept;
      torrent = c.add(addSource, { path: dest.dir });
    } catch (err) {
      update(it, { state: 'error', error: t('downloads.errors.torrentUnreadable', { reason: (err as Error).message }) });
      return { ok: false, error: it.error };
    }
    live.set(it.id, torrent);
    torrent.on('error', (err: Error) => {
      live.delete(it.id);
      update(it, { state: 'error', speed: 0, error: t('downloads.errors.torrentError', { reason: err.message }) });
    });
    torrent.on('metadata', async () => {
      // Le fichier .torrent est gardé : la reprise n'a plus besoin de retrouver les métadonnées.
      try {
        fs.mkdirSync(torrentDir, { recursive: true });
        const tf = path.join(torrentDir, `${torrent.infoHash}.torrent`);
        await fsp.writeFile(tf, torrent.torrentFile);
        it.torrentFile = tf;
      } catch {
        /* sans copie locale */
      }
      update(it, { name: torrent.name, total: torrent.length, infoHash: torrent.infoHash, files: torrent.files.length, state: 'downloading' });
    });
    let lastSent = 0;
    torrent.on('download', () => {
      if (Date.now() - lastSent < 600) return;
      lastSent = Date.now();
      update(it, {
        state: 'downloading',
        received: torrent.downloaded,
        total: torrent.length,
        speed: torrent.downloadSpeed,
        peers: torrent.numPeers,
        eta: torrent.timeRemaining,
      });
    });
    torrent.on('done', async () => {
      const files = torrent.files.map((f: { path: string }) => path.join(dest.dir, f.path));
      update(it, { received: torrent.length, total: torrent.length, speed: 0, peers: torrent.numPeers });
      if (!host.settings().seed) {
        live.delete(it.id);
        torrent.destroy({ destroyStore: false });
      }
      await host.finish(it, files);
    });
    return { ok: true, id: it.id };
  }

  return {
    id: 'torrent',
    canHandle: (source) => isMagnet(source) || /\.torrent$/i.test(source),
    add: (source, ctx = {}, fiche = null) => addTorrent(source, ctx, fiche),
    isLive: (id) => live.has(id),
    pause(it) {
      const torrent = live.get(it.id);
      if (!torrent) return;
      live.delete(it.id);
      torrent.destroy({ destroyStore: false });
      update(it, { state: 'paused', speed: 0, peers: 0 });
    },
    async resume(it) {
      if (['paused', 'error'].includes(it.state)) await addTorrent(it.source, {}, it);
    },
    async cancel(it, removeFiles) {
      const torrent = live.get(it.id);
      live.delete(it.id);
      if (torrent) {
        await new Promise<void>((resolve) => torrent.destroy({ destroyStore: removeFiles }, () => resolve()));
      } else if (removeFiles && it.state !== 'done' && it.name && it.dir) {
        await fsp.rm(path.join(it.dir, it.name), { recursive: true, force: true }).catch(() => {});
      }
    },
    async stop() {
      if (client)
        await new Promise<void>((resolve) => {
          client.destroy(() => resolve());
          setTimeout(resolve, 3000);
        });
    },
    addTorrent,
  };
}
