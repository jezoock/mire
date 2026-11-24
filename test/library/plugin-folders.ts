// Banc de test du plugin inclus `mire.source.local` (P5-11c) branché au cœur comme dans Mire : son code réel
// (plugins/mire.source.local/), le contexte réel des plugins (`files.walk`, `files.exists`, dossiers accordés), le pont
// des sources et la bibliothèque du cœur. Seul l'hôte isolé est remplacé : les appels passent par une copie
// structurée, comme sur le canal.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Config } from '@mire/shared';
import type { Catalog } from '../../src/main/catalog/index.ts';
import { createContextHandler } from '../../src/main/plugins/context.ts';
import { createPluginBridges, type BridgeService } from '../../src/main/plugins/bridges.ts';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';
import { libraryLocations } from '../../src/main/library/locations.ts';
import { createLibraryService } from '../../src/main/library/service.ts';
import { createPluginStorage } from '../../src/main/plugins/plugin-storage.ts';
import type { ContributionKind } from '@mire/plugin-sdk';

export const PLUGIN_DIR = path.join(import.meta.dirname, '..', '..', 'plugins', 'mire.source.local');
const manifest = JSON.parse(readFileSync(path.join(PLUGIN_DIR, 'mire-plugin.json'), 'utf8'));

type Source = Record<string, (...args: unknown[]) => unknown>;

/** Fabrique de la source du plugin (`src/source.mjs`). */
export async function loadSource(): Promise<(ctx: unknown) => Source> {
  const file = pathToFileURL(path.join(PLUGIN_DIR, manifest.contributes.sources[0].main)).href;
  return ((await import(file)) as { default: (ctx: unknown) => Source }).default;
}

export interface WireOptions {
  config: { get(): Config };
  catalog: Catalog;
  /** Journal du pont (éléments écartés, analyses en échec). */
  log?: (m: string) => void;
}

export async function wireLocalPlugin({ config, catalog, log = () => {} }: WireOptions) {
  const createSource = await loadSource();
  let enabled = true;
  let bridges: ReturnType<typeof createPluginBridges> | undefined;
  const forPlugin = createContextHandler({
    pickFolder: async () => null,
    folders: { list: (id) => bridges?.assignedFolders(id) ?? [], add: () => {} },
    storage: () => createPluginStorage(path.join(PLUGIN_DIR, '.aucun'), 0),
  });
  const port = forPlugin({ id: manifest.id, manifest });
  const call = (method: string, args: unknown[]) => port.handle(method, args, new AbortController().signal);
  const ctx = {
    id: manifest.id,
    version: manifest.version,
    locale: 'fr',
    files: { exists: (p: string) => call('files.exists', [p]), walk: (root: string, o: unknown) => call('files.walk', [root, o]) },
    log: { info() {}, warn() {}, error() {} },
    events: { on: () => () => {} },
  };
  const source = createSource(ctx);
  const entry: ContributionEntry = { pluginId: manifest.id, kind: 'sources', id: 'src-local', declaration: manifest.contributes.sources[0] };
  const listeners = new Set<(kinds: ContributionKind[]) => void>();
  const service: BridgeService = {
    contributions: (kind) => (enabled && kind === 'sources' ? [entry] : []),
    onContributionsChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    call: async (_id, _kind, _c, method, args = []) => structuredClone(await source[method](...structuredClone(args))),
    levelOf: () => (enabled ? 'code' : null),
    folders: () => [],
    hosts: () => [],
    sourceRights: () => ({ trusted: true, folders: true }),
  };
  bridges = createPluginBridges({ service, catalog, log });
  const b = bridges;
  const library = createLibraryService({
    config,
    access: { allowFile: () => {}, isAllowed: () => true },
    catalog,
    claimed: (k) => b.claimed(k),
    pluginScans: () => b.rescan(),
  });
  /** Emplacements de la configuration redonnés au pont, comme à chaque changement de configuration dans Mire. */
  const syncLocations = () => b.setLocations(libraryLocations(config.get().library.sources));
  await syncLocations();
  return {
    library,
    bridges: b,
    syncLocations,
    /** Active ou désactive le plugin, comme le service des plugins : le pont suit. */
    async setEnabled(value: boolean) {
      enabled = value;
      for (const l of listeners) l(['sources']);
      await b.idle();
      await b.rescan();
    },
  };
}
