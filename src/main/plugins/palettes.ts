/**
 * Palettes des plugins actifs (contribution de données `palettes`, P5-02). Le cœur garde ses palettes (Écran éteint,
 * Contraste élevé) en fichiers CSS ; un plugin apporte une palette sous forme de données, jamais de CSS ni de code.
 * Fichier de la contribution :
 *
 *   { "scheme": "light", "tokens": { "bg": "#f1efe8", "text": "#1c1f1d", …, "ring-mix": "58%", "mire-edge": "1px" } }
 *
 * - `scheme` : palette claire (`light`) ou sombre (`dark`) ;
 * - `tokens` : jetons de `docs/themes.md`, sans `--` ; chaque valeur est vérifiée selon sa forme (couleur `#rrggbb`,
 *   pourcentage, longueur bornée : `checkPaletteToken` de `@mire/shared`). Un jeton obligatoire absent ou invalide
 *   refuse la palette ; un jeton facultatif invalide ou inconnu est ignoré ;
 * - l'identifiant de la palette est celui de la contribution (minuscules, chiffres, tirets) : c'est lui que retient le
 *   réglage `ui.theme` et qu'un thème désigne. Une palette du cœur ne peut pas être remplacée ; entre deux plugins, le
 *   premier activé l'emporte ;
 * - le nom est le texte `palettes.<contribution>.name` du plugin.
 *
 * L'interface fabrique elle-même la feuille de styles à partir de ces valeurs (`@mire/ui/palettes`), après les avoir
 * vérifiées de nouveau : la CSP de la fenêtre ne change pas.
 */
import { isCorePalette, isPaletteId, parsePaletteData } from '@mire/shared';
import type { PluginPalette } from '@mire/shared/ipc';
import type { ContributionEntry } from './registry.ts';
import { pluginTextPrefix } from './service.ts';

/** Palette d'une contribution `palettes`, ou `null` si son identifiant ou ses données ne conviennent pas. */
export function readPluginPalette(entry: ContributionEntry): PluginPalette | null {
  if (entry.kind !== 'palettes' || !isPaletteId(entry.id) || isCorePalette(entry.id)) return null;
  const data = parsePaletteData(entry.data);
  if (!data) return null;
  return {
    id: entry.id,
    plugin: entry.pluginId,
    name: `${pluginTextPrefix(entry.pluginId)}palettes.${entry.id}.name`,
    scheme: data.scheme,
    background: data.tokens.bg!,
    tokens: data.tokens,
  };
}

/** Palettes des contributions actives, dans l'ordre d'activation ; un identifiant déjà pris est écarté. */
export function readPluginPalettes(entries: readonly ContributionEntry[]): PluginPalette[] {
  const seen = new Set<string>();
  return entries.flatMap((e) => {
    const p = readPluginPalette(e);
    if (!p || seen.has(p.id)) return [];
    seen.add(p.id);
    return [p];
  });
}
