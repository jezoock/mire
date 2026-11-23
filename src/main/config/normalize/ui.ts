/** Interface : thème, menu, vue de départ, accueil et langue. */
import { normalizeLanguageSetting } from '@mire/shared/i18n';
import { DEFAULT_PALETTE, DEFAULT_THEME, PALETTE_AUTO, isPaletteId, isTarget, isThemeId, listPageId, parseTarget } from '@mire/shared';
import type { HomeRow, HomeSettings, MenuPosition, UiSettings, WebSite } from '@mire/shared';
import { homeRowsFromV8 } from '../migrations/v9.ts';
import { DEFAULT_CONFIG, HOME_BARS } from '../defaults.ts';
import { isObjectLike, type Loose } from './common.ts';

const MENU_POSITIONS: readonly MenuPosition[] = ['left', 'right', 'top', 'bottom'];

// Les services de l'accueil doivent désigner des sites qui existent encore.
function normalizeHome(src: unknown, web: WebSite[]): HomeSettings {
  const home: Loose = { ...DEFAULT_CONFIG.ui.home, ...(isObjectLike(src) ? src : {}) };
  home.clock = home.clock !== false;
  home.recent = home.recent !== false;
  home.bars = [...new Set(Array.isArray(home.bars) ? home.bars : [])].filter((b) => HOME_BARS.includes(b));
  home.services = [...new Set(Array.isArray(home.services) ? home.services : [])].filter((id) => web.some((w) => w.id === id));
  // Sans rangées (installation neuve, fichier écrit à la main) : celles que la migration v9 aurait tirées.
  home.rows = isObjectLike(src) && Array.isArray(src.rows) ? normalizeRows(src.rows) : homeRowsFromV8(home);
  return home as HomeSettings;
}

const textList = (v: unknown, keep: (s: string) => boolean = () => true): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x !== '' && keep(x)))] : [];

function normalizeRow(r: unknown): HomeRow | null {
  if (!isObjectLike(r)) return null;
  if (r.kind === 'recent') return { kind: 'recent' };
  // Une cible invalide (notation, écran inconnu) est retirée : voir `parseTarget` (@mire/shared).
  if (r.kind === 'bars') return { kind: 'bars', targets: textList(r.targets, isTarget) };
  // Les sites gardent leur clé même s'ils quittent `web` : ils deviendront des éléments de plugins (P5-01).
  if (r.kind === 'sites') return { kind: 'sites', keys: textList(r.keys, (k) => k.startsWith('web:')) };
  if (r.kind === 'page' || r.kind === 'list') return rowTarget(r.kind, r.id);
  return null;
}

/** Rangée d'une page ou d'une liste : son identifiant suit la même règle que dans une cible. */
function rowTarget(kind: 'page' | 'list', id: unknown): HomeRow | null {
  if (typeof id !== 'string') return null;
  const target = parseTarget(kind === 'list' ? listPageId(id) : id);
  return target?.kind === kind ? { kind, id } : null;
}

/** Rangées valides, chacune une seule fois (une seule rangée de barres, de sites et « Reprendre »). */
function normalizeRows(src: unknown[]): HomeRow[] {
  const seen = new Set<string>();
  const rows: HomeRow[] = [];
  for (const r of src.map(normalizeRow)) {
    if (!r) continue;
    const id = r.kind === 'page' || r.kind === 'list' ? `${r.kind}:${r.id}` : r.kind;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(r);
  }
  return rows;
}

function normalizeMenu(src: unknown): UiSettings['menu'] {
  const menu: Loose = { ...DEFAULT_CONFIG.ui.menu, ...(isObjectLike(src) ? src : {}) };
  if (!MENU_POSITIONS.includes(menu.position)) menu.position = 'left';
  menu.autohide = menu.autohide === true;
  return menu as UiSettings['menu'];
}

/**
 * `ui` : section déjà complétée par les valeurs par défaut ; `srcUi` : celle d'origine, pour l'accueil et le menu
 * (complétés à leur tour clé par clé) ; `web` : sites normalisés.
 */
export function normalizeUi(ui: Loose, srcUi: unknown, web: WebSite[]): UiSettings {
  const src = srcUi as Loose | null | undefined;
  const out: Loose = { ...ui };
  out.home = normalizeHome(src?.home, web);
  // Palette : « Automatique » ou un identifiant (palette du cœur ou d'un plugin, P5-02). Celle d'un plugin absent est
  // gardée : l'interface affiche la palette par défaut en attendant, et la retrouve quand le plugin revient.
  if (out.theme !== PALETTE_AUTO && !isPaletteId(out.theme)) out.theme = DEFAULT_PALETTE;
  // Un thème inconnu de l'interface y retombe sur le thème par défaut : seul l'identifiant est vérifié ici.
  if (!isThemeId(out.pageTheme)) out.pageTheme = DEFAULT_THEME;
  if (typeof out.start !== 'string') out.start = 'home';
  out.backdrop = out.backdrop !== false;
  out.menu = normalizeMenu(src?.menu);
  out.language = normalizeLanguageSetting(out.language);
  return out as UiSettings;
}
