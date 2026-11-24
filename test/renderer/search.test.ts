// Recherche (P4-13) : groupes du catalogue par page, recherches récentes, « Où regarder » (fournisseurs `search`),
// sites où chercher, contrôleur `mire-search` et coquille.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Element, PageDefinition, SearchResult, WebSite } from '@mire/shared';
import { keepGroups } from '@mire/ui/utils';
import { MAX_RECENT, pageOfResult, searchGroups, siteViews, watchState, watchTargets, watchView, withRecent } from '../../src/renderer/search/index.ts';
import type { WatchResult, WatchState } from '../../src/renderer/search/index.ts';
import { SearchController } from '../../src/renderer/controllers/search.ts';
import type { ControllerContext } from '../../src/renderer/controllers/types.ts';
import { SCREEN_VIEWS, SEARCH_TARGET, SEARCH_VIEW, targetOfLegacyView, viewOf } from '../../src/renderer/shell/router.ts';
import { PAGE, S } from '../../src/renderer/state/index.ts';
import fr from '../../packages/shared/src/i18n/locales/fr.json' with { type: 'json' };
import en from '../../packages/shared/src/i18n/locales/en.json' with { type: 'json' };

type Messages = Record<string, unknown>;
function translator(messages: Messages) {
  return (key: string, vars: Record<string, string | number> = {}) => {
    const v = key.split('.').reduce<unknown>((o, k) => (o as Messages | undefined)?.[k], messages);
    assert.equal(typeof v, 'string', key);
    return (v as string).replace(/\{(\w+)\}/g, (_, n: string) => String(vars[n]));
  };
}
const tFr = translator(fr.messages as Messages);
const tEn = translator(en.messages as Messages);

const el = (key: string, name: string): Element => ({ key, name, tags: [], infos: {}, images: {} }) as unknown as Element;
const PAGES = [
  { id: 'movies', name: { key: 'pages.movies' }, require: [], display: 'posters' },
  { id: 'music', name: { key: 'pages.music' }, require: [], display: 'list' },
] as unknown as PageDefinition[];
const RESULT: SearchResult = {
  query: 'voyage',
  total: 3,
  groups: [
    { page: 'movies', name: 'Films', total: 2, elements: [el('local:/v/voyage.mkv', 'Voyage dans la Lune'), el('local:/v/voyage2.mkv', 'Le Voyage')] },
    { page: 'music', name: 'Musique', total: 1, elements: [el('local:/m/voyage.flac', 'Voyage')] },
    { page: null, name: 'Ailleurs', total: 1, elements: [el('web:voyages', 'Voyages')] },
  ],
};
const SITES = [
  { id: 'netflix', name: 'Netflix', color: '#e50914', search: 'https://www.netflix.com/search?q={q}' },
  { id: 'arte', name: 'Arte', color: 'red;}' },
] as unknown as WebSite[];
const colors = { color: (c: unknown) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : 'var(--muted)'), ink: () => '#fff' };

describe('Recherche : groupes du catalogue par page', () => {
  it('un groupe par page, dans l’ordre de la réponse, avec la forme de cartes de la page', () => {
    const groups = searchGroups(RESULT, PAGES);
    assert.deepEqual(
      groups.map((g) => [g.id, g.page, g.heading, g.total, g.variant, g.elements.map((e) => e.key)]),
      [
        ['movies', 'movies', 'Films', 2, 'poster', ['local:/v/voyage.mkv', 'local:/v/voyage2.mkv']],
        ['music', 'music', 'Musique', 1, 'line', ['local:/m/voyage.flac']],
        ['none', null, 'Ailleurs', 1, 'poster', ['web:voyages']],
      ],
    );
  });

  it('une page inconnue de la coquille n’est pas un lien', () => {
    const [g] = searchGroups({ query: 'x', total: 1, groups: [{ page: 'gone', name: 'Gone', total: 1, elements: [el('a', 'A')] }] }, PAGES);
    assert.equal(g?.page, null);
    assert.equal(g?.id, 'gone');
  });

  it('un résultat s’ouvre dans la page de son groupe', () => {
    const groups = searchGroups(RESULT, PAGES);
    assert.equal(pageOfResult(groups, 'local:/m/voyage.flac'), 'music');
    assert.equal(pageOfResult(groups, 'web:voyages'), null);
    assert.equal(pageOfResult(groups, 'inconnu'), null);
    assert.equal(pageOfResult(null, 'local:/m/voyage.flac'), null);
  });

  it('pendant la frappe, un groupe inchangé garde son objet (sa rangée n’est pas redessinée)', () => {
    const first = searchGroups(RESULT, PAGES);
    const narrower = { ...RESULT, groups: [{ ...RESULT.groups[0]!, total: 1, elements: [RESULT.groups[0]!.elements[0]!] }, RESULT.groups[1]!] };
    const next = keepGroups(first, searchGroups(narrower, PAGES));
    assert.notEqual(next[0], first[0]);
    assert.equal(next[1], first[1]);
    assert.equal(next.length, 2);
  });
});

describe('Recherche : recherches récentes', () => {
  it('la dernière en tête, sans doublon (casse et accents ignorés), dix au plus', () => {
    assert.deepEqual(withRecent(['amélie', 'friends'], 'Amelie'), ['Amelie', 'friends']);
    assert.deepEqual(withRecent(['a'], '  '), ['a']);
    const many = Array.from({ length: 12 }, (_, i) => `q${i}`);
    const next = withRecent(many, 'nouvelle');
    assert.equal(next.length, MAX_RECENT);
    assert.equal(next[0], 'nouvelle');
  });
});

describe('Recherche : « Où regarder » (fournisseurs search) et sites', () => {
  const result: WatchResult = {
    key: 'movie-1',
    title: 'Amélie',
    year: '2001',
    type: 'movie',
    poster: null,
    providers: [
      { name: 'Netflix', webId: 'netflix' },
      { name: 'Canal+', webId: null },
      { name: 'Prime Video', webId: null },
      { name: 'Mubi', webId: null },
    ],
  };
  const done: WatchState = { q: 'amélie', status: 'done', results: [result] };

  it('réponse du processus principal → état : titres et attribution, sans plugin, réglage à remplir, erreur', () => {
    assert.deepEqual(watchState('a', { ok: true, plugin: 'mire.tmdb', results: [result], attribution: 'Catalogue : TMDB.' }), {
      q: 'a',
      status: 'done',
      results: [result],
      attribution: 'Catalogue : TMDB.',
    });
    assert.deepEqual(watchState('a', { ok: false, reason: 'noprovider' }), { q: 'a', status: 'noprovider', results: [] });
    assert.deepEqual(watchState('a', { ok: false, plugin: 'mire.tmdb', error: 'Ajoutez une clé.', setup: 'token' }), {
      q: 'a',
      status: 'nokey',
      results: [],
      error: 'Ajoutez une clé.',
      plugin: 'mire.tmdb',
      setup: 'token',
    });
    assert.deepEqual(watchState('a', { ok: false, plugin: 'mire.tmdb', error: 'Panne.' }), { q: 'a', status: 'error', results: [], error: 'Panne.' });
  });

  it('états : sans clé (message du plugin), sans plugin, en cours, erreur, aucun titre ; attribution du plugin', () => {
    assert.deepEqual(watchView({ q: '', status: 'nokey', results: [], error: 'Ajoutez une clé TMDB.' }, 'amélie', SITES, colors, tFr), {
      status: 'nokey',
      message: 'Ajoutez une clé TMDB.',
      cards: [],
    });
    assert.match(watchView({ q: 'amélie', status: 'noprovider', results: [] }, 'amélie', SITES, colors, tFr).message, /plugin « Où regarder »/);
    assert.equal(watchView({ ...done, attribution: 'Catalogue : TMDB.' }, 'amélie', SITES, colors, tFr).attribution, 'Catalogue : TMDB.');
    assert.equal(watchView({ q: 'amé', status: 'done', results: [result] }, 'amélie', SITES, colors, tFr).status, 'loading');
    assert.deepEqual(watchView({ q: 'amélie', status: 'error', results: [], error: 'Clé refusée' }, 'amélie', SITES, colors, tFr), {
      status: 'error',
      message: 'Clé refusée',
      cards: [],
    });
    assert.equal(watchView({ q: 'amélie', status: 'done', results: [] }, 'amélie', SITES, colors, tFr).message, 'Aucun film ni série trouvé.');
  });

  it('une carte : titre, nature et année, trois services (le site configuré à ses couleurs), le reste en nombre', () => {
    const [card] = watchView(done, 'amélie', SITES, colors, tFr).cards;
    assert.deepEqual(card, {
      key: 'movie-1',
      title: 'Amélie',
      meta: 'Film, 2001',
      poster: '',
      chips: [{ name: 'Netflix', color: '#e50914', ink: '#fff' }, { name: 'Canal+' }, { name: 'Prime Video' }],
      more: '+1',
    });
    const series = watchView({ ...done, results: [{ ...result, type: 'tv', providers: [] }] }, 'amélie', SITES, colors, tEn).cards[0];
    assert.equal(series?.meta, 'Series, 2001');
    assert.equal(series?.more, 'Not on subscription');
  });

  it('où ouvrir un titre : les sites configurés, sinon le message', () => {
    assert.deepEqual(
      watchTargets(result, SITES, tFr).sites.map((w) => w.id),
      ['netflix'],
    );
    const elsewhere = watchTargets({ ...result, providers: [{ name: 'Canal+', webId: null }] }, SITES, tFr);
    assert.equal(elsewhere.message, 'Disponible sur Canal+, qui n’est pas configuré dans Mire.');
    assert.match(watchTargets({ ...result, providers: [] }, SITES, tFr).message, /aucun service/);
  });

  it('sites où chercher : adresse de recherche connue ou à mémoriser, couleurs filtrées', () => {
    assert.deepEqual(siteViews(SITES, 'amélie', colors, tFr), [
      { id: 'netflix', name: 'Netflix', color: '#e50914', ink: '#fff', how: 'Chercher « amélie »' },
      { id: 'arte', name: 'Arte', color: 'var(--muted)', ink: '#fff', how: 'Ouvrir le site (recherche à mémoriser)' },
    ]);
    assert.equal(siteViews(SITES, 'amélie', colors, tEn)[0]?.how, 'Search for “amélie”');
  });
});

describe('Recherche : contrôleur mire-search', () => {
  function harness() {
    const calls: unknown[][] = [];
    const toasts: string[] = [];
    const groups = searchGroups(RESULT, PAGES);
    const search = {
      query: () => 'voyage',
      setQuery: async (q: string) => void calls.push(['setQuery', q]),
      refresh: async () => void calls.push(['refresh']),
      pageOf: (key: string) => pageOfResult(groups, key),
      watchResult: (key: string) => (key === 'movie-1' ? { key, title: 'Amélie', year: '', type: 'movie', poster: null, providers: [] } : null),
    };
    const ui = new Proxy(
      { search },
      {
        get: (t, name: string) =>
          name in t
            ? (t as Record<string, unknown>)[name]
            : (...args: unknown[]) => {
                calls.push([name, ...args]);
                return name === 'getQueries' ? ['voyage'] : name === 'open' ? true : undefined;
              },
      },
    );
    const api = new Proxy(
      {},
      {
        get:
          (_t, name: string) =>
          async (...args: unknown[]) => (
            calls.push([`api.${name}`, ...args]),
            name === 'catalogElement' ? { key: args[0], name: 'X', tags: [], open: { kind: 'site', site: 'voyages' } } : undefined
          ),
      },
    );
    const ctx = { S, api, ui, toast: (m: string) => toasts.push(m), t: tFr, page: PAGE, dialogs: {} } as unknown as ControllerContext;
    return { ctl: new SearchController(ctx), calls, toasts };
  }

  it('un résultat s’ouvre dans sa page : la page s’affiche, puis l’élément s’ouvre comme elle l’ouvrirait', async () => {
    const { ctl, calls } = harness();
    await ctl.openResult({ key: 'local:/m/voyage.flac' });
    assert.deepEqual(calls.slice(0, 3), [
      ['rememberQuery', 'voyage'],
      ['open', 'music', { path: [], focus: 'content' }],
      ['api.catalogElement', 'local:/m/voyage.flac'],
    ]);
    assert.deepEqual(calls[3], ['openWeb', 'voyages', undefined]);
  });

  it('un résultat hors des pages s’ouvre sans quitter la Recherche ; le titre d’un groupe ouvre sa page', async () => {
    const { ctl, calls } = harness();
    await ctl.openResult({ key: 'web:voyages' });
    assert.ok(!calls.some((c) => c[0] === 'open'));
    ctl.openPage({ page: 'movies' });
    assert.deepEqual(calls.at(-1), ['open', 'movies', { path: [], focus: 'content' }]);
  });

  it('recherches récentes : seule une recherche connue est relancée ; les effacer', async () => {
    const { ctl, calls, toasts } = harness();
    await ctl.useRecentQuery({ query: 'inconnue' });
    await ctl.useRecentQuery({ query: 'voyage' });
    assert.deepEqual(
      calls.filter((c) => c[0] === 'setQuery'),
      [['setQuery', 'voyage']],
    );
    ctl.clearQueries();
    assert.deepEqual(S.usage.queries, []);
    assert.deepEqual(toasts, ['Recherches récentes effacées']);
  });

  it('« Où regarder » : un titre sans service configuré affiche un message', () => {
    const { ctl, toasts, calls } = harness();
    S.config = { web: SITES } as never;
    ctl.openWatch({ key: 'movie-1' });
    ctl.openWatch({ key: 'inconnu' });
    assert.equal(toasts.length, 1);
    assert.match(toasts[0] ?? '', /aucun service/);
    assert.ok(!calls.some((c) => c[0] === 'openWeb'));
  });
});

describe('Recherche : coquille', () => {
  it('la Recherche a sa vue, elle n’est plus une vue historique', () => {
    assert.ok(SCREEN_VIEWS.some(([t, s]) => t === SEARCH_TARGET && s === SEARCH_VIEW));
    assert.equal(viewOf('screen:search'), 'search');
    assert.equal(targetOfLegacyView('search'), 'screen:search');
  });
});
