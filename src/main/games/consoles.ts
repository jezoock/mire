/**
 * Consoles créées à la main et émulateur choisi (P4-17, D-21). Fonctions pures sur la liste des consoles de la
 * configuration : la page ne la modifie plus elle-même, elle passe par ces règles (IPC `console*` et `gameEmulator*`).
 *
 * Émulateur d'une console : quand plusieurs consoles du même système existent (deux émulateurs installés pour la
 * PlayStation, ou une console ajoutée à la main à côté d'une console de la boutique), chacune peut lancer ses jeux
 * avec l'émulateur d'une autre (`emulator`), et un jeu peut avoir le sien (`gameEmulators`, par clé d'élément).
 * L'émulateur d'une console, ce sont son programme et ses arguments : ceux d'une console de RetroArch désignent
 * le bon cœur pour ce système.
 */
import path from 'node:path';
import { guessSystem } from '@mire/shared';
import type { Emulator } from '@mire/shared';
import type { ConsoleInput, EmulatorChoice } from '@mire/shared/ipc';
import { newConsoleId } from '../config/normalize/consoles.ts';
import { EMULATORS } from '../store/catalog/index.ts';

export type { ConsoleInput, EmulatorChoice };

/** Raison d'un refus ; chacune a son message dans les catalogues (`games.consoles.errors.*`). */
export type ConsoleError = 'name' | 'path' | 'gone' | 'emulator';

export type ConsoleResult = { ok: true; emulators: Emulator[]; id: string } | { ok: false; code: ConsoleError };

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);

/** Extensions écrites `.sfc` en minuscules, sans doublon. */
const extensionsOf = (v: unknown): string[] => [...new Set(texts(v).map((x) => (x.startsWith('.') ? x : `.${x}`).toLowerCase()))];

/** Nom de l'émulateur d'une console : celui de la boutique, sinon le nom du programme sans son extension. */
export function emulatorName(emu: Pick<Emulator, 'path' | 'store'>): string {
  const storeId = String(emu.store || '').split(':')[0];
  const known = storeId ? EMULATORS.find((e) => e.id === storeId) : undefined;
  if (known) return known.name;
  const base =
    String(emu.path || '')
      .split(/[\\/]/)
      .pop() || '';
  return base.replace(/\.(exe|appimage|app|sh|bat|cmd)$/i, '') || base;
}

/** Système d'une console pour comparer deux consoles (vide si inconnu : la console n'est comparée qu'à elle-même). */
const systemOf = (emu: Emulator): string => guessSystem(emu);

/** Émulateurs proposés pour une console : le sien d'abord, puis ceux des consoles du même système. */
export function emulatorChoices(emulators: readonly Emulator[], consoleId: unknown): EmulatorChoice[] {
  const own = emulators.find((e) => e.id === consoleId);
  if (!own) return [];
  const sys = systemOf(own);
  const others = sys ? emulators.filter((e) => e !== own && systemOf(e) === sys) : [];
  return [own, ...others].map((e) => ({ id: e.id, emulator: emulatorName(e), console: String(e.name || '') }));
}

/**
 * Console dont l'émulateur lance un jeu : celle demandée pour ce lancement, sinon celle choisie pour le jeu, sinon
 * celle choisie pour la console, sinon la console elle-même. Un choix qui ne fait plus partie des propositions
 * (console supprimée, système changé) est ignoré.
 */
export function launcherOf(emulators: readonly Emulator[], consoleId: unknown, opts: { key?: string; emulator?: unknown } = {}): Emulator | null {
  const own = emulators.find((e) => e.id === consoleId);
  if (!own) return null;
  const allowed = new Set(emulatorChoices(emulators, consoleId).map((c) => c.id));
  const perGame = opts.key ? own.gameEmulators?.[opts.key] : undefined;
  for (const wanted of [opts.emulator, perGame, own.emulator]) {
    if (typeof wanted === 'string' && allowed.has(wanted)) return emulators.find((e) => e.id === wanted) ?? own;
  }
  return own;
}

/** Crée une console (sans `id`) ou modifie la console `id` ; le reste de sa fiche (bannière, boutique…) est gardé. */
export function saveConsole(emulators: readonly Emulator[], input: ConsoleInput, id?: string): ConsoleResult {
  const name = text(input?.name);
  const exe = text(input?.path);
  if (!name) return { ok: false, code: 'name' };
  if (!exe) return { ok: false, code: 'path' };
  const at = id == null ? -1 : emulators.findIndex((e) => e.id === id);
  if (id != null && at < 0) return { ok: false, code: 'gone' };
  const base: Emulator = at >= 0 ? { ...emulators[at] } : ({ id: '', sources: [] } as unknown as Emulator);
  const next: Emulator = {
    ...base,
    name,
    path: exe,
    args: texts(input.args).length ? texts(input.args) : ['{rom}'],
    romsDir: text(input.romsDir),
    sources: texts(input.sources),
    extensions: extensionsOf(input.extensions),
    system: text(input.system),
  };
  if (Array.isArray(input.romSites)) next.romSites = input.romSites;
  else if (input.romSites === null) delete next.romSites;
  const out = [...emulators];
  if (at >= 0) out[at] = next;
  else {
    next.id = newConsoleId(next, new Set(emulators.map((e) => e.id)));
    out.push(next);
  }
  // Un changement de système peut rendre caducs des choix d'émulateur : on les retire partout.
  return { ok: true, emulators: pruneChoices(out), id: next.id };
}

/** Retire une console, et les choix d'émulateur qui la désignaient. */
export function removeConsole(emulators: readonly Emulator[], id: string): ConsoleResult {
  if (!emulators.some((e) => e.id === id)) return { ok: false, code: 'gone' };
  return { ok: true, emulators: pruneChoices(emulators.filter((e) => e.id !== id)), id };
}

/** Émulateur par défaut d'une console : celui d'une console proposée, ou `null` pour le sien. */
export function setConsoleEmulator(emulators: readonly Emulator[], id: string, emulator: string | null): ConsoleResult {
  return withChoice(emulators, id, emulator, (e, value) => {
    if (value) e.emulator = value;
    else delete e.emulator;
  });
}

/** Émulateur d'un jeu (désigné par sa clé) : celui d'une console proposée, ou `null` pour celui de la console. */
export function setGameEmulator(emulators: readonly Emulator[], id: string, key: string, emulator: string | null): ConsoleResult {
  if (!text(key)) return { ok: false, code: 'gone' };
  return withChoice(emulators, id, emulator, (e, value) => {
    const map = { ...(e.gameEmulators || {}) };
    if (value) map[key] = value;
    else delete map[key];
    if (Object.keys(map).length) e.gameEmulators = map;
    else delete e.gameEmulators;
  });
}

function withChoice(emulators: readonly Emulator[], id: string, emulator: string | null, apply: (e: Emulator, value: string | null) => void): ConsoleResult {
  const at = emulators.findIndex((e) => e.id === id);
  if (at < 0) return { ok: false, code: 'gone' };
  // Choisir la console elle-même revient à ne rien choisir.
  const value = emulator && emulator !== id ? emulator : null;
  if (value && !emulatorChoices(emulators, id).some((c) => c.id === value)) return { ok: false, code: 'emulator' };
  const out = [...emulators];
  out[at] = { ...out[at] };
  apply(out[at], value);
  return { ok: true, emulators: out, id };
}

/** Retire les choix d'émulateur qui ne font plus partie des propositions. */
function pruneChoices(emulators: readonly Emulator[]): Emulator[] {
  return emulators.map((e) => {
    const allowed = new Set(emulatorChoices(emulators, e.id).map((c) => c.id));
    const keep = (v: unknown) => typeof v === 'string' && v !== e.id && allowed.has(v);
    const games = Object.fromEntries(Object.entries(e.gameEmulators || {}).filter(([, v]) => keep(v)));
    const changed = (e.emulator != null && !keep(e.emulator)) || Object.keys(games).length !== Object.keys(e.gameEmulators || {}).length;
    if (!changed) return e;
    const out = { ...e };
    if (!keep(out.emulator)) delete out.emulator;
    if (Object.keys(games).length) out.gameEmulators = games;
    else delete out.gameEmulators;
    return out;
  });
}

/** Le dossier de travail d'un émulateur : celui de son programme (chemin absolu seulement). */
export const workingDir = (exe: string): string | undefined => (path.isAbsolute(exe) ? path.dirname(exe) : undefined);
