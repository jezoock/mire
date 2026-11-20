/**
 * Manette (API Gamepad), en données : reconnaissance par les profils des plugins (`gamepads`, P5-04) et profil
 * générique, rappel des commandes, et correspondance bouton → touche selon le contexte. Sans DOM : testé tel quel.
 * Croix ou stick gauche, A valider, B retour, Start lecture/pause, LB/RB précédent/suivant.
 */
import { isRescueCombo } from '@mire/shared';
import type { GamepadGlyphButton, GamepadProfile } from '@mire/shared/ipc';

export type PadButton = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'select' | 'start' | 'home';
export type PadContext = 'dialog' | 'video' | 'image' | 'web' | 'list' | 'columns';
export type PadState = Record<PadButton, boolean>;
type GlyphButton = GamepadGlyphButton;

/**
 * Profil générique du cœur : une manette qu'aucun profil de plugin ne reconnaît (ou dont la famille est désactivée)
 * reste utilisable, avec les libellés de la disposition standard. Un bouton qui porte un mot plutôt qu'un symbole est
 * donné par sa clé des catalogues, traduite à l'affichage.
 */
export const GENERIC_PROFILE: Readonly<GamepadProfile> = {
  id: 'generic',
  name: '',
  match: [],
  priority: 100,
  glyphs: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', select: 'shell.pad.buttons.select' },
};

/** Profil prêt à reconnaître une manette : motifs compilés (une expression invalide est ignorée). */
export interface PadMatcher {
  profile: GamepadProfile;
  patterns: RegExp[];
}

// Identifiant annoncé par la manette : borné avant d'y chercher les motifs.
const MAX_PAD_ID = 256;

/** Compile les motifs des profils des plugins, dans leur ordre d'essai ; un profil sans motif valide est écarté. */
export function padMatchers(profiles: readonly GamepadProfile[]): PadMatcher[] {
  return profiles.flatMap((profile) => {
    const patterns = (Array.isArray(profile?.match) ? profile.match : []).flatMap((p) => {
      try {
        return [new RegExp(p, 'i')];
      } catch {
        return [];
      }
    });
    return patterns.length ? [{ profile, patterns }] : [];
  });
}

/** Profil de la manette d'après l'identifiant qu'elle annonce : le premier qui la reconnaît, sinon le générique. */
export function padProfile(id: unknown, matchers: readonly PadMatcher[]): GamepadProfile {
  const s = String(id || '').slice(0, MAX_PAD_ID);
  return matchers.find((m) => m.patterns.some((re) => re.test(s)))?.profile ?? GENERIC_PROFILE;
}

/** Libellés des boutons d'un profil : les siens, complétés par ceux du profil générique. */
export function padGlyphs(profile: GamepadProfile): Readonly<Record<GlyphButton, string>> {
  return { ...(GENERIC_PROFILE.glyphs as Record<GlyphButton, string>), ...profile.glyphs };
}

const LIST_HINTS: ReadonlyArray<readonly [string, string]> = [
  ['a', 'open'],
  ['b', 'back'],
  ['x', 'edit'],
  ['y', 'search'],
  ['lb rb', 'section'],
];

/**
 * Rappel des commandes en bas de l'écran (`mire-padbar`) : boutons (séparés par une espace) et ce qu'ils font, clé
 * des catalogues sous `shell.pad`.
 */
export const PAD_HINTS: Readonly<Partial<Record<PadContext, ReadonlyArray<readonly [string, string]>>>> = {
  list: LIST_HINTS,
  // Colonnes (explorateur) : comme les listes, mais Y choisit un élément (sélection multiple, P4-09) ; la croix change
  // de ligne et de colonne.
  columns: LIST_HINTS.map(([b, k]) => (b === 'y' ? ['y', 'pick'] : [b, k])),
  video: [
    ['a', 'pause'],
    ['lt rt', 'minute'],
    ['lb rb', 'otherVideo'],
    ['y', 'subtitles'],
    ['b', 'close'],
  ],
  image: [
    ['a', 'slideshow'],
    ['lb rb', 'image'],
    ['b', 'close'],
  ],
  dialog: [
    ['a', 'confirm'],
    ['b', 'cancel'],
  ],
};

/** Vrai si le libellé d'un bouton est une clé des catalogues (du cœur ou d'un plugin), à traduire. */
export const isGlyphKey = (glyph: string): boolean => glyph.startsWith('shell.pad.buttons.') || glyph.startsWith('pluginTexts.');

/**
 * Aide de la manette pour ce contexte et ce profil : libellés des boutons et clé du texte (`shell.pad.<clé>`),
 * à traduire ; `null` si le contexte n'a pas de rappel.
 */
export function padHints(ctx: string, profile: GamepadProfile = GENERIC_PROFILE): { glyphs: string[]; key: string }[] | null {
  const hints = PAD_HINTS[ctx as PadContext];
  if (!hints) return null;
  const g = padGlyphs(profile) as Record<string, string>;
  return hints.map(([btns, key]) => ({ glyphs: btns.split(' ').map((b) => g[b] as string), key: `shell.pad.${key}` }));
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
  /** Combinaison du mode secours tenue (elle ne compte qu'une fois tant qu'on ne la relâche pas). */
  combo?: boolean;
}

/**
 * Combinaison du mode secours (P4-10, Affichage + Menu) : vrai si elle vient d'être faite. Tant qu'elle est tenue, ses
 * boutons sont marqués comme déjà enfoncés, pour qu'ils ne déclenchent pas en plus leur action habituelle.
 */
export function rescueCombo(state: PadState, mem: PadMemory): boolean {
  if (!isRescueCombo(state)) {
    mem.combo = false;
    return false;
  }
  for (const [b, pressed] of Object.entries(state)) if (pressed) mem.prev[b] = true;
  if (mem.combo) return false;
  mem.combo = true;
  return true;
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
