/**
 * Thèmes intégrés (P4-11) et branchement du moteur sur la page. Le thème Mire reprend l'apparence de Mire ; il
 * deviendra un plugin inclus (P5-10). « Papier », thème d'essai très différent (palette claire, polices à empattements,
 * rangées de vignettes, menu en haut, fond dessiné), vérifie que les composants sont assez souples.
 *
 * Chaque thème est un dossier `themes/<id>/` (copié tel quel dans `dist/renderer/themes/`) : son `theme.json`, lu et
 * vérifié ici, et ses fichiers, désignés par des chemins relatifs à ce dossier.
 */
import { isCorePalette, validateTheme } from '@mire/shared';
import { documentHost, paletteHref } from '@mire/ui/palettes';
import mire from './mire/theme.json' with { type: 'json' };
import papier from './papier/theme.json' with { type: 'json' };
import { sharedScope } from './engine.ts';
import type { ThemeEntry, ThemeHost } from './engine.ts';

export { createThemeEngine, activeTheme, sharedScope, DEFAULT_PAGE_LAYOUT } from './engine.ts';
export type { ActiveTheme, ThemeEngine, ThemeEntry, ThemeHost, ThemeLoad, ThemeScope } from './engine.ts';

/** Lit les `theme.json` intégrés ; un thème invalide est écarté (avec un message dans la console). */
export function readThemes(sources: Readonly<Record<string, unknown>>, base = 'themes'): ThemeEntry[] {
  const out: ThemeEntry[] = [];
  for (const [id, data] of Object.entries(sources)) {
    const r = validateTheme(data, id);
    if (r.ok) out.push({ theme: r.theme, base: `${base}/${id}` });
    else console.error(`Thème « ${id} » ignoré : ${r.errors.join(', ') || 'fichier invalide'}`);
  }
  return out;
}

export const BUILTIN_THEMES: readonly ThemeEntry[] = readThemes({ mire, papier });

/**
 * La page réelle : les portées habillées (l'hôte des pages et celui de l'accueil, P4-12), les feuilles de palettes du
 * `<head>` (celles des plugins sont fabriquées par le chargeur de palette), `FontFace` et `Audio`.
 */
export function documentThemeHost(scopes: HTMLElement | readonly HTMLElement[], doc: Document = document): ThemeHost {
  const palettes = documentHost(doc);
  const list = Array.isArray(scopes) ? scopes : [scopes as HTMLElement];
  return {
    scope: list.length === 1 ? (list[0] as HTMLElement) : sharedScope(list),
    hasTokens: (id) => palettes.hasTokens(id),
    // Palette d'un plugin (P5-02) : sa feuille est fabriquée par le chargeur de palette quand le plugin est actif ;
    // absent, la portée garde les jetons de la palette des réglages, sans écran cassé, et la retrouve avec lui.
    addTokens: (id, onReady, onError) => (isCorePalette(id) ? palettes.addTokens(id, paletteHref(id), onReady, onError) : onReady()),
    async loadFont(family, url) {
      try {
        const face = new FontFace(family, `url("${url}")`);
        doc.fonts.add(await face.load());
        return true;
      } catch {
        return false;
      }
    },
    absolute: (url) => new URL(url, doc.baseURI).href,
    playSound(url) {
      const audio = new Audio(url);
      audio.volume = 0.4;
      audio.play().catch(() => {});
    },
  };
}
