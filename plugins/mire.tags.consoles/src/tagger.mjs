/**
 * Tags automatiques des consoles (contribution `taggers`, id `consoles`) : info `system` (nom libretro du système)
 * d'un jeu de console, d'après l'extension de son fichier. Repris du cœur de Mire (`src/main/catalog/tags/taggers.ts`
 * et `guessSystem` de `@mire/shared`, avant P5-09).
 *
 * Le système deviné d'après la console elle-même (système choisi, nom, programme, extensions) est posé par la source
 * des jeux de Mire : un jeu qui l'a déjà n'est pas touché. Le plugin ne lit pas la configuration de Mire.
 */

/** Extensions propres à un système (en minuscules), dans l'ordre du référentiel de Mire (`SYSTEMS`). */
export const EXTENSIONS = [
  ['Nintendo - Nintendo Entertainment System', ['.nes', '.fds', '.unf']],
  ['Nintendo - Super Nintendo Entertainment System', ['.sfc', '.smc']],
  ['Nintendo - Game Boy', ['.gb']],
  ['Nintendo - Game Boy Color', ['.gbc']],
  ['Nintendo - Game Boy Advance', ['.gba']],
  ['Nintendo - Nintendo 64', ['.n64', '.z64', '.v64']],
  ['Nintendo - Nintendo DS', ['.nds']],
  ['Nintendo - Nintendo 3DS', ['.3ds', '.cci', '.cxi']],
  ['Sega - Mega Drive - Genesis', ['.md', '.gen', '.smd']],
  ['Sega - Master System - Mark III', ['.sms']],
  ['Sega - Game Gear', ['.gg']],
  ['NEC - PC Engine - TurboGrafx 16', ['.pce']],
  ['Atari - 2600', ['.a26']],
];

/** Système d'après le chemin d'un jeu (« Tetris.gb » → « Nintendo - Game Boy »), chaîne vide sinon. */
export function systemOf(path) {
  const ext = /\.[^./\\]+$/.exec(String(path ?? ''))?.[0].toLowerCase() ?? '';
  if (!ext) return '';
  const found = EXTENSIONS.find(([, exts]) => exts.some((e) => ext.endsWith(e)));
  return found ? found[0] : '';
}

/** Info `system` d'un jeu de console qui n'en a pas encore, ou `null`. */
export function compute(e) {
  if (e?.open?.kind !== 'game') return null;
  const own = e.infos?.system;
  if (typeof own === 'string' && own) return null;
  const system = systemOf(e.open.path);
  return system ? { infos: { system } } : null;
}

export default function createTagger() {
  return { id: 'consoles', compute };
}
