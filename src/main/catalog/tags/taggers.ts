/**
 * Tags automatiques internes (P2-05) : ce que l'interface devinait d'après les noms et les dossiers devient des tags et
 * des infos, calculés ici. Ils deviendront les plugins inclus de la phase 5 (P5-09).
 */
import {
  cleanTrack,
  folderLabel,
  folderText,
  guessSystem,
  parseEpisode,
  splitAlbumFolder,
  trackNumber,
  type Element,
  type InfoValue,
  type SystemHint,
} from '@mire/shared';
import { parseVideo } from '../../scrape/parse.ts';
import type { Contributor } from './engine.ts';
import type { Tagger, TaggerResult } from '@mire/plugin-sdk';

// Interfaces publiées dans le SDK des plugins (contribution `taggers`).
export type { Tagger, TaggerResult };

/** Dossier d'un fichier (chemin local ou adresse) : tout ce qui précède le dernier séparateur. */
const dirOf = (p: string): string => p.replace(/[\\/]+[^\\/]*$/, '');

/** Fichier vidéo, audio ou image (pas un flux, un site ni un jeu) : chemin et dossier. */
function fileOf(e: Readonly<Element>, tag: string): { path: string; dir: string } | null {
  if (e.open.kind !== 'file' || !e.tags.includes(tag)) return null;
  return { path: e.open.path, dir: dirOf(e.open.path) };
}

const folderOf = (e: Readonly<Element>, dir: string): string => {
  const f = e.infos.folder;
  return typeof f === 'string' && f ? f : (dir.split(/[\\/]/).pop() ?? '');
};

/** Séries : `series`, infos `series`, `season`, `episode` (« Friends S01E03 », ou « S01E03 » dans « Friends/Saison 1 »). */
export const seriesTagger: Tagger = {
  id: 'series',
  compute(e) {
    const file = fileOf(e, 'video');
    if (!file) return null;
    const p = parseVideo({ name: e.name, dir: file.dir });
    if (p.type !== 'tv') return null;
    const { season, episode } = parseEpisode(e.name);
    const infos: Record<string, InfoValue> = {};
    if (p.title) infos.series = p.title;
    if (season !== null) infos.season = season;
    if (episode !== null) infos.episode = episode;
    return { tags: ['series'], infos };
  },
};

/** Films : toute vidéo qui n'est pas un épisode ; infos `title` et `year` d'après le nom du fichier. */
export const movieTagger: Tagger = {
  id: 'movie',
  compute(e) {
    const file = fileOf(e, 'video');
    if (!file) return null;
    const p = parseVideo({ name: e.name, dir: file.dir });
    if (p.type !== 'movie') return null;
    const infos: Record<string, InfoValue> = {};
    if (p.title) infos.title = p.title;
    if (p.year) infos.year = Number(p.year);
    return { tags: ['movie'], infos };
  },
};

/**
 * Musique : `album` (dossier « Artiste - Album », ou dossier de l'album, le parent d'un « CD 2 »), `artist` (dossier
 * « Artiste - Album »), `track` (numéro en tête du nom) et `title` (nom sans ce numéro).
 */
export const musicTagger: Tagger = {
  id: 'music',
  compute(e) {
    const file = fileOf(e, 'audio');
    if (!file) return null;
    const folder = folderOf(e, file.dir);
    const split = splitAlbumFolder(folder);
    const infos: Record<string, InfoValue> = { title: cleanTrack(e.name) };
    if (split) Object.assign(infos, split);
    else {
      const album = folderLabel({ folder, dir: file.dir }).title;
      if (album) infos.album = album;
    }
    const n = trackNumber(e.name);
    if (n !== null) infos.track = n;
    return { infos };
  },
};

/** Photos : info `folder`, le groupe de dossier de l'interface (« Vacances », « Ma série, Saison 1 »). */
export const photoTagger: Tagger = {
  id: 'photos',
  compute(e) {
    const file = fileOf(e, 'image');
    if (!file) return null;
    const folder = folderText({ folder: folderOf(e, file.dir), dir: file.dir });
    return folder ? { infos: { folder } } : null;
  },
};

/** Consoles : info `system` (système libretro) d'un jeu, d'après sa console ou, à défaut, l'extension du fichier. */
export function systemTagger(consoles: () => readonly (SystemHint & { id: string })[]): Tagger {
  return {
    id: 'consoles',
    compute(e) {
      if (e.open.kind !== 'game') return null;
      const { console: id, path } = e.open;
      const found = consoles().find((c) => c.id === id);
      const ext = /\.[^./\\]+$/.exec(path)?.[0] ?? '';
      const system = guessSystem(found ?? { name: '', path: '', extensions: ext ? [ext] : [] });
      return system ? { infos: { system } } : null;
    },
  };
}

/** Un tag automatique, branché sur le moteur de tags. */
export const taggerContributor = (tagger: Tagger): Contributor => ({ id: tagger.id, origin: 'tagger', compute: (e) => tagger.compute(e) });

/** Les cinq tags automatiques internes, dans l'ordre. `consoles` : consoles de la configuration. */
export const builtinTaggers = (consoles: () => readonly (SystemHint & { id: string })[]): Tagger[] => [
  seriesTagger,
  movieTagger,
  musicTagger,
  systemTagger(consoles),
  photoTagger,
];
