/** Albums : MusicBrainz et Cover Art Archive (sans clé), au plus une requête par seconde. */
import { cleanTitle, rankByTitle } from '@mire/shared';
import { rateLimited } from '../../net/http.ts';
import type { MetadataProvider, ScrapeItem } from '../types.ts';
import { t } from '../../i18n/current.ts';

const MB = 'https://musicbrainz.org/ws/2/release-group/';
const coverUrl = (id: string) => `https://coverartarchive.org/release-group/${id}/front-250`;

// Étiquettes MusicBrainz courantes → clé du catalogue (scrape.genres.music) ; l’anglais garde les étiquettes.
export const MUSIC_GENRES: Readonly<Record<string, string>> = {
  electronic: 'electronic',
  'hip hop': 'hipHop',
  classical: 'classical',
  soundtrack: 'soundtrack',
  'french house': 'frenchHouse',
  house: 'house',
  pop: 'pop',
  rock: 'rock',
  jazz: 'jazz',
  blues: 'blues',
  metal: 'metal',
  'heavy metal': 'heavyMetal',
  folk: 'folk',
  'chanson française': 'chansonFrancaise',
  chanson: 'chanson',
  reggae: 'reggae',
  soul: 'soul',
  funk: 'funk',
  'r&b': 'rnb',
  country: 'country',
  punk: 'punk',
  ambient: 'ambient',
  techno: 'techno',
  downtempo: 'downtempo',
  'trip hop': 'tripHop',
  'alternative rock': 'alternativeRock',
  'indie rock': 'indieRock',
  'indie pop': 'indiePop',
  world: 'world',
  disco: 'disco',
  rap: 'rap',
};

const capitalize = (x: string) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);
const escape = (s: string) => s.replace(/(["\\])/g, '\\$1');
const artists = (g: any): string => (g['artist-credit'] || []).map((a: any) => a.name).join(', ');

// Étiquette la plus citée, traduite.
function genreOf(g: any): string {
  const tag: string = [...(g?.tags || [])].sort((a: any, b: any) => (b.count || 0) - (a.count || 0))[0]?.name || '';
  const id = MUSIC_GENRES[tag.toLowerCase()];
  return id ? t(`scrape.genres.music.${id}`) : capitalize(tag);
}

const searchUrl = (title: string, artist: string | undefined, limit: number) => {
  const q = `releasegroup:"${escape(title)}"${artist ? ` AND artist:"${escape(artist)}"` : ''}`;
  return `${MB}?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
};

export interface MusicBrainzOptions {
  /** Intervalle minimal entre deux requêtes, en millisecondes (règle de MusicBrainz : une par seconde). */
  intervalMs?: number;
}

export function musicBrainzProvider({ intervalMs = 1100 }: MusicBrainzOptions = {}): MetadataProvider {
  const limit = rateLimited('musicbrainz', intervalMs);

  return {
    id: 'musicbrainz',
    kinds: ['album'],
    group: 'music',
    concurrency: 1,
    key: (album: ScrapeItem) => `a:${album.dir}`,
    collect: (opts) => opts.albums || [],

    async scrape(album, override, ctx) {
      let artist = '';
      let title = album.folder;
      const m = /^(.+?)\s+-\s+(.+)$/.exec(album.folder || '');
      if (m) {
        artist = m[1];
        title = m[2];
      }
      if (override) {
        artist = override.artist || '';
        title = override.title;
      }
      title = cleanTitle(title.replace(/\((19|20)\d{2}\)/, ''));
      if (!title) return null;
      const data = await limit(() => ctx.io.getJson(searchUrl(title, artist, 5)));
      const groups = rankByTitle(
        (data?.['release-groups'] || []).filter((g: any) => (g.score ?? 100) >= 70),
        title,
        (g: any) => g.title,
      );
      for (const g of groups) {
        if (ctx.cancelled()) return undefined;
        const image = await ctx.io.saveImage(coverUrl(g.id), ctx.key);
        if (image) {
          return { title: g.title, artist: artists(g), year: (g['first-release-date'] || '').slice(0, 4), genre: genreOf(g), image, source: 'MusicBrainz' };
        }
      }
      return null;
    },

    // Album choisi par l'utilisateur dans la liste des fiches MusicBrainz.
    async byId(pick, _album, ctx) {
      const g = await limit(() => ctx.io.getJson(`${MB}${encodeURIComponent(pick.id)}?inc=tags+artist-credits&fmt=json`)).catch(() => null);
      const image = await ctx.io.saveImage(coverUrl(pick.id), ctx.key).catch(() => null);
      return {
        title: g?.title || pick.title,
        artist: g ? artists(g) : pick.sub,
        year: (g?.['first-release-date'] || pick.year || '').slice(0, 4),
        genre: genreOf(g),
        image,
        source: 'MusicBrainz',
        picked: true,
      };
    },

    async candidates({ query, artist }, ctx) {
      const data = await limit(() => ctx.io.getJson(searchUrl(query, artist, 12)));
      return rankByTitle(data?.['release-groups'] || [], query, (g: any) => g.title).map((g: any) => ({
        id: g.id,
        title: g.title,
        year: (g['first-release-date'] || '').slice(0, 4),
        sub: [artists(g), g['primary-type']].filter(Boolean).join(', '),
        image: coverUrl(g.id),
      }));
    },
  };
}
