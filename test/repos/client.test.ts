// Client des dépôts (P3-07) avec le dépôt de test local et le vrai hôte de plugins : installation avec les
// dépendances, mise à jour, désinstallation ; paquet altéré, archive piégée, index mal signé refusés ; hors ligne ;
// retour à la version précédente quand l'installation échoue ; arguments de l'IPC vérifiés.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { PluginsProgress } from '@mire/shared/ipc';
import { pluginsHandlers } from '../../src/main/ipc/handlers/plugins.ts';
import type { MainContext } from '../../src/main/ipc/context.ts';
import { createJournal } from '../../src/main/plugins/journal.ts';
import { createPluginService } from '../../src/main/plugins/service.ts';
import { createPluginState } from '../../src/main/plugins/state.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { createRepoClient } from '../../src/main/repos/client.ts';
import { createInstaller } from '../../src/main/repos/installer.ts';
import { createRepositories } from '../../src/main/repos/repositories.ts';
import { INDEX_URL, keys, pluginEntries, tempDir, testRepo, tgz, type PluginSpec, type TestRepo } from './helpers.ts';

const A = 'org.exemple.films';
const B = 'org.exemple.base';

/** Mire (hôte de plugins et client des dépôts) sur un dossier de données ; relancé avec le même dossier. */
function mire(repo: TestRepo, userData = tempDir(), { official = false } = {}) {
  const installed = path.join(userData, 'plugins');
  fs.mkdirSync(installed, { recursive: true });
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
  });
  const progress: PluginsProgress[] = [];
  const config = { id: official ? 'official' : 'test', index: INDEX_URL, publicKey: repo.publicKey, official };
  const client = createRepoClient({
    repositories: createRepositories({ cacheDir: path.join(userData, 'repos'), repositories: () => [config], fetch: repo.fetch, log: () => {} }),
    installer: createInstaller({ pluginsDir: installed, fetch: repo.fetch }),
    plugins: service,
    appVersion: '1.0.0',
    locale: () => 'fr',
    translate: (k, vars) => `${k} ${JSON.stringify(vars ?? {})}`,
    onProgress: (p) => progress.push(p),
    log: () => {},
  });
  const versions = (id: string) => (fs.existsSync(path.join(installed, id)) ? fs.readdirSync(path.join(installed, id)).sort() : []);
  const active = () => Object.fromEntries(service.list().map((p) => [p.id, `${p.version} ${p.status}`]));
  return { userData, installed, service, client, progress, versions, active };
}

const published = (): PluginSpec[] => [
  { id: B, version: '1.0.0' },
  { id: B, version: '1.1.0' },
  { id: A, version: '1.0.0', dependencies: { [B]: '^1.0.0' } },
];

/** Fichiers et dossiers sous `dir`, chemins relatifs. */
function tree(dir: string): string[] {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: false }).map(String).sort();
}

describe('installation depuis un dépôt', () => {
  it('installe un plugin avec ses dépendances, note son origine et l’active', async () => {
    const repo = testRepo(published());
    const m = mire(repo);
    await m.service.start();
    await m.client.refresh();
    const offer = m.client.available().find((p) => p.id === A)!;
    assert.equal(offer.version, '1.0.0');
    assert.equal(offer.repository, 'test');
    assert.deepEqual(offer.dependencies, { [B]: '^1.0.0' });
    assert.equal(offer.installed, null);

    const r = await m.client.install(A);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(m.active(), { [A]: '1.0.0 active', [B]: '1.1.0 active' });
    assert.deepEqual(m.versions(A), ['1.0.0', 'origin.json']);
    assert.deepEqual(m.versions(B), ['1.1.0', 'origin.json']);
    const info = m.service.list().find((p) => p.id === A)!;
    assert.equal(info.repository, 'test');
    assert.deepEqual(info.permissions, {});
    const phases = m.progress.map((p) => `${p.phase}${p.plugin ? ` ${p.plugin}` : ''}`);
    assert.deepEqual([...new Set(phases)], ['resolve', `download ${B}`, `verify ${B}`, `download ${A}`, `verify ${A}`, 'install', 'done']);
    assert.equal(m.client.available().find((p) => p.id === A)!.installed, '1.0.0');
    // Aucune requête hors du dépôt, et chacune suit la redirection vers le stockage.
    assert.ok(repo.requests.every((u) => u.startsWith('https://')));
  });

  it('met à jour, puis désinstalle', async () => {
    const repo = testRepo(published());
    const m = mire(repo);
    await m.service.start();
    await m.client.refresh();
    assert.ok((await m.client.install(A)).ok);
    repo.publish([...published(), { id: A, version: '1.2.0', dependencies: { [B]: '^1.0.0' } }], { generated: '2026-11-20T00:00:00.000Z' });
    await m.client.refresh();
    assert.deepEqual(
      m.client.updates().map((p) => [p.id, p.installed, p.update]),
      [[A, '1.0.0', '1.2.0']],
    );
    const r = await m.client.update(A);
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(m.versions(A), ['1.2.0', 'origin.json']);
    assert.equal(m.active()[A], '1.2.0 active');
    assert.deepEqual(m.client.updates(), []);

    assert.equal((await m.service.uninstall(B, { keepData: false }))?.ok, false);
    assert.equal((await m.service.uninstall(A, { keepData: false }))?.ok, true);
    assert.equal((await m.service.uninstall(B, { keepData: false }))?.ok, true);
    assert.deepEqual(m.versions(A), []);
    assert.deepEqual(m.service.list(), []);
  });

  it('fonctionne hors ligne avec les plugins installés et l’index en cache', async () => {
    const repo = testRepo(published());
    const first = mire(repo);
    await first.service.start();
    await first.client.refresh();
    assert.ok((await first.client.install(A)).ok);
    await first.service.stop();

    repo.offline = true;
    const again = mire(repo, first.userData);
    await again.service.start();
    assert.deepEqual(again.active(), { [A]: '1.0.0 active', [B]: '1.1.0 active' });
    assert.deepEqual(
      again.client.available().map((p) => p.id),
      [B, A],
    );
    const [status] = await again.client.refresh();
    assert.equal(status.error, 'network');
    assert.ok(status.message);
    const r = await again.client.install(B, '1.0.0');
    assert.equal(r.ok ? 'ok' : r.code, 'network');
    assert.deepEqual(again.versions(B), ['1.1.0', 'origin.json']);
  });
});

describe('refus', () => {
  it('refuse un paquet altéré : rien n’est installé ni laissé sur le disque', async () => {
    const repo = testRepo(published());
    const m = mire(repo);
    await m.service.start();
    await m.client.refresh();
    const url = repo.index.plugins.find((p) => p.id === A)!.versions[0].package.url;
    const bytes = Buffer.from(repo.files.get(url)!);
    bytes[bytes.length - 5] ^= 0xff;
    repo.files.set(url, bytes);
    const r = await m.client.install(A);
    assert.equal(r.ok ? 'ok' : r.code, 'checksum');
    // La dépendance, téléchargée et vérifiée, n'a pas été mise en place : tout est fait ou rien.
    assert.deepEqual(
      tree(m.installed).filter((f) => !f.startsWith('logs') && f !== 'state.json'),
      [],
    );
    assert.deepEqual(m.service.list(), []);
    assert.equal(m.progress.at(-1)!.phase, 'error');
  });

  it('refuse une archive piégée (chemin `..`, lien symbolique) sans rien écrire hors du dossier des plugins', async () => {
    for (const trap of [
      { path: '../../evil.txt', data: 'x' },
      { path: 'packs/lien', type: '2', link: '../../../../etc/passwd' },
    ]) {
      const repo = testRepo([{ id: A, version: '1.0.0', bytes: tgz([...pluginEntries({ id: A, version: '1.0.0' }), trap]) }]);
      const m = mire(repo);
      await m.service.start();
      await m.client.refresh();
      const r = await m.client.install(A);
      assert.equal(r.ok ? 'ok' : r.code, 'archive');
      assert.deepEqual(
        tree(m.userData).filter((f) => !/^(plugins(\/logs.*|\/state\.json)?|repos.*)$/.test(f)),
        [],
      );
    }
  });

  it('refuse un paquet dont le manifeste ne correspond pas à l’index', async () => {
    const repo = testRepo([{ id: A, version: '1.0.0', edit: (mf) => (mf.version = '9.9.9') }]);
    const m = mire(repo);
    await m.service.start();
    await m.client.refresh();
    const r = await m.client.install(A);
    assert.equal(r.ok ? 'ok' : r.code, 'manifest');
  });

  it('ignore un index mal signé : rien n’est proposé', async () => {
    const repo = testRepo(published());
    repo.publish(published(), { sign: keys().privateKey });
    const m = mire(repo);
    const [status] = await m.client.refresh();
    assert.equal(status.error, 'signature');
    assert.deepEqual(m.client.available(), []);
    assert.equal(m.client.knows(A), false);
  });

  it('refuse les dépendances introuvables et les versions inconnues', async () => {
    const repo = testRepo([{ id: A, version: '1.0.0', dependencies: { 'org.exemple.absent': '^1.0.0' } }]);
    const m = mire(repo);
    await m.client.refresh();
    const r = await m.client.install(A);
    assert.equal(r.ok ? 'ok' : r.code, 'dependency');
    const v = await m.client.install(A, '3.0.0');
    assert.equal(v.ok ? 'ok' : v.code, 'unknown');
  });
});

describe('retour à la version précédente', () => {
  it('remet la version précédente (et retire les dépendances installées avec) quand le plugin est refusé au chargement', async () => {
    const repo = testRepo(published());
    const m = mire(repo);
    await m.service.start();
    await m.client.refresh();
    assert.ok((await m.client.install(A)).ok);
    const before = fs.readFileSync(path.join(m.installed, A, 'origin.json'), 'utf8');
    // 2.0.0 : paquet conforme à l'index, mais du code dans un plugin de données (refusé par l'hôte), et une nouvelle
    // dépendance qui sera installée avec lui.
    repo.publish(
      [
        ...published(),
        { id: 'org.exemple.neuf', version: '1.0.0' },
        { id: A, version: '2.0.0', dependencies: { [B]: '^1.0.0', 'org.exemple.neuf': '^1.0.0' }, extra: [{ path: 'main.js', data: 'export default 1;' }] },
      ],
      { generated: '2026-11-20T00:00:00.000Z' },
    );
    await m.client.refresh();
    const r = await m.client.update(A);
    assert.equal(r.ok ? 'ok' : r.code, 'refused');
    assert.deepEqual(m.versions(A), ['1.0.0', 'origin.json']);
    assert.equal(fs.readFileSync(path.join(m.installed, A, 'origin.json'), 'utf8'), before);
    assert.deepEqual(m.versions('org.exemple.neuf'), []);
    assert.deepEqual(m.active(), { [A]: '1.0.0 active', [B]: '1.1.0 active' });
  });

  it('remet une réinstallation de la même version quand le disque refuse', async () => {
    const repo = testRepo(published());
    const m = mire(repo);
    await m.service.start();
    await m.client.refresh();
    assert.ok((await m.client.install(B, '1.1.0')).ok);
    const installer = createInstaller({ pluginsDir: m.installed, fetch: repo.fetch });
    const entry = repo.index.plugins.find((p) => p.id === B)!.versions[0];
    const item = { id: B, entry, repository: 'test', official: false };
    const staging = await installer.prepare(item);
    const c = await installer.commit(item, staging);
    assert.ok(c.backup && fs.existsSync(c.backup));
    await installer.rollback(c);
    assert.deepEqual(m.versions(B), ['1.1.0', 'origin.json']);
  });
});

describe('dépôt officiel', () => {
  it('accepte le préfixe mire. d’un index signé par la clé du dépôt officiel', async () => {
    const id = 'mire.exemple.donnees';
    const repo = testRepo([{ id, version: '1.0.0' }]);
    const m = mire(repo, tempDir(), { official: true });
    await m.service.start();
    await m.client.refresh();
    assert.ok((await m.client.install(id)).ok);
    const info = m.service.list().find((p) => p.id === id)!;
    assert.equal(info.status, 'active');
    assert.equal(info.repository, 'official');
    // Sans `origin.json` (copié à la main), le même dossier est refusé : le préfixe est réservé.
    fs.rmSync(path.join(m.installed, id, 'origin.json'));
    const [after] = await m.service.reload([id]);
    assert.equal(after.status, 'refused');
  });
});

describe('IPC', () => {
  it('vérifie les arguments : identifiant connu des dépôts, version, booléen', async () => {
    const calls: unknown[][] = [];
    const ctx = {
      repos: {
        knows: (id: string) => id === A,
        install: (...a: unknown[]) => calls.push(['install', ...a]),
        update: (...a: unknown[]) => calls.push(['update', ...a]),
      },
      plugins: { uninstall: (...a: unknown[]) => calls.push(['uninstall', ...a]) },
    } as unknown as MainContext;
    const h = pluginsHandlers(ctx);
    assert.equal(h.pluginsInstall('org.exemple.autre'), null);
    assert.equal(h.pluginsInstall('../x'), null);
    assert.equal(h.pluginsInstall(A, '1.0'), null);
    assert.equal(h.pluginsInstall(A, { toString: () => '1.0.0' } as unknown as string), null);
    assert.equal(h.pluginsUpdate(42 as unknown as string), null);
    assert.equal(h.pluginsUninstall(A, 'oui' as unknown as boolean), null);
    assert.equal(h.pluginsUninstall('x'.repeat(200), true), null);
    assert.deepEqual(calls, []);
    h.pluginsInstall(A, '1.0.0');
    h.pluginsInstall(A);
    h.pluginsUpdate(A);
    h.pluginsUninstall(A, true);
    assert.deepEqual(calls, [
      ['install', A, '1.0.0'],
      ['install', A, undefined],
      ['update', A],
      ['uninstall', A, { keepData: true }],
    ]);
  });
});
