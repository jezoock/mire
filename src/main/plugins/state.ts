/**
 * État des plugins, mémorisé dans `userData/plugins/state.json` : activé ou non, et la dernière erreur qui a fait
 * désactiver un plugin (gardée pour le futur Centre, P4-18). Un fichier de données versionné, comme ceux du
 * catalogue : lecture tolérante (un fichier illisible est mis de côté), écriture atomique. Les réglages des plugins
 * iront, eux, dans la configuration sous `plugins.<id>` (P3-04).
 *
 * Un plugin absent de l'état est activé : le poser dans `userData/plugins` (ou l'installer, P3-07) vaut accord.
 */
import { createJsonStore } from '../storage/json-store.ts';

export const PLUGIN_STATE_VERSION = 1;

/** Erreur qui a fait désactiver un plugin : code stable, message affiché (langue du moment), date. */
export interface PluginFault {
  code: 'exception' | 'timeout' | 'crashed' | 'load';
  message: string;
  at: number;
}

export interface PluginStateEntry {
  enabled: boolean;
  fault?: PluginFault;
}

export interface PluginStateFile {
  version: number;
  plugins: Record<string, PluginStateEntry>;
}

const FAULT_CODES = new Set<PluginFault['code']>(['exception', 'timeout', 'crashed', 'load']);

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

  return {
    load(): void {
      state = normalizeState(store.load());
    },
    get: (id: string): PluginStateEntry => state.plugins[id] ?? { enabled: true },
    /** Active ou désactive à la demande : l'erreur éventuelle est oubliée. */
    setEnabled(id: string, enabled: boolean): void {
      state.plugins[id] = { enabled };
      store.set(state);
    },
    /** Désactivé par une erreur : gardée avec lui. */
    setFault(id: string, fault: PluginFault): void {
      state.plugins[id] = { enabled: false, fault };
      store.set(state);
    },
    flush: () => store.flush(),
  };
}

export type PluginState = ReturnType<typeof createPluginState>;
