// Adresses accordées d'après la configuration (P5-12) : un serveur web ou une liste en ligne de la bibliothèque, pris
// par un plugin inclus ou du dépôt officiel, lui est accordé (origine exacte, sous son chemin, réseau local compris)
// tant qu'il reste dans la configuration ; tout le reste suit les règles du manifeste.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SourceLocation } from '@mire/plugin-sdk';
import { m3uEntryKey, remoteFileKey } from '../../src/main/catalog/keys.ts';
import { checkElements, createPluginBridges, type BridgeService } from '../../src/main/plugins/bridges.ts';
import { createContextHandler, type ContextDeps } from '../../src/main/plugins/context.ts';
import { urlGranted } from '../../src/main/plugins/permissions.ts';
import { createPluginStorage, pluginDataDir } from '../../src/main/plugins/plugin-storage.ts';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'mire-origins-'));
after(() => rmSync(root, { recursive: true, force: true }));

const code = (e: unknown) => (e as { code?: string }).code;
const signal = () => new AbortController().signal;

describe('urlGranted', () => {
  const grants = ['http://192.168.1.10:8080/films', 'https://nas.local/musique/', 'https://box.exemple.org/listes/tv.m3u'];
  const ok = (u: string) => urlGranted(new URL(u), grants);

  it('origine exacte (schéma, hôte, port) et chemin de départ ou en dessous', () => {
    for (const u of [
      'http://192.168.1.10:8080/films',
      'http://192.168.1.10:8080/films/',
      'http://192.168.1.10:8080/films/S%C3%A9rie/a.mkv',
      'https://nas.local/musique/album/b.mp3',
      'https://box.exemple.org/listes/tv.m3u',
      'https://box.exemple.org/listes/tv.m3u?jeton=1',
      'HTTPS://NAS.local:443/musique/',
    ])
      assert.ok(ok(u), u);
  });

  it('autre schéma, hôte ou port, chemin voisin ou au-dessus : refusé', () => {
    for (const u of [
      'https://192.168.1.10:8080/films/',
      'http://192.168.1.10/films/',
      'http://192.168.1.11:8080/films/',
      'http://192.168.1.10:8080/films-2/',
      'http://192.168.1.10:8080/',
      'http://192.168.1.10:8080/films/../admin',
      'http://192.168.1.10:8080/films/%2e%2e/admin',
      'http://192.168.1.10:8080/films/..%2Fadmin',
      'http://192.168.1.10:8080/films/a%5c..%5cb',
      'http://moi:secret@192.168.1.10:8080/films/',
      'https://nas.local/musiques/',
      'https://box.exemple.org/listes/autre.m3u',
      'https://box.exemple.org/listes/',
      'ftp://nas.local/musique/',
    ])
      assert.ok(!ok(u), u);
  });

  it('accord vide ou adresse accordée invalide : rien', () => {
    assert.ok(!urlGranted(new URL('https://nas.local/musique/'), []));
    assert.ok(!urlGranted(new URL('https://nas.local/musique/'), ['pas une adresse']));
    assert.ok(!urlGranted(new URL('https://nas.local/musique/'), ['https://moi:x@nas.local/musique/']));
  });
});

/** fetch de test : rend la réponse prévue pour chaque adresse, et note les adresses demandées. */
function fakeFetch(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    const r = routes[url];
    if (!r) throw new TypeError('fetch failed');
    return r();
  };
  return { fetch, asked };
}

function context(origins: Record<string, string[]>, deps: Partial<ContextDeps> = {}) {
  const all: ContextDeps = {
    lookup: async () => [{ address: '93.184.216.34' }],
    pickFolder: async () => null,
    folders: { list: () => [], add: () => {} },
    origins: { list: (id) => origins[id] ?? [] },
    storage: (id) => createPluginStorage(pluginDataDir(path.join(root, 'data'), id), 0),
    ...deps,
  };
  const forPlugin = createContextHandler(all);
  return (id = 'mire.source.http', permissions: Record<string, unknown> = {}) => forPlugin({ id, manifest: { level: 'code', permissions } as never });
}

describe('ctx.http : adresses accordées par la configuration', () => {
  const routes = {
    'http://192.168.1.10/films/': () => new Response('index'),
    'http://192.168.1.10/films/S%C3%A9rie/': () => new Response('série'),
    'http://192.168.1.10/films': () => new Response(null, { status: 301, headers: { location: '/films/' } }),
    'http://192.168.1.10/films/vers-admin': () => new Response(null, { status: 302, headers: { location: '/admin/' } }),
    'http://192.168.1.10/films/vers-https': () => new Response(null, { status: 302, headers: { location: 'https://192.168.1.10/films/' } }),
    'http://192.168.1.10/films/vers-public': () => new Response(null, { status: 302, headers: { location: 'https://api.exemple.org/v1' } }),
    'http://192.168.1.10/admin/': () => new Response('admin'),
    'https://192.168.1.10/films/': () => new Response('index https'),
    'http://192.168.1.11/films/': () => new Response('voisin'),
    'https://api.exemple.org/v1': () => new Response('public'),
  };
  const grants = { 'mire.source.http': ['http://192.168.1.10/films'] };

  it('réseau local et adresse IP permis pour l’origine accordée seule, sous son chemin', async () => {
    const f = fakeFetch(routes);
    const c = context(grants, { fetch: f.fetch })();
    assert.equal(await c.handle('http.getText', ['http://192.168.1.10/films/'], signal()), 'index');
    assert.equal(await c.handle('http.getText', ['http://192.168.1.10/films/S%C3%A9rie/'], signal()), 'série');
    for (const url of ['http://192.168.1.10/admin/', 'https://192.168.1.10/films/', 'http://192.168.1.11/films/', 'https://api.exemple.org/v1'])
      await assert.rejects(c.handle('http.getText', [url], signal()), (e) => code(e) === 'refused', url);
    assert.deepEqual(f.asked, ['http://192.168.1.10/films/', 'http://192.168.1.10/films/S%C3%A9rie/']);
  });

  it('redirection suivie seulement vers une adresse accordée', async () => {
    const f = fakeFetch(routes);
    const c = context(grants, { fetch: f.fetch })();
    // `/films` → `/films/` : même origine, sous le chemin de départ.
    assert.equal(await c.handle('http.getText', ['http://192.168.1.10/films'], signal()), 'index');
    for (const url of ['http://192.168.1.10/films/vers-admin', 'http://192.168.1.10/films/vers-https', 'http://192.168.1.10/films/vers-public'])
      await assert.rejects(c.handle('http.getText', [url], signal()), (e) => code(e) === 'refused', url);
    assert.ok(!f.asked.some((u) => /admin\/$|^https:/.test(u)));
  });

  it('l’accord ne vaut que pour le plugin qui lit l’emplacement', async () => {
    const f = fakeFetch(routes);
    const autre = context(grants, { fetch: f.fetch })('mire.source.m3u');
    await assert.rejects(autre.handle('http.getText', ['http://192.168.1.10/films/'], signal()), (e) => code(e) === 'refused');
    assert.deepEqual(f.asked, []);
  });

  it('les hôtes du manifeste restent permis, avec leurs règles (réseau local refusé)', async () => {
    const f = fakeFetch(routes);
    const lookup = async (h: string) => [{ address: h === 'api.exemple.org' ? '93.184.216.34' : '10.0.0.1' }];
    const c = context(grants, { fetch: f.fetch, lookup })('mire.source.http', { hosts: ['api.exemple.org'] });
    assert.equal(await c.handle('http.getText', ['https://api.exemple.org/v1'], signal()), 'public');
    // Accordée, puis redirigée vers un hôte du manifeste : permis.
    assert.equal(await c.handle('http.getText', ['http://192.168.1.10/films/vers-public'], signal()), 'public');
  });
});

describe('ponts : adresses accordées tant qu’elles restent dans la configuration', () => {
  const entry = (pluginId: string, id: string): ContributionEntry => ({ pluginId, kind: 'sources', id, declaration: { id } }) as unknown as ContributionEntry;
  const url = (u: string, kinds: SourceLocation['kinds'] = ['video']) => ({ key: u, location: { location: u, url: u, network: false, kinds } });

  function setup(trusted = true) {
    const entries = [entry('mire.source.m3u', 'src-m3u'), entry('mire.source.http', 'src-http')];
    const service: BridgeService = {
      contributions: (kind) => (kind === 'sources' ? entries : []),
      onContributionsChange: () => () => {},
      async call(pluginId, _kind, _id, method, args) {
        const loc = (args ?? [])[0] as SourceLocation | null;
        if (method === 'handles') return pluginId === 'mire.source.m3u' ? /\.m3u8?$/.test(loc?.url ?? '') : !!loc?.url && !/\.m3u8?$/.test(loc.url);
        return [];
      },
      levelOf: () => 'code',
      folders: () => [],
      hosts: () => [],
      sourceRights: () => ({ trusted, folders: false }),
    };
    const catalog = { setSource() {}, removeSource() {} };
    return createPluginBridges({ service, catalog, log: () => {} });
  }

  it('chaque plugin reçoit l’adresse qu’il lit ; l’accord part avec l’emplacement', async () => {
    const bridges = setup();
    await bridges.setLocations([url('http://192.168.1.10/films/'), url('https://box.exemple.org/tv.m3u')]);
    assert.deepEqual(bridges.assignedUrls('mire.source.http'), ['http://192.168.1.10/films/']);
    assert.deepEqual(bridges.assignedUrls('mire.source.m3u'), ['https://box.exemple.org/tv.m3u']);
    await bridges.setLocations([url('https://box.exemple.org/tv.m3u')]);
    assert.deepEqual(bridges.assignedUrls('mire.source.http'), []);
    await bridges.setLocations([]);
    assert.deepEqual(bridges.assignedUrls('mire.source.m3u'), []);
    bridges.stop();
  });

  it('plugin qui n’est ni inclus ni du dépôt officiel : aucune adresse', async () => {
    const bridges = setup(false);
    await bridges.setLocations([url('http://192.168.1.10/films/')]);
    assert.deepEqual(bridges.assignedUrls('mire.source.http'), []);
    bridges.stop();
  });
});

describe('clés du cœur gardées pour un fichier en ligne ou une entrée de liste (P5-12)', () => {
  const at = (u: string): SourceLocation => ({ location: u, url: u, network: false, kinds: ['video'] });
  const film = 'http://192.168.1.10/films/Am%C3%A9lie.mkv';

  it('fichier sous l’adresse de l’emplacement : clé `remote:` gardée si elle vaut celle de son `open`', () => {
    const raw = [
      { key: remoteFileKey(film), name: 'Amélie', open: { kind: 'file', path: film } },
      { key: remoteFileKey('http://192.168.1.10/autre.mkv'), name: 'Autre', open: { kind: 'file', path: 'http://192.168.1.10/autre.mkv' } },
      { key: remoteFileKey('http://192.168.1.10/films/b.mkv'), name: 'Menteur', open: { kind: 'file', path: film } },
    ];
    const { elements } = checkElements('mire.source.http', 'code', [], raw, 'linux', { location: at('http://192.168.1.10/films/') });
    assert.deepEqual(
      elements.map((e) => e.key),
      [
        remoteFileKey(film),
        `plugin:mire.source.http|${remoteFileKey('http://192.168.1.10/autre.mkv')}`,
        `plugin:mire.source.http|${remoteFileKey('http://192.168.1.10/films/b.mkv')}`,
      ],
    );
    // Sans emplacement (source qui n'en reçoit pas) : préfixée.
    assert.equal(checkElements('mire.source.http', 'code', [], raw.slice(0, 1), 'linux').elements[0].key, `plugin:mire.source.http|${remoteFileKey(film)}`);
  });

  it('entrée de liste : clé `m3u:<liste>|<flux>` de la liste analysée seulement', () => {
    const list = 'https://box.exemple.org/tv.m3u';
    const raw = [
      { key: m3uEntryKey(list, 'http://flux/a', 'linux'), name: 'A', open: { kind: 'stream', url: 'http://flux/a' } },
      { key: m3uEntryKey('https://box.exemple.org/autre.m3u', 'http://flux/b', 'linux'), name: 'B', open: { kind: 'stream', url: 'http://flux/b' } },
    ];
    const { elements } = checkElements('mire.source.m3u', 'code', [], raw, 'linux', { location: at(list) });
    assert.deepEqual(
      elements.map((e) => e.key),
      [m3uEntryKey(list, 'http://flux/a', 'linux'), `plugin:mire.source.m3u|${m3uEntryKey('https://box.exemple.org/autre.m3u', 'http://flux/b', 'linux')}`],
    );
    const local = '/home/moi/Listes/radios.m3u';
    const loc: SourceLocation = { location: local, path: local, network: false, kinds: ['audio'] };
    const own = { key: m3uEntryKey(local, 'http://flux/r', 'linux'), name: 'R', open: { kind: 'stream', url: 'http://flux/r' } };
    assert.equal(checkElements('mire.source.m3u', 'code', [], [own], 'linux', { location: loc }).elements[0].key, own.key);
  });
});

describe('liste de lecture locale : son dossier est accordé avec elle', () => {
  it('emplacement qui désigne un fichier → son dossier ; un dossier → lui seul', async () => {
    const dir = path.join(root, 'Listes');
    mkdirSync(dir, { recursive: true });
    const list = path.join(dir, 'radios.m3u');
    writeFileSync(list, '#EXTM3U\n');
    const entries = [{ pluginId: 'mire.source.m3u', kind: 'sources', id: 'src-m3u', declaration: { id: 'src-m3u' } } as unknown as ContributionEntry];
    const service: BridgeService = {
      contributions: (kind) => (kind === 'sources' ? entries : []),
      onContributionsChange: () => () => {},
      call: async (_p, _k, _i, method) => (method === 'handles' ? true : []),
      levelOf: () => 'code',
      folders: () => [],
      hosts: () => [],
      sourceRights: () => ({ trusted: true, folders: true }),
    };
    const bridges = createPluginBridges({ service, catalog: { setSource() {}, removeSource() {} }, log: () => {} });
    const loc = (p: string) => ({ key: p, location: { location: p, path: p, network: false, kinds: ['audio' as const] } });
    await bridges.setLocations([loc(list), loc(root)]);
    assert.deepEqual(bridges.assignedFolders('mire.source.m3u').sort(), [root, list, dir].sort());
    await bridges.setLocations([loc(root)]);
    assert.deepEqual(bridges.assignedFolders('mire.source.m3u'), [root]);
    bridges.stop();
  });
});
