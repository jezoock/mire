/**
 * Jeux de console : libretro-thumbnails, les jaquettes utilisées par RetroArch (sans clé), et les genres et
 * années de libretro-database.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { bigramDice, fold, guessSystem, stripTags, titleKey } from '@mire/shared';
import { ScrapeRefusal } from '../refusal.ts';
import type { JobContext, MetadataProvider, ProviderContext, ScrapeItem, ScrapeOutcome, ScrapeOverride } from '../types.ts';

const INDEX_TTL_MS = 30 * 24 * 3600 * 1000;

// Genres de jeux libretro (anglais) → français.
const GAME_GENRES: Record<string, string> = {
  platform: 'Plateformes',
  action: 'Action',
  sports: 'Sport',
  'role-playing (rpg)': 'Jeu de rôle',
  adventure: 'Aventure',
  strategy: 'Stratégie',
  racing: 'Course',
  puzzle: 'Réflexion',
  shooter: 'Tir',
  "shoot'em up": 'Shoot’em up',
  board: 'Jeu de plateau',
  "beat'em up": 'Beat’em up',
  fighting: 'Combat',
  simulation: 'Simulation',
  compilation: 'Compilation',
  gambling: 'Casino',
  educational: 'Éducatif',
  pinball: 'Flipper',
  card: 'Cartes',
  'sports with animals': 'Sport',
  'hunting and fishing': 'Chasse et pêche',
  'casual game': 'Jeu familial',
  various: 'Divers',
  quiz: 'Quiz',
  'lightgun shooter': 'Tir au pistolet',
  'music / dancing': 'Musique et danse',
  thinking: 'Réflexion',
  adult: 'Adulte',
};

/** « Super Mario World (Europe) (En,Fr) [!] » → « super mario world ». */
export const romKey = (s: string): string => titleKey(stripTags(fold(s)));

const REGION_PREF = ['france', 'fr', 'europe', 'world', 'usa, europe', 'usa', 'japan'];

function regionScore(file: string): number {
  const tags = fold(file).match(/\(([^)]*)\)/g) || [];
  const joined = tags.join(' ');
  const i = REGION_PREF.findIndex((r) => joined.includes(r));
  return i < 0 ? REGION_PREF.length : i;
}

/** Jaquette la plus proche du nom du jeu (région préférée à égalité), ou `null` sous le seuil de 0,82. */
export function bestMatch(list: string[], romName: string): string | null {
  const k = romKey(romName);
  if (!k) return null;
  const exact = list.filter((n) => romKey(n) === k);
  if (exact.length) return exact.sort((a, b) => regionScore(a) - regionScore(b))[0];
  let best: string | null = null;
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

const repoOf = (system: string) => system.replace(/ /g, '_');
const thumbName = (s: string) => s.replace(/[&*/:`<>?\\|"]/g, '_');
const thumbUrl = (system: string, folder: string, name: string) =>
  `https://raw.githubusercontent.com/libretro-thumbnails/${repoOf(system)}/master/${folder}/${encodeURIComponent(thumbName(name))}.png`;
const boxartUrl = (system: string, name: string) => thumbUrl(system, 'Named_Boxarts', name);

interface Facts {
  genre?: string;
  year?: string;
}

// Cache disque frais (moins de 30 jours), sinon `undefined`.
async function readCache<T>(file: string): Promise<T | undefined> {
  try {
    const st = await fsp.stat(file);
    if (Date.now() - st.mtimeMs < INDEX_TTL_MS) return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    /* pas de cache */
  }
  return undefined;
}

export function libretroProvider(): MetadataProvider {
  const indexes = new Map<string, string[] | null>();
  const datCache = new Map<string, Map<string, Facts>>();

  // Système d'un jeu d'après sa console (item.emu : identifiant de la console).
  function systemOf(item: ScrapeItem, ctx: ProviderContext): string {
    const emu = ctx.getConfig().emulators.find((e) => e.id === item?.emu);
    return emu ? guessSystem(emu) : '';
  }

  // Liste des jaquettes d'un système : fichier .index du serveur libretro, sinon l'API GitHub.
  async function boxartIndex(system: string, ctx: ProviderContext): Promise<string[] | null> {
    if (indexes.has(system)) return indexes.get(system)!;
    const cacheFile = path.join(ctx.cacheDir, `${repoOf(system)}.json`);
    const cached = await readCache<string[]>(cacheFile);
    if (cached) {
      indexes.set(system, cached);
      return cached;
    }
    let list: string[] | null = null;
    try {
      const txt = await ctx.io.getText(`https://thumbnails.libretro.com/${encodeURIComponent(system)}/Named_Boxarts/.index`);
      if (txt && !/<html/i.test(txt))
        list = txt
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => l.replace(/\.png$/i, ''));
    } catch {
      /* serveur indisponible */
    }
    if (!list || !list.length) {
      try {
        const tree = await ctx.io.getJson(`https://api.github.com/repos/libretro-thumbnails/${repoOf(system)}/git/trees/master?recursive=1`, {
          accept: 'application/vnd.github+json',
        });
        list = (tree?.tree || []).filter((t: any) => t.path.startsWith('Named_Boxarts/') && t.path.endsWith('.png')).map((t: any) => t.path.slice(14, -4));
      } catch {
        list = null;
      }
    }
    if (list && list.length) {
      indexes.set(system, list);
      fsp.writeFile(cacheFile, JSON.stringify(list)).catch(() => {});
    } else {
      indexes.set(system, null); // on se rabattra sur des noms devinés
    }
    return indexes.get(system)!;
  }

  // Genres et années de libretro-database (fichiers .dat par système), gardés en cache 30 jours.
  async function romFacts(system: string, ctx: ProviderContext): Promise<Map<string, Facts>> {
    if (datCache.has(system)) return datCache.get(system)!;
    const cacheFile = path.join(ctx.cacheDir, `${repoOf(system)}.facts.json`);
    const cached = await readCache<[string, Facts][]>(cacheFile);
    if (cached) {
      const map = new Map(cached);
      datCache.set(system, map);
      return map;
    }
    const map = new Map<string, Facts>();
    for (const [field, folder] of [
      ['genre', 'genre'],
      ['year', 'releaseyear'],
    ] as const) {
      try {
        const txt = await ctx.io.getText(
          `https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/${folder}/${encodeURIComponent(system)}.dat`,
        );
        if (!txt) continue;
        for (const m of txt.matchAll(/comment\s+"([^"]+)"\s+(?:genre|releaseyear)\s+"([^"]+)"/g)) {
          const k = romKey(m[1]);
          const cur = map.get(k) || {};
          if (!cur[field]) cur[field] = field === 'genre' ? GAME_GENRES[m[2].toLowerCase()] || m[2] : m[2];
          map.set(k, cur);
        }
      } catch {
        /* indisponible */
      }
    }
    datCache.set(system, map);
    if (map.size) fsp.writeFile(cacheFile, JSON.stringify([...map])).catch(() => {});
    return map;
  }

  async function scrapeRom(rom: ScrapeItem, override: ScrapeOverride | undefined, ctx: JobContext): Promise<ScrapeOutcome> {
    const system = systemOf(rom, ctx);
    if (!system) throw new ScrapeRefusal('Système de la console inconnu : ajoutez « system » dans sa configuration.');
    const { key, io } = ctx;
    const name: string = override?.title || rom.name;
    let image: string | null = null;
    let matched: string | null = null;
    let title: string = rom.displayName || name;
    const list = override?.pick ? null : await boxartIndex(system, ctx);
    if (override?.pick) {
      matched = override.pick.id;
      image = await io.saveImage(boxartUrl(system, matched), key);
    } else if (list) {
      matched = bestMatch(list, name);
      if (matched) image = await io.saveImage(boxartUrl(system, matched), key);
    } else {
      // Sans liste : on essaie le nom tel quel puis avec les régions courantes.
      const base = stripTags(name);
      const guesses = [name, `${base} (Europe)`, `${base} (France)`, `${base} (USA, Europe)`, `${base} (USA)`, `${base} (World)`, `${base} (Japan)`];
      for (const c of [...new Set(guesses)]) {
        if (ctx.cancelled()) return undefined;
        image = await io.saveImage(boxartUrl(system, c), key);
        if (image) {
          matched = c;
          break;
        }
      }
    }
    const facts = (await romFacts(system, ctx)).get(romKey(matched || name)) || {};
    if (!image && !facts.genre) return null;
    if (matched) title = stripTags(matched) || title;
    // Capture d'écran du jeu en guise de fond (à défaut, l'écran titre).
    let backdrop: string | null = null;
    if (matched) {
      backdrop =
        (await io.saveImage(thumbUrl(system, 'Named_Snaps', matched), `${key}:bg`)) ||
        (await io.saveImage(thumbUrl(system, 'Named_Titles', matched), `${key}:bg`));
    }
    return { title, image, backdrop, genre: facts.genre || '', year: facts.year || '', source: 'libretro' };
  }

  return {
    id: 'libretro',
    kinds: ['rom'],
    group: 'games',
    concurrency: 4,
    key: (rom: ScrapeItem) => `r:${rom.path}`,

    // Jeux des consoles dont le système est reconnu ; chaque jeu garde l'identifiant de sa console.
    async collect(_opts, ctx) {
      const items: ScrapeItem[] = [];
      for (const emu of ctx.getConfig().emulators) {
        if (!guessSystem(emu)) continue;
        const r = await ctx.listRoms(emu.id);
        if (!r?.ok) continue;
        for (const rom of r.roms || []) items.push({ ...rom, emu: emu.id });
      }
      return items;
    },

    scrape: (rom, override, ctx) => scrapeRom(rom, override, ctx),
    byId: (pick, rom, ctx) => scrapeRom(rom, { pick }, ctx),

    async candidates({ item, query }, ctx) {
      const system = systemOf(item || {}, ctx);
      if (!system) throw new ScrapeRefusal('Système de la console inconnu : indiquez-le avec « Modifier la console ».');
      const list = await boxartIndex(system, ctx);
      if (!list) throw new ScrapeRefusal('La liste des jaquettes de ce système est indisponible pour le moment.');
      const k = romKey(query);
      const scored = list
        .map((n) => ({ n, s: bigramDice(k, romKey(n)) + (romKey(n) === k ? 1 : 0) - regionScore(n) * 0.01 }))
        .filter((x) => x.s > 0.35)
        .sort((a, b) => b.s - a.s)
        .slice(0, 12);
      return scored.map(({ n }) => ({
        id: n,
        title: stripTags(n) || n,
        year: '',
        sub: (n.match(/\(([^)]*)\)/g) || []).map((x) => x.slice(1, -1)).join(', '),
        image: boxartUrl(system, n),
      }));
    },
  };
}
