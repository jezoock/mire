/**
 * État des plugins, mémorisé dans `userData/plugins/state.json` : activé ou non, et la dernière erreur qui a fait
 * désactiver un plugin (gardée pour le futur Centre, P4-18), et les dossiers que l'utilisateur lui a accordés
 * (`ctx.files`, P3-04 : mémorisés ici, hors de portée du plugin). Un fichier de données versionné, comme ceux du
 * catalogue : lecture tolérante (un fichier illisible est mis de côté), écriture atomique. Les réglages des plugins
 * iront, eux, dans la configuration sous `plugins.<id>` (P3-04).
 *
 * Un plugin absent de l'état est activé : le poser dans `userData/plugins` (ou l'installer, P3-07) vaut accord.
 */
import path from 'node:path';
import { createJsonStore } from '../storage/json-store.ts';

export const PLUGIN_STATE_VERSION = 1;

/** Panne : exception du plugin, délai dépassé (requête ou chien de garde), hôte planté, chargement impossible. */
export type FaultCode = 'exception' | 'timeout' | 'crashed' | 'load';

/** Erreur qui a fait désactiver un plugin : code stable, message affiché (langue du moment), date. */
export interface PluginFault {
  code: FaultCode;
  message: string;
  at: number;
}

export interface PluginStateEntry {
  enabled: boolean;
  fault?: PluginFault;
  /** Dossiers accordés par l'utilisateur (chemins absolus). */
  folders?: string[];
}

export interface PluginStateFile {
  version: number;
  plugins: Record<string, PluginStateEntry>;
}

const FAULT_CODES = new Set<FaultCode>(['exception', 'timeout', 'crashed', 'load']);

/** Ne garde que des entrées bien formées (fichier modifié à la main, version future). */
export function normalizeState(raw: unknown): PluginStateFile {
  const out: PluginStateFile = { version: PLUGIN_STATE_VERSION, plugins: {} };
  const plugins = (raw as { plugins?: unknown })?.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return out;
  for (const [id, v] of Object.entries(plugins as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || typeof (v as PluginStateEntry).enabled !== 'boolean') continue;
    const entry: PluginStateEntry = { enabled: (v as PluginStateEntry).enabled };
    const f = (v as PluginStateEntry).fault;
    if (f && FAULT_CODES.has(f.code) && typeof f.message === 'string' && Number.isFinite(f.at)) entry.fault = { code: f.code, message: f.message, at: f.at };
    const folders = (v as PluginStateEntry).folders;
    if (Array.isArray(folders)) {
      const kept = folders.filter((d): d is string => typeof d === 'string' && path.isAbsolute(d));
      if (kept.length) entry.folders = [...new Set(kept)];
    }
    out.plugins[id] = entry;
  }
  return out;
}

export function createPluginState(file: string) {
  const store = createJsonStore<PluginStateFile>(file, {
    defaults: { version: PLUGIN_STATE_VERSION, plugins: {} },
    setAside: true,
    space: 2,
    onCorrupt: (err, f, kept) => console.error(`Plugins : ${f} illisible (${err.message})${kept ? `, mis de côté dans ${kept}` : ''}.`),
  });
  let state: PluginStateFile = store.get();
  const folders = (id: string) => (state.plugins[id]?.folders?.length ? { folders: [...state.plugins[id].folders!] } : {});

  return {
    load(): void {
      state = normalizeState(store.load());
    },
    get: (id: string): PluginStateEntry => state.plugins[id] ?? { enabled: true },
    /** Active ou désactive à la demande : l'erreur éventuelle est oubliée. */
    setEnabled(id: string, enabled: boolean): void {
      state.plugins[id] = { enabled, ...folders(id) };
      store.set(state);
    },
    /** Désactivé par une erreur : gardée avec lui. */
    setFault(id: string, fault: PluginFault): void {
      state.plugins[id] = { enabled: false, fault, ...folders(id) };
      store.set(state);
    },
    /** Dossiers accordés à un plugin. */
    folders: (id: string): string[] => [...(state.plugins[id]?.folders ?? [])],
    /** Accorde un dossier à un plugin (mémorisé). */
    addFolder(id: string, dir: string): void {
      if (!path.isAbsolute(dir)) return;
      const entry = state.plugins[id] ?? { enabled: true };
      const list = entry.folders ?? [];
      if (list.includes(dir)) return;
      state.plugins[id] = { ...entry, folders: [...list, dir] };
      store.set(state);
    },
    /** Retire l'accord d'un dossier. */
    removeFolder(id: string, dir: string): void {
      const entry = state.plugins[id];
      if (!entry?.folders?.includes(dir)) return;
      const list = entry.folders.filter((d) => d !== dir);
      state.plugins[id] = { enabled: entry.enabled, ...(entry.fault ? { fault: entry.fault } : {}), ...(list.length ? { folders: list } : {}) };
      store.set(state);
    },
    flush: () => store.flush(),
  };
}

export type PluginState = ReturnType<typeof createPluginState>;
