/** Sous-titres .srt / .vtt à côté d'une vidéo : sur le disque, ou trouvés par l'analyse d'une page d'index. */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { isHttpUrl } from '@mire/shared';
import * as http from '../net/http.ts';
import { decodeText, srtToVtt } from '../lib/text.ts';
import type { RemoteSubtitles } from './types.ts';
import { t } from '../i18n/current.ts';

export interface Subtitle {
  label: string;
  lang: string;
  vtt: string;
}

export interface SubtitleOptions {
  /** Sous-titres des vidéos en ligne, rendus par la dernière analyse. */
  remote: RemoteSubtitles;
  /** Politique d'accès : une vidéo locale hors des dossiers autorisés n'a pas de sous-titres. */
  isAllowed: (file: string) => boolean;
}

// Libellé et langue d'après ce qui suit le nom de la vidéo (film.fr.srt → « fr »).
function describe(rest: string, vtt: string): Subtitle {
  const lang = (rest.split(/[._\s-]/)[0] || '').toLowerCase();
  return { label: rest || t('library.subtitles'), lang: /^[a-z]{2,3}$/.test(lang) ? lang : '', vtt };
}

async function remoteSubtitles(videoUrl: string, remote: RemoteSubtitles): Promise<Subtitle[]> {
  const out: Subtitle[] = [];
  for (const sub of remote.get(videoUrl) || []) {
    try {
      let text = decodeText(await http.getBuffer(sub.url, { timeout: 15000 }));
      if (sub.name.toLowerCase().endsWith('.srt')) text = srtToVtt(text);
      const rest = path
        .basename(sub.name, path.extname(sub.name))
        .slice(sub.base.length)
        .replace(/^[._\-\s]+/, '');
      out.push(describe(rest, text));
    } catch {
      /* sous-titre inaccessible */
    }
  }
  return out;
}

async function localSubtitles(videoPath: string): Promise<Subtitle[]> {
  const dir = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath)).toLowerCase();
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const subs: Subtitle[] = [];
  for (const n of names) {
    const ext = path.extname(n).toLowerCase();
    if (ext !== '.srt' && ext !== '.vtt') continue;
    const b = path.basename(n, path.extname(n));
    if (!b.toLowerCase().startsWith(base)) continue;
    const rest = b.slice(base.length).replace(/^[._\-\s]+/, '');
    try {
      let text = decodeText(await fsp.readFile(path.join(dir, n)));
      if (ext === '.srt') text = srtToVtt(text);
      subs.push(describe(rest, text));
    } catch {
      /* fichier illisible */
    }
  }
  return subs;
}

export async function findSubtitles(videoPath: string, opts: SubtitleOptions): Promise<Subtitle[]> {
  if (isHttpUrl(videoPath)) return remoteSubtitles(videoPath, opts.remote);
  if (!opts.isAllowed(videoPath)) return [];
  return localSubtitles(videoPath);
}
