/**
 * Source `consoles` : les jeux des dossiers de chaque console de Mire (reprise de `src/main/games/roms/list.ts` du
 * cœur, avant P5-14a, pour les dossiers locaux et les partages réseau).
 *
 * Contrat du cœur (`src/main/plugins/bridges.ts`) : Mire propose chaque dossier d'une console comme un emplacement de
 * type `rom`, avec sa console (`location.console` : identifiant, système, extensions, dossier des jaquettes), et accorde
 * au plugin ce dossier et celui des jaquettes tant qu'ils restent dans ses réglages. Les fichiers sont lus par
 * `ctx.files` (parcours fait par le cœur, sans suivre les liens), puis le cœur revérifie chaque jeu et chaque jaquette
 * sur son chemin réel. Le plugin ne lance rien : Mire lance l'émulateur de la console par la clé de l'élément.
 *
 * Les adresses (sources en ligne d'une console) restent lues par le cœur (P5-14b).
 */
import { citedByPlaylists } from './playlists.mjs';
import { cleanRomName, isWindowsPath, nameOf, pathKey, romKey } from './names.mjs';

/** Profondeur des sous-dossiers parcourus sous le dossier d'une console (comme le cœur avant P5-14a). */
export const MAX_DEPTH = 4;
/** Fichiers rendus au plus par un parcours (borne de Mire). */
export const WALK_LIMIT = 150000;

/** Extensions des jaquettes (images reconnues par Mire). */
export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico', 'tif', 'tiff', 'heic'];

const isConsoleFolder = (location) =>
  !!location &&
  typeof location.path === 'string' &&
  location.path !== '' &&
  Array.isArray(location.kinds) &&
  location.kinds.includes('rom') &&
  typeof location.console?.id === 'string' &&
  location.console.id !== '';

/** Extensions demandées à `walk` (sans le point) ; `undefined` : tous les fichiers. */
function walkExtensions(machine) {
  const list = Array.isArray(machine.extensions) ? machine.extensions.map((e) => String(e).toLowerCase().replace(/^\./, '')).filter(Boolean) : [];
  return list.length ? [...new Set(list)] : undefined;
}

/** Jaquettes du dossier d'images de la console : nom sans extension (minuscules) → chemin. */
async function coversOf(files, dir) {
  const covers = new Map();
  if (typeof dir !== 'string' || !dir) return covers;
  try {
    for (const f of await files.walk(dir, { extensions: IMAGE_EXTS, depth: 0, skipHidden: true, limit: WALK_LIMIT })) {
      covers.set(nameOf(f.path).toLowerCase(), f.path);
    }
  } catch {
    /* pas de jaquettes */
  }
  return covers;
}

/** Élément d'un jeu, avec la clé que lui donnait le cœur (`rom:<console>|<chemin>`) : favoris et fiches le retrouvent. */
export function romElement(machine, file, cover) {
  const name = nameOf(file);
  return {
    key: romKey(machine.id, file, isWindowsPath(file)),
    name: cleanRomName(name),
    open: { kind: 'game', console: machine.id, path: file },
    tags: ['game'],
    infos: machine.system ? { system: machine.system } : {},
    images: cover ? { poster: cover } : {},
  };
}

/** Jeux d'un dossier de console : disques cités par une liste .m3u écartés, jaquettes, ordre alphabétique. */
export async function scanConsoleFolder(files, location) {
  const machine = location.console;
  const found = await files.walk(location.path, { extensions: walkExtensions(machine), depth: MAX_DEPTH, skipHidden: true, limit: WALK_LIMIT });
  const paths = found.map((f) => f.path);
  const hidden = await citedByPlaylists(files, paths);
  const covers = await coversOf(files, machine.images);
  return paths
    .filter((p) => !hidden.has(pathKey(p)))
    .map((p) => {
      const name = nameOf(p);
      return romElement(machine, p, covers.get(name.toLowerCase()) || covers.get(cleanRomName(name).toLowerCase()));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));
}

export default function createSource(ctx) {
  return {
    id: 'consoles',
    tags: ['game'],
    handles: (location) => isConsoleFolder(location),
    instance: (location) => location.path,
    async scan(location) {
      if (!isConsoleFolder(location)) return [];
      return scanConsoleFolder(ctx.files, location);
    },
  };
}
