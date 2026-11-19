// Dépôts tiers et confiance (P3-08), avec des dépôts de test locaux (même forme que ceux de `mire-addons`) et le vrai
// hôte de plugins : ajout (empreinte confirmée) et retrait d'un dépôt ; clé incorrecte, index altéré, préfixe réservé
// refusés ; un identifiant appartient au dépôt qui l'a installé ; accord pour le code sensible ; un hôte isolé par
// dépôt tiers ; arguments de l'IPC vérifiés.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { PluginConsentRequest, PluginsOutcome } from '@mire/shared/ipc';
import { pluginsHandlers } from '../../src/main/ipc/handlers/plugins.ts';
import type { MainContext } from '../../src/main/ipc/context.ts';
import { createHostPool, hostGroup, MAIN_GROUP, type PooledHost } from '../../src/main/plugins/host-pool.ts';
import { createJournal } from '../../src/main/plugins/journal.ts';
import { createPluginService } from '../../src/main/plugins/service.ts';
import { createPluginState } from '../../src/main/plugins/state.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { createRepoClient } from '../../src/main/repos/client.ts';
import { keyId, loadPublicKey } from '../../src/main/repos/index-file.ts';
import { createInstaller, readOrigin } from '../../src/main/repos/installer.ts';
import { OFFICIAL_PUBLIC_KEY } from '../../src/main/repos/official.ts';
import { createRepositories } from '../../src/main/repos/repositories.ts';
import { checkIndexUrl, covers, createTrustStore, keyFingerprint, thirdPartyId, toConfig, type ConsentRequest } from '../../src/main/repos/trust.ts';
import { keys, pem, tempDir, testRepo, type PluginSpec, type TestRepo } from './helpers.ts';

const T1 = 'https://github.com/tiers/un/releases/download';
const T2 = 'https://github.com/tiers/deux/releases/download';
const FILMS = 'org.exemple.films';
const OUTIL = 'org.exemple.outil';

const fingerprintOf = (repo: TestRepo) => keyId(loadPublicKey(repo.publicKey));

/** Mire avec un dépôt « officiel » de test et les dépôts tiers ajoutés ; `repos` : tous les dépôts joignables. */
function mire(official: TestRepo, others: TestRepo[], userData = tempDir()) {
  const installed = path.join(userData, 'plugins');
  fs.mkdirSync(installed, { recursive: true });
  const trust = createTrustStore({ file: path.join(userData, 'repos', 'trust.json'), log: () => {} });
  const all = [official, ...others];
  const fetch = (url: string, init?: RequestInit) => {
    const repo = all.find(
      (r) =>
        url.startsWith(r.indexUrl.replace('/index/index.json', '')) ||
        url.startsWith(r.indexUrl.replace('/index/index.json', '').replace('https://github.com/', 'https://storage.example/')),
    );
    return repo ? repo.fetch(url, init) : Promise.resolve(new Response('absent', { status: 404 }));
  };
  const service = createPluginService({
    roots: { bundled: null, installed },
    appVersion: '1.0.0',
    languages: ['fr', 'en'],
    state: createPluginState(path.join(installed, 'state.json')),
    journal: createJournal({ dir: path.join(installed, 'logs') }),
    tagRegistry: createRegistry((k) => k),
    setTexts: () => {},
    translate: (k, vars) => `${k} ${JSON.stringify(vars ?? {})}`,
    locale: () => 'fr',
    runners: () => ({
      isolated: () => Promise.reject(new Error('pas de code ici')),
      inProcess: () => Promise.reject(new Error('pas de code ici')),
      base: () => '',
      shutdown: () => {},
    }),
    onTaggersChange: () => {},
    refresh: () => {},
    watchdog: { interval: 0, timeout: 0 },
    consented: (c) => trust.consented(c),
  });
  const officialConfig = { id: 'official', index: official.indexUrl, publicKey: official.publicKey, official: true };
  const client = createRepoClient({
    repositories: createRepositories({
      cacheDir: path.join(userData, 'repos'),
      repositories: () => [officialConfig, ...trust.repositories().map(toConfig)],
      fetch,
      log: () => {},
    }),
    installer: createInstaller({ pluginsDir: installed, fetch }),
    plugins: service,
    appVersion: '1.0.0',
    locale: () => 'fr',
    translate: (k, vars) => `${k} ${JSON.stringify(vars ?? {})}`,
    log: () => {},
    trust,
  });
  const summary = (id: string) => service.list().find((p) => p.id === id);
  /** Ajoute un dépôt tiers comme l'interface : vérification, empreinte montrée, puis ajout avec cette empreinte. */
  async function add(repo: TestRepo): Promise<string> {
    const seen = await client.inspectRepository(repo.indexUrl, repo.publicKey);
    assert.ok(seen.ok, JSON.stringify(seen));
    const added = await client.addRepository(repo.indexUrl, repo.publicKey, seen.repository.fingerprint);
    assert.ok(added.ok, JSON.stringify(added));
    return added.repository.id;
  }
  const start = async () => {
    await service.start();
    await client.refresh();
  };
  return { userData, installed, service, client, trust, summary, add, start };
}

const failed = (out: PluginsOutcome | { ok: boolean; code?: string }) => (out.ok ? 'ok' : out.code);

describe('Vérifications (trust.ts)', () => {
  it('adresse https seulement, sans nom ni mot de passe, de taille bornée', () => {
    assert.equal(checkIndexUrl('https://exemple.org/index.json'), 'https://exemple.org/index.json');
    for (const bad of [
      'http://exemple.org/index.json',
      'file:///etc/passwd',
      'https://moi:secret@exemple.org/i.json',
      `https://exemple.org/${'a'.repeat(3000)}`,
      42,
      '',
      'pas une adresse',
    ])
      assert.equal(checkIndexUrl(bad), null, String(bad).slice(0, 40));
  });

  it('clé : PEM d’une clé ed25519 seulement ; l’empreinte est le keyId de l’index', () => {
    const { publicKey } = keys();
    assert.equal(keyFingerprint(pem(publicKey)), keyId(publicKey));
    const raw = (publicKey.export({ format: 'jwk' }) as { x: string }).x;
    assert.equal(keyFingerprint(Buffer.from(raw, 'base64url').toString('base64')), null, '32 octets bruts : PEM attendu');
    assert.equal(keyFingerprint('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n'), null);
    assert.equal(keyFingerprint(pem(publicKey) + ' '.repeat(2000)), null, 'trop longue');
    assert.equal(keyFingerprint({ toString: () => pem(publicKey) }), null);
  });

  it('identifiant d’un dépôt tiers : calculé d’après la clé, jamais « official »', () => {
    const fp = keyFingerprint(OFFICIAL_PUBLIC_KEY)!;
    assert.match(thirdPartyId(fp), /^repo-[0-9a-f]{16}$/);
    assert.notEqual(thirdPartyId(fp), 'official');
  });

  it('un accord couvre une version qui ne demande rien de plus, pas une qui élargit', () => {
    const base: ConsentRequest = {
      plugin: OUTIL,
      repository: 'repo-0123456789abcdef',
      version: '1.0.0',
      level: 'privileged',
      permissions: { launch: true, hosts: ['a.org', 'b.org'] },
    };
    assert.ok(covers(base, { ...base, version: '1.1.0', permissions: { launch: true, hosts: ['a.org'] } }));
    assert.ok(covers(base, { ...base, level: 'code', permissions: {} }));
    assert.equal(covers(base, { ...base, permissions: { launch: true, hosts: ['c.org'] } }), false);
    assert.equal(covers(base, { ...base, permissions: { launch: true, deleteFiles: true } }), false);
    assert.equal(covers({ ...base, level: 'code' }, base), false);
    assert.equal(covers(base, { ...base, repository: 'repo-fedcba9876543210' }), false);
    assert.equal(covers(base, { ...base, plugin: 'org.exemple.autre' }), false);
  });

  it('le fichier de confiance : les entrées mal formées ou contrefaites sont ignorées', () => {
    const dir = tempDir();
    const file = path.join(dir, 'trust.json');
    const { publicKey } = keys();
    const fp = keyId(publicKey);
    const good = { id: thirdPartyId(fp), index: 'https://exemple.org/index.json', publicKey: pem(publicKey), fingerprint: fp, addedAt: 1 };
    fs.writeFileSync(
      file,
      JSON.stringify({
        repositories: [good, { ...good, id: 'official' }, { ...good, fingerprint: '0'.repeat(64) }, { ...good, index: 'http://exemple.org/i.json' }],
        consents: [{ plugin: OUTIL, repository: 'official', version: '1.0.0', level: 'privileged', permissions: {}, at: 1 }],
      }),
    );
    const store = createTrustStore({ file, log: () => {} });
    assert.deepEqual(
      store.repositories().map((r) => r.id),
      [good.id],
    );
    assert.equal(store.consented({ plugin: OUTIL, repository: 'official', version: '1.0.0', level: 'privileged', permissions: {} }), false);
  });
});

describe('Ajout d’un dépôt tiers', () => {
  it('montre l’empreinte, ajoute le dépôt avec elle, puis installe un plugin depuis lui', async () => {
    const official = testRepo([]);
    const tiers = testRepo([{ id: FILMS, version: '1.0.0' }], { base: T1 });
    const m = mire(official, [tiers]);
    await m.start();
    const seen = await m.client.inspectRepository(tiers.indexUrl, tiers.publicKey);
    assert.ok(seen.ok);
    assert.equal(seen.repository.fingerprint, fingerprintOf(tiers));
    assert.equal(seen.repository.fingerprint, tiers.index.signature!.keyId);
    assert.equal(seen.repository.plugins, 1);
    assert.equal(m.trust.repositories().length, 0, 'rien n’est ajouté avant la confirmation');

    const id = await m.add(tiers);
    assert.equal(id, thirdPartyId(fingerprintOf(tiers)));
    const info = m.client.repositories().find((r) => r.id === id)!;
    assert.deepEqual([info.trust, info.official, info.fingerprint, info.index], ['third-party', false, fingerprintOf(tiers), tiers.indexUrl]);

    const out = await m.client.install(FILMS);
    assert.equal(failed(out), 'ok');
    assert.equal(readOrigin(m.installed, FILMS)?.repository, id);
    assert.deepEqual([m.summary(FILMS)?.trust, m.summary(FILMS)?.repository, m.summary(FILMS)?.status], ['third-party', id, 'active']);
    assert.equal(m.client.available().find((p) => p.id === FILMS)?.trust, 'third-party');

    // Relancé : le dépôt et son index (cache) sont toujours là, sans réseau.
    tiers.offline = true;
    const again = mire(official, [tiers], m.userData);
    assert.deepEqual(
      again.client.available().map((p) => [p.id, p.repository, p.installed]),
      [[FILMS, id, null]],
    );
  });

  it('refuse une empreinte qui n’est pas celle de la clé', async () => {
    const tiers = testRepo([{ id: FILMS, version: '1.0.0' }], { base: T1 });
    const m = mire(testRepo([]), [tiers]);
    const out = await m.client.addRepository(tiers.indexUrl, tiers.publicKey, 'a'.repeat(64));
    assert.equal(failed(out), 'fingerprint');
    assert.equal(m.trust.repositories().length, 0);
  });

  it('refuse une clé incorrecte, un index altéré, le préfixe réservé, une adresse http', async () => {
    const official = testRepo([]);
    const tiers = testRepo([{ id: FILMS, version: '1.0.0' }], { base: T1 });
    const m = mire(official, [tiers]);
    const other = pem(keys().publicKey);
    assert.equal(failed(await m.client.addRepository(tiers.indexUrl, other, keyFingerprint(other)!)), 'signature', 'autre clé');
    assert.equal(failed(await m.client.inspectRepository(tiers.indexUrl, 'pas une clé')), 'key');
    assert.equal(failed(await m.client.inspectRepository(tiers.indexUrl.replace('https:', 'http:'), tiers.publicKey)), 'url');

    tiers.publish([{ id: FILMS, version: '1.0.0' }], { alter: (i) => void (i.plugins[0].versions[0].level = 'privileged') });
    assert.equal(failed(await m.client.inspectRepository(tiers.indexUrl, tiers.publicKey)), 'signature', 'index altéré après signature');

    tiers.publish([{ id: 'mire.films', version: '1.0.0' }]);
    assert.equal(failed(await m.client.inspectRepository(tiers.indexUrl, tiers.publicKey)), 'format', 'préfixe « mire. » refusé');
    assert.equal(m.trust.repositories().length, 0);
  });

  it('refuse le dépôt officiel et un dépôt déjà ajouté', async () => {
    const tiers = testRepo([{ id: FILMS, version: '1.0.0' }], { base: T1 });
    const m = mire(testRepo([]), [tiers]);
    await m.add(tiers);
    assert.equal(failed(await m.client.inspectRepository(tiers.indexUrl, tiers.publicKey)), 'exists');
    assert.equal(failed(await m.client.inspectRepository('https://autre.exemple/index.json', tiers.publicKey)), 'exists', 'même clé');
    assert.equal(failed(await m.client.inspectRepository('https://autre.exemple/index.json', OFFICIAL_PUBLIC_KEY)), 'exists', 'clé officielle');
  });

  it('un index tiers devenu altéré ou signé par une autre clé est ignoré (le cache reste)', async () => {
    const tiers = testRepo([{ id: FILMS, version: '1.0.0' }], { base: T1 });
    const m = mire(testRepo([]), [tiers]);
    const id = await m.add(tiers);
    tiers.publish([{ id: FILMS, version: '2.0.0' }], { generated: '2026-11-20T00:00:00.000Z', sign: keys().privateKey });
    const status = (await m.client.refresh()).find((r) => r.id === id)!;
    assert.equal(status.error, 'signature');
    assert.equal(m.client.available().find((p) => p.id === FILMS)?.version, '1.0.0');
  });
});

describe('Un identifiant appartient au dépôt qui l’a installé', () => {
  it('ni remplacement ni mise à jour par un autre dépôt, dans les deux sens', async () => {
    const official = testRepo([{ id: FILMS, version: '1.0.0' }]);
    const tiers = testRepo([{ id: FILMS, version: '9.0.0' }], { base: T1 });
    const m = mire(official, [tiers]);
    await m.start();
    const id = await m.add(tiers);
    // Par défaut, le dépôt officiel.
    assert.equal(failed(await m.client.install(FILMS)), 'ok');
    assert.equal(m.summary(FILMS)?.version, '1.0.0');
    assert.equal(m.client.updates().length, 0, 'la 9.0.0 du dépôt tiers n’est pas une mise à jour');
    const third = m.client.available().find((p) => p.id === FILMS && p.repository === id)!;
    assert.deepEqual([third.conflict, third.installed, third.update], [true, null, null]);
    assert.equal(failed(await m.client.install(FILMS, undefined, id)), 'owner');
    assert.equal(failed(await m.client.install(FILMS, '9.0.0')), 'unknown', 'pas de mélange des versions de deux dépôts');
    assert.equal(m.summary(FILMS)?.version, '1.0.0');

    // Installé depuis le dépôt tiers : le dépôt officiel ne le remplace pas non plus.
    const n = mire(official, [tiers]);
    await n.start();
    await n.add(tiers);
    assert.equal(failed(await n.client.install(FILMS, undefined, id)), 'ok');
    official.publish([{ id: FILMS, version: '10.0.0' }], { generated: '2026-11-20T00:00:00.000Z' });
    await n.client.refresh();
    assert.equal(failed(await n.client.install(FILMS, undefined, 'official')), 'owner');
    assert.equal(n.client.updates().length, 0);
    assert.equal(failed(await n.client.update(FILMS)), 'ok', 'mise à jour depuis son dépôt (rien de plus récent)');
    assert.equal(n.summary(FILMS)?.version, '9.0.0');
    tiers.publish([{ id: FILMS, version: '9.1.0' }], { generated: '2026-11-20T00:00:00.000Z' });
    await n.client.refresh();
    assert.equal(failed(await n.client.update(FILMS)), 'ok');
    assert.equal(n.summary(FILMS)?.version, '9.1.0');
  });

  it('un plugin tiers « mire. » posé à la main est refusé au chargement', async () => {
    const official = testRepo([]);
    const m = mire(official, []);
    const dir = path.join(m.installed, 'mire.faux', '1.0.0');
    fs.mkdirSync(dir, { recursive: true });
    const { pluginEntries } = await import('./helpers.ts');
    for (const e of pluginEntries({ id: 'mire.faux', version: '1.0.0' })) {
      fs.mkdirSync(path.dirname(path.join(dir, e.path)), { recursive: true });
      fs.writeFileSync(path.join(dir, e.path), e.data ?? '');
    }
    fs.writeFileSync(path.join(m.installed, 'mire.faux', 'origin.json'), JSON.stringify({ repository: 'repo-0123456789abcdef', version: '1.0.0' }));
    await m.start();
    assert.equal(m.summary('mire.faux')?.status, 'refused');
  });
});

describe('Accord pour un plugin tiers de code sensible', () => {
  const outil = (version: string, permissions: Record<string, unknown> = { launch: true }): PluginSpec => ({
    id: OUTIL,
    version,
    level: 'privileged',
    permissions,
  });

  it('refusé sans accord ; accord lié à la version ; une mise à jour qui élargit le redemande', async () => {
    const tiers = testRepo([outil('1.0.0')], { base: T1 });
    const m = mire(testRepo([]), [tiers]);
    await m.start();
    const id = await m.add(tiers);
    const shown = m.client.available().find((p) => p.id === OUTIL)!;
    assert.deepEqual([shown.sensitive, shown.consented], [true, false]);

    const refused = await m.client.install(OUTIL);
    assert.equal(failed(refused), 'consent');
    const asked = (refused as { consent?: PluginConsentRequest[] }).consent;
    assert.deepEqual(asked, [{ plugin: OUTIL, repository: id, version: '1.0.0', level: 'privileged', permissions: { launch: true } }]);
    assert.equal(fs.existsSync(path.join(m.installed, OUTIL)), false, 'rien n’est téléchargé sans accord');

    assert.equal(m.client.consent(OUTIL, id, '2.0.0'), null, 'version inconnue');
    assert.deepEqual(m.client.consent(OUTIL, id, '1.0.0'), asked![0]);
    assert.equal(failed(await m.client.install(OUTIL)), 'ok');
    assert.notEqual(m.summary(OUTIL)?.status, 'refused');

    // Même permissions : l'accord suit la mise à jour.
    tiers.publish([outil('1.1.0')], { generated: '2026-11-20T00:00:00.000Z' });
    await m.client.refresh();
    assert.equal(failed(await m.client.update(OUTIL)), 'ok');
    assert.equal(m.summary(OUTIL)?.version, '1.1.0');
    assert.notEqual(m.summary(OUTIL)?.status, 'refused');

    // Une permission de plus : l'accord est redemandé, la version installée reste.
    tiers.publish([outil('1.2.0', { launch: true, deleteFiles: true })], { generated: '2026-11-21T00:00:00.000Z' });
    await m.client.refresh();
    const wider = await m.client.update(OUTIL);
    assert.equal(failed(wider), 'consent');
    assert.equal(m.summary(OUTIL)?.version, '1.1.0');
    m.client.consent(OUTIL, id, '1.2.0');
    assert.equal(failed(await m.client.update(OUTIL)), 'ok');
    assert.equal(m.summary(OUTIL)?.version, '1.2.0');
  });

  it('au chargement, l’accord est relu : sans lui, le plugin tiers privileged est refusé', async () => {
    const tiers = testRepo([outil('1.0.0')], { base: T1 });
    const m = mire(testRepo([]), [tiers]);
    await m.start();
    const id = await m.add(tiers);
    m.client.consent(OUTIL, id, '1.0.0');
    assert.equal(failed(await m.client.install(OUTIL)), 'ok');
    m.trust.revoke(OUTIL, id);
    const again = mire(testRepo([]), [tiers], m.userData);
    await again.start();
    assert.equal(again.summary(OUTIL)?.status, 'refused');
    assert.match(again.summary(OUTIL)?.message ?? '', /plugins\.refused\.consent/);

    // Un origin.json qui prétend venir d'un autre dépôt ne profite pas de l'accord.
    m.trust.grant({ plugin: OUTIL, repository: id, version: '1.0.0', level: 'privileged', permissions: { launch: true } });
    fs.writeFileSync(path.join(m.installed, OUTIL, 'origin.json'), JSON.stringify({ repository: 'repo-fedcba9876543210', version: '1.0.0' }));
    const third = mire(testRepo([]), [tiers], m.userData);
    await third.start();
    assert.equal(third.summary(OUTIL)?.status, 'refused');
  });

  it('pas d’accord demandé pour un plugin de code limité tiers, ni pour un plugin officiel', async () => {
    const official = testRepo([{ id: 'mire.outil', version: '1.0.0', level: 'privileged', permissions: { launch: true } }]);
    const tiers = testRepo([{ id: FILMS, version: '1.0.0', level: 'code', permissions: { hosts: ['api.exemple.org'] } }], { base: T1 });
    const m = mire(official, [tiers]);
    await m.start();
    await m.add(tiers);
    assert.equal(failed(await m.client.install(FILMS)), 'ok');
    assert.equal(failed(await m.client.install('mire.outil')), 'ok');
  });
});

describe('Retrait d’un dépôt tiers', () => {
  const specs: PluginSpec[] = [
    { id: OUTIL, version: '1.0.0' },
    { id: FILMS, version: '1.0.0', dependencies: { [OUTIL]: '^1.0.0' } },
  ];

  it('plugins gardés : ils restent installés, sans mise à jour', async () => {
    const tiers = testRepo(specs, { base: T1 });
    const m = mire(testRepo([]), [tiers]);
    await m.start();
    const id = await m.add(tiers);
    assert.equal(failed(await m.client.install(FILMS)), 'ok');
    const out = await m.client.removeRepository(id, { uninstall: false, keepData: false });
    assert.ok(out.ok);
    assert.deepEqual([out.uninstalled, out.kept], [[], []]);
    assert.deepEqual(
      out.repositories.map((r) => r.id),
      ['official'],
    );
    assert.equal(fs.existsSync(path.join(m.userData, 'repos', id)), false, 'cache de l’index effacé');
    assert.equal(m.summary(FILMS)?.status, 'active');
    assert.equal(m.summary(FILMS)?.trust, 'third-party');
    assert.equal(failed(await m.client.update(FILMS)), 'repository');
    assert.deepEqual(m.client.available(), []);
  });

  it('plugins désinstallés, dépendances comprises ; un plugin dont un autre dépôt a besoin est gardé', async () => {
    const tiers = testRepo(specs, { base: T1 });
    const autre = testRepo([{ id: 'org.exemple.pack', version: '1.0.0', dependencies: { [OUTIL]: '^1.0.0' } }], { base: T2 });
    const m = mire(testRepo([]), [tiers, autre]);
    await m.start();
    const id = await m.add(tiers);
    await m.add(autre);
    assert.equal(failed(await m.client.install(FILMS)), 'ok');
    assert.equal(failed(await m.client.install('org.exemple.pack')), 'ok');
    const out = await m.client.removeRepository(id, { uninstall: true, keepData: false });
    assert.ok(out.ok);
    assert.deepEqual(out.uninstalled, [FILMS]);
    assert.deepEqual(out.kept, [{ id: OUTIL, by: ['org.exemple.pack'] }]);
    assert.equal(m.summary(FILMS), undefined);
    assert.equal(fs.existsSync(path.join(m.installed, FILMS)), false);
    assert.equal(m.trust.get(id), null);
  });

  it('refuse un dépôt inconnu et le dépôt officiel', async () => {
    const m = mire(testRepo([]), []);
    assert.equal(failed(await m.client.removeRepository('official', { uninstall: true, keepData: false })), 'repository');
    assert.equal(failed(await m.client.removeRepository('repo-0123456789abcdef', { uninstall: false, keepData: false })), 'repository');
  });
});

describe('Un hôte isolé par dépôt tiers', () => {
  it('groupe d’après le dépôt noté par Mire', () => {
    assert.equal(hostGroup({ origin: 'bundled', repository: null }), MAIN_GROUP);
    assert.equal(hostGroup({ origin: 'installed', repository: 'official' }), MAIN_GROUP);
    assert.equal(hostGroup({ origin: 'installed', repository: null }), MAIN_GROUP);
    assert.equal(hostGroup({ origin: 'installed', repository: 'repo-0123456789abcdef' }), 'repo-0123456789abcdef');
  });

  it('les plugins de deux dépôts tiers tournent dans deux hôtes distincts, ceux de l’officiel dans le sien', async () => {
    const created: string[] = [];
    const fake = (group: string): PooledHost => {
      created.push(group);
      const running = new Set<string>();
      return {
        start: async (id) => (running.add(id), {} as never),
        stop: (id) => void running.delete(id),
        shutdown: () => running.clear(),
        plugins: () => [...running],
      };
    };
    const pool = createHostPool(fake);
    const endpoint = { handle: async () => null, onEvent: () => {} };
    await pool.start({ id: 'a', dir: '/a', origin: 'installed', repository: 'official' }, endpoint, 1000);
    await pool.start({ id: 'b', dir: '/b', origin: 'bundled', repository: null }, endpoint, 1000);
    await pool.start({ id: 'c', dir: '/c', origin: 'installed', repository: 'repo-1111111111111111' }, endpoint, 1000);
    await pool.start({ id: 'd', dir: '/d', origin: 'installed', repository: 'repo-2222222222222222' }, endpoint, 1000);
    await pool.start({ id: 'e', dir: '/e', origin: 'installed', repository: 'repo-2222222222222222' }, endpoint, 1000);
    assert.deepEqual(created, [MAIN_GROUP, 'repo-1111111111111111', 'repo-2222222222222222']);
    assert.deepEqual(pool.groups(), { [MAIN_GROUP]: ['a', 'b'], 'repo-1111111111111111': ['c'], 'repo-2222222222222222': ['d', 'e'] });
    pool.stop('d');
    assert.deepEqual(pool.groups()['repo-2222222222222222'], ['e']);
  });
});

describe('IPC des dépôts tiers', () => {
  it('vérifie les arguments : adresse https, clé PEM ed25519, tailles, empreinte, dépôt configuré, version', () => {
    const calls: unknown[][] = [];
    const { publicKey } = keys();
    const key = pem(publicKey);
    const ctx = {
      repos: {
        knows: (id: string) => id === OUTIL,
        hasRepository: (id: string) => id === 'repo-0123456789abcdef' || id === 'official',
        inspectRepository: (...a: unknown[]) => calls.push(['inspect', ...a]),
        addRepository: (...a: unknown[]) => calls.push(['add', ...a]),
        removeRepository: (...a: unknown[]) => calls.push(['remove', ...a]),
        consent: (...a: unknown[]) => calls.push(['consent', ...a]),
        install: (...a: unknown[]) => calls.push(['install', ...a]),
      },
    } as unknown as MainContext;
    const h = pluginsHandlers(ctx);
    const url = 'https://exemple.org/index.json';
    const fp = keyId(publicKey);
    assert.equal(h.reposInspect('http://exemple.org/index.json', key), null);
    assert.equal(h.reposInspect(url, 'clé'), null);
    assert.equal(h.reposInspect(url, key + 'x'.repeat(5000)), null);
    assert.equal(h.reposInspect(`https://exemple.org/${'a'.repeat(5000)}`, key), null);
    assert.equal(h.reposInspect(url, pem(keys().publicKey).replace('PUBLIC', 'PRIVATE')), null);
    assert.equal(h.reposAdd(url, key, fp.toUpperCase()), null);
    assert.equal(h.reposAdd(url, key, 'abc'), null);
    assert.equal(h.reposRemove('repo-ffffffffffffffff', true, false), null);
    assert.equal(h.reposRemove('repo-0123456789abcdef', 'oui' as unknown as boolean, false), null);
    assert.equal(h.pluginsConsent(OUTIL, 'repo-0123456789abcdef', '1.0'), null);
    assert.equal(h.pluginsConsent(OUTIL, '../x', '1.0.0'), null);
    assert.equal(h.pluginsInstall(OUTIL, undefined, 'repo-ffffffffffffffff'), null);
    assert.deepEqual(calls, []);
    h.reposInspect(url, key);
    h.reposAdd(url, key, fp);
    h.reposRemove('repo-0123456789abcdef', true, false);
    h.pluginsConsent(OUTIL, 'repo-0123456789abcdef', '1.0.0');
    h.pluginsInstall(OUTIL, undefined, 'repo-0123456789abcdef');
    assert.deepEqual(calls, [
      ['inspect', url, key],
      ['add', url, key, fp],
      ['remove', 'repo-0123456789abcdef', { uninstall: true, keepData: false }],
      ['consent', OUTIL, 'repo-0123456789abcdef', '1.0.0'],
      ['install', OUTIL, undefined, 'repo-0123456789abcdef'],
    ]);
  });
});
