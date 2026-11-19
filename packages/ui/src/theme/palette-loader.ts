/**
 * Chargeur de palette (P4-02) : applique la palette d'un réglage à la page, sans la recharger. La palette est
 * désignée par l'attribut `data-palette` de `<html>` ; ses jetons sont dans `palettes/<id>/<id>.css`. Les palettes
 * du cœur sont liées par index.html ; une autre palette voit sa feuille ajoutée à la première demande, et n'est
 * appliquée qu'une fois celle-ci chargée : introuvable, la palette affichée reste en place. « Automatique » suit le mode clair ou
 * sombre du système, y compris quand il change.
 */
import { DEFAULT_PALETTE, PALETTE_AUTO, resolvePalette } from '@mire/shared';

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
  /** Mode clair du système. */
  light: { readonly matches: boolean; addEventListener(type: 'change', listener: () => void): void };
}

export interface PaletteLoader {
  /** Applique la palette du réglage (`auto` ou un identifiant). */
  set(setting: string | null | undefined): void;
  /** Palette affichée (ou en cours de chargement si elle vient d'être demandée). */
  current(): string;
}

/** Adresse de la feuille d'une palette, relative à la page. */
export const paletteHref = (id: string, base = 'palettes'): string => `${base}/${id}/${id}.css`;

export function createPaletteLoader(host: PaletteHost = documentHost()): PaletteLoader {
  let setting: string = DEFAULT_PALETTE;
  let wanted = '';

  function apply() {
    const id = resolvePalette(setting, !host.light.matches);
    wanted = id;
    const show = () => {
      // Une demande plus récente l'a emporté pendant le chargement.
      if (wanted === id) host.root.dataset.palette = id;
    };
    if (host.hasTokens(id)) show();
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
  };
}

/** La page réelle : `<html>`, les `<link data-palette-tokens>` du `<head>`, et la préférence du système. */
export function documentHost(doc: Document = document): PaletteHost {
  const linked = (id: string) => [...doc.querySelectorAll<HTMLLinkElement>('link[data-palette-tokens]')].some((l) => l.dataset.paletteTokens === id);
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
    light: doc.defaultView!.matchMedia('(prefers-color-scheme: light)'),
  };
}
