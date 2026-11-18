/**
 * Stockage d'un plugin (`ctx.storage`, P3-04) : des valeurs JSON rangées par clé, dans
 * `userData/plugin-data/<id>/storage.json`. Conventions de `storage/json-store.ts` : lecture tolérante (un fichier
 * illisible est mis de côté), écriture atomique, différée et regroupée ; `flush()` à la fermeture de Mire.
 *
 * Bornes : clé de 1 à 200 caractères ; 1 000 clés ; 8 Mio pour l'ensemble (en JSON).
 */
import path from 'node:path';
import { createJsonStore, type JsonStore } from '../storage/json-store.ts';
import { CHANNEL_ERRORS, ChannelError } from './channel.ts';

export const STORAGE_VERSION = 1;
export const STORAGE_LIMITS = Object.freeze({ key: 200, keys: 1000, bytes: 8 * 1024 * 1024 });

interface StorageFile {
  version: number;
  values: Record<string, unknown>;
}

export interface PluginStorage {
  get(key: unknown): unknown;
  set(key: unknown, value: unknown): void;
  delete(key: unknown): void;
  keys(): string[];
  flush(): Promise<void>;
}

/** Dossier de données d'un plugin ; l'identifiant (déjà vérifié par le manifeste) ne peut pas en sortir. */
export function pluginDataDir(root: string, id: string): string {
  if (!id || id !== path.basename(id) || id.startsWith('.')) throw new Error(`Invalid plugin id: ${id}`);
  return path.join(root, id);
}

const checkKey = (key: unknown): string => {
  if (typeof key !== 'string' || !key || key.length > STORAGE_LIMITS.key)
    throw new ChannelError(CHANNEL_ERRORS.plugin, `Storage keys are strings of 1 to ${STORAGE_LIMITS.key} characters.`);
  return key;
};

export function createPluginStorage(dir: string, debounceMs = 500): PluginStorage {
  let store: JsonStore<StorageFile> | null = null;
  let values: Map<string, unknown> | null = null;

  function open(): Map<string, unknown> {
    if (values) return values;
    store = createJsonStore<StorageFile>(path.join(dir, 'storage.json'), {
      defaults: () => ({ version: STORAGE_VERSION, values: {} }),
      debounceMs,
      setAside: true,
      onCorrupt: (err, f, kept) => console.error(`Plugins : ${f} illisible (${err.message})${kept ? `, mis de côté dans ${kept}` : ''}.`),
      onError: (err, f) => console.error(`Plugins : écriture de ${f} impossible (${err.message}).`),
    });
    const raw = store.load().values;
    values = new Map(raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.entries(raw) : []);
    return values;
  }

  function save(next: Map<string, unknown>): void {
    const file: StorageFile = { version: STORAGE_VERSION, values: Object.fromEntries(next) };
    if (Buffer.byteLength(JSON.stringify(file)) > STORAGE_LIMITS.bytes)
      throw new ChannelError(CHANNEL_ERRORS.tooLarge, `Plugin storage is limited to ${STORAGE_LIMITS.bytes} bytes.`);
    values = next;
    store!.set(file);
  }

  return {
    get(key) {
      const v = open().get(checkKey(key));
      return v === undefined ? undefined : structuredClone(v);
    },
    set(key, value) {
      const k = checkKey(key);
      const current = open();
      if (!current.has(k) && current.size >= STORAGE_LIMITS.keys) throw new ChannelError(CHANNEL_ERRORS.tooLarge, `At most ${STORAGE_LIMITS.keys} storage keys.`);
      // Seulement des données JSON : ce qui ne s'y écrit pas est refusé ; `undefined` vaut suppression.
      let copy: unknown;
      try {
        const text = JSON.stringify(value);
        copy = text === undefined ? undefined : JSON.parse(text);
      } catch {
        throw new ChannelError(CHANNEL_ERRORS.plugin, 'Storage values must be JSON data.');
      }
      const next = new Map(current);
      if (copy === undefined) next.delete(k);
      else next.set(k, copy);
      save(next);
    },
    delete(key) {
      const k = checkKey(key);
      const current = open();
      if (!current.has(k)) return;
      const next = new Map(current);
      next.delete(k);
      save(next);
    },
    keys: () => [...open().keys()],
    flush: () => store?.flush() ?? Promise.resolve(),
  };
}
