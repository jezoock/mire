/**
 * Infos en ligne des jeux de console (contribution `metadata`, id `libretro`) : reprise du fournisseur libretro du cœur
 * de Mire (`src/main/scrape/providers/libretro.ts`, avant P5-16). Jaquettes de libretro-thumbnails (celles de
 * RetroArch), genres et années de libretro-database, sans clé.
 *
 * Contrat du cœur (`src/main/plugins/bridges.ts`) : Mire rassemble lui-même les jeux et n'envoie d'un jeu que son nom,
 * sa console (`emu`) et le système libretro de celle-ci (`system`), jamais son chemin. Les images sont rendues par
 * leur adresse (`raw.githubusercontent.com`, déclaré dans `permissions.hosts`) et Mire les copie lui-même ; un échec
 * attendu (système inconnu, liste indisponible) est rendu `{ failure: "<message>" }`.
 */
import { bigramDice, fold, stripTags, titleKey } from './text.mjs';
import { translator } from './texts.mjs';

/** Listes et genres gardés 30 jours (stockage du plugin). */
export const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
const TIMEOUT = 15000;

// Genres de jeux libretro (anglais) → clé des genres (`genres` des textes) ; l'anglais garde les valeurs de libretro.
export const GAME_GENRES = Object.freeze({
  platform: 'platform',
  action: 'action',
  sports: 'sports',
  'role-playing (rpg)': 'rolePlaying',
  adventure: 'adventure',
  strategy: 'strategy',
  racing: 'racing',
  puzzle: 'puzzle',
  shooter: 'shooter',
  "shoot'em up": 'shootEmUp',
  board: 'board',
  "beat'em up": 'beatEmUp',
  fighting: 'fighting',
  simulation: 'simulation',
  compilation: 'compilation',
  gambling: 'gambling',
  educational: 'educational',
  pinball: 'pinball',
  card: 'card',
  'sports with animals': 'sportsWithAnimals',
  'hunting and fishing': 'huntingAndFishing',
  'casual game': 'casualGame',
  various: 'various',
  quiz: 'quiz',
  'lightgun shooter': 'lightgunShooter',
  'music / dancing': 'musicDancing',
  thinking: 'thinking',
  adult: 'adult',
});

/** « Super Mario World (Europe) (En,Fr) [!] » → « super mario world ». */
export const romKey = (s) => titleKey(stripTags(fold(s)));

const REGION_PREF = ['france', 'fr', 'europe', 'world', 'usa, europe', 'usa', 'japan'];

function regionScore(file) {
  const joined = (fold(file).match(/\(([^)]*)\)/g) || []).join(' ');
  const i = REGION_PREF.findIndex((r) => joined.includes(r));
  return i < 0 ? REGION_PREF.length : i;
}

/** Jaquette la plus proche du nom du jeu (région préférée à égalité), ou `null` sous le seuil de 0,82. */
export function bestMatch(list, romName) {
  const k = romKey(romName);
  if (!k) return null;
  const exact = list.filter((n) => romKey(n) === k);
  if (exact.length) return exact.sort((a, b) => regionScore(a) - regionScore(b))[0];
  let best = null;
  let score = 0;
  for (const n of list) {
    const s = bigramDice(k, romKey(n));
    if (s > score || (s === score && best && regionScore(n) < regionScore(best))) {
      score = s;
      best = n;
    }
  }
  return score >= 0.82 ? best : null;
}

const repoOf = (system) => system.replace(/ /g, '_');
const thumbName = (s) => s.replace(/[&*/:`<>?\\|"]/g, '_');
export const thumbUrl = (system, folder, name) =>
  `https://raw.githubusercontent.com/libretro-thumbnails/${repoOf(system)}/master/${folder}/${encodeURIComponent(thumbName(name))}.png`;
const boxartUrl = (system, name) => thumbUrl(system, 'Named_Boxarts', name);

/** Échec attendu : `message` est un texte pour l'utilisateur. */
class LibretroFailure extends Error {}

/** Fabrique de la contribution ; `now` (horloge) ne sert qu'aux tests. */
export default function createMetadata(ctx, { now = () => Date.now() } = {}) {
  const t = translator(ctx.locale);
  const indexes = new Map();
  const factsBySystem = new Map();
  const header = (res, name) => Object.entries(res?.headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1] ?? '';

  // Genre libretro dans la langue de l'interface ; un genre absent de la table est gardé tel quel.
  const gameGenre = (raw) => {
    const id = Object.hasOwn(GAME_GENRES, raw.toLowerCase()) ? GAME_GENRES[raw.toLowerCase()] : null;
    return id ? t.genre(id) : raw;
  };

  // Texte d'une adresse ; `null` si elle ne répond pas (code d'erreur ou serveur injoignable).
  async function getText(url, headers) {
    const res = await ctx.http.request(url, { headers, timeout: TIMEOUT }).catch(() => null);
    return res && res.status >= 200 && res.status <= 299 ? res.text : null;
  }

  // Vrai si l'adresse mène à une image (vérifiée sans la télécharger).
  async function isImage(url) {
    const res = await ctx.http.request(url, { method: 'HEAD', timeout: TIMEOUT }).catch(() => null);
    return !!res && res.status >= 200 && res.status <= 299 && String(header(res, 'content-type')).startsWith('image/');
  }

  // Valeur gardée moins de 30 jours dans le stockage du plugin, sinon `undefined`.
  async function cached(key) {
    const v = await ctx.storage.get(key).catch(() => undefined);
    return v && typeof v === 'object' && typeof v.at === 'number' && now() - v.at < CACHE_TTL_MS ? v.value : undefined;
  }
  // Une liste trop grosse pour le stockage reste seulement en mémoire.
  const keep = (key, value) => ctx.storage.set(key, { at: now(), value }).catch(() => {});

  // Liste des jaquettes d'un système : fichier .index du serveur libretro, sinon l'API GitHub ; `null` si indisponible.
  async function boxartIndex(system) {
    if (indexes.has(system)) return indexes.get(system);
    const storeKey = `index:${repoOf(system)}`.slice(0, 200);
    const old = await cached(storeKey);
    if (Array.isArray(old)) {
      indexes.set(system, old);
      return old;
    }
    let list = null;
    const txt = await getText(`https://thumbnails.libretro.com/${encodeURIComponent(system)}/Named_Boxarts/.index`);
    if (txt && !/<html/i.test(txt))
      list = txt
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.replace(/\.png$/i, ''));
    if (!list || !list.length) {
      const tree = await getText(`https://api.github.com/repos/libretro-thumbnails/${repoOf(system)}/git/trees/master?recursive=1`, {
        accept: 'application/vnd.github+json',
      });
      try {
        list = (JSON.parse(tree ?? 'null')?.tree || [])
          .map((x) => x?.path)
          .filter((p) => typeof p === 'string' && p.startsWith('Named_Boxarts/') && p.endsWith('.png'))
          .map((p) => p.slice(14, -4));
      } catch {
        list = null;
      }
    }
    if (list && list.length) {
      indexes.set(system, list);
      await keep(storeKey, list);
    } else {
      indexes.set(system, null); // on se rabattra sur des noms devinés
    }
    return indexes.get(system);
  }

  // Genres et années de libretro-database (fichiers .dat par système).
  async function romFacts(system) {
    if (factsBySystem.has(system)) return factsBySystem.get(system);
    const storeKey = `facts:${repoOf(system)}`.slice(0, 200);
    const old = await cached(storeKey);
    if (Array.isArray(old)) {
      const map = new Map(old);
      factsBySystem.set(system, map);
      return map;
    }
    const map = new Map();
    for (const [field, folder] of [
      ['genre', 'genre'],
      ['year', 'releaseyear'],
    ]) {
      const txt = await getText(`https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/${folder}/${encodeURIComponent(system)}.dat`);
      if (!txt) continue;
      for (const m of txt.matchAll(/comment\s+"([^"]+)"\s+(?:genre|releaseyear)\s+"([^"]+)"/g)) {
        const k = romKey(m[1]);
        const cur = map.get(k) || {};
        if (!cur[field]) cur[field] = m[2];
        map.set(k, cur);
      }
    }
    factsBySystem.set(system, map);
    if (map.size) await keep(storeKey, [...map]);
    return map;
  }

  const systemOf = (item) => (typeof item?.system === 'string' ? item.system : '');

  async function scrapeRom(rom, override) {
    const system = systemOf(rom);
    if (!system) throw new LibretroFailure(t('unknownSystemConfig'));
    const name = String(override?.title || rom?.name || '');
    let image = null;
    let matched = null;
    let title = String(rom?.displayName || name);
    if (override?.pick) {
      matched = String(override.pick.id ?? '');
      image = boxartUrl(system, matched);
    } else {
      const list = await boxartIndex(system);
      if (list) {
        matched = bestMatch(list, name);
        if (matched) image = boxartUrl(system, matched);
      } else {
        // Sans liste : on essaie le nom tel quel puis avec les régions courantes.
        const base = stripTags(name);
        const guesses = [name, `${base} (Europe)`, `${base} (France)`, `${base} (USA, Europe)`, `${base} (USA)`, `${base} (World)`, `${base} (Japan)`];
        for (const c of [...new Set(guesses)]) {
          if (!(await isImage(boxartUrl(system, c)))) continue;
          matched = c;
          image = boxartUrl(system, c);
          break;
        }
      }
    }
    const facts = (await romFacts(system)).get(romKey(matched || name)) || {};
    if (!image && !facts.genre) return null;
    if (matched) title = stripTags(matched) || title;
    // Capture d'écran du jeu en guise de fond (à défaut, l'écran titre).
    let backdrop = null;
    if (matched) {
      const snap = thumbUrl(system, 'Named_Snaps', matched);
      backdrop = (await isImage(snap)) ? snap : thumbUrl(system, 'Named_Titles', matched);
    }
    return { title, image, backdrop, genre: facts.genre ? gameGenre(facts.genre) : '', year: facts.year || '', source: 'libretro' };
  }

  async function candidates({ item, query } = {}) {
    const system = systemOf(item);
    if (!system) throw new LibretroFailure(t('unknownSystem'));
    const list = await boxartIndex(system);
    if (!list) throw new LibretroFailure(t('coversUnavailable'));
    const k = romKey(String(query ?? ''));
    return list
      .map((n) => ({ n, s: bigramDice(k, romKey(n)) + (romKey(n) === k ? 1 : 0) - regionScore(n) * 0.01 }))
      .filter((x) => x.s > 0.35)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map(({ n }) => ({
        id: n,
        title: stripTags(n) || n,
        year: '',
        sub: (n.match(/\(([^)]*)\)/g) || []).map((x) => x.slice(1, -1)).join(', '),
        image: boxartUrl(system, n),
      }));
  }

  const orFailure = async (run) => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof LibretroFailure) return { failure: err.message };
      throw err;
    }
  };

  return {
    id: 'libretro',
    kinds: ['rom'],
    group: 'games',
    concurrency: 4,
    key: (rom) => `r:${rom?.path ?? ''}`,
    // Mire rassemble lui-même les jeux de console (P5-16).
    collect: (opts) => (Array.isArray(opts?.roms) ? opts.roms : []),
    scrape: (rom, override) => orFailure(() => scrapeRom(rom, override ?? undefined)),
    byId: (pick, rom) => orFailure(() => scrapeRom(rom, { pick })),
    candidates: (query) => orFailure(() => candidates(query)),
  };
}
