/**
 * Manette (API Gamepad), en données : familles reconnues, libellés des boutons, rappel des commandes,
 * et correspondance bouton → touche selon le contexte. Sans DOM : testé tel quel.
 * Croix ou stick gauche, A valider, B retour, Start lecture/pause, LB/RB précédent/suivant.
 */
import { esc } from '../core/dom.ts';

export type PadFamily = 'xbox' | 'ps' | 'nintendo';
export type PadButton = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'select' | 'start' | 'home';
export type PadContext = 'dialog' | 'video' | 'image' | 'web' | 'list';
export type PadState = Record<PadButton, boolean>;

/** Familles reconnues d'après l'identifiant annoncé par la manette, dans l'ordre de priorité ; Xbox par défaut. */
export const PAD_FAMILIES: ReadonlyArray<{ family: PadFamily; match: RegExp }> = [
  { family: 'xbox', match: /xbox|xinput|045e/ },
  // Les manettes Sony s'annoncent souvent comme « Wireless Controller … Vendor: 054c ».
  { family: 'ps', match: /054c|playstation|dualsense|dualshock|^wireless controller/ },
  { family: 'nintendo', match: /057e|nintendo|switch|pro controller|joy-con/ },
];

export function padFamily(id: unknown): PadFamily {
  const s = String(id || '').toLowerCase();
  return PAD_FAMILIES.find((f) => f.match.test(s))?.family ?? 'xbox';
}

export const PAD_NAMES: Readonly<Record<PadFamily, string>> = { xbox: 'Xbox', ps: 'PlayStation', nintendo: 'Nintendo' };

type GlyphButton = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'select';

// Libellés des boutons par famille (selon leur position : en bas = valider, à droite = retour…).
export const PAD_GLYPHS: Readonly<Record<PadFamily, Readonly<Record<GlyphButton, string>>>> = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', select: 'Affichage' },
  ps: { a: '✕', b: '○', x: '□', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', select: 'Créer' },
  nintendo: { a: 'B', b: 'A', x: 'Y', y: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', select: '−' },
};

/** Rappel des commandes en bas de l'écran : boutons (séparés par une espace) et ce qu'ils font. */
export const PAD_HINTS: Readonly<Partial<Record<PadContext, ReadonlyArray<readonly [string, string]>>>> = {
  list: [
    ['a', 'Ouvrir'],
    ['b', 'Retour'],
    ['x', 'Modifier'],
    ['y', 'Rechercher'],
    ['lb rb', 'Section'],
  ],
  video: [
    ['a', 'Pause'],
    ['lt rt', '1 min'],
    ['lb rb', 'Autre vidéo'],
    ['y', 'Sous-titres'],
    ['b', 'Fermer'],
  ],
  image: [
    ['a', 'Diaporama'],
    ['lb rb', 'Image'],
    ['b', 'Fermer'],
  ],
  dialog: [
    ['a', 'Valider'],
    ['b', 'Annuler'],
  ],
};

/** Contenu de la barre de rappel pour ce contexte et cette famille ; `null` si le contexte n'a pas de rappel. */
export function padHintsHtml(ctx: string, family: PadFamily): string | null {
  const hints = PAD_HINTS[ctx as PadContext];
  if (!hints) return null;
  const g = PAD_GLYPHS[family] as Record<string, string>;
  return hints
    .map(
      ([btns, label]) =>
        `<span class="ph">${btns
          .split(' ')
          .map((b) => `<span class="pb${(g[b] as string).length > 2 ? ' long' : ''}">${esc(g[b])}</span>`)
          .join('')}${esc(label)}</span>`,
    )
    .join('');
}

type PadKeys = Readonly<Partial<Record<PadButton, string>>>;

// Dans un site, la manette pilote la page : croix = flèches, A = Entrée, X ou Start = Espace,
// B = page précédente, Y = Échap, LB/RB = élément précédent/suivant, Select ou Home = revenir aux menus de Mire.
export const WEB_PAD: PadKeys = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  a: 'Enter',
  x: 'Space',
  start: 'Space',
  b: 'Back',
  y: 'Escape',
  lb: 'ShiftTab',
  rb: 'Tab',
};
export const VIDEO_PAD: PadKeys = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  a: 'Enter',
  start: ' ',
  b: 'Escape',
  y: 's',
  lb: 'PageUp',
  rb: 'PageDown',
  lt: 'j',
  rt: 'l',
};
export const IMAGE_PAD: PadKeys = { left: 'ArrowLeft', right: 'ArrowRight', lb: 'ArrowLeft', rb: 'ArrowRight', a: ' ', start: ' ', b: 'Escape' };
export const LIST_PAD: PadKeys = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  a: 'Enter',
  b: 'Escape',
  y: '/',
  lt: 'PageUp',
  rt: 'PageDown',
  start: 'MediaPlayPause',
};

/** Touche envoyée par le bouton dans la table donnée, ou `null`. */
export function padKey(map: PadKeys, button: string): string | null {
  return Object.hasOwn(map, button) ? (map[button as PadButton] ?? null) : null;
}

/** Sections parcourues par LB et RB, dans l'ordre du menu. */
export const SECTION_ORDER = ['home', 'search', 'videos', 'music', 'images', 'streaming', 'tv', 'games'];

/** Section suivante (`d` = 1) ou précédente (`d` = -1), en boucle ; une section hors de la liste compte comme l'accueil. */
export function nextSection(current: string, d: number): string {
  const cur = SECTION_ORDER.indexOf(current);
  return SECTION_ORDER[(Math.max(0, cur) + d + SECTION_ORDER.length) % SECTION_ORDER.length] as string;
}

interface GamepadLike {
  buttons: ReadonlyArray<{ pressed?: boolean; value?: number } | undefined>;
  axes: ReadonlyArray<number>;
}

/** Boutons enfoncés, d'après la disposition standard (croix ou stick gauche pour les directions). */
export function readPad(gp: GamepadLike): PadState {
  const btn = (n: number) => !!gp.buttons[n]?.pressed || (gp.buttons[n]?.value || 0) > 0.5;
  const ax = gp.axes[0] || 0;
  const ay = gp.axes[1] || 0;
  return {
    up: btn(12) || ay < -0.6,
    down: btn(13) || ay > 0.6,
    left: btn(14) || ax < -0.6,
    right: btn(15) || ax > 0.6,
    a: btn(0),
    b: btn(1),
    x: btn(2),
    y: btn(3),
    lb: btn(4),
    rb: btn(5),
    lt: btn(6),
    rt: btn(7),
    select: btn(8),
    start: btn(9),
    home: btn(16),
  };
}

/** Boutons répétés tant qu'ils restent enfoncés (directions, et LT/RT pour avancer ou reculer). */
export const REPEATING: ReadonlySet<string> = new Set(['up', 'down', 'left', 'right', 'lt', 'rt']);
/** Délai avant la première répétition, puis entre deux répétitions (ms). */
export const REPEAT_DELAY = 380;
export const REPEAT_RATE = 110;

/** Mémoire de la manette entre deux lectures : boutons enfoncés et moment de la prochaine répétition. */
export interface PadMemory {
  prev: Partial<Record<string, boolean>>;
  repeatAt: Partial<Record<string, number>>;
}

/**
 * Appuis à traiter pour cette lecture de la manette, dans l'ordre des boutons : `first` pour un nouvel appui,
 * sinon une répétition. Met à jour `mem`.
 */
export function padPresses(state: PadState, mem: PadMemory, now: number): Array<{ button: PadButton; first: boolean }> {
  const out: Array<{ button: PadButton; first: boolean }> = [];
  for (const [k, pressed] of Object.entries(state) as Array<[PadButton, boolean]>) {
    if (pressed && !mem.prev[k]) {
      out.push({ button: k, first: true });
      mem.repeatAt[k] = now + REPEAT_DELAY;
    } else if (pressed && REPEATING.has(k) && now >= (mem.repeatAt[k] as number)) {
      out.push({ button: k, first: false });
      mem.repeatAt[k] = now + REPEAT_RATE;
    }
    mem.prev[k] = pressed;
  }
  return out;
}
