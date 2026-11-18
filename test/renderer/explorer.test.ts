// Explorateur (P4-08) : colonnes (Pages, Listes, Tags, regroupements, éléments), tranches, aperçu, relecture, et le
// contrôleur `mire-explorer` (ouvrir, montrer, lire, modifier, ajouter à une liste), en français et en anglais.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Element, ListSummary, PageDefinition, PageLevel, PagePath, TagSummary } from '@mire/shared';
import { createExplorerModel, elementPreview, levelNode, parseLevelNode, ROOT } from '../../src/renderer/explorer/index.ts';
import type { ExplorerSources, ExplorerState } from '../../src/renderer/explorer/index.ts';
import { ExplorerController, NEW_LIST } from '../../src/renderer/controllers/explorer.ts';
import type { ControllerContext } from '../../src/renderer/controllers/types.ts';
import { EXPLORER_TARGET, EXPLORER_VIEW, SCREEN_VIEWS, viewOf } from '../../src/renderer/shell/router.ts';
import { railEntries } from '../../src/renderer/shell/menu.ts';
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

const el = (key: string, name: string, extra: Partial<Element> = {}): Element =>
  ({
    key,
    name,
    source: { plugin: 'src-local', instance: '/bib' },
    open: { kind: 'file', path: key.slice(6) },
    tags: ['video'],
    infos: {},
    images: {},
    added: 0,
    ...extra,
  }) as Element;

const PAGES = [
  { id: 'series', name: { key: 'pages.series' }, require: ['series'], groupBy: ['series', 'season'] },
  { id: 'movies', name: { key: 'pages.movies' }, require: ['movie'] },
] as PageDefinition[];
const LISTS: ListSummary[] = [{ id: 'favoris', name: 'Favoris', count: 1 }];
const TAGS: TagSummary[] = [
  { id: 'video', name: 'Vidéo', origin: 'core', count: 3 },
  { id: 'audio', name: 'Musique', origin: 'core', count: 0 },
  { id: 'a-revoir', name: 'À revoir', origin: 'user', count: 1 },
];
const EPISODES = Array.from({ length: 150 }, (_, i) => el(`local:/s/e${i}.mkv`, `Épisode ${i + 1}`, { infos: { season: 1 } }));

/** Faux `catalog.page` : Séries → Friends → Saison 1 (150 épisodes, par tranches de 100), Films, listes, tags. */
function level(pageId: string, path: PagePath, cursor: string | null): Promise<PageLevel | null> {
  const from = cursor ? Number(cursor) : 0;
  const elements = (all: Element[]): PageLevel => ({
    page: pageId,
    path,
    total: all.length,
    next: from + 100 < all.length ? String(from + 100) : null,
    kind: 'elements',
    elements: all.slice(from, from + 100),
  });
  if (pageId === 'series' && path.length === 0)
    return Promise.resolve({
      page: pageId,
      path,
      total: 2,
      next: null,
      kind: 'groups',
      info: 'series',
      groups: [
        { value: 'Friends', name: 'Friends', count: 150 },
        { value: null, name: 'Autres', count: 0 },
      ],
    });
  if (pageId === 'series' && path.length === 1)
    return Promise.resolve({ page: pageId, path, total: 1, next: null, kind: 'groups', info: 'season', groups: [{ value: 1, name: '1', count: 150 }] });
  if (pageId === 'series') return Promise.resolve(elements(EPISODES));
  if (pageId === 'movies')
    return Promise.resolve(
      elements([el('local:/f/amelie.mkv', 'Amélie', { infos: { year: 2001, genres: ['Comédie', 'Romance'] }, images: { poster: '/img/amelie.jpg' } })]),
    );
  if (pageId === 'list:favoris')
    return Promise.resolve({ ...elements([el('local:/x.mkv', 'Disparu')]), elements: [{ ...el('local:/x.mkv', 'Disparu'), unavailable: true }] } as PageLevel);
  if (pageId === 'tag:video') return Promise.resolve(elements([el('local:/f/amelie.mkv', 'Amélie')]));
  return Promise.resolve(null);
}

function setup(t = tFr, over: Partial<ExplorerSources> = {}) {
  const states: ExplorerState[] = [];
  const calls: string[] = [];
  const src: ExplorerSources = {
    t,
    plural: (key, count) => `${key}:${count}`,
    pages: () => PAGES,
    lists: async () => LISTS,
    tags: async () => TAGS,
    level: (id, path, cursor) => {
      calls.push(`${id} ${JSON.stringify(path)} ${cursor}`);
      return level(id, path, cursor);
    },
    element: async (key) =>
      key === 'local:/f/amelie.mkv' ? el(key, 'Amélie', { infos: { year: 2001, genres: ['Comédie'] }, tags: ['video', 'a-revoir'] }) : null,
    ...over,
  };
  const model = createExplorerModel(src, (s) => states.push(s));
  model.reset();
  const last = () => states[states.length - 1] as ExplorerState;
  const headings = () => last().columns.map((c) => c.heading);
  const labels = (i: number) => last().columns[i]?.rows.map((r) => r.label);
  return { model, last, headings, labels, calls };
}

describe('Explorateur : colonnes', () => {
  it('la première colonne propose Pages, Listes et Tags, en français et en anglais', () => {
    assert.deepEqual(setup().labels(0), ['Pages', 'Listes', 'Tags']);
    assert.deepEqual(setup(tEn).labels(0), ['Pages', 'Lists', 'Tags']);
    assert.equal(setup().last().columns[0]?.node, ROOT);
  });

  it('Pages → Séries → Friends → Saison 1 → épisodes : une colonne par choix, la ligne choisie marquée', async () => {
    const { model, last, headings, labels } = setup();
    assert.ok(await model.open('pages'));
    assert.deepEqual(labels(1), ['Séries', 'Films']);
    assert.ok(await model.open(levelNode('series', [])));
    assert.deepEqual(labels(2), ['Friends', 'Autres']);
    assert.ok(await model.open(levelNode('series', ['Friends'])));
    // Une saison se lit « Saison 1 », comme dans la vue de page.
    assert.deepEqual(labels(3), ['Saison 1']);
    assert.ok(await model.open(levelNode('series', ['Friends', 1])));
    assert.deepEqual(headings(), ['Explorateur', 'Pages', 'Séries', 'Friends', 'Saison 1']);
    assert.equal(last().columns[4]?.rows.length, 100);
    assert.equal(last().columns[2]?.selected, levelNode('series', ['Friends']));
    // Un autre choix plus à gauche retire les colonnes qui en dépendaient.
    assert.ok(await model.open('lists'));
    assert.deepEqual(headings(), ['Explorateur', 'Listes']);
    assert.equal(last().columns[0]?.selected, 'lists');
  });

  it('les éléments arrivent par tranches : « Afficher plus » charge la suivante', async () => {
    const { model, last, calls } = setup();
    await model.open('pages');
    await model.open(levelNode('series', []));
    await model.open(levelNode('series', ['Friends']));
    const node = levelNode('series', ['Friends', 1]);
    await model.open(node);
    const col = () => last().columns[4];
    assert.equal(col()?.remaining, 50);
    assert.equal(col()?.more, 'elements.grid.more:50');
    assert.ok(await model.more(node));
    assert.equal(col()?.rows.length, 150);
    assert.equal(col()?.more, '');
    assert.equal(await model.more(node), false);
    assert.equal(calls.filter((c) => c.startsWith('series [\"Friends\",1]')).length, 2);
  });

  it('Listes et Tags : `list:<id>` et `tag:<id>` de catalog.page ; tags vides écartés, par nom ; élément disparu', async () => {
    const { model, last, labels } = setup();
    await model.open('tags');
    assert.deepEqual(labels(1), ['À revoir', 'Vidéo']);
    assert.deepEqual(
      last().columns[1]?.rows.map((r) => r.count),
      [1, 3],
    );
    assert.ok(await model.open(levelNode('tag:video', [])));
    assert.deepEqual(labels(2), ['Amélie']);
    await model.open('lists');
    assert.ok(await model.open(levelNode('list:favoris', [])));
    assert.equal(last().columns[2]?.rows[0]?.unavailable, true);
    // Un élément disparu ne s'ouvre pas.
    assert.equal(await model.show('local:/x.mkv'), false);
    assert.equal(last().preview, null);
  });

  it('un nœud ou un élément qui n’est pas affiché ne s’ouvre pas', async () => {
    const { model } = setup();
    assert.equal(await model.open(levelNode('series', ['Friends'])), false);
    assert.equal(await model.show('local:/f/amelie.mkv'), false);
    assert.equal(parseLevelNode('pages'), null);
    assert.equal(parseLevelNode('level:pas du json'), null);
    assert.deepEqual(parseLevelNode(levelNode('list:a', [null, 2])), { pageId: 'list:a', path: [null, 2] });
  });

  it('une réponse dépassée par un autre choix est ignorée', async () => {
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => (release = r));
    const { model, headings } = setup(tFr, { lists: async () => (await slow, LISTS) });
    const lists = model.open('lists');
    await model.open('pages');
    release();
    assert.equal(await lists, false);
    assert.deepEqual(headings(), ['Explorateur', 'Pages']);
  });
});

describe('Explorateur : aperçu', () => {
  it('montre image, nom, infos, tags par leur nom, source et emplacement', async () => {
    const { model, last } = setup();
    await model.open('pages');
    await model.open(levelNode('movies', []));
    assert.ok(await model.show('local:/f/amelie.mkv'));
    const p = last().preview;
    assert.equal(p?.name, 'Amélie');
    assert.deepEqual(p?.facts, [
      { label: 'Année', value: '2001' },
      { label: 'Genres', value: 'Comédie' },
    ]);
    assert.deepEqual(p?.tags, ['Vidéo', 'À revoir']);
    assert.equal(p?.source, 'src-local · /bib');
    assert.equal(p?.location, '/f/amelie.mkv');
    assert.equal(last().columns[2]?.selected, 'local:/f/amelie.mkv');
  });

  it('elementPreview : image (affiche, sinon fond, sinon le fichier d’une image), saison, site, source de la configuration', () => {
    const img = elementPreview(el('local:/p/a.jpg', 'a', { tags: ['image'] }), [], tEn);
    assert.equal(img.image, `media://local/?p=${encodeURIComponent('/p/a.jpg')}`);
    assert.deepEqual(img.tags, ['image']);
    const ep = elementPreview(el('local:/s/e.mkv', 'e', { infos: { season: 2, episode: 3 }, images: { background: 'https://x/b.jpg' } }), [], tEn);
    assert.equal(ep.image, 'https://x/b.jpg');
    assert.deepEqual(ep.facts, [
      { label: 'Season', value: 'Season 2' },
      { label: 'Episode', value: '3' },
    ]);
    const site = elementPreview(
      el('web:arte', 'Arte', { open: { kind: 'site', url: 'https://arte.tv' }, source: { plugin: 'sites', instance: 'config' } }),
      [],
      tFr,
    );
    assert.equal(site.location, 'https://arte.tv');
    assert.equal(site.source, 'sites');
    assert.equal(site.image, '');
  });

  it('relecture : garde les choix et l’aperçu qui existent encore, retire ceux qui ont disparu', async () => {
    let tags = TAGS;
    const { model, last, headings } = setup(tFr, { tags: async () => tags });
    await model.open('tags');
    await model.open(levelNode('tag:video', []));
    await model.show('local:/f/amelie.mkv');
    await model.refresh();
    assert.deepEqual(headings(), ['Explorateur', 'Tags', 'Vidéo']);
    assert.equal(last().preview?.key, 'local:/f/amelie.mkv');
    tags = TAGS.filter((x) => x.id !== 'video');
    await model.refresh();
    assert.deepEqual(headings(), ['Explorateur', 'Tags']);
    assert.equal(last().columns[1]?.selected, null);
    assert.equal(last().preview, null);
  });
});

describe('Explorateur : coquille', () => {
  it('screen:explorer a sa vue, et une entrée en bas du menu', () => {
    assert.ok(SCREEN_VIEWS.some(([t, v]) => t === EXPLORER_TARGET && v === EXPLORER_VIEW));
    assert.equal(viewOf('screen:explorer'), EXPLORER_VIEW);
    const entry = railEntries(PAGES, tFr).find((e) => e.target === EXPLORER_TARGET);
    assert.equal(entry?.label, 'Explorateur');
    assert.equal(entry?.bottom, true);
  });
});

describe('Explorateur : contrôleur', () => {
  function ctl(opts: { lists?: ListSummary[]; form?: { action: string; values: Record<string, unknown> } } = {}) {
    const calls: unknown[][] = [];
    const toasts: string[] = [];
    const forms: unknown[] = [];
    const explorer = {
      open: async (node: string, o: unknown) => (calls.push(['open', node, o]), true),
      show: async (key: string, o: unknown) => (calls.push(['show', key, o]), true),
      more: async (node: string) => (calls.push(['more', node]), true),
    };
    const api = {
      catalogElement: async (key: string) => (key === 'local:/a.mkv' || key === 'local:/x.mkv' ? el(key, 'A') : null),
      listsList: async () => opts.lists ?? LISTS,
      listsCreate: async (name: string) => (calls.push(['create', name]), { id: 'nouvelle', name, count: 0 }),
      listsAdd: async (id: string, keys: string[]) => (calls.push(['add', id, keys]), id === 'favoris' && keys[0] === 'local:/x.mkv' ? 0 : 1),
      tagsList: async () => TAGS,
    };
    const ui = { explorer, afterEdit: () => {} };
    const dialogs = {
      form: async (f: unknown) => (forms.push(f), opts.form ?? { action: 'cancel', values: {} }),
    };
    const ctx = { S, api, ui, toast: (m: string) => toasts.push(m), t: tFr, page: PAGE, dialogs } as unknown as ControllerContext;
    return { c: new ExplorerController(ctx), calls, toasts, forms };
  }

  it('ouvre une branche et montre un élément par leur nœud et leur clé, le focus suit', async () => {
    const { c, calls } = ctl();
    await c.openNode({ node: 'pages' });
    await c.showElement({ key: 'local:/a.mkv' });
    await c.more({ node: 'n' });
    assert.deepEqual(calls, [
      ['open', 'pages', { focus: true }],
      ['show', 'local:/a.mkv', { focus: true }],
      ['more', 'n'],
    ]);
  });

  it('ajouter à une liste : liste choisie, déjà présent, nouvelle liste, abandon, élément disparu', async () => {
    let r = ctl({ form: { action: 'add', values: { list: 'favoris', name: '' } } });
    assert.equal(await r.c.addToList({ key: 'local:/a.mkv' }), 1);
    assert.deepEqual(r.calls, [['add', 'favoris', ['local:/a.mkv']]]);
    assert.deepEqual(r.toasts, ['Ajouté à « Favoris ».']);
    const f = r.forms[0] as { fields: { id: string; options?: unknown[] }[] };
    assert.deepEqual(
      f.fields.map((x) => x.id),
      ['list', 'name'],
    );
    assert.deepEqual(f.fields[0]?.options?.at(-1), [NEW_LIST, 'Ou une nouvelle liste']);

    r = ctl({ form: { action: 'add', values: { list: NEW_LIST, name: ' À voir ' } } });
    assert.equal(await r.c.addToList({ key: 'local:/a.mkv' }), 1);
    assert.deepEqual(r.calls, [
      ['create', 'À voir'],
      ['add', 'nouvelle', ['local:/a.mkv']],
    ]);

    r = ctl({ lists: [], form: { action: 'add', values: { name: '' } } });
    assert.equal(await r.c.addToList({ key: 'local:/a.mkv' }), null);
    assert.deepEqual(r.toasts, ['Impossible d’ajouter à cette liste.']);
    assert.deepEqual(
      (r.forms[0] as { fields: { id: string; required?: boolean }[] }).fields.map((x) => [x.id, x.required]),
      [['name', true]],
    );

    r = ctl();
    assert.equal(await r.c.addToList({ key: 'local:/a.mkv' }), null);
    assert.deepEqual(r.calls, []);

    r = ctl();
    assert.equal(await r.c.addToList({ key: 'local:/inconnu.mkv' }), null);
    assert.deepEqual(r.toasts, ['Cet élément n’est plus dans le catalogue.']);
    assert.equal(r.forms.length, 0);
  });

  it('déjà dans la liste : un message le dit', async () => {
    const r = ctl({ form: { action: 'add', values: { list: 'favoris' } } });
    assert.equal(await r.c.addToList({ key: 'local:/x.mkv' }), 0);
    assert.deepEqual(r.toasts, ['Déjà dans « Favoris ».']);
  });
});
