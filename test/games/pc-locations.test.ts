// Dossiers de jeux PC proposés aux sources des plugins (P5-13, extension du socle de P5-11a) : type `game`, clé
// distincte de celle d'un dossier de la bibliothèque au même chemin, mêmes règles (confiance, `folders`), accord
// dérivé de la configuration, plugin désactivé puis réactivé.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElementSourceRef } from '@mire/shared';
import type { SourceLocation } from '@mire/plugin-sdk';
import { createPluginBridges, type BridgeService } from '../../src/main/plugins/bridges.ts';
import { pcGameKey } from '../../src/main/catalog/keys.ts';
import { gameLocationKey, gameLocations } from '../../src/main/games/pc/locations.ts';
import { libraryLocations } from '../../src/main/library/locations.ts';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';
import type { PluginLevel } from '@mire/plugin-sdk';

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'mire-jeux-pc-')));
after(() => rmSync(root, { recursive: true, force: true }));
const jeux = path.join(root, 'Jeux');
mkdirSync(path.join(jeux, 'Celeste'), { recursive: true });
writeFileSync(path.join(jeux, 'Celeste', 'Celeste.exe'), 'jeu');

const P = 'mire.games.test';

/** Source factice de jeux PC : n'accepte que les dossiers de type `game`, rend un programme par dossier. */
function fakeService(opts: { trusted?: boolean; folders?: boolean; launch?: boolean; level?: PluginLevel } = {}) {
  const listeners: Array<(k: string[]) => void> = [];
  const entry: ContributionEntry = { pluginId: P, kind: 'sources', id: 'dossiers', declaration: {} };
  let entries = [entry];
  const calls: Array<[string, SourceLocation | null]> = [];
  const service: BridgeService = {
    contributions: (kind) => (kind === 'sources' ? entries : []),
    onContributionsChange: (l) => (listeners.push(l as never), () => {}),
    call: async (_id, _kind, _c, method, args) => {
      const location = (args?.[0] ?? null) as SourceLocation | null;
      calls.push([method, location]);
      if (method === 'handles') return !!location?.path && location.kinds.includes('game');
      if (!location?.path) return [];
      const exe = path.join(location.path, 'Celeste', 'Celeste.exe');
      return [{ key: pcGameKey(exe), name: 'Celeste', open: { kind: 'program', path: exe, args: ['--libre'] } }];
    },
    levelOf: (id) => (entries.some((e) => e.pluginId === id) ? (opts.level ?? 'privileged') : null),
    folders: () => [],
    hosts: () => [],
    sourceRights: () => ({ trusted: opts.trusted ?? true, folders: opts.folders ?? true, launch: opts.launch ?? true }),
  };
  const set = (list: ContributionEntry[]) => {
    entries = list;
    for (const l of listeners) l(['sources']);
  };
  return { service, calls, enable: () => set([entry]), disable: () => set([]) };
}

function fakeCatalog() {
  const sources = new Map<string, Array<{ key: string; open: { kind: string } }>>();
  const id = (ref: ElementSourceRef) => `${ref.plugin}|${ref.instance}`;
  return {
    sources,
    setSource: (ref: ElementSourceRef, els: Iterable<unknown>) => void sources.set(id(ref), [...els] as never),
    removeSource: (ref: ElementSourceRef) => void sources.delete(id(ref)),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('gameLocations : dossiers de jeux PC proposés aux sources', () => {
  it('un emplacement `game` par dossier absolu, sans doublon ni adresse', () => {
    const list = gameLocations([
      { id: 'a', location: jeux },
      { id: 'b', location: `${jeux}/` },
      { id: 'c', location: 'relatif/jeux' },
      { id: 'd', location: 'https://exemple.org/jeux/' },
    ]);
    assert.deepEqual(list, [{ key: gameLocationKey(jeux), location: { location: jeux, path: jeux, network: false, kinds: ['game'] } }]);
  });

  it('partage réseau Windows : chemin UNC, marqué réseau', () => {
    const [l] = gameLocations([{ id: 'a', location: '\\\\NAS\\Jeux' }], 'win32');
    assert.equal(l.location.network, true);
    assert.equal(l.key, 'game:\\\\nas\\jeux'.replace(/\\/g, '/'));
  });

  it('un dossier à la fois dans la bibliothèque et dans les jeux : deux emplacements distincts', () => {
    const lib = libraryLocations([{ id: 'v', kind: 'video', location: jeux }]);
    assert.notEqual(lib[0].key, gameLocations([{ id: 'g', location: jeux }])[0].key);
  });
});

describe('sources des plugins : dossiers de jeux PC', () => {
  const locations = [...libraryLocations([{ id: 'v', kind: 'video', location: root }]), ...gameLocations([{ id: 'g', location: jeux }])];
  const key = gameLocationKey(jeux);

  it('seul le dossier de jeux est pris, accordé et analysé ; les programmes passent pour un plugin `privileged`', async () => {
    const { service, calls } = fakeService();
    const catalog = fakeCatalog();
    const b = createPluginBridges({ service, catalog, log: () => {} });
    await b.setLocations(locations);
    assert.deepEqual(
      calls.filter(([m]) => m === 'scan').map(([, l]) => l?.path),
      [jeux],
    );
    assert.ok(b.claimed(key));
    assert.deepEqual(b.assignedFolders(P), [jeux]);
    const els = catalog.sources.get(`${P}|${key}`) ?? assert.fail([...catalog.sources.keys()].join(' ; '));
    assert.deepEqual(
      els.map((e) => [e.key, e.open.kind]),
      [[pcGameKey(path.join(jeux, 'Celeste', 'Celeste.exe')), 'program']],
    );
  });

  it('un plugin `code` ne peut pas rendre de programme', async () => {
    const { service } = fakeService({ level: 'code' });
    const catalog = fakeCatalog();
    const b = createPluginBridges({ service, catalog, log: () => {} });
    await b.setLocations(locations);
    assert.deepEqual(catalog.sources.get(`${P}|${key}`), []);
  });

  it('un plugin `privileged` qui ne déclare pas `launch` ne peut pas rendre de programme', async () => {
    const { service } = fakeService({ launch: false });
    const catalog = fakeCatalog();
    const b = createPluginBridges({ service, catalog, log: () => {} });
    await b.setLocations(locations);
    assert.ok(b.claimed(key));
    assert.deepEqual(catalog.sources.get(`${P}|${key}`), []);
  });

  it('plugin tiers, ou sans `folders` : aucun dossier de jeux proposé', async () => {
    for (const rights of [{ trusted: false }, { folders: false }]) {
      const { service, calls } = fakeService(rights);
      const b = createPluginBridges({ service, catalog: fakeCatalog(), log: () => {} });
      await b.setLocations(locations);
      assert.ok(!calls.some(([m, l]) => m === 'handles' && l?.path), JSON.stringify(rights));
      assert.equal(b.claimed(key), false);
    }
  });

  it('dossier retiré, plugin désactivé puis réactivé : ses jeux partent et reviennent, sans erreur', async () => {
    const { service, enable, disable } = fakeService();
    const catalog = fakeCatalog();
    const logs: string[] = [];
    const b = createPluginBridges({ service, catalog, log: (m) => logs.push(m) });
    await b.setLocations(locations);
    disable();
    await settle();
    assert.equal(catalog.sources.size, 0);
    assert.deepEqual(b.assignedFolders(P), []);
    enable();
    await settle();
    assert.equal(catalog.sources.get(`${P}|${key}`)?.length, 1);
    await b.setLocations(locations.filter((l) => l.key !== key));
    assert.equal(catalog.sources.has(`${P}|${key}`), false);
    assert.deepEqual(logs, []);
  });
});
