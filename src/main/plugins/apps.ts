/**
 * Lecteurs externes des plugins actifs (contribution de données `apps` de genre `player`, P5-20). Le plugin décrit le
 * programme ; le cœur garde le seul mécanisme qui lance un programme (`src/main/platform/players.ts`) : il cherche
 * lui-même l'exécutable aux emplacements décrits, et fabrique lui-même la ligne de commande. Fichier de la
 * contribution :
 *
 *   { "kind": "player", "priority": 10, "names": ["mpv"],
 *     "locations": { "windows": ["{programFiles}\\mpv\\mpv.exe"], "mac": ["/opt/homebrew/bin/mpv"], "linux": ["/usr/bin/mpv"] },
 *     "options": { "fullscreen": "--fs", "title": "--force-media-title={title}", "start": "--start={start}" } }
 *
 * - `kind` : `player` (les autres genres d'apps, les émulateurs, viendront avec leur tâche ; ignorés ici) ;
 * - `priority` : ordre de préférence (le plus petit d'abord, 0 à 100, 50 par défaut) ;
 * - `names` : noms du programme (minuscules, sans extension) ; ils reconnaissent le programme choisi par
 *   l'utilisateur, et le premier sert de commande si rien n'est trouvé (programme cherché dans le PATH, sans shell) ;
 * - `locations` : emplacements absolus, par système ; sous Windows, un emplacement peut commencer par
 *   `{programFiles}`, `{programFilesX86}` ou `{localAppData}`. Refusés : chemin relatif, partage réseau, segment
 *   `..`, et tout emplacement dont le nom de fichier n'est pas l'un des `names` (un plugin ne fait pas passer un
 *   autre programme pour un lecteur) ;
 * - `options` : les seules options que le plugin choisit, chacune limitée à sa forme : `fullscreen` une option seule
 *   (`--fs`), `title` et `start` une option suivie de `={title}` ou `={start}`. Aucune autre valeur : le cœur ajoute
 *   le titre, la position et le fichier à lire (toujours en dernier, jamais une option) ;
 * - le nom affiché est le texte `apps.<contribution>.name` du plugin.
 * Un fichier mal formé ne donne aucun lecteur ; un emplacement ou une option mal formés sont ignorés.
 */
import path from 'node:path';
import type { ContributionEntry } from './registry.ts';
import type { ExternalPlayerSpec, PlayerLocations, PlayerOptions } from '../platform/types.ts';
import { pluginTextPrefix } from './service.ts';

/** Bornes des données d'un lecteur. */
export const MAX_NAMES = 4;
export const MAX_LOCATIONS = 8;
export const MAX_LOCATION_LENGTH = 260;

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const OPTION = '--?[A-Za-z][A-Za-z0-9-]{0,39}';
const OPTION_RES: Record<keyof PlayerOptions, RegExp> = {
  fullscreen: new RegExp(`^${OPTION}$`),
  title: new RegExp(`^${OPTION}=\\{title\\}$`),
  start: new RegExp(`^${OPTION}=\\{start\\}$`),
};
// Dossiers d'installation de Windows qu'un emplacement peut désigner (remplacés par le cœur, voir `detect.ts`).
export const WINDOWS_DIRS = ['{programFiles}', '{programFilesX86}', '{localAppData}'] as const;
const SYSTEMS = { windows: 'win32', mac: 'darwin', linux: 'linux' } as const;
const CONTROL = /[\p{Cc}\p{Cf}]/u;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Nom du fichier d'un programme, en minuscules, sans `.exe` : ce que `names` désigne. */
export function programBaseName(file: string, windows: boolean): string {
  const base = (windows ? path.win32 : path.posix).basename(file).toLowerCase();
  return windows ? base.replace(/\.exe$/, '') : base;
}

/** Emplacement utilisable sur ce système, ou `null` (ignoré). */
export function checkLocation(v: unknown, system: keyof typeof SYSTEMS, names: readonly string[]): string | null {
  if (typeof v !== 'string' || !v || v.length > MAX_LOCATION_LENGTH || CONTROL.test(v)) return null;
  const windows = system === 'windows';
  const dir = WINDOWS_DIRS.find((d) => v.startsWith(d));
  if (v.includes('{') && !(windows && dir && !v.slice(dir.length).includes('{'))) return null;
  const rest = dir ? v.slice(dir.length) : v;
  const segments = rest.split(windows ? /[\\/]/ : '/');
  if (segments.includes('..') || segments.includes('.')) return null;
  // Windows : lecteur et chemin absolu (`C:\…`), jamais un partage réseau (`\\serveur\…`) ; ailleurs : `/…`.
  if (!dir && !(windows ? /^[A-Za-z]:[\\/]/.test(v) : v.startsWith('/'))) return null;
  if (dir && !/^[\\/]/.test(rest)) return null;
  return names.includes(programBaseName(v, windows)) ? v : null;
}

function readNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.slice(0, MAX_NAMES).filter((n): n is string => typeof n === 'string' && NAME_RE.test(n)))];
}

function readLocations(v: unknown, names: readonly string[]): PlayerLocations {
  const out: PlayerLocations = {};
  if (!isRecord(v)) return out;
  for (const [key, platform] of Object.entries(SYSTEMS) as [keyof typeof SYSTEMS, keyof PlayerLocations][]) {
    const list = Object.hasOwn(v, key) && Array.isArray(v[key]) ? (v[key] as unknown[]) : [];
    const ok = list.slice(0, MAX_LOCATIONS).flatMap((l) => checkLocation(l, key, names) ?? []);
    if (ok.length) out[platform] = ok;
  }
  return out;
}

function readOptions(v: unknown): PlayerOptions {
  const out: PlayerOptions = {};
  if (!isRecord(v)) return out;
  for (const k of Object.keys(OPTION_RES) as (keyof PlayerOptions)[]) {
    const o = Object.hasOwn(v, k) ? v[k] : undefined;
    if (typeof o === 'string' && OPTION_RES[k].test(o)) out[k] = o;
  }
  return out;
}

/** Lecteur d'une contribution `apps`, ou `null` si ce n'est pas un lecteur ou si ses données ne conviennent pas. */
export function readExternalPlayer(entry: ContributionEntry): ExternalPlayerSpec | null {
  const d = entry.data;
  if (entry.kind !== 'apps' || !isRecord(d) || d.kind !== 'player') return null;
  const names = readNames(d.names);
  if (!names.length) return null;
  const priority = typeof d.priority === 'number' && Number.isInteger(d.priority) && d.priority >= 0 && d.priority <= 100 ? d.priority : 50;
  return {
    id: `${entry.pluginId}/${entry.id}`,
    name: `${pluginTextPrefix(entry.pluginId)}apps.${entry.id}.name`,
    priority,
    names,
    locations: readLocations(d.locations, names),
    options: readOptions(d.options),
  };
}

/** Lecteurs des contributions données, dans l'ordre de préférence (priorité, puis identifiant). */
export function readExternalPlayers(entries: readonly ContributionEntry[]): ExternalPlayerSpec[] {
  return entries.flatMap((e) => readExternalPlayer(e) ?? []).sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
