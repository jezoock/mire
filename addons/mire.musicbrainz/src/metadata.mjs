/**
 * Infos en ligne des albums (contribution `metadata`, id `musicbrainz`) : reprise du fournisseur MusicBrainz du cœur
 * de Mire (`src/main/scrape/providers/musicbrainz.ts`, avant P5-16). MusicBrainz et Cover Art Archive, sans clé.
 *
 * Contrat du cœur (`src/main/plugins/bridges.ts`) : la pochette est rendue par son adresse (`coverartarchive.org`,
 * déclaré dans `permissions.hosts` avec `archive.org`, où elle est redirigée) et Mire la copie lui-même ; un échec
 * attendu (MusicBrainz injoignable) est rendu `{ failure: "<message>" }`.
 */
import { createClient, orFailure } from './client.mjs';
import { cleanTitle, rankByTitle } from './text.mjs';
import { translator } from './texts.mjs';

const MB = 'https://musicbrainz.org/ws/2/release-group/';
export const coverUrl = (id) => `https://coverartarchive.org/release-group/${encodeURIComponent(id)}/front-250`;

// Étiquettes MusicBrainz courantes → clé des genres (`genres` des textes) ; l'anglais garde les étiquettes.
export const MUSIC_GENRES = Object.freeze({
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
});

const capitalize = (x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);
const escape = (s) => s.replace(/(["\\])/g, '\\$1');
const list = (v) => (Array.isArray(v) ? v : []);
const artists = (g) =>
  list(g?.['artist-credit'])
    .map((a) => a?.name)
    .filter((n) => typeof n === 'string')
    .join(', ');
const yearOf = (v) => String(v || '').slice(0, 4);

const searchUrl = (title, artist, limit) => {
  const q = `releasegroup:"${escape(title)}"${artist ? ` AND artist:"${escape(artist)}"` : ''}`;
  return `${MB}?query=${encodeURIComponent(q)}&fmt=json&limit=${limit}`;
};

/** Fabrique de la contribution ; `options` (intervalle, horloge) ne sert qu'aux tests. */
export default function createMetadata(ctx, options = {}) {
  const t = translator(ctx.locale);
  const client = createClient(ctx, t, options);

  // Étiquette la plus citée, traduite.
  function genreOf(g) {
    const tag = [...list(g?.tags)].sort((a, b) => (b?.count || 0) - (a?.count || 0))[0]?.name;
    const name = typeof tag === 'string' ? tag : '';
    const id = Object.hasOwn(MUSIC_GENRES, name.toLowerCase()) ? MUSIC_GENRES[name.toLowerCase()] : null;
    return id ? t.genre(id) : capitalize(name);
  }

  async function scrape(album, override) {
    let artist = '';
    let title = String(album?.folder ?? '');
    const m = /^(.+?)\s+-\s+(.+)$/.exec(title);
    if (m) {
      artist = m[1];
      title = m[2];
    }
    if (override) {
      artist = String(override.artist || '');
      title = String(override.title || '');
    }
    title = cleanTitle(title.replace(/\((19|20)\d{2}\)/, ''));
    if (!title) return null;
    const data = await client.getJson(searchUrl(title, artist, 5));
    const groups = rankByTitle(
      list(data?.['release-groups']).filter((g) => (g?.score ?? 100) >= 70),
      title,
      (g) => g.title,
    );
    // Premier album dont la pochette existe.
    for (const g of groups) {
      if (typeof g?.id !== 'string' || !(await client.isImage(coverUrl(g.id)))) continue;
      return { title: g.title, artist: artists(g), year: yearOf(g['first-release-date']), genre: genreOf(g), image: coverUrl(g.id), source: 'MusicBrainz' };
    }
    return null;
  }

  // Album choisi par l'utilisateur dans la liste des fiches MusicBrainz ; sans détails, ceux du candidat.
  async function byId(pick) {
    const id = String(pick?.id ?? '');
    if (!id) return undefined;
    const g = await client.getJson(`${MB}${encodeURIComponent(id)}?inc=tags+artist-credits&fmt=json`).catch(() => null);
    return {
      title: g?.title || pick.title,
      artist: g ? artists(g) : pick.sub || '',
      year: yearOf(g?.['first-release-date'] || pick.year),
      genre: genreOf(g),
      image: coverUrl(id),
      source: 'MusicBrainz',
      picked: true,
    };
  }

  async function candidates({ query, artist } = {}) {
    const data = await client.getJson(searchUrl(String(query ?? ''), artist ? String(artist) : '', 12));
    return rankByTitle(list(data?.['release-groups']), String(query ?? ''), (g) => g?.title)
      .filter((g) => typeof g?.id === 'string' && typeof g.title === 'string')
      .map((g) => ({
        id: g.id,
        title: g.title,
        year: yearOf(g['first-release-date']),
        sub: [artists(g), g['primary-type']].filter(Boolean).join(', '),
        image: coverUrl(g.id),
      }));
  }

  return {
    id: 'musicbrainz',
    kinds: ['album'],
    group: 'music',
    concurrency: 1,
    key: (album) => `a:${album?.dir ?? ''}`,
    collect: (opts) => (Array.isArray(opts?.albums) ? opts.albums : []),
    scrape: (album, override) => orFailure(() => scrape(album, override ?? undefined)),
    byId: (pick) => orFailure(() => byId(pick)),
    candidates: (query) => orFailure(() => candidates(query)),
  };
}
