/**
 * Chargeur de palette (P4-02, P5-02) : applique la palette d'un réglage à la page, sans la recharger. La palette est
 * désignée par l'attribut `data-palette` de `<html>`.
 *
 * - **palettes du cœur** (`CORE_PALETTES`) : leurs jetons sont dans `palettes/<id>/<id>.css`, liés par index.html ;
 *   une feuille pas encore liée l'est à la première demande, et la palette n'est appliquée qu'une fois celle-ci
 *   chargée (introuvable, la palette affichée reste en place) ;
 * - **palettes des plugins** : des données (`PluginPalette`), jamais du CSS. Le chargeur fabrique lui-même leur
 *   feuille, par le CSSOM (une règle `[data-palette="<id>"]` et une propriété par jeton), après avoir vérifié de
 *   nouveau chaque jeton (`checkPaletteToken`) : la CSP de la fenêtre ne change pas. Toutes les palettes des plugins
 *   actifs ont leur feuille, pour les aperçus des Réglages et les thèmes ;
 * - **palette absente** (plugin pas encore installé, désactivé, désinstallé) : la palette par défaut s'affiche, et
 *   `onMissing` est prévenu une fois les plugins démarrés. Le réglage est gardé : la palette revient avec son plugin.
 *
 * « Automatique » suit le mode clair ou sombre du système, y compris quand il change ; sans palette claire (plugin
 * absent), il garde la palette par défaut, sans message.
 */
import { AUTO_PALETTES, DEFAULT_PALETTE, PALETTE_AUTO, checkPaletteToken, isCorePalette, isPaletteId, resolvePalette } from '@mire/shared';

/** Palette d'un plugin, telle que le processus principal la donne (`PluginPalette` de `@mire/shared/ipc`). */
export interface PluginPaletteTokens {
  id: string;
  scheme: 'light' | 'dark';
  tokens: Readonly<Record<string, string>>;
}

/** Ce que le chargeur utilise de la page : un sous-ensemble de `document` et `matchMedia`, remplaçable en test. */
export interface PaletteHost {
  root: { dataset: Record<string, string | undefined> };
  /** Feuille de la palette déjà liée à la page ? */
  hasTokens(id: string): boolean;
  /**
   * Lie la feuille de la palette ; `onReady` est appelé quand elle est chargée (pas si elle est introuvable :
   * `onError` l'est alors, s'il est donné).
   */
  addTokens(id: string, href: string, onReady: () => void, onError?: () => void): void;
  /**
   * Remplace les feuilles des palettes des plugins par celles-ci ; les déclarations sont déjà vérifiées (nom de
   * propriété, valeur), le seul sélecteur est `[data-palette="<id>"]` avec un identifiant vérifié.
   */
  setPluginTokens(sheets: readonly { id: string; declarations: readonly [string, string][] }[]): void;
  /** Mode clair du système. */
  light: { readonly matches: boolean; addEventListener(type: 'change', listener: () => void): void };
}

export interface PaletteLoader {
  /** Applique la palette du réglage (`auto` ou un identifiant). */
  set(setting: string | null | undefined): void;
  /** Palette affichée (ou en cours de chargement si elle vient d'être demandée). */
  current(): string;
  /** Palettes des plugins actifs ; `ready` : les plugins ont démarré (une palette absente est alors manquante). */
  setPlugins(info: { ready: boolean; palettes: readonly PluginPaletteTokens[] }): void;
  /** Palette disponible (du cœur, ou d'un plugin actif) ? */
  available(id: string): boolean;
  /** Abonnement : la palette choisie est absente, la palette par défaut la remplace. */
  onMissing(listener: (id: string) => void): () => void;
}

/** Adresse de la feuille d'une palette, relative à la page. */
export const paletteHref = (id: string, base = 'palettes'): string => `${base}/${id}/${id}.css`;

/** Déclarations d'une palette de plugin, revérifiées ici : `color-scheme`, puis un `--<jeton>` par jeton valide. */
export function pluginDeclarations(p: PluginPaletteTokens): [string, string][] {
  const out: [string, string][] = [['color-scheme', p.scheme === 'light' ? 'light' : 'dark']];
  for (const [name, value] of Object.entries(p.tokens)) {
    const v = checkPaletteToken(name, value);
    if (v !== null) out.push([`--${name}`, v]);
  }
  return out;
}

export function createPaletteLoader(host: PaletteHost = documentHost()): PaletteLoader {
  let setting: string = DEFAULT_PALETTE;
  let wanted = '';
  let ready = false;
  let plugins = new Set<string>();
  // Palettes manquantes déjà signalées (une fois chacune, tant qu'elles restent absentes).
  const reported = new Set<string>();
  const missing = new Set<(id: string) => void>();

  const available = (id: string) => isCorePalette(id) || plugins.has(id);

  function choose(): string {
    const id = resolvePalette(setting, !host.light.matches);
    if (available(id)) {
      reported.delete(id);
      return id;
    }
    // « Automatique » sans sa palette claire : la palette par défaut, sans message.
    const auto = setting === PALETTE_AUTO && id === AUTO_PALETTES.light;
    if (ready && !auto && !reported.has(id)) {
      reported.add(id);
      for (const l of missing) l(id);
    }
    return DEFAULT_PALETTE;
  }

  function apply() {
    const id = choose();
    wanted = id;
    const show = () => {
      // Une demande plus récente l'a emporté pendant le chargement.
      if (wanted === id) host.root.dataset.palette = id;
    };
    if (plugins.has(id) || host.hasTokens(id)) show();
    else host.addTokens(id, paletteHref(id), show);
  }

  host.light.addEventListener('change', () => {
    if (setting === PALETTE_AUTO) apply();
  });

  return {
    set(next) {
      setting = next || DEFAULT_PALETTE;
      apply();
    },
    current: () => wanted || host.root.dataset.palette || '',
    setPlugins(info) {
      const list = info.palettes.filter((p) => isPaletteId(p.id) && !isCorePalette(p.id));
      host.setPluginTokens(list.map((p) => ({ id: p.id, declarations: pluginDeclarations(p) })));
      plugins = new Set(list.map((p) => p.id));
      for (const id of [...reported]) if (plugins.has(id)) reported.delete(id);
      ready = info.ready;
      apply();
    },
    available,
    onMissing(listener) {
      missing.add(listener);
      return () => missing.delete(listener);
    },
  };
}

/**
 * La page réelle : `<html>`, les `<link data-palette-tokens>` du `<head>` (palettes du cœur), les `<style
 * data-palette-tokens>` fabriqués pour les palettes des plugins, et la préférence du système.
 */
export function documentHost(doc: Document = document): PaletteHost {
  const linked = (id: string) => [...doc.querySelectorAll<HTMLElement>('[data-palette-tokens]')].some((l) => l.dataset.paletteTokens === id);
  return {
    root: doc.documentElement,
    hasTokens: linked,
    addTokens(id, href, onReady, onError) {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.paletteTokens = id;
      link.addEventListener('load', onReady, { once: true });
      if (onError) link.addEventListener('error', onError, { once: true });
      doc.head.append(link);
    },
    setPluginTokens(sheets) {
      for (const old of doc.head.querySelectorAll('style[data-palette-plugin]')) old.remove();
      for (const { id, declarations } of sheets) {
        if (!isPaletteId(id)) continue;
        const style = doc.createElement('style');
        style.dataset.palettePlugin = '';
        style.dataset.paletteTokens = id;
        doc.head.append(style);
        // Règle vide, puis propriétés une à une par le CSSOM : une valeur ne peut pas sortir de sa déclaration.
        const sheet = style.sheet!;
        const rule = sheet.cssRules[sheet.insertRule(`[data-palette="${id}"] {}`)] as CSSStyleRule;
        for (const [name, value] of declarations) rule.style.setProperty(name, value);
      }
    },
    light: doc.defaultView!.matchMedia('(prefers-color-scheme: light)'),
  };
}
