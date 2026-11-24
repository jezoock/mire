// Banc de test du plugin inclus `mire.games.roms` (P5-14a) branché au cœur comme dans Mire : son code réel
// (plugins/mire.games.roms/), le contexte réel des plugins (`files.walk`, `files.readBytes`, dossiers accordés), le pont
// des sources et la lecture des jeux par le cœur (`romFolders` du service des jeux). Seul l'hôte isolé est remplacé :
// les appels passent par une copie structurée, comme sur le canal.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ContributionKind } from '@mire/plugin-sdk';
import type { Config } from '@mire/shared';
import type { Catalog } from '../../src/main/catalog/index.ts';
import { romLocations } from '../../src/main/games/roms/locations.ts';
import type { RomFolderDeps } from '../../src/main/games/roms/list.ts';
import { createContextHandler } from '../../src/main/plugins/context.ts';
import { createPluginBridges, type BridgeService } from '../../src/main/plugins/bridges.ts';
import { createPluginStorage } from '../../src/main/plugins/plugin-storage.ts';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';

export const ROMS_PLUGIN_DIR = path.join(import.meta.dirname, '..', '..', 'plugins', 'mire.games.roms');
const manifest = JSON.parse(readFileSync(path.join(ROMS_PLUGIN_DIR, 'mire-plugin.json'), 'utf8'));

type Source = Record<string, (...args: unknown[]) => unknown>;

export async function wireRomsPlugin({
  config,
  catalog,
  log = () => {},
}: {
  config: { get(): Config; onChange?(listener: () => void): unknown };
  catalog: Catalog;
  log?: (m: string) => void;
}) {
  const file = pathToFileURL(path.join(ROMS_PLUGIN_DIR, manifest.contributes.sources[0].main)).href;
  const createSource = ((await import(file)) as { default: (ctx: unknown) => Source }).default;
  let enabled = true;
  let bridges: ReturnType<typeof createPluginBridges> | undefined;
  const forPlugin = createContextHandler({
    pickFolder: async () => null,
    folders: { list: (id) => bridges?.assignedFolders(id) ?? [], add: () => {} },
    storage: () => createPluginStorage(path.join(ROMS_PLUGIN_DIR, '.aucun'), 0),
  });
  const port = forPlugin({ id: manifest.id, manifest });
  const call = (method: string, args: unknown[]) => port.handle(method, args, new AbortController().signal);
  const ctx = {
    id: manifest.id,
    version: manifest.version,
    locale: 'fr',
    files: {
      walk: (root: string, o: unknown) => call('files.walk', [root, o]),
      readBytes: (p: string) => call('files.readBytes', [p]),
      exists: (p: string) => call('files.exists', [p]),
    },
    log: { info() {}, warn() {}, error() {} },
    events: { on: () => () => {} },
  };
  const source = createSource(ctx);
  const entry: ContributionEntry = { pluginId: manifest.id, kind: 'sources', id: 'consoles', declaration: manifest.contributes.sources[0] };
  const listeners = new Set<(kinds: ContributionKind[]) => void>();
  const service: BridgeService = {
    contributions: (kind) => (enabled && kind === 'sources' ? [entry] : []),
    onContributionsChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    call: async (_id, _kind, _c, method, args = []) => structuredClone(await source[method](...structuredClone(args))),
    levelOf: () => (enabled ? manifest.level : null),
    folders: () => [],
    hosts: () => [],
    sourceRights: () => ({ trusted: true, folders: true, launch: false }),
  };
  bridges = createPluginBridges({ service, catalog, log });
  const b = bridges;
  /** Dossiers des consoles de la configuration redonnés au pont, comme à chaque changement de configuration dans Mire. */
  const syncLocations = () => b.setLocations(romLocations(config.get().emulators));
  await syncLocations();
  config.onChange?.(() => void syncLocations());
  const romFolders: RomFolderDeps = { rescan: (keys) => b.rescanLocations(keys), claimed: (k) => b.claimed(k), catalog };
  return {
    bridges: b,
    romFolders,
    syncLocations,
    /** Active ou désactive le plugin, comme le service des plugins : le pont suit. */
    async setEnabled(value: boolean) {
      enabled = value;
      for (const l of listeners) l(['sources']);
      await b.idle();
    },
  };
}
