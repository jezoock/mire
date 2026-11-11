/** Jeux PC : recherche et fiches du magasin Steam (sans clé). */
import { fold, rankByTitle } from '@mire/shared';
import type { JobContext, MetadataProvider, ScrapeItem, ScrapeOutcome, ScrapeOverride } from '../types.ts';

const searchUrl = (term: string) => `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=french&cc=FR`;
const detailsUrl = (appId: string) => `https://store.steampowered.com/api/appdetails?appids=${appId}&l=french&cc=FR`;
const assets = (appId: string, file: string) => [
  `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/${file}`,
  `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/${file}`,
];

// Description courte du magasin, sans balises HTML.
const strip = (h: unknown) =>
  String(h || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, '’')
    .replace(/\s+/g, ' ')
    .trim();

// Première image disponible parmi `urls`.
async function firstImage(urls: string[], key: string, ctx: JobContext): Promise<string | null> {
  for (const u of urls) {
    const image = await ctx.io.saveImage(u, key).catch(() => null);
    if (image) return image;
  }
  return null;
}

async function scrapePcGame(game: ScrapeItem, override: ScrapeOverride | undefined, ctx: JobContext): Promise<ScrapeOutcome> {
  const { key, io } = ctx;
  let appId: string | null = (/^steam:\/\/rungameid\/(\d+)/i.exec(String(game.path || '')) || [])[1] || null;
  let title: string = game.name;
  if (override?.pick) {
    appId = String(override.pick.id);
    title = override.pick.title || title;
  } else if (!appId || override) {
    const term = override?.title || game.name;
    const data = await io.getJson(searchUrl(term));
    const it = rankByTitle(data?.items || [], term, (x: any) => x.name)[0];
    if (!it) return null;
    appId = String(it.id);
    title = it.name || title;
  }
  const image = await firstImage([...assets(appId, 'library_600x900.jpg'), ...assets(appId, 'header.jpg')], key, ctx);
  if (!image) return null;
  let details: any = null;
  try {
    details = (await io.getJson(detailsUrl(appId)))?.[appId]?.data || null;
  } catch {
    /* sans détails */
  }
  const backdrop = await firstImage([...assets(appId, 'library_hero.jpg'), details?.background_raw, details?.background].filter(Boolean), `${key}:bg`, ctx);
  return {
    title: details?.name || title,
    image,
    backdrop,
    genre: (details?.genres || [])
      .map((g: any) => g.description)
      .slice(0, 2)
      .join(', '),
    year: (/(\d{4})/.exec(details?.release_date?.date || '') || [])[1] || '',
    overview: strip(details?.short_description),
    source: 'Steam',
  };
}

export function steamProvider(): MetadataProvider {
  const key = (game: ScrapeItem) => `g:${fold(game.name)}`;
  return {
    id: 'steam',
    kinds: ['pc'],
    group: 'games',
    concurrency: 2,
    key,
    // Jeux de l'interface, sinon ceux de la configuration ; un même nom n'est récupéré qu'une fois.
    collect(opts, ctx) {
      const seen = new Set<string>();
      return (opts.pcGames || ctx.getConfig().games).filter((g) => {
        const k = key(g);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    },
    scrape: (game, override, ctx) => scrapePcGame(game, override, ctx),
    byId: (pick, game, ctx) => scrapePcGame(game, { pick }, ctx),
    async candidates({ query }, ctx) {
      const data = await ctx.io.getJson(searchUrl(query));
      return rankByTitle(data?.items || [], query, (x: any) => x.name)
        .slice(0, 12)
        .map((it: any) => ({
          id: String(it.id),
          title: it.name,
          year: '',
          sub: 'Steam',
          image: assets(String(it.id), 'library_600x900.jpg')[0],
          fallback: it.tiny_image || null,
        }));
    },
  };
}
