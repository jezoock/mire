/**
 * Moteur de thèmes (P4-11, D-17) : applique le thème choisi (`theme.json`, `@mire/shared`) à la partie de la page
 * qu'il dessine (les pages, puis l'accueil en P4-12), sans recharger la fenêtre.
 *
 * - **palette** : celle du thème, posée sur la portée (`data-palette`) ; sans elle, la portée suit la palette des
 *   réglages. Les écrans du cœur gardent toujours la palette des réglages ;
 * - **polices** : chargées depuis les fichiers du thème (`FontFace`), puis données par des propriétés CSS
 *   (`--mire-font-body`, `--mire-font-heading`) ;
 * - **images** : adresses des fichiers du thème (`--mire-theme-background`, logo) ;
 * - **sons** : joués à la demande (`play`) ;
 * - **mise en page** : transmise aux composants par les abonnés (`onChange`), qui la donnent en attributs.
 *
 * Les fichiers d'un thème intégré sont des fichiers de la page (`themes/<id>/…`, `'self'` dans la CSP). Sans DOM : la
 * page réelle est derrière `ThemeHost` (voir `documentThemeHost`).
 */
import { DEFAULT_THEME, resolveTheme, themeAssetUrl } from '@mire/shared';
import type { ThemeDefinition, ThemeFileType, ThemeMenuPosition, ThemePageLayout, ThemeLayout } from '@mire/shared';

/** Thème connu de l'interface : sa définition et l'adresse de son dossier. */
export interface ThemeEntry {
  theme: ThemeDefinition;
  /** Adresse du dossier du thème, relative à la page (`themes/mire`). */
  base: string;
}

/** Ce que les composants reçoivent du thème affiché. */
export interface ActiveTheme {
  id: string;
  theme: ThemeDefinition;
  page: Required<ThemePageLayout>;
  home: { layout: ThemeLayout };
  /** Place du menu voulue par le thème, ou `null` (celle des réglages). */
  menu: ThemeMenuPosition | null;
  images: { background: string; logo: string };
}

/** Ce que le moteur utilise de la page, remplaçable en test. */
export interface ThemeHost {
  /** Élément que le thème habille (`data-palette`, `data-theme`, propriétés CSS). */
  scope: { dataset: Record<string, string | undefined>; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } };
  /** Feuille de la palette déjà liée ? Sinon `addTokens` la lie et appelle `onReady` une fois chargée. */
  hasTokens(id: string): boolean;
  addTokens(id: string, onReady: () => void): void;
  /** Charge une police ; vrai si elle est prête. */
  loadFont(family: string, url: string): Promise<boolean>;
  /** Joue un son (sans erreur s'il ne peut pas l'être). */
  playSound(url: string): void;
  /**
   * Adresse complète d'un fichier, pour une propriété CSS : une adresse relative y serait lue depuis la feuille qui
   * l'emploie, et non depuis la page.
   */
  absolute?(url: string): string;
}

export interface ThemeEngine {
  /** Applique le thème d'un réglage (un thème inconnu donne le thème par défaut). */
  set(setting: unknown): ActiveTheme;
  current(): ActiveTheme;
  /** Thèmes connus, dans l'ordre. */
  list(): ThemeDefinition[];
  /** Joue un son du thème (`move`, `select`, `back`), s'il en a un. */
  play(sound: 'move' | 'select' | 'back'): void;
  onChange(listener: (active: ActiveTheme) => void): () => void;
}

/** Mise en page des pages quand le thème ne dit rien : celle du thème Mire. */
export const DEFAULT_PAGE_LAYOUT: Required<ThemePageLayout> = { layout: 'grid', card: 'auto', size: 'm', background: 'none' };

/** Ce que le thème donne aux composants, champs absents complétés. */
export function activeTheme(entry: ThemeEntry): ActiveTheme {
  const { theme, base } = entry;
  const asset = (file: string | undefined, type: ThemeFileType) => themeAssetUrl(base, file, type);
  const background = asset(theme.images?.background, 'image');
  const page = { ...DEFAULT_PAGE_LAYOUT, ...theme.page };
  // Un fond « image » sans image utilisable n'affiche rien.
  if (page.background === 'image' && !background) page.background = 'none';
  return {
    id: theme.id,
    theme,
    page,
    home: { layout: theme.home?.layout ?? 'rows' },
    menu: theme.menu?.position ?? null,
    images: { background, logo: asset(theme.images?.logo, 'image') },
  };
}

/** Valeur CSS d'une police : la famille chargée du thème (si elle l'est), puis ses familles de repli. */
export function fontStack(loaded: string | null, family: string | undefined): string {
  return [loaded ? `"${loaded}"` : '', family ?? ''].filter(Boolean).join(', ');
}

export function createThemeEngine(entries: readonly ThemeEntry[], host: ThemeHost): ThemeEngine {
  const byId = new Map(entries.map((e) => [e.theme.id, e]));
  const fallback = byId.get(DEFAULT_THEME) ?? entries[0];
  if (!fallback) throw new Error('Moteur de thèmes : aucun thème.');
  let active = activeTheme(fallback);
  let generation = 0;
  const listeners = new Set<(a: ActiveTheme) => void>();
  const { scope } = host;

  function applyPalette(theme: ThemeDefinition, gen: number) {
    const id = theme.palette;
    if (!id) {
      delete scope.dataset.palette;
      return;
    }
    const show = () => {
      // Un autre thème a été choisi pendant le chargement de la feuille.
      if (gen === generation) scope.dataset.palette = id;
    };
    if (host.hasTokens(id)) show();
    else host.addTokens(id, show);
  }

  function applyFonts(entry: ThemeEntry, gen: number) {
    for (const role of ['body', 'heading'] as const) {
      const prop = `--mire-font-${role}`;
      const font = entry.theme.fonts?.[role];
      if (!font) {
        scope.style.removeProperty(prop);
        continue;
      }
      scope.style.setProperty(prop, fontStack(null, font.family) || 'inherit');
      const url = themeAssetUrl(entry.base, font.file, 'font');
      if (!url) continue;
      const family = `mire-theme-${entry.theme.id}-${role}`;
      void host.loadFont(family, url).then((ok) => {
        if (ok && gen === generation) scope.style.setProperty(prop, fontStack(family, font.family));
      });
    }
  }

  function apply(entry: ThemeEntry) {
    const gen = ++generation;
    active = activeTheme(entry);
    scope.dataset.theme = entry.theme.id;
    applyPalette(entry.theme, gen);
    applyFonts(entry, gen);
    const bg = active.images.background;
    if (bg) scope.style.setProperty('--mire-theme-background', `url("${host.absolute ? host.absolute(bg) : bg}")`);
    else scope.style.removeProperty('--mire-theme-background');
    for (const l of listeners) l(active);
  }

  return {
    set(setting) {
      const entry = byId.get(resolveTheme(setting, [...byId.keys()])) ?? fallback;
      if (entry.theme.id !== active.id || scope.dataset.theme !== entry.theme.id) apply(entry);
      return active;
    },
    current: () => active,
    list: () => entries.map((e) => e.theme),
    play(sound) {
      const entry = byId.get(active.id);
      const url = entry ? themeAssetUrl(entry.base, entry.theme.sounds?.[sound], 'sound') : '';
      if (url) host.playSound(url);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
