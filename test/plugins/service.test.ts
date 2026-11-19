// Service des plugins : découverte, activation, désactivation à chaud, registre, textes, tags automatiques, pannes
// (exception, délai, chien de garde, hôte planté), état mémorisé et journal. Le code des plugins tourne ici dans ce
// processus, relié par des ports de node:worker_threads : le canal et le runtime sont ceux de l'hôte isolé.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Element } from '@mire/shared';
import { adaptPort, createChannel } from '../../src/main/plugins/channel.ts';
import { fileBase, startInProcess } from '../../src/main/plugins/in-process.ts';
import { createJournal } from '../../src/main/plugins/journal.ts';
import { createPluginService, type RunnerEvents, type Runners } from '../../src/main/plugins/service.ts';
import { createPluginState } from '../../src/main/plugins/state.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'mire-service-'));
after(() => rmSync(root, { recursive: true, force: true }));
const catalog = (code: string, messages: Record<string, unknown>) => JSON.stringify({ meta: { code, name: code, app: '1.0.0' }, messages });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;

function write(dir: string, files: Record<string, string | object>) {
  for (const [rel, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), typeof c === 'string' ? c : JSON.stringify(c));
  }
}

function plugin(installed: string, id: string, level: string, contributes: object, files: Record<string, string>) {
  write(path.join(installed, id, '1.0.0'), {
    'mire-plugin.json': { id, version: '1.0.0', engines: { mire: '^1.0.0' }, level, contributes, i18n: 'i18n/' },
    'i18n/en.json': catalog('en', { plugin: { name: `${id} (en)` }, tags: { date: 'Dated' } }),
    'i18n/fr.json': catalog('fr', { plugin: { name: `${id} (fr)` }, tags: { date: 'Daté' } }),
    ...files,
  });
}

const TAGGER = `export default () => ({ id: 'annee', compute(e) { if (e.name === 'boom') throw new Error('panne voulue'); const m = /(\\d{4})/.exec(e.name); return m ? { tags: ['date'] } : null; }, hello(x) { return 'bonjour ' + x; } });`;

function setup(extra: { hang?: boolean } = {}) {
  const base = path.join(root, `s${++n}`);
  const installed = path.join(base, 'plugins');
  plugin(installed, 'org.exemple.annees', 'code', { taggers: [{ id: 'annee', main: 'annee.mjs', tags: ['date'] }] }, { 'annee.mjs': TAGGER });
  plugin(installed, 'org.exemple.couleurs', 'data', { palettes: [{ id: 'nuit', file: 'nuit.json' }] }, { 'nuit.json': '{"accent":"#123"}' });
  write(path.join(installed, 'org.exemple.futur', '1.0.0'), {
    'mire-plugin.json': {
      id: 'org.exemple.futur',
      version: '1.0.0',
      engines: { mire: '>=2.0.0' },
      level: 'data',
      contributes: { palettes: [{ id: 'f', file: 'f.json' }] },
      i18n: 'i18n/',
    },
    'f.json': '{}',
    'i18n/en.json': catalog('en', { plugin: { name: 'Future' } }),
  });
  const texts = new Map<string, unknown>();
  const tagRegistry = createRegistry((k) => k);
  let taggersChanged = 0;
  const refreshed: string[] = [];
  let events!: RunnerEvents;
  const runner = (_p: unknown, endpoint: Parameters<Runners['isolated']>[1], timeout: number) => {
    if (!extra.hang) return Promise.resolve(startInProcess(endpoint, timeout, () => new MessageChannel()));
    // Hôte qui charge le plugin puis ne répond plus aux pings (boucle sans fin simulée).
    const { port1, port2 } = new MessageChannel();
    const other = createChannel(adaptPort(port2), { handle: (_t, m) => (m === 'ping' ? new Promise(() => {}) : []) });
    const channel = createChannel(adaptPort(port1), { timeout });
    return Promise.resolve({ channel, stop: () => (channel.close(), other.close()) });
  };
  const service = createPluginService({
    roots: { bundled: null, installed },
    appVersion: '1.0.0',
    languages: ['fr', 'en'],
    state: createPluginState(path.join(installed, 'state.json')),
    journal: createJournal({ dir: path.join(installed, 'logs') }),
    tagRegistry,
    setTexts: (k, t) => (t ? texts.set(k, t) : texts.delete(k)),
    translate: (k, vars) => `${k} ${JSON.stringify(vars ?? {})}`,
    locale: () => 'fr',
    runners: (e) => {
      events = e;
      return { isolated: runner, inProcess: runner, base: (p) => fileBase(p.dir), shutdown: () => {} };
    },
    onTaggersChange: () => taggersChanged++,
    refresh: (keys) => refreshed.push(...keys),
    watchdog: { interval: 20, timeout: 60 },
  });
  return { service, installed, texts, tagRegistry, refreshed, taggersChanged: () => taggersChanged, events: () => events };
}

const statuses = (s: ReturnType<typeof setup>['service']) => Object.fromEntries(s.list().map((p) => [p.id, p.status]));
const el = (key: string, name: string) => ({ key, name, tags: [], infos: {} }) as unknown as Element;

describe('service des plugins', () => {
  const opened: { service: { stop(): Promise<void> } }[] = [];
  after(() => Promise.all(opened.map((o) => o.service.stop())));

  it('active les plugins valides, refuse les autres, branche contributions, textes et tags', async () => {
    const t = setup();
    opened.push(t);
    await t.service.start();
    assert.deepEqual(statuses(t.service), { 'org.exemple.annees': 'active', 'org.exemple.couleurs': 'active', 'org.exemple.futur': 'refused' });
    const info = Object.fromEntries(t.service.list().map((p) => [p.id, p]));
    assert.equal(info['org.exemple.annees'].name, 'org.exemple.annees (fr)');
    assert.match(info['org.exemple.futur'].message!, /plugins\.refused\.engine.*>=2\.0\.0/);
    assert.deepEqual(t.service.contributions('palettes')[0].data, { accent: '#123' });
    assert.deepEqual([...t.texts.keys()].sort(), ['org_exemple_annees', 'org_exemple_couleurs']);
    assert.equal(t.tagRegistry.isPluginTag('date'), true);
    assert.equal(t.taggersChanged(), 1);
    // « Même API par messages » : appel d'une méthode de la contribution.
    assert.equal(await t.service.call('org.exemple.annees', 'taggers', 'annee', 'hello', ['toi']), 'bonjour toi');
    // Tags automatiques : calculés par lots, puis les éléments sont recalculés.
    const [c] = t.service.taggerContributors();
    assert.equal(c.compute(el('k1', 'Film 1999')), null);
    await wait(30);
    assert.deepEqual(t.refreshed, ['k1']);
    assert.deepEqual(c.compute(el('k1', 'Film 1999')), { tags: ['date'], infos: {} });
    assert.match(readFileSync(path.join(t.installed, 'logs', 'org.exemple.annees.log'), 'utf8'), /INFO Activé : taggers\/annee/);
  });

  it('fournisseurs d’infos des plugins actifs (P4-20) : identifiant, nom du plugin, natures', async () => {
    const t = setup();
    opened.push(t);
    plugin(
      t.installed,
      'org.exemple.films',
      'code',
      { metadata: [{ id: 'infos', main: 'infos.mjs', kinds: ['video', 'album'] }] },
      {
        'infos.mjs': "export default () => ({ id: 'infos', collect() { return []; }, scrape() { return null; } });",
      },
    );
    await t.service.start();
    assert.equal(statuses(t.service)['org.exemple.films'], 'active', t.service.list().find((p) => p.id === 'org.exemple.films')?.message ?? '');
    assert.deepEqual(t.service.metadataProviders(), [
      { id: 'org.exemple.films/infos', plugin: 'org.exemple.films', name: 'org.exemple.films (fr)', kinds: ['video', 'album'] },
    ]);
    await t.service.setEnabled('org.exemple.films', false);
    assert.deepEqual(t.service.metadataProviders(), []);
  });

  it('désactive et réactive à chaud ; l’état est mémorisé', async () => {
    const t = setup();
    opened.push(t);
    await t.service.start();
    const off = await t.service.setEnabled('org.exemple.annees', false);
    assert.equal(off?.status, 'disabled');
    assert.equal(t.tagRegistry.isPluginTag('date'), false);
    assert.equal(t.texts.has('org_exemple_annees'), false);
    assert.deepEqual(t.service.taggerContributors(), []);
    await t.service.stop();
    const state = JSON.parse(readFileSync(path.join(t.installed, 'state.json'), 'utf8'));
    assert.deepEqual(state.plugins['org.exemple.annees'], { enabled: false });
    // Relancé : le plugin reste désactivé, puis se réactive à la demande.
    const again = setup();
    opened.push(again);
    rmSync(again.installed, { recursive: true });
    const { cpSync } = await import('node:fs');
    cpSync(t.installed, again.installed, { recursive: true });
    await again.service.start();
    assert.equal(statuses(again.service)['org.exemple.annees'], 'disabled');
    assert.equal((await again.service.setEnabled('org.exemple.annees', true))?.status, 'active');
    assert.equal(await again.service.setEnabled('org.exemple.inconnu', true), null);
  });

  it('désactive un plugin qui lève une exception, avec un message clair', async () => {
    const t = setup();
    opened.push(t);
    await t.service.start();
    const [c] = t.service.taggerContributors();
    c.compute(el('k', 'boom'));
    await wait(30);
    const p = t.service.list().find((x) => x.id === 'org.exemple.annees')!;
    assert.equal(p.status, 'fault');
    assert.equal(p.enabled, false);
    assert.match(p.message!, /plugins\.faults\.exception.*panne voulue/);
    assert.equal(t.tagRegistry.isPluginTag('date'), false);
    assert.equal(t.taggersChanged(), 2);
    assert.match(readFileSync(path.join(t.installed, 'logs', 'org.exemple.annees.log'), 'utf8'), /ERROR plugins\.faults\.exception/);
    // Les autres continuent.
    assert.equal(statuses(t.service)['org.exemple.couleurs'], 'active');
  });

  it('chien de garde : un plugin qui ne répond plus est désactivé', async () => {
    const t = setup({ hang: true });
    opened.push(t);
    await t.service.start();
    await wait(200);
    const p = t.service.list().find((x) => x.id === 'org.exemple.annees')!;
    assert.equal(p.status, 'fault');
    assert.match(p.message!, /plugins\.faults\.timeout/);
  });

  it('hôte planté : le plugin qui travaillait est désactivé, les autres redémarrent', async () => {
    const t = setup();
    opened.push(t);
    plugin(t.installed, 'org.exemple.autre', 'code', { taggers: [{ id: 'annee', main: 'annee.mjs', tags: ['date'] }] }, { 'annee.mjs': TAGGER });
    await t.service.start();
    // Requête en cours pour « annees » au moment du plantage.
    const pending = t.service.call('org.exemple.annees', 'taggers', 'annee', 'hello', ['x']);
    t.events().hostGone(['org.exemple.annees', 'org.exemple.autre'], 'Plugin host gone (crashed).');
    await pending.catch(() => {});
    await wait(30);
    const s = statuses(t.service);
    assert.equal(s['org.exemple.annees'], 'fault');
    assert.equal(s['org.exemple.autre'], 'active');
  });
});
