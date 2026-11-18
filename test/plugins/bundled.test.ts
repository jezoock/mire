// Plugins inclus et dépendances dans le service (P3-05) : installation au premier lancement d'un plugin inclus,
// désactivation, refus au démarrage d'une dépendance absente ou circulaire, activation dans l'ordre, arrêt et retour
// de ceux qui dépendent d'un plugin, désinstallation (refusée si un autre en a besoin ou si le plugin est inclus ;
// données gardées ou non ; version incluse qui reprend sa place).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJournal } from '../../src/main/plugins/journal.ts';
import { createPluginService } from '../../src/main/plugins/service.ts';
import { createPluginState } from '../../src/main/plugins/state.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'mire-bundled-'));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;

const catalog = (code: string, name: string) => JSON.stringify({ meta: { code, name: code, app: '1.0.0' }, messages: { plugin: { name } } });

/** Plugin de données (une palette), avec ses dépendances. */
function dataPlugin(dir: string, id: string, version: string, dependencies: Record<string, string> = {}) {
  const files: Record<string, string> = {
    'mire-plugin.json': JSON.stringify({
      id,
      version,
      engines: { mire: '^1.0.0' },
      level: 'data',
      contributes: { palettes: [{ id: 'p', file: 'p.json' }] },
      dependencies,
      i18n: 'i18n/',
    }),
    'p.json': `{"version":"${version}"}`,
    'i18n/en.json': catalog('en', `${id} ${version}`),
    'i18n/fr.json': catalog('fr', `${id} ${version}`),
  };
  for (const [rel, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), c);
  }
}

function setup() {
  const base = path.join(root, `s${++n}`);
  const bundled = path.join(base, 'resources', 'plugins');
  const installed = path.join(base, 'userData', 'plugins');
  const dataRoot = path.join(base, 'userData', 'plugin-data');
  mkdirSync(installed, { recursive: true });
  const make = () =>
    createPluginService({
      roots: { bundled, installed },
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
      dropData: (id) => Promise.resolve(rmSync(path.join(dataRoot, id), { recursive: true, force: true })),
      watchdog: { interval: 0, timeout: 0 },
    });
  return { bundled, installed, dataRoot, make, state: () => JSON.parse(readFileSync(path.join(installed, 'state.json'), 'utf8')) };
}

type Service = ReturnType<ReturnType<typeof setup>['make']>;
const byId = (s: Service) => Object.fromEntries(s.list().map((p) => [p.id, p]));
const statuses = (s: Service) => Object.fromEntries(s.list().map((p) => [p.id, p.status]));

describe('plugins inclus', () => {
  it('sont installés au premier lancement, une fois, et peuvent être désactivés', async () => {
    const t = setup();
    dataPlugin(path.join(t.bundled, 'org.exemple.inclus'), 'org.exemple.inclus', '1.0.0');
    const s = t.make();
    await s.start();
    assert.equal(byId(s)['org.exemple.inclus'].origin, 'bundled');
    assert.equal(byId(s)['org.exemple.inclus'].status, 'active');
    await s.stop();
    assert.deepEqual(t.state().plugins['org.exemple.inclus'], { enabled: true, bundled: '1.0.0' });
    const log = () => readFileSync(path.join(t.installed, 'logs', 'org.exemple.inclus.log'), 'utf8');
    assert.equal(log().match(/Installé/g)?.length, 1);

    // Désactivé par l'utilisateur : le reste au lancement suivant, sans nouvelle installation.
    const s2 = t.make();
    await s2.start();
    await s2.setEnabled('org.exemple.inclus', false);
    await s2.stop();
    const s3 = t.make();
    await s3.start();
    assert.equal(byId(s3)['org.exemple.inclus'].status, 'disabled');
    assert.equal(log().match(/Installé/g)?.length, 1);
    await s3.stop();

    // Nouvelle version livrée avec Mire : installée, et l'état voulu est gardé.
    rmSync(path.join(t.bundled, 'org.exemple.inclus'), { recursive: true });
    dataPlugin(path.join(t.bundled, 'org.exemple.inclus'), 'org.exemple.inclus', '1.1.0');
    const s4 = t.make();
    await s4.start();
    await s4.stop();
    assert.deepEqual(t.state().plugins['org.exemple.inclus'], { enabled: false, bundled: '1.1.0' });
  });

  it('ne se désinstallent pas ; une mise à jour installée se désinstalle et la version incluse revient', async () => {
    const t = setup();
    dataPlugin(path.join(t.bundled, 'org.exemple.inclus'), 'org.exemple.inclus', '1.0.0');
    dataPlugin(path.join(t.installed, 'org.exemple.inclus', '1.2.0'), 'org.exemple.inclus', '1.2.0');
    const s = t.make();
    await s.start();
    assert.equal(byId(s)['org.exemple.inclus'].version, '1.2.0');
    assert.equal(byId(s)['org.exemple.inclus'].origin, 'installed');
    const r = await s.uninstall('org.exemple.inclus', { keepData: true });
    assert.equal(r?.ok, true);
    assert.equal(r?.ok && r.restored?.version, '1.0.0');
    assert.equal(byId(s)['org.exemple.inclus'].origin, 'bundled');
    assert.equal(byId(s)['org.exemple.inclus'].status, 'active');
    assert.deepEqual(s.contributions('palettes')[0].data, { version: '1.0.0' });
    assert.ok(!existsSync(path.join(t.installed, 'org.exemple.inclus')));
    const refused = await s.uninstall('org.exemple.inclus', { keepData: true });
    assert.deepEqual(refused && !refused.ok && refused.code, 'bundled');
    assert.match(refused && !refused.ok ? refused.message : '', /plugins\.uninstall\.bundled/);
    await s.stop();
  });
});

describe('dépendances au démarrage', () => {
  it('refuse une dépendance absente, d’une version qui ne convient pas, circulaire, et active les autres dans l’ordre', async () => {
    const t = setup();
    const put = (id: string, version: string, deps: Record<string, string> = {}) => dataPlugin(path.join(t.installed, id, version), id, version, deps);
    put('org.exemple.base', '1.4.0');
    put('org.exemple.pack', '1.0.0', { 'org.exemple.base': '^1.2.0' });
    put('org.exemple.vieux', '1.0.0', { 'org.exemple.base': '^2.0.0' });
    put('org.exemple.absent', '1.0.0', { 'org.exemple.nulle-part': '*' });
    put('org.exemple.suite', '1.0.0', { 'org.exemple.vieux': '*' });
    put('org.exemple.ping', '1.0.0', { 'org.exemple.pong': '*' });
    put('org.exemple.pong', '1.0.0', { 'org.exemple.ping': '*' });
    const s = t.make();
    await s.start();
    assert.deepEqual(statuses(s), {
      'org.exemple.absent': 'refused',
      'org.exemple.base': 'active',
      'org.exemple.pack': 'active',
      'org.exemple.ping': 'refused',
      'org.exemple.pong': 'refused',
      'org.exemple.suite': 'refused',
      'org.exemple.vieux': 'refused',
    });
    const p = byId(s);
    assert.match(p['org.exemple.vieux'].message!, /plugins\.refused\.dependency .*"range":"\^2\.0\.0"/);
    assert.match(p['org.exemple.absent'].message!, /plugins\.refused\.dependency .*org\.exemple\.nulle-part/);
    assert.match(p['org.exemple.suite'].message!, /plugins\.refused\.dependency-refused/);
    assert.match(p['org.exemple.ping'].message!, /plugins\.refused\.cycle/);
    // Ordre d'activation : la dépendance avant ce qui en a besoin.
    assert.deepEqual(
      s.contributions('palettes').map((e) => e.pluginId),
      ['org.exemple.base', 'org.exemple.pack'],
    );
    await s.stop();
  });

  it('désactiver une dépendance arrête ce qui en a besoin, qui revient avec elle', async () => {
    const t = setup();
    dataPlugin(path.join(t.installed, 'org.exemple.base', '1.0.0'), 'org.exemple.base', '1.0.0');
    dataPlugin(path.join(t.installed, 'org.exemple.pack', '1.0.0'), 'org.exemple.pack', '1.0.0', { 'org.exemple.base': '^1.0.0' });
    const s = t.make();
    await s.start();
    await s.setEnabled('org.exemple.base', false);
    assert.deepEqual(statuses(s), { 'org.exemple.base': 'disabled', 'org.exemple.pack': 'disabled' });
    const pack = byId(s)['org.exemple.pack'];
    assert.equal(pack.enabled, true);
    assert.match(pack.message!, /plugins\.waiting .*org\.exemple\.base/);
    // Activer celui qui attend ne suffit pas : il attend toujours sa dépendance.
    await s.setEnabled('org.exemple.pack', true);
    assert.equal(byId(s)['org.exemple.pack'].status, 'disabled');
    await s.setEnabled('org.exemple.base', true);
    assert.deepEqual(statuses(s), { 'org.exemple.base': 'active', 'org.exemple.pack': 'active' });
    await s.stop();
  });
});

describe('désinstallation', () => {
  it('est refusée si un autre plugin en a besoin, en disant lequel', async () => {
    const t = setup();
    dataPlugin(path.join(t.installed, 'org.exemple.base', '1.0.0'), 'org.exemple.base', '1.0.0');
    dataPlugin(path.join(t.installed, 'org.exemple.pack', '1.0.0'), 'org.exemple.pack', '1.0.0', { 'org.exemple.base': '^1.0.0' });
    const s = t.make();
    await s.start();
    const r = await s.uninstall('org.exemple.base', { keepData: false });
    assert.equal(r?.ok, false);
    assert.deepEqual(r && !r.ok && r.code === 'needed' && r.by, ['org.exemple.pack']);
    assert.match(r && !r.ok ? r.message : '', /plugins\.uninstall\.needed .*"by":"org\.exemple\.pack 1\.0\.0"/);
    assert.ok(existsSync(path.join(t.installed, 'org.exemple.base', '1.0.0')));
    assert.equal(byId(s)['org.exemple.base'].status, 'active');
    // Le plugin qui en avait besoin désinstallé, la dépendance peut l'être.
    assert.equal((await s.uninstall('org.exemple.pack', { keepData: false }))?.ok, true);
    assert.equal((await s.uninstall('org.exemple.base', { keepData: false }))?.ok, true);
    assert.deepEqual(s.list(), []);
    assert.equal(await s.uninstall('org.exemple.inconnu', { keepData: false }), null);
    await s.stop();
  });

  it('garde ou efface userData/plugin-data/<id>/, et oublie l’état du plugin', async () => {
    const t = setup();
    for (const id of ['org.exemple.garde', 'org.exemple.efface']) {
      dataPlugin(path.join(t.installed, id, '1.0.0'), id, '1.0.0');
      mkdirSync(path.join(t.dataRoot, id), { recursive: true });
      writeFileSync(path.join(t.dataRoot, id, 'storage.json'), '{}');
    }
    const s = t.make();
    await s.start();
    await s.setEnabled('org.exemple.garde', false);
    s.grantFolder('org.exemple.efface', root);
    assert.deepEqual(await s.uninstall('org.exemple.garde', { keepData: true }), { ok: true, keptData: true, restored: null });
    assert.deepEqual(await s.uninstall('org.exemple.efface', { keepData: false }), { ok: true, keptData: false, restored: null });
    assert.ok(existsSync(path.join(t.dataRoot, 'org.exemple.garde', 'storage.json')));
    assert.ok(!existsSync(path.join(t.dataRoot, 'org.exemple.efface')));
    assert.ok(!existsSync(path.join(t.installed, 'org.exemple.garde')));
    await s.stop();
    assert.deepEqual(t.state().plugins, {});
  });
});
