/**
 * Sous-titres d'une vidéo, demandés par le lecteur à l'ouverture.
 *
 * - Vidéo locale : les sous-titres viennent des plugins (nature `subtitles`, P5-11b ; `mire.subtitles` cherche les
 *   `.srt` et `.vtt` posés à côté). Le cœur ne leur passe qu'une vidéo que sa politique d'accès autorise, et vérifie
 *   ce qu'ils rendent (`plugins/bridges.ts`).
 * - Vidéo en ligne : sous-titres trouvés par l'analyse d'une page d'index (serveur web de la bibliothèque).
 */
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
  /** Sous-titres trouvés par les plugins pour une vidéo locale autorisée (libellé vide : « Sous-titres »). */
  plugins?: (videoPath: string) => Promise<Subtitle[]>;
}

/** Longueur maximale d'un chemin ou d'une adresse reçus de l'interface. */
const MAX_PATH = 4096;

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

async function pluginSubtitles(videoPath: string, opts: SubtitleOptions): Promise<Subtitle[]> {
  if (!opts.plugins) return [];
  try {
    const found = await opts.plugins(videoPath);
    return found.map((s) => ({ ...s, label: s.label || t('library.subtitles') }));
  } catch {
    return [];
  }
}

export async function findSubtitles(videoPath: unknown, opts: SubtitleOptions): Promise<Subtitle[]> {
  if (typeof videoPath !== 'string' || !videoPath || videoPath.length > MAX_PATH) return [];
  if (isHttpUrl(videoPath)) return remoteSubtitles(videoPath, opts.remote);
  if (!path.isAbsolute(videoPath) || !opts.isAllowed(videoPath)) return [];
  return pluginSubtitles(path.resolve(videoPath), opts);
}
