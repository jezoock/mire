// Pages des plugins (P5-03) : lecture des contributions `pages` par le cœur (données vérifiées, invalides ignorées),
// prise en compte d'un plugin factice activé puis désactivé, pages de l'utilisateur inchangées.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPages } from '../../src/main/catalog/pages/index.ts';
import { readPluginPage, readPluginPages } from '../../src/main/plugins/pages.ts';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';
import { createJournal } from '../../src/main/plugins/journal.ts';
import { createPluginService } from '../../src/main/plugins/service.ts';
import { createPluginState } from '../../src/main/plugins/state.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';

const PAGE = {
  id: 'essai',
  name: { key: 'pages.essai' },
  icon: 'movie',
  require: ['video'],
  groupBy: ['genres'],
  display: 'posters',
  menu: { pinned: true, order: 9 },
};

const entry = (data: unknown, pluginId = 'org.essai.pages', id = 'essai'): ContributionEntry => ({
  pluginId,
  kind: 'pages',
  id,
  declaration: { id, file: 'essai.json' },
  data,
});

describe('lecture des pages des plugins', () => {
  it('lit la définition et range le nom sous les textes du plugin', () => {
    assert.deepEqual(readPluginPage(entry(PAGE)), { ...PAGE, name: { key: 'pluginTexts.org_essai_pages.pages.essai' } });
  });

  it('données invalides ignorées : forme, champ inconnu, identifiant, nom en clair, clé mal formée', () => {
    const bad: unknown[] = [
      null,
      'texte',
      [],
      {},
      { ...PAGE, id: 'autre' },
      { ...PAGE, id: 'Mauvais id' },
      { ...PAGE, name: 'Essai' },
      { ...PAGE, name: { key: '../x' } },
      { ...PAGE, name: { key: 'a', autre: 1 } },
      { ...PAGE, name: { key: '<img src=x onerror=alert(1)>' } },
      { ...PAGE, require: 'video' },
      { ...PAGE, display: 'cartes' },
      { ...PAGE, inconnu: true },
      { ...PAGE, menu: { pinned: 'oui' } },
    ];
    for (const d of bad) assert.equal(readPluginPage(entry(d)), null, JSON.stringify(d));
  });

  it('un autre type de contribution est ignoré ; en double, le premier plugin (par identifiant) l’emporte', () => {
    const list = readPluginPages([
      entry(PAGE, 'org.b'),
      { ...entry(PAGE, 'org.z'), kind: 'palettes' },
      entry({ ...PAGE, icon: 'tv' }, 'org.a'),
      entry({ ...PAGE, id: 'autre' }, 'org.c', 'autre'),
      entry({ nope: 1 }, 'org.d'),
    ]);
    assert.deepEqual(
      list.map((p) => [p.id, p.icon, (p.name as { key: string }).key]),
      [
        ['essai', 'tv', 'pluginTexts.org_a.pages.essai'],
        ['autre', 'movie', 'pluginTexts.org_c.pages.essai'],
      ],
    );
  });
});

describe('pages prêtes à l’emploi changeantes (moteur des pages)', () => {
  const engine = { query: () => [], peek: () => undefined, keys: () => [], element: () => undefined, onChange: () => () => {} };
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mire-pages-plugins-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const make = (file: string) =>
    createPages({ file: path.join(dir, file), engine: engine as never, catalog: { get: () => undefined }, translate: (k) => k, onIgnored: () => {} });
  const def = (id: string, order: number) => ({ id, name: { key: `pages.${id}` }, require: ['video'], menu: { pinned: true, order } });

  it('le cœur seul n’a aucune page prête à l’emploi', () => {
    const pages = make('vide.json');
    pages.load();
    assert.deepEqual(pages.list(), []);
  });

  it('une page de plugin actif apparaît comme une page du cœur, signalée ; désactivé, elle disparaît', () => {
    const pages = make('actif.json');
    pages.load();
    const seen: string[][] = [];
    pages.onChange((ids) => seen.push(ids));
    pages.setBuiltin([def('a', 1), def('b', 2)]);
    assert.deepEqual(
      pages.list().map((p) => p.id),
      ['a', 'b'],
    );
    assert.equal(pages.overview()[0].origin, 'builtin');
    assert.deepEqual(pages.page('a')?.kind, 'elements');
    pages.setBuiltin([def('b', 2)]);
    assert.deepEqual(
      pages.list().map((p) => p.id),
      ['b'],
    );
    assert.equal(pages.get('a'), null);
    assert.equal(pages.page('a'), null);
    assert.deepEqual(seen, [['a', 'b'], ['a']]);
  });

  it('les pages de l’utilisateur ne changent pas, ni sa suppression d’une page, plugin désactivé puis réactivé', () => {
    const f = 'utilisateur.json';
    const pages = make(f);
    pages.load();
    pages.setBuiltin([def('a', 1), def('b', 2)]);
    assert.ok(pages.save({ id: 'mienne', name: 'Ma page', require: ['audio'] }).ok);
    assert.ok(pages.save({ ...def('a', 1), name: 'Mes films' }).ok);
    assert.ok(pages.remove('b'));
    // Plugins désactivés : la page de l'utilisateur et la copie modifiée restent, la supprimée n'apparaît pas.
    pages.setBuiltin([]);
    assert.deepEqual(
      pages.list().map((p) => p.id),
      ['a', 'mienne'],
    );
    assert.equal(pages.get('a')?.name, 'Mes films');
    // Relecture du fichier (redémarrage, plugins pas encore actifs), puis réactivation.
    const again = make(f);
    again.load();
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, f), 'utf8')).removed, ['b']);
    again.setBuiltin([def('a', 1), def('b', 2)]);
    assert.deepEqual(
      again.list().map((p) => p.id),
      ['a', 'mienne'],
    );
    assert.equal(again.get('a')?.name, 'Mes films');
    // `reset` rend la page du plugin ; une page qui n'est pas prête à l'emploi n'a pas de réinitialisation.
    assert.deepEqual(again.reset('b'), def('b', 2));
    assert.equal(again.reset('mienne'), null);
  });
});

const root = mkdtempSync(path.join(os.tmpdir(), 'mire-pages-service-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** Plugin inclus factice : une page, données seules. */
function fakePlugin(dir: string) {
  const catalog = (code: string) =>
    JSON.stringify({ meta: { code, name: code, app: '1.0.0' }, messages: { plugin: { name: 'Essai' }, pages: { essai: 'Essai' } } });
  const files: Record<string, string> = {
    'mire-plugin.json': JSON.stringify({
      id: 'org.essai.pages',
      version: '1.0.0',
      engines: { mire: '^1.0.0' },
      level: 'data',
      contributes: { pages: [{ id: 'essai', file: 'pages/essai.json' }] },
      i18n: 'i18n/',
    }),
    'pages/essai.json': JSON.stringify(PAGE),
    'i18n/en.json': catalog('en'),
    'i18n/fr.json': catalog('fr'),
  };
  for (const [rel, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), c);
  }
}

describe('pages dans le service des plugins', () => {
  it('plugin activé : sa page est lue ; désactivé : elle disparaît et le changement est signalé', async () => {
    const bundled = path.join(root, 'resources', 'plugins');
    const installed = path.join(root, 'userData', 'plugins');
    mkdirSync(installed, { recursive: true });
    fakePlugin(path.join(bundled, 'org.essai.pages'));
    const s = createPluginService({
      roots: { bundled, installed },
      appVersion: '1.0.0',
      languages: ['fr', 'en'],
      state: createPluginState(path.join(installed, 'state.json')),
      journal: createJournal({ dir: path.join(installed, 'logs') }),
      tagRegistry: createRegistry((k) => k),
      setTexts: () => {},
      translate: (k) => k,
      locale: () => 'fr',
      runners: () => ({
        isolated: () => Promise.reject(new Error('aucun code ici')),
        inProcess: () => Promise.reject(new Error('aucun code ici')),
        base: () => '',
        shutdown: () => {},
      }),
      onTaggersChange: () => {},
      refresh: () => {},
      watchdog: { interval: 0, timeout: 0 },
    });
    const changes: string[][] = [];
    s.onContributionsChange((kinds) => changes.push(kinds));
    await s.start();
    assert.deepEqual(s.pageDefinitions(), [{ ...PAGE, name: { key: 'pluginTexts.org_essai_pages.pages.essai' } }]);
    await s.setEnabled('org.essai.pages', false);
    assert.deepEqual(s.pageDefinitions(), []);
    assert.deepEqual(changes, [['pages'], ['pages']]);
    await s.stop();
  });
});
