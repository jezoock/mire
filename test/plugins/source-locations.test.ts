// Sources de fichiers des plugins (P5-11a) : emplacements de la bibliothèque passés à une source factice, dossiers
// accordés tant qu'ils restent dans la configuration, clés `local:` et images locales vérifiées (chemin écrit puis
// chemin réel), plugin désactivé puis réactivé, emplacement pris au cœur.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElementSourceRef } from '@mire/shared';
import type { SourceLocation } from '@mire/plugin-sdk';
import { checkElements, createPluginBridges, keepReal, type BridgeService } from '../../src/main/plugins/bridges.ts';
import { localFileKey } from '../../src/main/catalog/keys.ts';
import { libraryLocations } from '../../src/main/library/locations.ts';
import { createLibraryService } from '../../src/main/library/service.ts';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'mire-sources-')));
after(() => rmSync(root, { recursive: true, force: true }));

const films = path.join(root, 'Films');
const outside = path.join(root, 'Prive');
mkdirSync(films, { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(path.join(films, 'Alien.mkv'), 'film');
writeFileSync(path.join(films, 'Alien.jpg'), 'affiche');
writeFileSync(path.join(outside, 'secret.mkv'), 'non');
symlinkSync(path.join(outside, 'secret.mkv'), path.join(films, 'lien.mkv'));
symlinkSync(path.join(outside, 'secret.mkv'), path.join(films, 'lien.jpg'));

const P = 'mire.source.test';
const fileOf = (file: string, extra: object = {}) => ({ key: localFileKey(file), name: path.basename(file), open: { kind: 'file', path: file }, ...extra });

describe('checkElements et keepReal : fichiers locaux d’un plugin de code', () => {
  it('garde la clé `local:` du fichier vérifié, préfixe toute autre clé', () => {
    const alien = path.join(films, 'Alien.mkv');
    const raw = [
      fileOf(alien),
      { ...fileOf(alien), key: localFileKey(path.join(films, 'Autre.mkv')) },
      { ...fileOf(path.join(outside, 'secret.mkv')) },
      { key: 'radio', name: 'Radio', open: { kind: 'stream', url: 'https://r.exemple.org/flux' } },
    ];
    const r = checkElements(P, 'code', [films], raw);
    assert.deepEqual(
      r.elements.map((e) => e.key),
      [localFileKey(alien), `plugin:${P}|${localFileKey(path.join(films, 'Autre.mkv'))}`, `plugin:${P}|radio`],
    );
    assert.equal(r.dropped, 1);
  });

  it('accepte une image locale d’un dossier accordé, pas une autre', () => {
    const raw = [
      fileOf(path.join(films, 'Alien.mkv'), {
        images: { poster: path.join(films, 'Alien.jpg'), background: path.join(outside, 'x.jpg'), logo: 'file:///etc/passwd' },
      }),
    ];
    assert.deepEqual(checkElements(P, 'code', [films], raw).elements[0].images, { poster: path.join(films, 'Alien.jpg') });
    assert.deepEqual(Object.keys(checkElements(P, 'privileged', [], raw).elements[0].images).sort(), ['background', 'poster']);
  });

  it('écarte, sur le chemin réel, un fichier ou une image qui mène hors des dossiers accordés', async () => {
    const written = checkElements(
      P,
      'code',
      [films],
      [
        fileOf(path.join(films, 'Alien.mkv'), { images: { poster: path.join(films, 'lien.jpg') } }),
        fileOf(path.join(films, 'lien.mkv')),
        fileOf(path.join(films, 'disparu.mkv')),
      ],
    );
    assert.equal(written.elements.length, 3);
    const real = await keepReal(written.elements, 'code', [films]);
    assert.deepEqual(
      real.elements.map((e) => [e.name, e.images]),
      [['Alien.mkv', {}]],
    );
    assert.equal(real.dropped, 2);
    assert.equal((await keepReal(written.elements, 'privileged', [])).elements.length, 3);
  });
});

/** Service de plugins factice : une source de dossiers (`mire.source.test`) et ce qu'elle a reçu. */
function fakeService(opts: { trusted?: boolean; folders?: boolean; handles?: (l: SourceLocation) => boolean } = {}) {
  const listeners: Array<(k: string[]) => void> = [];
  let entries: ContributionEntry[] = [{ pluginId: P, kind: 'sources', id: 'dossiers', declaration: {} }];
  const calls: Array<[string, unknown]> = [];
  const service: BridgeService = {
    contributions: (kind) => (kind === 'sources' ? entries : []),
    onContributionsChange: (l) => (listeners.push(l as never), () => {}),
    call: async (_id, _kind, _c, method, args) => {
      const location = args?.[0] as SourceLocation | null;
      calls.push([method, location]);
      if (method === 'handles') return (opts.handles ?? ((l) => !!l.path))(location as SourceLocation);
      if (!location?.path) return [];
      return [fileOf(path.join(location.path, 'Alien.mkv'), { images: { poster: path.join(location.path, 'Alien.jpg') } })];
    },
    levelOf: (id) => (entries.some((e) => e.pluginId === id) ? 'code' : null),
    folders: () => [],
    hosts: () => [],
    sourceRights: () => ({ trusted: opts.trusted ?? true, folders: opts.folders ?? true }),
  };
  const set = (list: ContributionEntry[]) => {
    entries = list;
    for (const l of listeners) l(['sources']);
  };
  return { service, calls, enable: () => set([{ pluginId: P, kind: 'sources', id: 'dossiers', declaration: {} }]), disable: () => set([]) };
}

function fakeCatalog() {
  const sources = new Map<string, unknown[]>();
  const id = (ref: ElementSourceRef) => `${ref.plugin}|${ref.instance}`;
  return {
    sources,
    setSource: (ref: ElementSourceRef, els: Iterable<unknown>) => void sources.set(id(ref), [...els]),
    removeSource: (ref: ElementSourceRef) => void sources.delete(id(ref)),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('sources des plugins : emplacements de la bibliothèque', () => {
  const locations = libraryLocations([
    { id: 'a', kind: 'video', location: films },
    { id: 'b', kind: 'image', location: `${films}/` },
    { id: 'c', kind: 'audio', location: 'https://nas.exemple.org/musique/' },
  ]);
  const key = locations[0].key;

  it('regroupe un même emplacement et ses types, avec la clé de la bibliothèque du cœur', () => {
    assert.equal(locations.length, 2);
    assert.deepEqual(locations[0].location, { location: films, path: films, network: false, kinds: ['video', 'image'] });
    assert.equal(locations[1].location.url, 'https://nas.exemple.org/musique/');
    assert.deepEqual(libraryLocations([{ id: 'r', kind: 'video', location: 'relatif/films' }]), []);
  });

  it('un dossier accepté est analysé, accordé au plugin et pris au cœur ; ses clés et affiches locales restent', async () => {
    const { service, calls } = fakeService();
    const catalog = fakeCatalog();
    let claims = 0;
    const b = createPluginBridges({ service, catalog, log: () => {}, onClaimsChange: () => claims++ });
    await b.setLocations(locations);
    assert.deepEqual(
      calls.filter(([m]) => m === 'scan'),
      [['scan', locations[0].location]],
    );
    assert.ok(b.claimed(key));
    assert.equal(b.claimed(locations[1].key), false);
    assert.deepEqual(b.assignedFolders(P), [films]);
    assert.equal(claims, 1);
    const [el] = (catalog.sources.get(`${P}|${key}`) ?? assert.fail([...catalog.sources.keys()].join(' ; '))) as { key: string; images: object }[];
    assert.equal(el.key, localFileKey(path.join(films, 'Alien.mkv')));
    assert.deepEqual(el.images, { poster: path.join(films, 'Alien.jpg') });
  });

  it('un emplacement retiré de la configuration : éléments retirés, dossier plus accordé', async () => {
    const { service } = fakeService();
    const catalog = fakeCatalog();
    const b = createPluginBridges({ service, catalog, log: () => {} });
    await b.setLocations(locations);
    await b.setLocations([]);
    assert.equal(catalog.sources.has(`${P}|${key}`), false);
    assert.deepEqual(b.assignedFolders(P), []);
    assert.equal(b.claimed(key), false);
  });

  it('plugin désactivé : ses éléments disparaissent sans erreur, et reviennent à la réactivation', async () => {
    const { service, enable, disable } = fakeService();
    const catalog = fakeCatalog();
    const logs: string[] = [];
    const b = createPluginBridges({ service, catalog, log: (m) => logs.push(m) });
    await b.setLocations(locations);
    disable();
    await settle();
    assert.equal(catalog.sources.size, 0);
    assert.equal(b.claimed(key), false);
    assert.deepEqual(b.assignedFolders(P), []);
    enable();
    await settle();
    assert.equal((catalog.sources.get(`${P}|${key}`) as unknown[]).length, 1);
    assert.deepEqual(logs, []);
  });

  it('plugin tiers, ou sans la permission `folders` : aucun dossier proposé ; analysé sans emplacement', async () => {
    for (const rights of [{ trusted: false }, { folders: false }]) {
      const { service, calls } = fakeService({ ...rights, handles: () => true });
      const catalog = fakeCatalog();
      const b = createPluginBridges({ service, catalog, log: () => {} });
      await b.setLocations(locations);
      assert.ok(!calls.some(([m, l]) => m === 'handles' && (l as SourceLocation).path), JSON.stringify(rights));
      assert.deepEqual(b.assignedFolders(P), []);
      // Sans `folders` mais de confiance : l'adresse lui est proposée et il l'accepte.
      assert.equal(b.claimed(locations[1].key), rights.trusted !== false);
      if (rights.trusted === false) assert.deepEqual([...catalog.sources.keys()], [`${P}|dossiers`]);
    }
  });

  it('la bibliothèque du cœur laisse un emplacement pris par un plugin', async () => {
    const set: string[] = [];
    const removed: string[] = [];
    const library = createLibraryService({
      config: { get: () => ({ library: { sources: [{ id: 'a', kind: 'video', location: films }] }, bookmarks: [] }) as never },
      access: { allowFile: () => {}, isAllowed: () => true },
      catalog: {
        setSource: (ref: ElementSourceRef) => void set.push(ref.plugin),
        removeSource: (ref: ElementSourceRef) => void removed.push(`${ref.plugin}|${ref.instance}`),
        sources: () => [{ plugin: 'src-local', instance: key }],
      } as never,
      claimed: (k) => k === key,
    });
    await library.scan();
    assert.deepEqual(set, []);
    assert.deepEqual(removed, [`src-local|${key}`]);
  });
});
