/**
 * Infos en ligne des jeux PC (contribution `metadata`, id `steam`) : reprise du fournisseur Steam du cœur de Mire
 * (`src/main/scrape/providers/steam.ts`, avant P5-16). Recherche et fiches du magasin Steam, sans clé.
 *
 * Contrat du cœur (`src/main/plugins/bridges.ts`) : jaquette et fond rendus par leur adresse (hôtes d'images de Steam
 * déclarés dans `permissions.hosts`), copiés par Mire ; un échec attendu (magasin injoignable) est rendu
 * `{ failure: "<message>" }`.
 */
import { metadataLanguage, steamLocale } from './locale.mjs';
import { fold, rankByTitle, strip } from './text.mjs';
import { translator } from './texts.mjs';

const TIMEOUT = 12000;
const IMAGE_TIMEOUT = 20000;

/** Échec attendu : `message` est un texte pour l'utilisateur. */
class SteamFailure extends Error {}

/** Adresses d'une image d'un jeu, sur les deux serveurs d'images de Steam. */
export const assets = (appId, file) => [
  `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/${file}`,
  `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/${file}`,
];

const list = (v) => (Array.isArray(v) ? v : []);
const header = (res, name) => Object.entries(res?.headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1] ?? '';

export default function createMetadata(ctx) {
  const t = translator(ctx.locale);

  // Langue et pays du magasin : réglage `language` du plugin, sinon la langue de Mire.
  const locale = () => {
    const { l, cc } = steamLocale(metadataLanguage(ctx.settings.get('language'), ctx.locale));
    return `l=${l}&cc=${cc}`;
  };
  const searchUrl = (term) => `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&${locale()}`;
  const detailsUrl = (appId) => `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&${locale()}`;

  /** JSON du magasin ; `null` pour 404. Lève `SteamFailure` sinon (le message du client HTTP n'est jamais repris). */
  async function getJson(url) {
    let res;
    try {
      res = await ctx.http.request(url, { headers: { accept: 'application/json' }, timeout: TIMEOUT });
    } catch {
      throw new SteamFailure(t('unreachable'));
    }
    if (res.status === 404) return null;
    if (res.status < 200 || res.status > 299) throw new SteamFailure(t('status', { status: res.status }));
    try {
      return JSON.parse(res.text);
    } catch {
      throw new SteamFailure(t('unreachable'));
    }
  }

  // Première adresse qui mène à une image (sans la télécharger) ; une adresse injoignable est passée.
  async function firstImage(urls) {
    for (const url of urls) {
      const res = await ctx.http.request(url, { method: 'HEAD', timeout: IMAGE_TIMEOUT }).catch(() => null);
      if (res && res.status >= 200 && res.status <= 299 && String(header(res, 'content-type')).startsWith('image/')) return url;
    }
    return null;
  }

  async function scrapePcGame(game, override) {
    // Mire envoie l'identifiant Steam d'un raccourci `steam://rungameid/<id>` (`appid`), jamais le chemin du jeu.
    let appId = /^\d+$/.test(String(game?.appid ?? '')) ? String(game.appid) : null;
    let title = String(game?.name ?? '');
    if (override?.pick) {
      appId = String(override.pick.id ?? '');
      title = override.pick.title || title;
    } else if (!appId || override) {
      const term = String(override?.title || title);
      if (!term.trim()) return null;
      const data = await getJson(searchUrl(term));
      const it = rankByTitle(list(data?.items), term, (x) => x?.name)[0];
      if (!it) return null;
      appId = String(it.id);
      title = it.name || title;
    }
    if (!/^\d+$/.test(appId)) return undefined;
    const image = await firstImage([...assets(appId, 'library_600x900.jpg'), ...assets(appId, 'header.jpg')]);
    if (!image) return null;
    let details = null;
    try {
      details = (await getJson(detailsUrl(appId)))?.[appId]?.data || null;
    } catch {
      /* sans détails */
    }
    const backgrounds = [details?.background_raw, details?.background].filter((u) => typeof u === 'string' && u);
    const backdrop = await firstImage([...assets(appId, 'library_hero.jpg'), ...backgrounds]);
    return {
      title: details?.name || title,
      image,
      backdrop,
      genre: list(details?.genres)
        .map((g) => g?.description)
        .filter((d) => typeof d === 'string')
        .slice(0, 2)
        .join(', '),
      year: (/(\d{4})/.exec(details?.release_date?.date || '') || [])[1] || '',
      overview: strip(details?.short_description),
      source: 'Steam',
    };
  }

  async function candidates({ query } = {}) {
    const data = await getJson(searchUrl(String(query ?? '')));
    return rankByTitle(list(data?.items), String(query ?? ''), (x) => x?.name)
      .filter((it) => it?.id != null && typeof it.name === 'string')
      .slice(0, 12)
      .map((it) => ({
        id: String(it.id),
        title: it.name,
        year: '',
        sub: 'Steam',
        image: assets(String(it.id), 'library_600x900.jpg')[0],
        fallback: typeof it.tiny_image === 'string' ? it.tiny_image : null,
      }));
  }

  const orFailure = async (run) => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof SteamFailure) return { failure: err.message };
      throw err;
    }
  };

  const key = (game) => `g:${fold(game?.name)}`;
  return {
    id: 'steam',
    kinds: ['pc'],
    group: 'games',
    concurrency: 2,
    key,
    // Mire rassemble lui-même les jeux PC (P5-16) ; gardé pour un hôte qui demanderait au plugin.
    collect(opts) {
      const seen = new Set();
      return list(opts?.pcGames).filter((g) => {
        const k = key(g);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    },
    scrape: (game, override) => orFailure(() => scrapePcGame(game, override ?? undefined)),
    byId: (pick, game) => orFailure(() => scrapePcGame(game, { pick })),
    candidates: (query) => orFailure(() => candidates(query)),
  };
}
