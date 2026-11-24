/**
 * Liste des jeux d'une console : dossier principal et sources supplémentaires (dossiers, partages réseau, pages web
 * qui listent des fichiers). Un jeu à plusieurs disques est représenté par sa liste .m3u ; ses disques ne sont pas
 * listés à part. Les jaquettes locales sont prises dans le dossier d'images de la console.
 *
 * Depuis P5-14a, les dossiers locaux et les partages sont lus par la source d'un plugin (`locations.ts`) : leurs jeux
 * viennent du catalogue, sous l'instance `rom:<console>|<chemin>` ; un dossier qu'aucun plugin actif ne lit n'a pas
 * de jeux. Le cœur ne lit plus lui-même que les sources en ligne d'une console (jusqu'à P5-14b).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { KIND, cleanRomName, isHttpUrl, safeDecode } from '@mire/shared';
import type { Config, ElementSourceRef, Emulator, OpenSpec } from '@mire/shared';
import { findConsole } from '../../config/index.ts';
import { crawlHttp } from '../../library/providers/http-index.ts';
import { locationError, resolveLocation } from '../../library/location.ts';
import * as disc from '../disc/index.ts';
import type { GameDownloads, Rom } from '../types.ts';
import { t } from '../../i18n/current.ts';
import { consoleLocations, romFolder, romLocationKey } from './locations.ts';

export { consoleLocations } from './locations.ts';

const MAX_ROMS = 20000;

/** Ce que la lecture des dossiers d'une console demande au pont des sources et au catalogue (P5-14a). */
export interface RomFolderDeps {
  /** Analyse de nouveau ces emplacements (clés) avec la source du plugin qui les lit. */
  rescan(keys: string[]): Promise<void>;
  /** Vrai si la source d'un plugin actif lit cet emplacement. */
  claimed(key: string): boolean;
  catalog: {
    sources(): ElementSourceRef[];
    keysOf(source: ElementSourceRef): string[];
    get(key: string): { name: string; open: OpenSpec; images?: { poster?: string } } | undefined;
  };
}

export interface ListOptions {
  /** Inclure les sources distantes. */
  online?: boolean;
  /** N'analyser qu'un emplacement précis. */
  only?: string;
}

export type ListResult = { ok: true; roms: Rom[]; errors: string[]; noLocal?: boolean } | { ok: false; error: string };

export interface ListDeps {
  config: { get(): Config };
  /** Lecture d'un index distant (.m3u) : celle du gestionnaire de téléchargements. */
  downloads: () => Pick<GameDownloads, 'fetchText'>;
  /** Après chaque liste : ce que chaque emplacement lu par le cœur a donné (le service des jeux en alimente le catalogue). */
  onScanned?: (emu: Emulator, scanned: ScannedRomLocation[]) => void;
  /** Dossiers locaux d'une console, lus par les sources des plugins (P5-14a). */
  romFolders?: RomFolderDeps;
  platform?: NodeJS.Platform;
}

const extSet = (emu: Emulator) => new Set((emu.extensions || []).map((e) => (String(e).startsWith('.') ? e : `.${e}`).toLowerCase()));

interface Collected {
  roms: Rom[];
  errors: string[];
  /** Emplacement où chaque jeu a été trouvé. */
  origin: Map<Rom, string>;
  /** Emplacements inaccessibles. */
  failed: Set<string>;
}

/** Jeux des sources en ligne d'une console (pages web qui listent des fichiers), seules lues par le cœur. */
async function collect(locations: string[], exts: Set<string>): Promise<Collected> {
  const roms: Rom[] = [];
  const errors: string[] = [];
  const origin = new Map<Rom, string>();
  const failed = new Set<string>();
  const wanted = (fileName: string) => !exts.size || exts.has(path.extname(fileName).toLowerCase());
  for (const location of locations) {
    const loc = resolveLocation(location);
    try {
      if (loc.type !== 'url') throw new Error(locationError(location, loc));
      await crawlHttp(loc.url, async (dirUrl, _dirName, files) => {
        for (const u of files) {
          const fileName = safeDecode(u.pathname.split('/').pop() || '');
          if (!wanted(fileName)) continue;
          const name = path.basename(fileName, path.extname(fileName));
          const rom: Rom = { path: u.href, name, displayName: cleanRomName(name), dir: dirUrl, image: null, remote: true };
          roms.push(rom);
          origin.set(rom, location);
        }
      });
    } catch (err) {
      errors.push((err as Error).message);
      failed.add(location);
    }
  }
  return { roms, errors, origin, failed };
}

// Clé de comparaison d'un jeu : chemin absolu, ou site et chemin décodé d'une adresse.
function romKey(p: string): string {
  if (!isHttpUrl(p)) return path.resolve(p);
  const u = new URL(p);
  return u.origin + safeDecode(u.pathname);
}

/** Disques cités par les listes .m3u (locales ou distantes), qui ne doivent pas apparaître seuls. */
export async function citedByPlaylists(roms: Rom[], fetchText: (url: string) => Promise<string>): Promise<Set<string>> {
  const hidden = new Set<string>();
  const m3us = roms.filter((r) => /\.m3u$/i.test(String(r.path).split('?')[0]));
  await Promise.all(
    m3us.map(async (r) => {
      let text = '';
      try {
        text = r.remote ? await fetchText(r.path) : disc.decode(await fsp.readFile(r.path));
      } catch {
        return;
      }
      if (r.remote) {
        // Les disques d'un .m3u distant peuvent être cités par chemin relatif ou par adresse complète.
        const name = safeDecode(new URL(r.path).pathname.split('/').pop() || '');
        for (const u of disc.citedUrls(name, text, r.path)) hidden.add(romKey(u));
      } else {
        for (const ref of disc.parseRefs(r.path, text)) hidden.add(romKey(path.join(path.dirname(r.path), ...ref.split('/'))));
      }
    }),
  );
  return hidden;
}

/** Jaquettes locales : image du dossier d'images au nom du fichier, ou au nom nettoyé. */
async function attachImages(roms: Rom[], imagesDir: string): Promise<void> {
  try {
    const images = new Map<string, string>();
    for (const n of await fsp.readdir(imagesDir)) {
      if (KIND[path.extname(n).toLowerCase()] === 'image') images.set(path.basename(n, path.extname(n)).toLowerCase(), path.join(imagesDir, n));
    }
    for (const r of roms) r.image = images.get(r.name.toLowerCase()) || images.get(r.displayName.toLowerCase()) || null;
  } catch {
    /* pas de jaquettes */
  }
}

/** Jeux qu'un emplacement d'une console a donnés à une liste (pour le catalogue d'éléments). */
export interface ScannedRomLocation {
  location: string;
  roms: Rom[];
  /** Faux si la liste a été coupée par le nombre maximal de jeux : l'emplacement n'est pas complet. */
  complete: boolean;
}

/**
 * Jeux de ces sources en ligne d'une console : disques cités par une liste .m3u écartés, jaquettes, ordre alphabétique.
 * `scanned` : ce que chaque emplacement accessible a donné.
 */
export async function listIn(
  emu: Emulator,
  locations: string[],
  fetchText: (url: string) => Promise<string>,
): Promise<{ roms: Rom[]; errors: string[]; scanned: ScannedRomLocation[] }> {
  const { errors, origin, failed, ...found } = await collect(locations, extSet(emu));
  let { roms } = found;
  if (!roms.length && errors.length === locations.length) return { roms, errors, scanned: [] };
  const complete = roms.length <= MAX_ROMS;

  const hidden = await citedByPlaylists(roms, fetchText);
  if (hidden.size) roms = roms.filter((r) => !hidden.has(romKey(r.path)));

  if (emu.imagesDir) await attachImages(roms, emu.imagesDir as string);
  roms.sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr', { numeric: true, sensitivity: 'base' }));
  const scanned = locations
    .filter((location) => !failed.has(location))
    .map((location) => ({ location, roms: roms.filter((r) => origin.get(r) === location), complete }));
  return { roms, errors, scanned };
}

const byName = (a: Rom, b: Rom) => a.displayName.localeCompare(b.displayName, 'fr', { numeric: true, sensitivity: 'base' });

/**
 * Jeux des dossiers locaux d'une console, lus par les sources des plugins : chaque dossier pris par un plugin actif
 * est analysé de nouveau, puis ses jeux sont lus dans le catalogue. Un dossier introuvable ou qu'aucun plugin ne lit
 * donne une erreur.
 */
export async function pluginRoms(
  deps: RomFolderDeps | undefined,
  emu: Emulator,
  locations: string[],
  platform: NodeJS.Platform = process.platform,
): Promise<{ roms: Rom[]; errors: string[] }> {
  const errors: string[] = [];
  const keys: string[] = [];
  for (const location of locations) {
    const folder = romFolder(location, platform);
    if (!folder) {
      errors.push(locationError(location, {}));
      continue;
    }
    const key = romLocationKey(emu.id, folder.path, platform);
    if (!deps?.claimed(key)) {
      errors.push(t('games.errors.romNoPlugin', { location }));
      continue;
    }
    try {
      await fsp.access(folder.path);
    } catch {
      errors.push(locationError(location, folder));
      continue;
    }
    keys.push(key);
  }
  if (!deps || !keys.length) return { roms: [], errors };
  await deps.rescan(keys);
  const wanted = new Set(keys);
  const seen = new Set<string>();
  const roms: Rom[] = [];
  for (const ref of deps.catalog.sources().filter((r) => wanted.has(r.instance))) {
    for (const k of deps.catalog.keysOf(ref)) {
      const el = deps.catalog.get(k);
      if (!el || el.open.kind !== 'game' || el.open.console !== emu.id || isHttpUrl(el.open.path) || seen.has(el.open.path)) continue;
      seen.add(el.open.path);
      const file = el.open.path;
      const name = path.basename(file, path.extname(file));
      roms.push({ path: file, name, displayName: el.name || cleanRomName(name), dir: path.dirname(file), image: el.images?.poster ?? null, remote: false });
    }
  }
  return { roms: roms.sort(byName), errors };
}

export async function listRoms(deps: ListDeps, consoleId: unknown, opts: ListOptions = {}): Promise<ListResult> {
  const emu = findConsole(deps.config.get(), consoleId);
  if (!emu) return { ok: false, error: t('games.errors.consoleGone') };
  let places = consoleLocations(emu);
  if (opts.only) places = places.filter((p) => p.location === opts.only);
  else if (!opts.online) places = places.filter((p) => !p.remote);
  const locations = places.map((p) => p.location);
  if (!locations.length) {
    if (!opts.online && consoleLocations(emu).some((p) => p.remote)) return { ok: true, roms: [], errors: [], noLocal: true };
    return { ok: false, error: t('games.errors.noRomFolder', { console: String(emu.name) }) };
  }

  const local = places.filter((p) => !p.remote).map((p) => p.location);
  const remote = places.filter((p) => p.remote).map((p) => p.location);
  const fromPlugins = await pluginRoms(deps.romFolders, emu, local, deps.platform);
  const fromCore = remote.length ? await listIn(emu, remote, (u) => deps.downloads().fetchText(u)) : { roms: [], errors: [], scanned: [] };
  const roms = [...fromPlugins.roms, ...fromCore.roms].sort(byName);
  const errors = [...fromPlugins.errors, ...fromCore.errors];
  if (!roms.length && errors.length === locations.length) return { ok: false, error: errors.join(' ') };
  deps.onScanned?.(emu, fromCore.scanned);
  return { ok: true, roms, errors };
}
