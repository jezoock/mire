// Accueil (P4-12) : rangées tirées des réglages (barres de la mire, sites épinglés, « Reprendre », pages et listes),
// cibles des barres, réglages (rangées, ordre) et personnalisation d'avant la migration v9 conservée.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Element as CatalogElement, HomeRow, HomeSettings, PageLevel, PagePath } from '@mire/shared';
import { migrate, normalizeConfig } from '../../src/main/config/index.ts';
import { BUILTIN_PAGES } from '../fixtures/builtin-pages.ts';
import { HOME_ROW_SIZE, barColor, homeBars, homeSections, recentCard, recentKey } from '../../src/renderer/home/model.ts';
import type { HomeSources } from '../../src/renderer/home/model.ts';
import { chosen, homeOptions, moveChosen, rowId, rowOf, toggleChosen, withChosen } from '../../src/renderer/home/settings.ts';
import { HOME_VIEW, viewOf } from '../../src/renderer/shell/router.ts';

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `«${key}:${JSON.stringify(vars)}»` : `«${key}»`);
const element = (key: string, name = key): CatalogElement =>
  ({
    key,
    name,
    tags: ['video'],
    infos: { year: 1994 },
    images: { poster: `/p/${name}.jpg` },
    open: { kind: 'file', path: `/v/${name}.mkv` },
  }) as unknown as CatalogElement;

/** Niveaux du catalogue : Films par genre, Séries en éléments, une liste ; tout autre identifiant est illisible. */
function level(id: string, _path: PagePath): Promise<PageLevel | null> {
  const base = { page: id, path: [], next: null };
  if (id === 'movies')
    return Promise.resolve({
      ...base,
      kind: 'groups',
      info: 'genres',
      total: 2,
      groups: [
        { value: 'Drame', name: 'Drame', count: 3 },
        { value: null, name: 'Autres', count: 1 },
      ],
    } as PageLevel);
  if (id === 'series')
    return Promise.resolve({
      ...base,
      kind: 'elements',
      total: 30,
      elements: Array.from({ length: 30 }, (_v, i) => element(`local:/s/${i}.mkv`)),
    } as PageLevel);
  if (id === 'music') return Promise.resolve({ ...base, kind: 'elements', total: 0, elements: [] } as PageLevel);
  if (id === 'list:favoris')
    return Promise.resolve({ ...base, kind: 'elements', total: 1, elements: [{ ...element('local:/f.mkv', 'Fav'), unavailable: true }] } as PageLevel);
  return Promise.reject(new Error('illisible'));
}

function sources(over: Partial<HomeSources> = {}): HomeSources {
  return {
    t,
    plural: (key, count) => (key.endsWith('.genres') || key.endsWith('.elements') || key.endsWith('.groups') ? `${count} ${key.split('.').pop()}` : ''),
    pages: () => BUILTIN_PAGES,
    lists: async () => [{ id: 'favoris', name: 'Favoris', count: 1 }],
    level,
    element: async (key) => (key === 'local:/a.mkv' ? element(key, 'Catalogue A') : null),
    recent: () => [
      { path: '/a.mkv', name: 'A', key: 'local:/a.mkv', cover: '/c/a.jpg' },
      { path: 'magnet:?xt=1', name: 'Torrent', key: null, fanart: '/f/t.jpg' },
    ],
    sites: () => [
      { id: 'netflix', name: 'Netflix', color: '#e50914' },
      { id: 'arte', name: 'Arte' },
    ],
    openSites: () => new Set(['arte']),
    color: (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#808080'),
    ink: () => '#ffffff',
    card: () => 'auto',
    ...over,
  };
}

const home = (rows: HomeRow[]): HomeSettings => ({ clock: true, recent: rows.some((r) => r.kind === 'recent'), bars: [], services: [], rows });

describe('accueil : rangées', () => {
  it('les barres ouvrent des cibles de la coquille : pages et écrans, dans l’ordre choisi, avec leur couleur', async () => {
    const bars = await homeBars(
      ['screen:search', 'movies', 'series', 'music', 'screen:settings', 'list:favoris', 'disparue', 'screen:explorer', 'screen:home'],
      sources(),
    );
    assert.deepEqual(
      bars.map((b) => [b.target, b.label, b.meta]),
      [
        ['screen:search', '«shell.views.search»', '«home.bars.searchMeta»'],
        ['movies', '«pages.movies»', '2 genres'],
        ['series', '«pages.series»', '30 elements'],
        ['music', '«pages.music»', '«home.bars.empty»'],
        ['screen:settings', '«shell.views.settings»', ''],
      ],
      'une liste, une page inconnue, l’explorateur et l’accueil lui-même n’ont pas de barre',
    );
    assert.equal(barColor('movies'), 'var(--bar-yellow)');
    assert.equal(barColor('screen:search'), 'var(--bar-white)');
    assert.equal(barColor('films-annees-90'), 'var(--muted)');
    // Chaque barre désigne une cible qu'une vue sait afficher.
    for (const b of bars) assert.ok(viewOf(b.target), b.target);
  });

  it('une page illisible garde sa barre, sans texte ; sans liste des pages, les pages prêtes à l’emploi gardent leur nom', async () => {
    const bars = await homeBars(['tv', 'movies'], sources({ pages: () => null }));
    assert.deepEqual(
      bars.map((b) => [b.target, b.label, b.meta]),
      [
        ['tv', '«pages.tv»', ''],
        ['movies', '«pages.movies»', '2 genres'],
      ],
    );
  });

  it('« Reprendre » : dans l’ordre, avec les images du catalogue, désigné par la clé de l’élément ou son chemin', async () => {
    const [section] = await homeSections([{ kind: 'recent' }], sources());
    assert.ok(section?.kind === 'elements');
    assert.equal(section.action, 'resume');
    assert.equal(section.heading, '«home.rows.recent»');
    assert.deepEqual(
      section.elements.map((e) => [e.key, e.name, e.images]),
      [
        ['local:/a.mkv', 'Catalogue A', { poster: '/p/Catalogue A.jpg' }],
        ['magnet:?xt=1', 'Torrent', { background: '/f/t.jpg' }],
      ],
    );
    assert.equal(recentKey({ path: '/x', key: '' }), '/x');
    assert.deepEqual(recentCard({ path: '/x' }, null), { key: '/x', name: '/x', images: {}, infos: {}, tags: [] });
  });

  it('rangées de pages et de listes : premiers éléments, ou premiers regroupements ; une rangée illisible est omise', async () => {
    const rows: HomeRow[] = [
      { kind: 'page', id: 'series' },
      { kind: 'page', id: 'movies' },
      { kind: 'list', id: 'favoris' },
      { kind: 'page', id: 'disparue' },
      { kind: 'list', id: 'inconnue' },
      { kind: 'page', id: 'tv' },
    ];
    const out = await homeSections(rows, sources({ card: () => 'thumbnail' }));
    assert.deepEqual(
      out.map((s) => [s.kind, s.id]),
      [
        ['elements', 'page:series'],
        ['groups', 'page:movies'],
        ['elements', 'list:favoris'],
      ],
    );
    const [series, movies, fav] = out;
    assert.ok(series?.kind === 'elements' && movies?.kind === 'groups' && fav?.kind === 'elements');
    assert.equal(series.elements.length, HOME_ROW_SIZE);
    assert.equal(series.target, 'series');
    assert.equal(series.variant, 'thumbnail', 'la carte du thème l’emporte');
    assert.equal(movies.target, 'movies');
    assert.deepEqual(
      movies.groups.map((g) => g.value),
      ['Drame', null],
    );
    // Une liste n'a pas encore de vue : pas de lien, mais ses éléments (indisponibles compris).
    assert.equal(fav.target, undefined);
    assert.equal(fav.heading, 'Favoris');
    assert.equal(fav.elements[0]?.unavailable, true);
  });

  it('sites épinglés : dans l’ordre, couleur sûre, déjà ouverts ; un site retiré n’est plus affiché', async () => {
    const [section] = await homeSections([{ kind: 'sites', keys: ['web:arte', 'web:retire', 'web:netflix'] }], sources());
    assert.ok(section?.kind === 'sites');
    assert.deepEqual(section.sites, [
      { key: 'web:arte', name: 'Arte', color: '#808080', ink: '#ffffff', open: true },
      { key: 'web:netflix', name: 'Netflix', color: '#e50914', ink: '#ffffff', open: false },
    ]);
  });

  it('l’ordre des rangées est celui des réglages', async () => {
    const rows: HomeRow[] = [{ kind: 'recent' }, { kind: 'sites', keys: ['web:arte'] }, { kind: 'bars', targets: ['music'] }];
    assert.deepEqual(
      (await homeSections(rows, sources())).map((s) => s.id),
      ['recent', 'sites', 'bars'],
    );
  });
});

describe('accueil : réglages (rangées, ordre)', () => {
  const base = home([{ kind: 'bars', targets: ['screen:search', 'movies'] }, { kind: 'recent' }]);
  const src = { t, pages: BUILTIN_PAGES, lists: [{ id: 'favoris', name: 'Favoris', count: 1 }], sites: [{ id: 'arte', name: 'Arte' }], color: () => '#808080' };

  it('identifiants des rangées', () => {
    for (const r of [
      { kind: 'bars', targets: [] },
      { kind: 'sites', keys: [] },
      { kind: 'recent' },
      { kind: 'page', id: 'movies' },
      { kind: 'list', id: 'favoris' },
    ] as HomeRow[]) {
      assert.deepEqual(rowOf(rowId(r)), r);
    }
    assert.equal(rowOf('autre'), null);
  });

  it('montrer, cacher et déplacer une rangée garde le contenu des autres', () => {
    let h = toggleChosen(base, 'rows', 'page:series', true);
    assert.deepEqual(chosen(h, 'rows'), ['bars', 'recent', 'page:series']);
    h = moveChosen(h, 'rows', 'page:series', -1);
    h = moveChosen(h, 'rows', 'page:series', -1);
    assert.deepEqual(chosen(h, 'rows'), ['page:series', 'bars', 'recent']);
    assert.equal(moveChosen(h, 'rows', 'page:series', -1), h, 'au bord, rien ne change');
    assert.deepEqual(h.rows[1], { kind: 'bars', targets: ['screen:search', 'movies'] });
    h = toggleChosen(h, 'rows', 'recent', false);
    assert.equal(h.recent, false, '« Reprendre » suit la rangée');
    assert.deepEqual(chosen(h, 'rows'), ['page:series', 'bars']);
  });

  it('barres et sites : choisis et ordonnés dans leur rangée, créée au premier choix', () => {
    let h = moveChosen(base, 'bars', 'movies', -1);
    assert.deepEqual(chosen(h, 'bars'), ['movies', 'screen:search']);
    h = toggleChosen(h, 'bars', 'games', true);
    assert.deepEqual(chosen(h, 'bars'), ['movies', 'screen:search', 'games']);
    assert.deepEqual(chosen(h, 'sites'), []);
    h = toggleChosen(h, 'sites', 'web:arte', true);
    assert.deepEqual(h.rows.at(-1), { kind: 'sites', keys: ['web:arte'] });
    const noBars = withChosen(home([{ kind: 'recent' }]), 'bars', ['music']);
    assert.deepEqual(noBars.rows[0], { kind: 'bars', targets: ['music'] }, 'les barres reviennent en tête');
  });

  it('lignes des réglages : les valeurs choisies dans l’ordre, puis les autres ; une valeur disparue reste retirable', () => {
    const bars = homeOptions(home([{ kind: 'bars', targets: ['games', 'disparue'] }]), 'bars', src);
    assert.deepEqual(
      bars.slice(0, 4).map((o) => [o.id, o.on]),
      [
        ['games', true],
        ['disparue', true],
        ['screen:search', false],
        ['screen:center', false],
      ],
    );
    assert.equal(bars.length, 2 + 3 + BUILTIN_PAGES.length - 1);
    const rows = homeOptions(base, 'rows', src).map((o) => o.id);
    assert.deepEqual(rows.slice(0, 5), ['bars', 'recent', 'sites', 'page:movies', 'page:series']);
    assert.ok(rows.includes('list:favoris'));
    assert.deepEqual(
      homeOptions(base, 'sites', src).map((o) => [o.id, o.on]),
      [['web:arte', false]],
    );
  });
});

describe('accueil : personnalisation d’avant la migration v9 (P2-11)', () => {
  const v8 = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'config-v8.json'), 'utf8'));

  it('les barres, les services et « Reprendre » choisis en v8 s’affichent dans le même ordre', async () => {
    const config = normalizeConfig(migrate(v8).config);
    const h = config.ui.home;
    assert.equal(h.clock, false, 'horloge cachée en v8, cachée sur l’accueil');
    const sections = await homeSections(h.rows, sources({ sites: () => config.web }));
    assert.deepEqual(
      sections.map((s) => s.id),
      ['bars', 'sites', 'recent'],
    );
    const [bars, sites] = sections;
    assert.ok(bars?.kind === 'bars' && sites?.kind === 'sites');
    // Les Vidéos de la v8 montraient les films et les séries : elles deviennent leurs deux pages.
    assert.deepEqual(
      bars.bars.map((b) => b.target),
      ['games', 'movies', 'series', 'screen:search', 'tv'],
    );
    assert.deepEqual(
      sites.sites.map((s) => s.name),
      ['Netflix', 'Arte'],
    );
    // Les réglages montrent les mêmes choix, dans le même ordre.
    const opts = homeOptions(h, 'bars', { t, pages: BUILTIN_PAGES, lists: [], sites: config.web, color: String });
    assert.deepEqual(
      opts.filter((o) => o.on).map((o) => o.id),
      ['games', 'movies', 'series', 'screen:search', 'tv'],
    );
  });

  it('l’accueil s’affiche dans sa propre vue, plus dans une vue historique', () => {
    assert.equal(viewOf('screen:home'), HOME_VIEW);
  });
});
