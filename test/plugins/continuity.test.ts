// Service de continuité (P5-01) avec le vrai hôte de plugins, le vrai client des dépôts et le dépôt de test local
// (`test/repos/helpers.ts`) : plugin inclus activé, plugin à installer hors ligne puis en ligne, introuvable dans le
// dépôt (impossible, sans boucle), échecs passagers bornés, dépôt officiel seulement, reprise rejouée sans effet.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { ContinuitySummary } from '@mire/shared/ipc';
import { createConfigService } from '../../src/main/config/service.ts';
import type { ContinuityRule } from '../../src/main/config/migrations/continuity.ts';
import { pluginsHandlers } from '../../src/main/ipc/handlers/plugins.ts';
import type { MainContext } from '../../src/main/ipc/context.ts';
import { createContinuity, MAX_ATTEMPTS } from '../../src/main/plugins/continuity.ts';
import { createJournal } from '../../src/main/plugins/journal.ts';
import { createPluginService } from '../../src/main/plugins/service.ts';
import { createPluginState } from '../../src/main/plugins/state.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { createRepoClient } from '../../src/main/repos/client.ts';
import { createInstaller } from '../../src/main/repos/installer.ts';
import { createRepositories } from '../../src/main/repos/repositories.ts';
import { INDEX_URL, pluginEntries, tempDir, testRepo, type TestRepo } from '../repos/helpers.ts';

const BUNDLED = 'mire.essai.lecteurs';
const INSTALL = 'mire.essai.infos';
const ABSENT = 'mire.essai.absent';
const rule = (id: string, plugin: string, mode: ContinuityRule['mode']): ContinuityRule => ({ id, plugin, mode, applies: () => true });
const RULES = [rule('P5-inclus', BUNDLED, 'bundled'), rule('P5-installer', INSTALL, 'install'), rule('P5-absent', ABSENT, 'install')];
const translate = (k: string, vars?: Record<string, string | number>) => `${k} ${JSON.stringify(vars ?? {})}`;

/** Plugin inclus factice, posé dans `resources/plugins/` d'essai. */
function bundledRoot(): string {
  const root = tempDir('mire-continuite-inclus-');
  for (const e of pluginEntries({ id: BUNDLED, version: '1.0.0' })) {
    const file = path.join(root, BUNDLED, e.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, e.data ?? '');
  }
  return root;
}

/** Mire (configuration, plugins, dépôts, continuité) sur un dossier de données ; relancé avec le même dossier. */
async function mire(repo: TestRepo, userData: string, { queue = [] as string[], official = true, bundled = bundledRoot() } = {}) {
  const installed = path.join(userData, 'plugins');
  fs.mkdirSync(installed, { recursive: true });
  const configFile = path.join(userData, 'config.json');
  if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, JSON.stringify({ version: 10, continuity: queue }));
  const config = createConfigService({ file: configFile, log: () => {} });
  config.load();
  const plugins = createPluginService({
    roots: { bundled, installed },
    appVersion: '1.0.0',
    languages: ['fr', 'en'],
    state: createPluginState(path.join(installed, 'state.json')),
    journal: createJournal({ dir: path.join(installed, 'logs') }),
    tagRegistry: createRegistry((k) => k),
    setTexts: () => {},
    translate,
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
  const repoConfig = { id: official ? 'official' : 'tiers', index: INDEX_URL, publicKey: repo.publicKey, official };
  const repos = createRepoClient({
    repositories: createRepositories({ cacheDir: path.join(userData, 'repos'), repositories: () => [repoConfig], fetch: repo.fetch, log: () => {} }),
    installer: createInstaller({ pluginsDir: installed, fetch: repo.fetch }),
    plugins,
    appVersion: '1.0.0',
    locale: () => 'fr',
    translate,
    log: () => {},
  });
  const changes: ContinuitySummary[] = [];
  const continuity = createContinuity({
    file: path.join(installed, 'continuity.json'),
    config,
    plugins,
    repos,
    translate,
    rules: RULES,
    onChange: (s) => changes.push(s),
    log: () => {},
  });
  await plugins.start();
  const status = () => Object.fromEntries(continuity.summary().items.map((i) => [i.plugin, i.status]));
  const active = (id: string) => plugins.list().find((p) => p.id === id)?.status;
  return { config, plugins, repos, continuity, changes, status, active };
}

describe('continuité : plugins inclus et à installer', () => {
  it('hors ligne puis en ligne : inclus activé tout de suite, installation en attente puis faite', async () => {
    const repo = testRepo([{ id: INSTALL, version: '1.0.0' }]);
    repo.offline = true;
    const userData = tempDir();
    const m = await mire(repo, userData, { queue: ['P5-inclus', 'P5-installer'] });
    await m.continuity.start();
    assert.deepEqual(m.status(), { [BUNDLED]: 'installed', [INSTALL]: 'pending' });
    assert.equal(m.active(BUNDLED), 'active');
    // La file de la configuration est reprise puis effacée, sur le disque aussi.
    assert.equal(m.config.get().continuity, undefined);
    assert.equal('continuity' in JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8')), false);
    // Récapitulatif : un plugin activé, un en attente ; montré une fois.
    const first = m.continuity.summary();
    assert.match(first.notice!, /continuity\.notice\.installed \{"count":1\}/);
    assert.match(first.notice!, /continuity\.notice\.pending \{"count":1\}/);
    assert.deepEqual(
      first.items.find((i) => i.plugin === BUNDLED),
      { plugin: BUNDLED, name: `Essai ${BUNDLED}`, bundled: true, status: 'installed', reason: null },
    );
    assert.equal(m.continuity.seen(), true);
    assert.equal(m.continuity.summary().notice, null);

    // Relancé, toujours hors ligne : toujours en attente, sans compter d'essai.
    const again = await mire(repo, userData);
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) await again.continuity.start();
    assert.deepEqual(again.status(), { [BUNDLED]: 'installed', [INSTALL]: 'pending' });
    assert.equal(again.continuity.summary().notice, null);

    // La connexion revient : la mise à jour des index (Centre) relance l'installation.
    repo.offline = false;
    const status = await again.repos.refresh();
    await again.continuity.afterRefresh(status);
    assert.deepEqual(again.status(), { [BUNDLED]: 'installed', [INSTALL]: 'installed' });
    assert.equal(again.active(INSTALL), 'active');
    assert.equal(again.plugins.list().find((p) => p.id === INSTALL)?.repository, 'official');
    assert.match(again.changes.at(-1)!.notice!, /continuity\.notice\.installed \{"count":1\}/);

    // Relancé en ligne : plus rien à faire, aucune requête.
    const before = repo.requests.length;
    const third = await mire(repo, userData);
    await third.continuity.start();
    assert.equal(repo.requests.length, before);
  });

  it('au démarrage en ligne : installé sans demande de l’interface', async () => {
    const repo = testRepo([{ id: INSTALL, version: '1.0.0' }]);
    const m = await mire(repo, tempDir(), { queue: ['P5-installer'] });
    await m.continuity.start();
    assert.deepEqual(m.status(), { [INSTALL]: 'installed' });
    assert.equal(m.active(INSTALL), 'active');
  });

  it('plugin introuvable dans le dépôt : impossible avec sa raison, sans boucle', async () => {
    const repo = testRepo([{ id: INSTALL, version: '1.0.0' }]);
    const userData = tempDir();
    const m = await mire(repo, userData, { queue: ['P5-absent'] });
    await m.continuity.start();
    assert.deepEqual(m.status(), { [ABSENT]: 'failed' });
    const item = m.continuity.summary().items[0];
    assert.match(item.reason!, /^repos\.errors\.unknown/);
    assert.match(m.continuity.summary().notice!, /continuity\.notice\.failed/);
    // Relancé, index mis à jour : plus aucun essai d'installation (seul l'index est relu par la mise à jour).
    const before = repo.requests.length;
    const again = await mire(repo, userData);
    await again.continuity.start();
    await again.continuity.afterRefresh(await again.repos.refresh());
    assert.deepEqual(again.status(), { [ABSENT]: 'failed' });
    assert.ok(repo.requests.slice(before).every((u) => u.endsWith('index.json')));
  });

  it('échecs passagers : retentés à chaque mise à jour des index, puis impossible après MAX_ATTEMPTS', async () => {
    const repo = testRepo([{ id: INSTALL, version: '1.0.0' }]);
    // Index en ligne, paquet absent du serveur : erreur réseau à chaque essai.
    for (const url of [...repo.files.keys()]) if (!url.endsWith('index.json')) repo.files.delete(url);
    const m = await mire(repo, tempDir(), { queue: ['P5-installer'] });
    await m.continuity.start();
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      assert.deepEqual(m.status(), { [INSTALL]: 'pending' }, `essai ${i}`);
      await m.continuity.afterRefresh(await m.repos.refresh());
    }
    assert.deepEqual(m.status(), { [INSTALL]: 'failed' });
    assert.match(m.continuity.summary().items[0].reason!, /^repos\.errors\.network/);
  });

  it('dépôt officiel seulement : un dépôt tiers ne sert jamais aux installations de la continuité', async () => {
    // Un dépôt tiers ne peut pas publier un identifiant `mire.` (son index est refusé) : l'installation attend.
    const tiers = testRepo([{ id: INSTALL, version: '1.0.0' }]);
    const m = await mire(tiers, tempDir(), { queue: ['P5-installer'], official: false });
    await m.continuity.start();
    assert.deepEqual(m.status(), { [INSTALL]: 'pending' });
    assert.equal(m.repos.knows(INSTALL), false);
    // Pour un autre identifiant, publié par le dépôt tiers : `install` le trouve, `installOfficial` non.
    const other = 'org.tiers.infos';
    const t2 = testRepo([{ id: other, version: '1.0.0' }]);
    const m2 = await mire(t2, tempDir(), { official: false });
    await m2.repos.refresh();
    assert.ok(m2.repos.knows(other));
    const out = await m2.repos.installOfficial(other);
    assert.equal(!out.ok && out.code, 'unknown');
    assert.equal(m2.active(other), undefined);
    assert.ok((await m2.repos.install(other)).ok);
  });

  it('rejouée (import du même fichier ancien) : rien de plus ; règle inconnue ignorée', async () => {
    const repo = testRepo([{ id: INSTALL, version: '1.0.0' }]);
    repo.offline = true;
    const userData = tempDir();
    const m = await mire(repo, userData, { queue: ['P5-inclus', 'P5-installer'] });
    await m.continuity.start();
    m.continuity.seen();
    const file = path.join(userData, 'plugins', 'continuity.json');
    const before = fs.readFileSync(file, 'utf8');
    m.config.replace({ ...m.config.get(), continuity: ['P5-inclus', 'P5-installer', 'P5-inconnue'] });
    await new Promise((r) => setImmediate(r));
    await m.continuity.start();
    assert.equal(m.config.get().continuity, undefined);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(m.continuity.summary().notice, null);
  });

  it('plugin inclus absent de cette version de Mire : impossible avec sa raison', async () => {
    const repo = testRepo([]);
    repo.offline = true;
    const m = await mire(repo, tempDir(), { queue: ['P5-inclus'], bundled: tempDir() });
    await m.continuity.start();
    assert.deepEqual(m.status(), { [BUNDLED]: 'failed' });
    assert.match(m.continuity.summary().items[0].reason!, /^continuity\.reasons\.missing/);
  });
});

describe('continuité : IPC', () => {
  it('récapitulatif sans argument ; la mise à jour des index relance les installations en attente', async () => {
    const calls: unknown[][] = [];
    const ctx = {
      repos: { refresh: async () => ['statut'] },
      continuity: {
        summary: () => ({ items: [], notice: null }),
        seen: () => true,
        afterRefresh: async (...a: unknown[]) => void calls.push(a),
      },
    } as unknown as MainContext;
    const h = pluginsHandlers(ctx);
    assert.deepEqual(h.pluginsContinuity(), { items: [], notice: null });
    assert.equal(h.pluginsContinuitySeen(), true);
    assert.deepEqual(await h.reposRefresh(), ['statut']);
    assert.deepEqual(calls, [[['statut']]]);
  });
});
