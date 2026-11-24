/**
 * Source `folders` : les jeux PC des dossiers de jeux de Mire. Mire propose chaque dossier de jeux comme un emplacement
 * de type `game` et l'accorde au plugin tant qu'il reste dans ses réglages ; le plugin y trouve les jeux et rend un
 * élément « programme » par jeu. Il ne lance rien lui-même : Mire lance le programme désigné par la clé de l'élément,
 * après avoir vérifié qu'il se trouve bien dans un dossier de jeux.
 */
import { scanFolder } from './scan.mjs';

/** Système des jeux PC (info `system`), comme dans Mire. */
export const PC_SYSTEM = 'pc';

/**
 * Clé d'un jeu PC, la même que celle que Mire donnait avant P5-13 (`pc:<chemin>`, sans casse sous Windows) : favoris,
 * temps de jeu, fiches et listes retrouvent leur jeu.
 */
export function pcGameKey(file, platform) {
  if (platform === 'win32') {
    const n = file.replace(/\\/g, '/').toLowerCase();
    return `pc:${n.length > 1 && n.endsWith('/') && !/^[a-z]:\/$/.test(n) ? n.slice(0, -1) : n}`;
  }
  return `pc:${file.length > 1 && file.endsWith('/') ? file.slice(0, -1) : file}`;
}

export function gameElement(game, platform) {
  return {
    key: pcGameKey(game.path, platform),
    name: game.name,
    open: { kind: 'program', path: game.path },
    tags: ['game'],
    infos: { system: PC_SYSTEM },
    images: {},
  };
}

/** `platform` : celui du système (le plugin tourne dans le processus principal de Mire) ; imposé par les tests. */
export default function createFolders(ctx, platform = globalThis.process?.platform ?? 'linux') {
  return {
    id: 'folders',
    tags: ['game'],
    handles: (location) => !!location?.path && Array.isArray(location.kinds) && location.kinds.includes('game'),
    instance: (location) => location.path,
    async scan(location) {
      if (!location?.path) return [];
      return (await scanFolder(ctx.files, location.path, platform)).map((g) => gameElement(g, platform));
    },
  };
}
