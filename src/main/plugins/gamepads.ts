/**
 * Profils de manettes des plugins actifs (contribution de données `gamepads`, P5-04). Le cœur garde la mécanique de la
 * manette (API Gamepad, correspondance bouton → touche, combinaison de secours) et un profil générique ; un plugin
 * apporte la reconnaissance d'une famille et les libellés de ses boutons. Fichier de la contribution :
 *
 *   { "match": ["xbox", "045e"], "priority": 10,
 *     "buttons": { "a": "A", "lb": "LB", "select": { "text": "buttons.view" } } }
 *
 * - `match` : motifs de l'identifiant annoncé par la manette (expressions régulières sans distinction de casse). Ce
 *   sont des données, jamais du code : chaînes courtes, en nombre borné, sans quantificateur appliqué à un groupe ni
 *   référence arrière (pas de retour arrière explosif) ; une expression invalide ou refusée est ignorée ;
 * - `priority` : ordre d'essai des profils (le plus petit d'abord, 0 à 100, 50 par défaut) ;
 * - `buttons` : libellé d'un bouton, symbole court affiché tel quel (jamais interprété comme du HTML), ou texte du
 *   plugin (`{ "text": "<clé>" }`, sous `pluginTexts.<plugin>.<clé>`) ; un bouton absent garde le libellé générique ;
 * - le nom de la famille est le texte `gamepads.<contribution>.name` du plugin.
 * Un fichier mal formé ne donne aucun profil ; un champ mal formé est ignoré.
 */
import type { GamepadGlyphButton, GamepadProfile } from '@mire/shared/ipc';
import type { ContributionEntry } from './registry.ts';
import { pluginTextPrefix } from './service.ts';

export const GLYPH_BUTTONS: readonly GamepadGlyphButton[] = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'select'];

/** Bornes des données d'un profil. */
export const MAX_PATTERNS = 16;
export const MAX_PATTERN_LENGTH = 64;
export const MAX_GLYPH_LENGTH = 4;
const TEXT_KEY_RE = /^[A-Za-z0-9_-]{1,32}(?:\.[A-Za-z0-9_-]{1,32}){0,3}$/;
// Groupe suivi d'un quantificateur (`(a+)+`), référence arrière (`\1`, `\k<n>`) : refusés.
const RISKY_PATTERN = /\)[*+?{]|\\[1-9]|\\k</;
// Caractères de contrôle et de mise en forme invisibles : refusés dans un libellé.
const CONTROL = /[\p{Cc}\p{Cf}]/u;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Motif utilisable : chaîne bornée, sans construction risquée, compilable. `null` sinon (ignoré). */
export function checkPattern(p: unknown): string | null {
  if (typeof p !== 'string' || !p || p.length > MAX_PATTERN_LENGTH || RISKY_PATTERN.test(p)) return null;
  try {
    new RegExp(p, 'i');
  } catch {
    return null;
  }
  return p;
}

/** Libellé d'un bouton : symbole court, ou clé d'un texte du plugin. `null` sinon. */
function checkGlyph(v: unknown, textPrefix: string): string | null {
  if (typeof v === 'string') {
    const g = v.trim();
    return g && [...g].length <= MAX_GLYPH_LENGTH && !CONTROL.test(g) && !g.includes('.') ? g : null;
  }
  if (isRecord(v) && typeof v.text === 'string' && TEXT_KEY_RE.test(v.text)) return textPrefix + v.text;
  return null;
}

/** Profil d'une contribution `gamepads`, ou `null` si ses données ne conviennent pas. */
export function readGamepadProfile(entry: ContributionEntry): GamepadProfile | null {
  const d = entry.data;
  if (!isRecord(d) || !Array.isArray(d.match)) return null;
  const match = d.match.slice(0, MAX_PATTERNS).flatMap((p) => checkPattern(p) ?? []);
  if (!match.length) return null;
  const priority = typeof d.priority === 'number' && Number.isInteger(d.priority) && d.priority >= 0 && d.priority <= 100 ? d.priority : 50;
  const prefix = pluginTextPrefix(entry.pluginId);
  const glyphs: GamepadProfile['glyphs'] = {};
  const buttons = isRecord(d.buttons) ? d.buttons : {};
  for (const b of GLYPH_BUTTONS) {
    const g = Object.hasOwn(buttons, b) ? checkGlyph(buttons[b], prefix) : null;
    if (g) glyphs[b] = g;
  }
  return { id: `${entry.pluginId}/${entry.id}`, name: `${prefix}gamepads.${entry.id}.name`, match, priority, glyphs };
}

/** Profils des contributions actives, dans l'ordre d'essai (priorité, puis identifiant). */
export function readGamepadProfiles(entries: readonly ContributionEntry[]): GamepadProfile[] {
  return entries
    .filter((e) => e.kind === 'gamepads')
    .flatMap((e) => readGamepadProfile(e) ?? [])
    .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
