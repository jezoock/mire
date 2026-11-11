/** Films et séries : TMDB (clé gratuite à saisir dans Réglages). */
import { fold, rankByTitle } from '@mire/shared';
import { tmdbImageUrl, type TmdbClient, type TmdbParams } from '../../net/tmdb.ts';
import { scrapeError } from '../io.ts';
import { parseVideo } from '../parse.ts';
import type { JobContext, MetadataProvider, ProviderContext, ScrapeItem, ScrapeOverride } from '../types.ts';

interface Found {
  title: string;
  year: string;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  genreIds?: number[];
  genres?: string;
  tv: boolean;
}

const yearOf = (r: any): string => (r.release_date || r.first_air_date || '').slice(0, 4);

export function tmdbProvider(client: TmdbClient): MetadataProvider {
  const language = (ctx: ProviderContext) => ctx.getConfig().search.language || 'fr-FR';
  const tmdb = (pathname: string, params: TmdbParams = {}) =>
    client.get(pathname, params, { timeout: 12000, notFoundAsNull: true }).catch((err) => Promise.reject(scrapeError(err)));

  // Liste des genres, lue une fois (même vide si TMDB n'a pas répondu).
  let genreMap: Map<number, string> | null = null;
  async function tmdbGenres(ctx: ProviderContext): Promise<Map<number, string>> {
    if (genreMap) return genreMap;
    const lang = language(ctx);
    const [m, t] = await Promise.all([
      tmdb('/genre/movie/list', { language: lang }).catch(() => null),
      tmdb('/genre/tv/list', { language: lang }).catch(() => null),
    ]);
    genreMap = new Map([...(m?.genres || []), ...(t?.genres || [])].map((g: any) => [g.id, g.name]));
    return genreMap;
  }
  async function genreNames(ids: number[] | undefined, ctx: ProviderContext): Promise<string> {
    const map = await tmdbGenres(ctx);
    return (ids || [])
      .map((id) => map.get(id))
      .filter(Boolean)
      .slice(0, 2)
      .join(', ');
  }

  const tvCache = new Map<string, Promise<Found | null>>(); // une seule recherche par série
  function lookupSeries(title: string, ctx: ProviderContext): Promise<Found | null> {
    // On garde la requête elle-même : les épisodes traités en parallèle partagent la même recherche.
    const k = fold(title);
    if (!tvCache.has(k)) {
      const search = tmdb('/search/tv', { query: title, language: language(ctx) }).then((data) => {
        const r = rankByTitle(data?.results || [], title, (x: any) => x.name)[0] || null;
        return r
          ? {
              title: r.name,
              year: (r.first_air_date || '').slice(0, 4),
              overview: r.overview || '',
              poster: r.poster_path,
              backdrop: r.backdrop_path,
              genreIds: r.genre_ids,
              tv: true,
            }
          : null;
      });
      tvCache.set(
        k,
        search.catch((err) => {
          tvCache.delete(k);
          throw err;
        }),
      );
    }
    return tvCache.get(k)!;
  }

  async function lookupVideo(parsed: { type: string; title?: string; year: string }, ctx: ProviderContext): Promise<Found | null> {
    const lang = language(ctx);
    if (!parsed.title) return null;
    if (parsed.type === 'tv') return lookupSeries(parsed.title, ctx);
    const title = parsed.title;
    const best = (d: any) =>
      rankByTitle(
        d?.results || [],
        title,
        (x: any) => x.title,
        (x: any) => x.release_date,
        parsed.year,
      )[0];
    let data = await tmdb('/search/movie', { query: title, year: parsed.year, language: lang });
    let r: any = best(data);
    if (!r && parsed.year) {
      data = await tmdb('/search/movie', { query: title, language: lang });
      r = best(data);
    }
    if (!r) {
      data = await tmdb('/search/multi', { query: title, language: lang });
      r = (data?.results || []).find((x: any) => x.media_type === 'movie' || x.media_type === 'tv');
    }
    if (!r) return null;
    return {
      title: r.title || r.name,
      year: yearOf(r),
      overview: r.overview || '',
      poster: r.poster_path,
      backdrop: r.backdrop_path,
      genreIds: r.genre_ids,
      tv: r.media_type === 'tv',
    };
  }

  // Les épisodes d'une même série partagent affiche et fond : un seul téléchargement.
  const posterCache = new Map<string, Promise<string | null>>();
  function tmdbImage(found: Found, kind: 'img' | 'bg', ctx: JobContext): Promise<string | null> {
    const file = kind === 'bg' ? found.backdrop : found.poster;
    if (!file) return Promise.resolve(null);
    const url = tmdbImageUrl(file, kind === 'bg' ? 'w1280' : 'w342');
    if (!found.tv) return ctx.io.saveImage(url, `${ctx.key}:${kind}`);
    const k = `tv:${fold(found.title)}:${kind}`;
    if (!posterCache.has(k))
      posterCache.set(
        k,
        ctx.io.saveImage(url, k).catch(() => null),
      );
    return posterCache.get(k)!;
  }

  return {
    id: 'tmdb',
    kinds: ['video'],
    group: 'videos',
    concurrency: 4,
    requires: () =>
      client.hasKey() ? null : { skipped: 'vidéos (clé TMDB absente)', error: 'Ajoutez une clé TMDB dans Réglages pour chercher les films et séries.' },
    key: (item: ScrapeItem) => `v:${item.path}`,
    collect: (opts) => opts.videos || [],

    async scrape(item: ScrapeItem, override: ScrapeOverride | undefined, ctx: JobContext) {
      const parsed = override
        ? { type: override.type || 'movie', title: override.title, year: override.year || '' }
        : parseVideo(item as { name: string; dir?: string });
      const found = await lookupVideo(parsed, ctx);
      if (!found) return null;
      const [image, backdrop, genre] = await Promise.all([tmdbImage(found, 'img', ctx), tmdbImage(found, 'bg', ctx), genreNames(found.genreIds, ctx)]);
      return {
        title: found.title,
        year: found.year,
        overview: found.overview,
        genre,
        image,
        backdrop,
        series: !!found.tv || parsed.type === 'tv',
        source: 'TMDB',
      };
    },

    // Fiche choisie par l'utilisateur (« movie:123 » ou « tv:456 »).
    async byId(pick, _item, ctx) {
      const [media, id] = String(pick.id).split(':');
      const r = await tmdb(`/${media === 'tv' ? 'tv' : 'movie'}/${id}`, { language: language(ctx) });
      if (!r) return undefined;
      // Les images d'une fiche choisie sont propres à l'élément, même pour une série.
      const found: Found = {
        title: r.title || r.name,
        year: yearOf(r),
        overview: r.overview || '',
        poster: r.poster_path,
        backdrop: r.backdrop_path,
        tv: false,
      };
      const genres = (r.genres || [])
        .map((g: any) => g.name)
        .slice(0, 2)
        .join(', ');
      const [image, backdrop] = await Promise.all([tmdbImage(found, 'img', ctx), tmdbImage(found, 'bg', ctx)]);
      return {
        title: found.title,
        year: found.year,
        overview: found.overview,
        genre: genres,
        image,
        backdrop,
        series: media === 'tv',
        source: 'TMDB',
        picked: true,
      };
    },

    async candidates({ item, query, year }, ctx) {
      const tvOnly = /S\d{1,2}\s*E\d{1,3}/i.test(item?.name || '');
      const data = await tmdb(tvOnly ? '/search/tv' : '/search/multi', { query, language: language(ctx) });
      const list = (data?.results || []).filter((r: any) => tvOnly || r.media_type === 'movie' || r.media_type === 'tv');
      const ranked = rankByTitle(
        list,
        query,
        (r: any) => r.title || r.name,
        (r: any) => r.release_date || r.first_air_date,
        year,
      ).slice(0, 12);
      return ranked.map((r: any) => {
        const media = tvOnly ? 'tv' : r.media_type;
        const t = r.title || r.name;
        const original = r.original_title || r.original_name;
        return {
          id: `${media}:${r.id}`,
          title: t,
          year: yearOf(r),
          sub: [media === 'tv' ? 'Série' : 'Film', original && original !== t ? original : ''].filter(Boolean).join(', '),
          image: r.poster_path ? tmdbImageUrl(r.poster_path, 'w154') : null,
        };
      });
    },
  };
}
