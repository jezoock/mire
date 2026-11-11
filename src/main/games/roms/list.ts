/**
 * Liste des jeux d'une console : dossier principal et sources supplémentaires (dossiers, partages réseau, pages web
 * qui listent des fichiers). Un jeu à plusieurs disques est représenté par sa liste .m3u ; ses disques ne sont pas
 * listés à part. Les jaquettes locales sont prises dans le dossier d'images de la console.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { KIND, cleanRomName, isHttpUrl, safeDecode } from '@mire/shared';
import type { Config, Emulator } from '@mire/shared';
import { findConsole } from '../../config/index.ts';
import { walkDirs } from '../../fs/walk.ts';
import { crawlHttp } from '../../library/providers/http-index.ts';
import { locationError, resolveLocation } from '../../library/location.ts';
import * as disc from '../disc/index.ts';
import type { ConsoleLocation, GameDownloads, Rom } from '../types.ts';

const MAX_ROMS = 20000;

/** Les emplacements d'une console : local (dossier principal) et distants (sources web ou réseau). */
export function consoleLocations(emu: Emulator): ConsoleLocation[] {
  const main = emu.romsDir ? [{ location: emu.romsDir, remote: false }] : [];
  const extra = (emu.sources || []).map((loc) => ({ location: loc, remote: isHttpUrl(loc) }));
  return [...main, ...extra];
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
}

const extSet = (emu: Emulator) => new Set((emu.extensions || []).map((e) => (String(e).startsWith('.') ? e : `.${e}`).toLowerCase()));

async function collect(locations: string[], exts: Set<string>): Promise<{ roms: Rom[]; errors: string[] }> {
  const roms: Rom[] = [];
  const errors: string[] = [];
  const add = (p: string, fileName: string, dir: string, remote = false) => {
    const name = path.basename(fileName, path.extname(fileName));
    roms.push({ path: p, name, displayName: cleanRomName(name), dir, image: null, remote });
  };
  const wanted = (fileName: string) => !exts.size || exts.has(path.extname(fileName).toLowerCase());
  for (const location of locations) {
    const loc = resolveLocation(location);
    try {
      if (loc.type === 'url') {
        await crawlHttp(loc.url, async (dirUrl, _dirName, files) => {
          for (const u of files) {
            const fileName = safeDecode(u.pathname.split('/').pop() || '');
            if (wanted(fileName)) add(u.href, fileName, dirUrl, true);
          }
        });
      } else {
        try {
          await fsp.access(loc.path);
        } catch {
          throw new Error(locationError(location, loc));
        }
        await walkDirs(
          loc.path,
          (dir, entries) => {
            for (const e of entries) {
              if (e.isDirectory() || e.name.startsWith('.') || !wanted(e.name)) continue;
              add(path.join(dir, e.name), e.name, dir);
            }
          },
          { maxDepth: 4, skipDir: (n) => n.startsWith('.'), shouldStop: () => roms.length > MAX_ROMS },
        );
      }
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  return { roms, errors };
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

export async function listRoms(deps: ListDeps, consoleId: unknown, opts: ListOptions = {}): Promise<ListResult> {
  const emu = findConsole(deps.config.get(), consoleId);
  if (!emu) return { ok: false, error: 'Cette console n’existe plus dans la configuration.' };
  let places = consoleLocations(emu);
  if (opts.only) places = places.filter((p) => p.location === opts.only);
  else if (!opts.online) places = places.filter((p) => !p.remote);
  const locations = places.map((p) => p.location);
  if (!locations.length) {
    if (!opts.online && consoleLocations(emu).some((p) => p.remote)) return { ok: true, roms: [], errors: [], noLocal: true };
    return { ok: false, error: `Aucun dossier de jeux indiqué pour ${emu.name}.` };
  }

  const found = await collect(locations, extSet(emu));
  const { errors } = found;
  let { roms } = found;
  if (!roms.length && errors.length === locations.length) return { ok: false, error: errors.join(' ') };

  const hidden = await citedByPlaylists(roms, (u) => deps.downloads().fetchText(u));
  if (hidden.size) roms = roms.filter((r) => !hidden.has(romKey(r.path)));

  if (emu.imagesDir) await attachImages(roms, emu.imagesDir as string);
  roms.sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr', { numeric: true, sensitivity: 'base' }));
  return { ok: true, roms, errors };
}
