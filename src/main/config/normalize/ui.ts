/** Interface : thème, menu, vue de départ et accueil. */
import type { HomeSettings, MenuPosition, UiSettings, WebSite } from '@mire/shared';
import { DEFAULT_CONFIG, HOME_BARS, THEMES } from '../defaults.ts';
import { isObjectLike, type Loose } from './common.ts';

const MENU_POSITIONS: readonly MenuPosition[] = ['left', 'right', 'top', 'bottom'];

// Les services de l'accueil doivent désigner des sites qui existent encore.
function normalizeHome(src: unknown, web: WebSite[]): HomeSettings {
  const home: Loose = { ...DEFAULT_CONFIG.ui.home, ...(isObjectLike(src) ? src : {}) };
  home.clock = home.clock !== false;
  home.recent = home.recent !== false;
  home.bars = [...new Set(Array.isArray(home.bars) ? home.bars : [])].filter((b) => HOME_BARS.includes(b));
  home.services = [...new Set(Array.isArray(home.services) ? home.services : [])].filter((id) => web.some((w) => w.id === id));
  return home as HomeSettings;
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
  if (!THEMES.includes(out.theme)) out.theme = 'ecran';
  if (typeof out.start !== 'string') out.start = 'home';
  out.backdrop = out.backdrop !== false;
  out.menu = normalizeMenu(src?.menu);
  return out as UiSettings;
}
