// Coquille (P4-07) : routeur par état (cible et chemin), vues historiques qui tiennent lieu d'écrans et de pages,
// entrées du menu (écrans du cœur, pages épinglées, outils), sites ouverts sous leur page, badge des téléchargements.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_SCREENS } from '@mire/shared';
import type { PageDefinition } from '@mire/shared';
import {
  HOME_TARGET,
  HOME_VIEW,
  LEGACY_PAGE_SECTIONS,
  settingsPartOf,
  PAGE_VIEW,
  createRouter,
  legacySectionOf,
  SCREEN_VIEWS,
  SETTINGS_VIEW,
  routeOf,
  sameRoute,
  targetOfLegacyView,
  viewOf,
} from '../../src/renderer/shell/router.ts';
import {
  DEFAULT_PINNED,
  activeDownloads,
  currentEntry,
  cycleTargets,
  nextTarget,
  pinnedPages,
  railEntries,
  railSessions,
} from '../../src/renderer/shell/menu.ts';

const t = (key: string) => `«${key}»`;
const page = (id: string, order?: number, pinned = true): PageDefinition => ({
  id,
  name: id,
  require: [],
  menu: { pinned, ...(order === undefined ? {} : { order }) },
});
const BUILTIN = DEFAULT_PINNED.map((id, i) => page(id, i + 1));

describe('routeur de la coquille', () => {
  it('une route est une cible valide et, pour une page ou une liste, un chemin dans ses regroupements', () => {
    assert.deepEqual(routeOf('series', ['Friends', 1]), { target: 'series', path: ['Friends', 1] });
    assert.deepEqual(routeOf('list:favoris', [null]), { target: 'list:favoris', path: [null] });
    assert.deepEqual(routeOf('screen:search', ['x']), { target: 'screen:search', path: [] });
    for (const bad of ['screen:nope', 'Films', 'list:', '', 42, null]) assert.equal(routeOf(bad), null, String(bad));
    assert.equal(sameRoute({ target: 'series', path: ['A', 1] }, { target: 'series', path: ['A', 1] }), true);
    assert.equal(sameRoute({ target: 'series', path: ['A', 1] }, { target: 'series', path: ['A'] }), false);
  });

  it('chaque page s’affiche dans la vue de page ; l’accueil dans la sienne ; chaque écran du cœur a une vue', () => {
    for (const s of CORE_SCREENS) assert.notEqual(viewOf(`screen:${s}`), null, s);
    // L'accueil (P4-12) a quitté les vues historiques : sa vue est mire-home, dans la section qui garde son nom.
    assert.equal(viewOf('screen:home'), HOME_VIEW);
    // Les Réglages (P4-20) aussi : plus aucun écran ne s'affiche dans une vue historique.
    assert.equal(viewOf('screen:settings'), SETTINGS_VIEW);
    assert.equal(targetOfLegacyView(SETTINGS_VIEW), 'screen:settings');
    assert.equal(targetOfLegacyView(HOME_VIEW), 'screen:home');
    for (const id of [...DEFAULT_PINNED, 'films-annees-90']) assert.equal(viewOf(id), PAGE_VIEW, id);
    assert.equal(viewOf('list:favoris'), null);
    assert.equal(viewOf('pas une cible'), null);
    // Ancienne vue des pages prêtes à l'emploi ; une page de l'utilisateur n'en a pas.
    for (const id of DEFAULT_PINNED) assert.ok(legacySectionOf(id), id);
    assert.equal(legacySectionOf('films-annees-90'), null);
    // Une section historique revient à sa première cible ; un site ouvert ou la démonstration n'en ont pas.
    assert.equal(targetOfLegacyView('videos'), 'movies');
    assert.equal(targetOfLegacyView('downloads'), 'screen:center');
    assert.equal(targetOfLegacyView('web'), null);
    assert.equal(targetOfLegacyView('demo'), null);
    for (const [target] of [...SCREEN_VIEWS, ...LEGACY_PAGE_SECTIONS]) assert.ok(routeOf(target), target);
  });

  it('ouvre une cible dans sa vue, garde le chemin, refuse ce qu’aucune vue n’affiche', () => {
    const shown: [string, string][] = [];
    const changes: string[] = [];
    const router = createRouter({ show: (section, { focus }) => shown.push([section, focus]) });
    router.onChange((r) => changes.push(`${r.target}/${r.path.join('/')}`));
    assert.equal(router.current().target, HOME_TARGET);
    assert.equal(router.open('series', { path: ['Friends'] }), true);
    assert.deepEqual(router.current(), { target: 'series', path: ['Friends'] });
    assert.equal(router.open('films-annees-90'), true);
    assert.equal(router.open('list:favoris'), false);
    assert.equal(router.open('pas une cible'), false);
    assert.equal(router.open('screen:settings', { focus: 'keep' }), true);
    assert.deepEqual(shown, [
      ['page', 'content'],
      ['page', 'content'],
      ['settings', 'keep'],
    ]);
    assert.deepEqual(changes, ['series/Friends', 'films-annees-90/', 'screen:settings/']);
  });

  it('suit les changements de section de l’interface historique', () => {
    const router = createRouter({ show: () => {} });
    router.open('series', { path: ['Friends'] });
    // Vue de page, puis ancienne vue de la page : Séries reste la route.
    router.follow('page');
    router.follow('videos');
    assert.deepEqual(router.current(), { target: 'series', path: ['Friends'] });
    router.follow('music');
    assert.equal(router.current().target, 'music');
    // Un site ouvert reste rattaché à la page d'où il vient.
    router.follow('web');
    assert.equal(router.current().target, 'music');
    router.follow('downloads');
    assert.equal(router.current().target, 'screen:center');
  });
});

describe('entrées du menu', () => {
  it('écrans du cœur, pages épinglées dans l’ordre du menu, puis Centre, Ouvrir, Réglages et Quitter', () => {
    const entries = railEntries(BUILTIN, t);
    assert.deepEqual(
      entries.map((e) => [e.key, e.view ?? '', e.bottom ?? false]),
      [
        ['screen:search', 'search', false],
        ['screen:home', 'home', false],
        ['movies', 'videos', false],
        ['series', 'videos', false],
        ['music', 'music', false],
        ['images', 'images', false],
        ['streaming', 'streaming', false],
        ['tv', 'tv', false],
        ['games', 'games', false],
        ['screen:center', 'downloads', true],
        ['screen:explorer', 'explorer', true],
        ['openFile', '', true],
        ['screen:settings', 'settings', true],
        ['quit', '', true],
      ],
    );
    assert.equal(entries[11]?.label, '«shell.menu.openFile»');
    assert.deepEqual(
      entries.filter((e) => e.sessions).map((e) => e.key),
      ['streaming', 'tv', 'games'],
    );
  });

  it('une entrée par page épinglée, avec le nom de la page ; Films et Séries ont chacune la leur', () => {
    const pages = [page('games', 1), page('series', 2), { ...page('mes-films', 3), name: 'Mes films' }, page('movies', 4), page('music', 5, false)];
    pages[1] = { ...pages[1]!, name: { key: 'pages.series' } };
    assert.deepEqual(
      pinnedPages(pages).map((p) => p.id),
      ['games', 'series', 'mes-films', 'movies'],
    );
    const entries = railEntries(pages, t).slice(2, -5);
    assert.deepEqual(
      entries.map((e) => [e.key, e.label, e.view, e.color]),
      [
        ['games', 'games', 'games', 'var(--bar-blue)'],
        ['series', '«pages.series»', 'videos', 'var(--bar-yellow)'],
        ['mes-films', 'Mes films', 'page', 'var(--muted)'],
        ['movies', 'movies', 'videos', 'var(--bar-yellow)'],
      ],
    );
    // Sans ordre, une page épinglée vient après les autres, dans l'ordre de la liste.
    assert.deepEqual(
      pinnedPages([page('b'), page('a', 2), page('c')]).map((p) => p.id),
      ['a', 'b', 'c'],
    );
  });

  it('sans la liste des pages, les pages prêtes à l’emploi sont épinglées, avec leur nom', () => {
    const entries = railEntries(null, t);
    assert.deepEqual(
      entries.map((e) => e.key),
      railEntries(BUILTIN, t).map((e) => e.key),
    );
    assert.equal(entries[2]?.label, '«pages.movies»');
  });

  it('entrée affichée : la page de la route (vue de page ou ancienne vue), sinon celle de la section', () => {
    const entries = railEntries(BUILTIN, t);
    assert.equal(currentEntry(entries, 'page', 'series'), 'series');
    assert.equal(currentEntry(entries, 'videos', 'series'), 'series');
    assert.equal(currentEntry(entries, 'videos', 'screen:home'), 'movies');
    assert.equal(currentEntry(entries, 'page', 'pas-epinglee'), '');
    assert.equal(currentEntry(entries, 'downloads', 'series'), 'screen:center');
    assert.equal(currentEntry(entries, 'demo'), '');
  });

  it('LB et RB parcourent les écrans et pages du haut du menu, puis le Centre, en boucle', () => {
    const targets = cycleTargets(railEntries(BUILTIN, t));
    assert.deepEqual(targets, ['screen:search', 'screen:home', ...DEFAULT_PINNED, 'screen:center']);
    assert.equal(nextTarget(targets, 'screen:home', 1), 'movies');
    assert.equal(nextTarget(targets, 'games', 1), 'screen:center');
    assert.equal(nextTarget(targets, 'screen:center', 1), 'screen:search');
    assert.equal(nextTarget(targets, 'screen:center', -1), 'games');
    assert.equal(nextTarget(targets, 'screen:search', -1), 'screen:center');
    assert.equal(nextTarget(targets, 'screen:settings', 1), 'screen:home');
    assert.equal(nextTarget([], 'x', 1), null);
  });

  it('les sites ouverts vont sous leur page, avec une couleur filtrée', () => {
    const entries = railEntries(BUILTIN, t);
    const home = (id: string) => (id.startsWith('tv:') ? 'tv' : id.startsWith('rom:') ? 'games' : 'streaming');
    const safe = (c: unknown) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : 'var(--muted)');
    const sessions = railSessions(
      entries,
      [
        { id: 'arte', name: 'Arte', color: '#ff0000' },
        { id: 'tv:sfr', name: 'SFR', color: 'red;}' },
        { id: 'rom:3', name: 'Super Nintendo' },
      ],
      home,
      safe,
    );
    assert.deepEqual(sessions, {
      streaming: [{ id: 'arte', name: 'Arte', color: '#ff0000' }],
      tv: [{ id: 'tv:sfr', name: 'SFR', color: 'var(--muted)' }],
      games: [{ id: 'rom:3', name: 'Super Nintendo', color: 'var(--muted)' }],
    });
  });

  it('badge des téléchargements : ceux qui sont en cours', () => {
    const active = new Set(['progressing', 'queued']);
    assert.equal(activeDownloads([{ state: 'progressing' }, { state: 'completed' }, { state: 'queued' }, {}], active), 2);
    assert.equal(activeDownloads([], active), 0);
  });
});

describe('rouage de l’en-tête (P4-24a1)', () => {
  it('ouvre la partie des Réglages de la section affichée, sinon le début', () => {
    assert.equal(settingsPartOf('videos'), 'sources');
    assert.equal(settingsPartOf('music'), 'sources');
    assert.equal(settingsPartOf('streaming'), 'streaming');
    assert.equal(settingsPartOf('tv'), 'tv');
    assert.equal(settingsPartOf('games'), 'games');
    assert.equal(settingsPartOf('downloads'), 'downloads');
    assert.equal(settingsPartOf('home'), 'home');
    assert.equal(settingsPartOf('search'), null);
    assert.equal(settingsPartOf('toString'), null);
  });
});
