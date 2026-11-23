// Contexte et permissions des plugins (P3-04) : hôtes déclarés, dossiers accordés, stockage, réglages et secrets,
// permissions sensibles, bornes, identité par le port, et ce que les ponts acceptent des plugins.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PluginSetting } from '@mire/plugin-sdk';
import type { PluginSettingsSection } from '@mire/shared';
import { checkElements, checkFacts, checkMissing, createPluginBridges, factsKey, imageAllowed, type BridgeService } from '../../src/main/plugins/bridges.ts';
import { createContextHandler, LIMITS, type ContextDeps } from '../../src/main/plugins/context.ts';
import { grantedPermissions, hostDeclared, isLocalHost } from '../../src/main/plugins/permissions.ts';
import { createPluginStorage, pluginDataDir } from '../../src/main/plugins/plugin-storage.ts';
import { createPluginSettings, keepSecrets, withoutSecrets, type SecretBox } from '../../src/main/plugins/settings.ts';
import { createPluginState } from '../../src/main/plugins/state.ts';
import { normalizeConfig } from '../../src/main/config/normalize/index.ts';
import { validateManifest } from '../../packages/plugin-sdk/src/validate.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'mire-context-'));
after(() => rmSync(root, { recursive: true, force: true }));

const code = (e: unknown) => (e as { code?: string }).code;
const signal = () => new AbortController().signal;

/** fetch de test : rend la réponse prévue pour chaque adresse, et note les adresses demandées. */
function fakeFetch(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const f = async (url: string) => {
    asked.push(url);
    const r = routes[url];
    if (!r) throw new TypeError('fetch failed');
    return r();
  };
  return { fetch: f, asked };
}

function context(manifest: { level: 'code' | 'privileged' | 'data'; permissions?: Record<string, unknown> }, deps: Partial<ContextDeps> = {}) {
  const folders = new Map<string, string[]>();
  const all: ContextDeps = {
    // Résolution simulée : tout nom mène à une adresse publique, sauf indication contraire.
    lookup: async () => [{ address: '93.184.216.34' }],
    pickFolder: async () => null,
    folders: { list: (id) => folders.get(id) ?? [], add: (id, d) => folders.set(id, [...(folders.get(id) ?? []), d]) },
    storage: (id) => createPluginStorage(pluginDataDir(path.join(root, 'data'), id), 0),
    ...deps,
  };
  const forPlugin = createContextHandler(all);
  return { forPlugin, folders, ctx: (id = 'org.exemple.test') => forPlugin({ id, manifest: manifest as never }) };
}

describe('permissions', () => {
  it('hôtes : exact, ou sous-domaines pour *.domaine (pas le domaine lui-même)', () => {
    assert.ok(hostDeclared(['api.exemple.org'], 'API.exemple.org'));
    assert.ok(!hostDeclared(['api.exemple.org'], 'exemple.org'));
    assert.ok(hostDeclared(['*.exemple.org'], 'a.exemple.org'));
    assert.ok(hostDeclared(['*.exemple.org'], 'b.a.exemple.org'));
    assert.ok(!hostDeclared(['*.exemple.org'], 'exemple.org'));
    assert.ok(!hostDeclared(['*.exemple.org'], 'malexemple.org'));
  });

  it('réseau local reconnu', () => {
    for (const h of ['localhost', '127.0.0.1', '192.168.1.2', '10.0.0.1', '172.20.0.1', '[::1]', 'fd00::1', 'nas.local', 'nas', '::ffff:192.168.0.1'])
      assert.ok(isLocalHost(h), h);
    for (const h of ['8.8.8.8', 'api.exemple.org', '2001:db8::1']) assert.ok(!isLocalHost(h), h);
  });

  it('permission sensible refusée au code limité, même si le manifeste a échappé à la vérification', () => {
    const p = { localNetwork: true, launch: true, webViews: true, deleteFiles: true, folders: true, hosts: ['a.exemple.org'] };
    const g = grantedPermissions({ level: 'code', permissions: p });
    assert.deepEqual([g.localNetwork, g.launch, g.webViews, g.deleteFiles], [false, false, false, false]);
    assert.equal(g.folders, true);
    const s = grantedPermissions({ level: 'privileged', permissions: p });
    assert.deepEqual([s.localNetwork, s.launch, s.webViews, s.deleteFiles], [true, true, true, true]);
    assert.equal(grantedPermissions({ level: 'data', permissions: p }).folders, false);
    // Et la vérification du manifeste le refuse d'abord.
    const r = validateManifest({
      id: 'org.exemple.x',
      version: '1.0.0',
      engines: { mire: '^1.0.0' },
      level: 'code',
      contributes: { search: [{ id: 's', main: 's.mjs' }] },
      permissions: { localNetwork: true },
      i18n: 'i18n',
    });
    assert.ok(!r.ok && r.issues.some((i) => i.code === 'privileged-permission'));
  });
});

describe('ctx.http', () => {
  const routes = {
    'https://api.exemple.org/v1': () => new Response('{"a":1}', { headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' } }),
    'https://api.exemple.org/absent': () => new Response('', { status: 404 }),
    'https://api.exemple.org/ailleurs': () => new Response(null, { status: 302, headers: { location: 'https://evil.example.net/x' } }),
    'https://api.exemple.org/gros': () => new Response('x', { headers: { 'content-length': String(LIMITS.response + 1) } }),
    'https://cdn.exemple.org/img': () => new Response('ok'),
  };

  it('refuse tout hôte non déclaré, sans rien envoyer', async () => {
    const f = fakeFetch(routes);
    const { ctx } = context({ level: 'code', permissions: { hosts: ['api.exemple.org', '*.exemple.org'] } }, { fetch: f.fetch });
    const c = ctx();
    assert.deepEqual(await c.handle('http.getJson', ['https://api.exemple.org/v1'], signal()), { a: 1 });
    assert.equal(await c.handle('http.getText', ['https://cdn.exemple.org/img'], signal()), 'ok');
    assert.equal(await c.handle('http.getJson', ['https://api.exemple.org/absent'], signal()), null);
    for (const url of [
      'https://evil.example.net/',
      'http://192.168.1.10/',
      'http://localhost:8080/',
      'https://8.8.8.8/',
      'file:///etc/passwd',
      'https://exemple.org/',
    ]) {
      await assert.rejects(c.handle('http.request', [url], signal()), (e) => code(e) === 'refused', url);
    }
    assert.ok(!f.asked.some((u) => /evil|192\.168|localhost|8\.8\.8\.8|file:|\/\/exemple\.org/.test(u)));
  });

  it('suit une redirection seulement vers un hôte déclaré ; pas de cookie rendu ; corps borné', async () => {
    const f = fakeFetch(routes);
    const c = context({ level: 'code', permissions: { hosts: ['api.exemple.org'] } }, { fetch: f.fetch }).ctx();
    await assert.rejects(c.handle('http.request', ['https://api.exemple.org/ailleurs'], signal()), (e) => code(e) === 'refused');
    assert.ok(!f.asked.includes('https://evil.example.net/x'));
    const r = (await c.handle('http.request', ['https://api.exemple.org/v1'], signal())) as { headers: Record<string, string> };
    assert.equal(r.headers['set-cookie'], undefined);
    await assert.rejects(c.handle('http.request', ['https://api.exemple.org/gros'], signal()), (e) => code(e) === 'too-large');
  });

  it('hôte déclaré qui se résout vers le réseau local : refusé sans localNetwork', async () => {
    const f = fakeFetch({ 'https://x.attaquant.com/': () => new Response('routeur'), 'https://api.exemple.org/v1': () => new Response('ok') });
    const resolved: Record<string, string[]> = {
      'x.attaquant.com': ['93.184.216.34', '10.0.0.1'],
      'y.attaquant.com': ['::ffff:127.0.0.1'],
      'api.exemple.org': ['93.184.216.34', '2606:2800:220:1::1'],
    };
    const lookup = async (h: string) => (resolved[h] ?? []).map((address) => ({ address }));
    const hosts = ['x.attaquant.com', 'y.attaquant.com', 'api.exemple.org'];
    const c = context({ level: 'code', permissions: { hosts } }, { fetch: f.fetch, lookup }).ctx();
    await assert.rejects(c.handle('http.getText', ['https://x.attaquant.com/'], signal()), (e) => code(e) === 'refused');
    await assert.rejects(c.handle('http.getText', ['https://y.attaquant.com/'], signal()), (e) => code(e) === 'refused');
    assert.equal(await c.handle('http.getText', ['https://api.exemple.org/v1'], signal()), 'ok');
    assert.deepEqual(f.asked, ['https://api.exemple.org/v1']);
    // Et après une redirection vers un hôte déclaré qui mène au réseau local.
    const r = fakeFetch({ 'https://api.exemple.org/r': () => new Response(null, { status: 302, headers: { location: 'https://x.attaquant.com/' } }) });
    const c2 = context({ level: 'code', permissions: { hosts } }, { fetch: r.fetch, lookup }).ctx();
    await assert.rejects(c2.handle('http.getText', ['https://api.exemple.org/r'], signal()), (e) => code(e) === 'refused');
    assert.deepEqual(r.asked, ['https://api.exemple.org/r']);
  });

  it('réseau local : seulement pour le code sensible qui le déclare', async () => {
    const f = fakeFetch({ 'http://192.168.1.10/': () => new Response('box') });
    const sensible = context({ level: 'privileged', permissions: { localNetwork: true } }, { fetch: f.fetch }).ctx();
    assert.equal(await sensible.handle('http.getText', ['http://192.168.1.10/'], signal()), 'box');
    const limite = context({ level: 'code', permissions: { localNetwork: true, hosts: ['a.exemple.org'] } }, { fetch: f.fetch }).ctx();
    await assert.rejects(limite.handle('http.getText', ['http://192.168.1.10/'], signal()), (e) => code(e) === 'refused');
  });

  it('borne la taille des messages et le nombre de requêtes en attente', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async () => {
      await gate;
      return new Response('ok');
    };
    const c = context({ level: 'code', permissions: { hosts: ['api.exemple.org'] } }, { fetch: slow }).ctx();
    await assert.rejects(
      c.handle('http.request', ['https://api.exemple.org/v1', { body: 'x'.repeat(LIMITS.message + 1) }], signal()),
      (e) => code(e) === 'too-large',
    );
    const runs = Array.from({ length: LIMITS.running + LIMITS.waiting }, () => c.handle('http.getText', ['https://api.exemple.org/v1'], signal()));
    await assert.rejects(c.handle('http.getText', ['https://api.exemple.org/v1'], signal()), (e) => code(e) === 'busy');
    release();
    assert.equal((await Promise.all(runs)).length, LIMITS.running + LIMITS.waiting);
  });
});

describe('ctx.files', () => {
  const granted = path.join(root, 'films');
  const other = path.join(root, 'prive');
  mkdirSync(path.join(granted, 'sous'), { recursive: true });
  mkdirSync(other, { recursive: true });
  writeFileSync(path.join(granted, 'a.mkv'), 'film');
  writeFileSync(path.join(granted, 'sous', 'b.mp3'), 'son');
  writeFileSync(path.join(other, 'secret.txt'), 'non');
  symlinkSync(other, path.join(granted, 'lien'));

  it('lit un dossier accordé, refuse un dossier non accordé et un lien qui en sort', async () => {
    const { ctx, folders } = context({ level: 'code', permissions: { folders: true } });
    folders.set('org.exemple.test', [granted]);
    const c = ctx();
    assert.equal(await c.handle('files.readText', [path.join(granted, 'a.mkv')], signal()), 'film');
    assert.equal(await c.handle('files.exists', [path.join(granted, 'nope')], signal()), false);
    await assert.rejects(c.handle('files.readText', [path.join(other, 'secret.txt')], signal()), (e) => code(e) === 'refused');
    await assert.rejects(c.handle('files.readText', [path.join(granted, '..', 'prive', 'secret.txt')], signal()), (e) => code(e) === 'refused');
    await assert.rejects(c.handle('files.readText', [path.join(granted, 'lien', 'secret.txt')], signal()), (e) => code(e) === 'refused');
    await assert.rejects(c.handle('files.readText', ['relatif.txt'], signal()), (e) => code(e) === 'refused');
    const all = (await c.handle('files.walk', [granted], signal())) as { path: string }[];
    assert.deepEqual(all.map((e) => path.relative(granted, e.path)).sort(), ['a.mkv', path.join('sous', 'b.mp3')]);
    const mp3 = (await c.handle('files.walk', [granted, { extensions: ['MP3'] }], signal())) as unknown[];
    assert.equal(mp3.length, 1);
    assert.equal(((await c.handle('files.walk', [granted, { depth: 0 }], signal())) as unknown[]).length, 1);
  });

  it('les dossiers accordés sont ceux du plugin du port, pas ceux d’un autre ; il faut la permission', async () => {
    const { forPlugin, folders } = context({ level: 'code', permissions: { folders: true } });
    folders.set('org.exemple.a', [granted]);
    const b = forPlugin({ id: 'org.exemple.b', manifest: { level: 'code', permissions: { folders: true } } as never });
    // Même si le message prétend venir de « a ».
    await assert.rejects(b.handle('files.readText', [path.join(granted, 'a.mkv'), { pluginId: 'org.exemple.a' }], signal()), (e) => code(e) === 'refused');
    const sans = forPlugin({ id: 'org.exemple.a', manifest: { level: 'code' } as never });
    await assert.rejects(sans.handle('files.readText', [path.join(granted, 'a.mkv')], signal()), (e) => code(e) === 'refused');
  });

  it('requestFolder : l’accord est mémorisé pour ce plugin', async () => {
    const state = createPluginState(path.join(root, 'state.json'));
    state.load();
    const { forPlugin } = context({ level: 'code' }, { pickFolder: async () => granted, folders: { list: state.folders, add: state.addFolder } });
    const c = forPlugin({ id: 'org.exemple.c', manifest: { level: 'code', permissions: { folders: true } } as never });
    assert.equal(await c.handle('files.requestFolder', ['Vos films'], signal()), granted);
    assert.equal(await c.handle('files.readText', [path.join(granted, 'a.mkv')], signal()), 'film');
    state.setEnabled('org.exemple.c', false);
    await state.flush();
    const again = createPluginState(path.join(root, 'state.json'));
    again.load();
    assert.deepEqual(again.folders('org.exemple.c'), [granted]);
    assert.deepEqual(again.folders('org.exemple.d'), []);
  });
});

describe('ctx.storage', () => {
  it('range des valeurs JSON dans plugin-data/<id>/storage.json', async () => {
    const dir = pluginDataDir(path.join(root, 'data'), 'org.exemple.s');
    const s = createPluginStorage(dir, 0);
    s.set('vu', { n: 1 });
    s.set('liste', [1, 2]);
    s.delete('liste');
    await s.flush();
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'storage.json'), 'utf8')).values, { vu: { n: 1 } });
    assert.deepEqual(createPluginStorage(dir).get('vu'), { n: 1 });
    assert.throws(
      () => s.set('', 1),
      (e) => code(e) === 'plugin-error',
    );
    assert.throws(() => pluginDataDir(root, '../x'));
  });
});

describe('ctx.settings', () => {
  const declared: PluginSetting[] = [
    { key: 'cle', type: 'secret' },
    { key: 'langue', type: 'choice', options: ['fr', 'en'], default: 'fr' },
    { key: 'actif', type: 'toggle', default: true },
  ];
  const box: SecretBox = {
    available: () => true,
    encrypt: (t) => Buffer.from(`chiffre:${t}`).toString('base64'),
    decrypt: (b) =>
      Buffer.from(b, 'base64')
        .toString()
        .replace(/^chiffre:/, ''),
  };

  function store(b = box) {
    let section: PluginSettingsSection | undefined;
    const logs: string[] = [];
    const s = createPluginSettings({ read: () => section, write: (id, v) => (section = { ...(section ?? {}), [id]: v }), box: b, log: (m) => logs.push(m) });
    return { s, section: () => section, logs };
  }

  it('réglage secret chiffré, jamais exporté ni rendu à l’interface', () => {
    const { s, section } = store();
    s.set('org.exemple.t', declared, 'cle', 'API-123');
    s.set('org.exemple.t', declared, 'langue', 'en');
    assert.ok(!JSON.stringify(section()).includes('API-123'));
    assert.deepEqual(s.values('org.exemple.t', declared), { cle: 'API-123', langue: 'en', actif: true });
    const config = normalizeConfig({ plugins: section() });
    const exported = JSON.stringify(withoutSecrets(config));
    assert.ok(!exported.includes('$secret') && !exported.includes('API-123'));
    assert.deepEqual(withoutSecrets(config).plugins, { 'org.exemple.t': { langue: 'en' } });
    // Un import (sans secret) garde ceux en place.
    assert.deepEqual(keepSecrets({ 'org.exemple.t': { langue: 'fr' } }, section())?.['org.exemple.t'].cle, section()!['org.exemple.t'].cle);
  });

  it('vue de l’écran Réglages (P4-20) : valeurs sans les secrets, dont on dit seulement s’ils sont saisis', () => {
    const { s } = store();
    assert.deepEqual(s.view('org.exemple.t', declared), { values: { langue: 'fr', actif: true }, secrets: [] });
    s.set('org.exemple.t', declared, 'cle', 'API-123');
    s.set('org.exemple.t', declared, 'langue', 'en');
    const view = s.view('org.exemple.t', declared);
    assert.deepEqual(view, { values: { langue: 'en', actif: true }, secrets: ['cle'] });
    assert.ok(!JSON.stringify(view).includes('API-123'));
  });

  it('sans chiffrement du système : gardé tel quel, mais toujours retiré de l’export', () => {
    const { s, section } = store({ ...box, available: () => false });
    s.set('org.exemple.t', declared, 'cle', 'API-456');
    assert.deepEqual(section()!['org.exemple.t'].cle, { $secret: 'API-456', encrypted: false });
    assert.ok(!JSON.stringify(withoutSecrets(normalizeConfig({ plugins: section() }))).includes('API-456'));
  });

  it('valeur refusée sans la citer ; illisible : à saisir de nouveau, sans rien écrire du secret', () => {
    const { s, section, logs } = store();
    assert.throws(
      () => s.set('org.exemple.t', declared, 'langue', 'SECRET-de'),
      (e) => code(e) === 'plugin-error' && !(e as Error).message.includes('SECRET'),
    );
    assert.throws(
      () => s.set('org.exemple.t', declared, 'inconnu', 1),
      (e) => code(e) === 'plugin-error',
    );
    s.set('org.exemple.t', declared, 'cle', 'API-789');
    const broken = createPluginSettings({
      read: section,
      write: () => {},
      box: {
        ...box,
        decrypt: () => {
          throw new Error('API-789 bad');
        },
      },
      log: (m) => logs.push(m),
    });
    assert.equal(broken.values('org.exemple.t', declared).cle, undefined);
    assert.ok(logs.length && !logs.join().includes('API-789'));
  });

  it('seal : un secret déplacé en clair (continuité, P5-01) est chiffré quand le système le permet', () => {
    const plain = { cle: { $secret: 'API-321', encrypted: false }, langue: 'en' };
    const sealed = store();
    // Pas de section : rien à faire.
    assert.equal(sealed.s.seal('org.exemple.t'), 0);
    sealed.s.set('org.exemple.t', declared, 'langue', 'en');
    Object.assign(sealed.section()!['org.exemple.t'], plain);
    assert.equal(sealed.s.seal('org.exemple.t'), 1);
    assert.ok(!JSON.stringify(sealed.section()).includes('API-321'));
    assert.equal(sealed.section()!['org.exemple.t'].langue, 'en');
    assert.equal(sealed.s.values('org.exemple.t', declared).cle, 'API-321');
    // Déjà chiffré : rien de plus.
    assert.equal(sealed.s.seal('org.exemple.t'), 0);
    // Sans chiffrement du système : gardé en clair.
    const clear = store({ ...box, available: () => false });
    clear.s.set('org.exemple.t', declared, 'cle', 'API-321');
    assert.equal(clear.s.seal('org.exemple.t'), 0);
    assert.deepEqual(clear.section()!['org.exemple.t'].cle, { $secret: 'API-321', encrypted: false });
  });

  it('configuration sans plugin : inchangée (pas de section, pas de nouvelle version)', () => {
    const c = normalizeConfig({});
    assert.equal('plugins' in c, false);
  });
});

describe('ponts', () => {
  it('sources : éléments vérifiés selon le niveau, clés préfixées, programme refusé au code limité', () => {
    const raw = [
      { key: 'a', name: 'Radio', open: { kind: 'stream', url: 'https://radio.exemple.org/flux' }, tags: ['radio', 3] },
      { key: 'b', name: 'Lanceur', open: { kind: 'program', path: '/usr/bin/sh' } },
      { key: 'c', name: 'Fichier', open: { kind: 'file', path: '/etc/passwd' } },
      { key: 'd', name: 'Accordé', open: { kind: 'file', path: path.join(root, 'films', 'a.mkv') } },
      { key: 'e', name: 'js', open: { kind: 'site', url: 'javascript:alert(1)' } },
    ];
    const r = checkElements('org.exemple.r', 'code', [path.join(root, 'films')], raw);
    assert.deepEqual(
      r.elements.map((e) => e.key),
      ['plugin:org.exemple.r|a', 'plugin:org.exemple.r|d'],
    );
    assert.deepEqual(r.elements[0].tags, ['radio']);
    assert.equal(r.dropped, 3);
    assert.equal(checkElements('org.exemple.r', 'privileged', [], raw).elements.length, 4);
    assert.equal(checkFacts('p/m', { title: 'Film', image: 'file:///etc/passwd', source: 'tmdb' })?.image, null);
    assert.equal(checkFacts('p/m', { title: 'Film' })?.source, 'p/m');
    // Fiche choisie par l'utilisateur : la marque est gardée.
    assert.equal(checkFacts('p/m', { title: 'Film', picked: true })?.picked, true);
    assert.equal(checkFacts('p/m', { title: 'Film', picked: 'oui' })?.picked, undefined);
  });

  it('sources au catalogue à l’activation, retirées à la désactivation ; recherche réunie', async () => {
    const listeners: Array<(k: string[]) => void> = [];
    let entries = [{ pluginId: 'org.exemple.r', kind: 'sources', id: 'radios', declaration: {} }];
    const searchEntries = [
      { pluginId: 'org.exemple.r', kind: 'search', id: 'ou', declaration: {} },
      { pluginId: 'org.exemple.z', kind: 'search', id: 'panne', declaration: {} },
    ];
    const service: BridgeService = {
      contributions: (kind) => (kind === 'sources' ? entries : kind === 'search' ? searchEntries : []) as never,
      onContributionsChange: (l) => (listeners.push(l as never), () => {}),
      call: async (pluginId, kind, _id, method, args) => {
        if (kind === 'sources') return [{ key: 'x', name: 'X', open: { kind: 'stream', url: 'https://r.exemple.org/x' } }];
        if (pluginId === 'org.exemple.z') throw new Error('panne');
        return { query: args?.[0], method };
      },
      levelOf: () => 'code',
      folders: () => [],
      hosts: () => [],
    };
    const set: unknown[] = [];
    const removed: unknown[] = [];
    const b = createPluginBridges({
      service,
      catalog: { setSource: (ref, els) => set.push([ref, [...els]]), removeSource: (ref) => removed.push(ref) },
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(set, [
      [
        { plugin: 'org.exemple.r', instance: 'radios' },
        [{ key: 'plugin:org.exemple.r|x', name: 'X', open: { kind: 'stream', url: 'https://r.exemple.org/x' }, tags: [], infos: {}, images: {} }],
      ],
    ]);
    entries = [];
    for (const l of listeners) l(['sources']);
    assert.deepEqual(removed, [{ plugin: 'org.exemple.r', instance: 'radios' }]);
    assert.deepEqual(await b.search('  dune '), [{ pluginId: 'org.exemple.r', id: 'ou', result: { query: 'dune', method: 'search' } }]);
  });

  it('infos en ligne d’un plugin factice : requires relayé, images des seuls hôtes déclarés, échec rendu → message', async () => {
    let key = 'cle';
    let fail = false;
    const calls: string[] = [];
    const service: BridgeService = {
      contributions: (kind) =>
        (kind === 'metadata' ? [{ pluginId: 'org.exemple.f', kind: 'metadata', id: 'films', declaration: { kinds: ['video'] } }] : []) as never,
      onContributionsChange: () => () => {},
      call: async (_p, _k, _id, method, args) => {
        calls.push(method);
        if (method === 'requires') return key ? null : { skipped: 'vidéos (clé absente)', error: 'Ajoutez la clé.' };
        if (fail) return { failure: 'Clé refusée.' };
        if (method === 'candidates') return [{ id: 'movie:1', title: 'Dune', image: 'https://img.exemple.org/d.jpg' }, { id: 2 }];
        return {
          title: `Dune ${(args?.[0] as { name?: string })?.name ?? ''}`.trim(),
          image: 'https://img.exemple.org/affiche.jpg',
          backdrop: 'https://ailleurs.example/fond.jpg',
          source: 'autre',
        };
      },
      levelOf: () => 'code',
      folders: () => [],
      hosts: () => ['img.exemple.org'],
    };
    const b = createPluginBridges({ service, catalog: { setSource: () => {}, removeSource: () => {} }, log: () => {} });
    const [provider] = b.metadataProviders();
    assert.equal(provider.id, 'org.exemple.f/films');
    assert.equal(await provider.requires?.({} as never), null);
    key = '';
    assert.deepEqual(await provider.requires?.({} as never), { skipped: 'vidéos (clé absente)', error: 'Ajoutez la clé.' });

    const saved: string[] = [];
    const job = {
      key: 'k',
      io: {
        saveImage: async (url: string) => {
          saved.push(url);
          return `/img/${url.split('/').pop()}`;
        },
      },
    } as never;
    const a = await provider.scrape({ name: 'A', path: '/v/a' } as never, undefined, job);
    const c = await provider.scrape({ name: 'B', path: '/v/b' } as never, undefined, job);
    assert.deepEqual(a, { title: 'Dune A', image: '/img/affiche.jpg', backdrop: null, source: 'org.exemple.f/films' });
    assert.equal(c?.image, '/img/affiche.jpg');
    // Même adresse : copiée une seule fois ; hôte non déclaré : jamais téléchargé.
    assert.deepEqual(saved, ['https://img.exemple.org/affiche.jpg']);
    // Clé du cœur pour une vidéo : la fiche rejoint son élément, celle de l'ancien fournisseur est reprise.
    assert.equal(provider.key({ path: '/v/a' } as never), 'v:/v/a');
    assert.equal(provider.key({ name: 'sans chemin' } as never), 'plugin:org.exemple.f/films|');
    assert.equal(factsKey('album', { dir: '/m/A' }), 'a:/m/A');
    assert.equal(factsKey('rom', { path: '/r/x.sfc' }), 'r:/r/x.sfc');
    assert.equal(factsKey('pc', { name: 'Hadès' }), 'g:hades');
    assert.equal(factsKey('video', {}), null);
    assert.deepEqual(await provider.candidates({ query: 'Dune' } as never, {} as never), [
      { id: 'movie:1', title: 'Dune', year: '', sub: '', image: 'https://img.exemple.org/d.jpg' },
    ]);

    fail = true;
    await assert.rejects(
      provider.scrape({ name: 'A' } as never, undefined, job),
      (err: Error) => err.name === 'ScrapeRefusal' && err.message === 'Clé refusée.',
    );
    await assert.rejects(provider.candidates({ query: 'Dune' } as never, {} as never), { message: 'Clé refusée.' });
  });

  it('requires absent ou en panne : la source est interrogée', async () => {
    const service: BridgeService = {
      contributions: (kind) =>
        (kind === 'metadata' ? [{ pluginId: 'org.exemple.f', kind: 'metadata', id: 'films', declaration: { kinds: ['video'] } }] : []) as never,
      onContributionsChange: () => () => {},
      call: async () => {
        throw new Error('requires.notFound');
      },
      levelOf: () => 'code',
      folders: () => [],
      hosts: () => [],
    };
    const [provider] = createPluginBridges({ service, catalog: { setSource: () => {}, removeSource: () => {} }, log: () => {} }).metadataProviders();
    assert.equal(await provider.requires?.({} as never), null);
  });

  it('imageAllowed et checkMissing', () => {
    assert.equal(imageAllowed('https://image.tmdb.org/t/p/w342/a.jpg', ['image.tmdb.org']), true);
    assert.equal(imageAllowed('http://image.tmdb.org/a.jpg', ['image.tmdb.org']), false);
    assert.equal(imageAllowed('https://u:p@image.tmdb.org/a.jpg', ['image.tmdb.org']), false);
    assert.equal(imageAllowed('https://evil.example/a.jpg', ['image.tmdb.org']), false);
    assert.equal(imageAllowed('pas une adresse', ['image.tmdb.org']), false);
    assert.equal(imageAllowed('https://cdn.exemple.org/a.jpg', ['*.exemple.org']), true);
    assert.deepEqual(checkMissing({ skipped: ' a ', error: 'b' }), { skipped: 'a', error: 'b' });
    assert.equal(checkMissing({ skipped: 'a' }), null);
    assert.equal(checkMissing('x'), null);
    assert.equal(checkMissing({ skipped: 'a', error: 'x'.repeat(900) })?.error.length, 500);
  });
});
