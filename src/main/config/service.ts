/**
 * Service de configuration : seul détenteur de la configuration du processus principal.
 * - `load()` lit `config.json`, le migre et le normalise ; un fichier absent est créé avec les valeurs par défaut,
 *   un fichier illisible est mis de côté (`config.json.illisible-<date>`) avant d'être remplacé par elles.
 * - `update(mutateur)` et `replace(config)` normalisent, enregistrent (écriture atomique), puis préviennent
 *   les abonnés de `onChange`, une fois par modification. La lecture au démarrage ne les prévient pas.
 * - `get()` rend la configuration courante : elle ne se modifie pas sur place (passer par `update`).
 */
import fs from 'node:fs';
import type { Config } from '@mire/shared';
import { createJsonStore, readJsonFile } from '../storage/json-store.ts';
import { DEFAULT_CONFIG } from './defaults.ts';
import { migrate } from './migrations/index.ts';
import { normalizeConfig } from './normalize/index.ts';

export type ConfigListener = (next: Config, previous: Config) => void;
/** Modifie la copie reçue sur place, ou rend la configuration suivante. */
export type ConfigMutator = (draft: Config) => Config | void;

export interface ConfigServiceOptions {
  /** Chemin de `config.json` (`dataPaths(...).config`). */
  file: string;
  /** Message d'erreur (fichier illisible, abonné en échec) ; `console.error` par défaut. */
  log?: (message: string) => void;
  /** Horloge du nom du fichier mis de côté (tests). */
  now?: () => number;
}

export interface ConfigService {
  readonly file: string;
  load(): Config;
  get(): Config;
  update(mutator: ConfigMutator): Config;
  replace(next: unknown): Config;
  /** Abonnement aux modifications ; rend la fonction de désabonnement. */
  onChange(listener: ConfigListener): () => void;
}

export function createConfigService({ file, log = (m) => console.error(m), now = Date.now }: ConfigServiceOptions): ConfigService {
  // Écriture immédiate et indentée, comme l'ancien `saveConfig` : le fichier se lit et s'édite à la main.
  const store = createJsonStore<Config>(file, { defaults: () => normalizeConfig(DEFAULT_CONFIG), space: 2 });
  const listeners = new Set<ConfigListener>();
  let current = normalizeConfig(DEFAULT_CONFIG);

  function write(next: Config): Config {
    store.set(next);
    current = next;
    return next;
  }

  function commit(next: Config): Config {
    const previous = current;
    write(next);
    for (const listener of listeners) {
      try {
        listener(next, previous);
      } catch (err) {
        log(`Abonné à la configuration en échec : ${(err as Error).message}`);
      }
    }
    return next;
  }

  // Fichier abîmé : on le garde de côté au lieu de l'écraser.
  function setAside(err: Error): void {
    try {
      fs.copyFileSync(file, `${file}.illisible-${now()}`);
    } catch {
      /* rien */
    }
    log(`config.json illisible : ${err.message}`);
  }

  // Lecture, migration et normalisation ; `null` : fichier absent ou illisible (mis de côté).
  function read(): { config: Config; changed: boolean } | null {
    try {
      const raw = readJsonFile(file);
      if (!raw) return null;
      const { config, changed } = migrate(raw);
      return { config: normalizeConfig(config), changed };
    } catch (err) {
      setAside(err as Error);
      return null;
    }
  }

  function load(): Config {
    const found = read();
    if (!found) return write(normalizeConfig(DEFAULT_CONFIG));
    // Une configuration migrée est réenregistrée tout de suite, au nouveau format.
    if (found.changed) return write(found.config);
    current = found.config;
    return current;
  }

  return {
    file,
    load,
    get: () => current,
    update(mutator) {
      const draft = structuredClone(current);
      return commit(normalizeConfig(mutator(draft) ?? draft));
    },
    replace: (next) => commit(normalizeConfig(next)),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
