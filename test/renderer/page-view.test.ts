// Vue de page (P4-11) : chemin parcouru, regroupements (« Autres », saisons), tranches, rangées et mise en page.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PageDefinition, PageElement, PageLevel, PagePath } from '@mire/shared';
import { groupKey, groupLabel, groupsAsRows, pageCardVariant, pageCrumbs, pageLayout, parentPath } from '@mire/ui/utils';
import { ROW_SIZE, createPageModel, groupFormatter, pageName } from '../../src/renderer/pages/model.ts';
import type { PageViewData } from '../../src/renderer/pages/model.ts';

const t = (key: string, vars?: Record<string, string | number>) =>
  key === 'pages.others' ? 'Autres' : key === 'pageView.season' ? `Saison ${vars?.value}` : `«${key}»`;

const SERIES: PageDefinition = { id: 'series', name: { key: 'pages.series' }, require: ['video', 'series'], groupBy: ['series', 'season'], display: 'posters' };
const el = (key: string): PageElement => ({
  key,
  name: key,
  source: { plugin: 'x', instance: 'y' },
  open: { kind: 'file', path: key },
  tags: [],
  infos: {},
  images: {},
  added: 0,
});

/** Catalogue factice : Séries › (Friends : saisons 1, 2 ; Autres) ; tranches de 2. */
function fakeLevels() {
  const calls: string[] = [];
  const level = async (page: string, path: PagePath, cursor: string | null): Promise<PageLevel | null> => {
    calls.push(`${page} ${JSON.stringify(path)} ${cursor}`);
    if (page !== 'series') return null;
    const from = Number(cursor ?? 0);
    const slice = <T>(all: T[]) => ({ items: all.slice(from, from + 2), next: from + 2 < all.length ? String(from + 2) : null, total: all.length });
    if (path.length === 0) {
      const s = slice([
        { value: 'Friends', name: 'Friends', count: 3 },
        { value: 'Lost', name: 'Lost', count: 1 },
        { value: null, name: 'Others', count: 2 },
      ]);
      return { page, path, total: s.total, next: s.next, kind: 'groups', info: 'series', groups: s.items };
    }
    if (path.length === 1) {
      if (path[0] === 'Disparue') return null;
      const s = slice([
        { value: 1, name: '1', count: 2 },
        { value: 2, name: '2', count: 1 },
      ]);
      return { page, path, total: s.total, next: s.next, kind: 'groups', info: 'season', groups: s.items };
    }
    const s = slice([el(`${path[0]}-${path[1]}-a`), el(`${path[0]}-${path[1]}-b`), el(`${path[0]}-${path[1]}-c`)]);
    return { page, path, total: s.total, next: s.next, kind: 'elements', elements: s.items };
  };
  return { calls, level };
}

function model(rows = false) {
  const { calls, level } = fakeLevels();
  const seen: PageViewData[] = [];
  const m = createPageModel({ level, t, rows: () => rows, onUpdate: (d) => seen.push(d) });
  return { m, seen, calls };
}

describe('règles de la vue de page', () => {
  it('chemin parcouru : la page, puis chaque valeur choisie (Séries › Friends › Saison 1)', () => {
    const crumbs = pageCrumbs('Séries', ['series', 'season'], ['Friends', 1], 'Autres', groupFormatter(t));
    assert.deepEqual(crumbs, [
      { label: 'Séries', path: [] },
      { label: 'Friends', path: ['Friends'] },
      { label: 'Saison 1', path: ['Friends', 1] },
    ]);
    assert.deepEqual(pageCrumbs('Séries', ['series'], [null], 'Autres').at(-1), { label: 'Autres', path: [null] });
    assert.deepEqual(parentPath(['Friends', 1]), ['Friends']);
    assert.equal(parentPath([]), null);
  });

  it('noms des regroupements : « Autres », saison mise en forme, sinon la valeur', () => {
    const f = groupFormatter(t);
    assert.equal(groupLabel('series', null, 'Autres', f), 'Autres');
    assert.equal(groupLabel('season', 3, 'Autres', f), 'Saison 3');
    assert.equal(groupLabel('year', 1999, 'Autres', f), '1999');
    assert.equal(groupKey(null), 'null');
    assert.notEqual(groupKey(1), groupKey('1'));
  });

  it('carte : celle du thème, sinon celle qu’indique la page', () => {
    assert.equal(pageCardVariant('posters', 'auto'), 'poster');
    assert.equal(pageCardVariant('thumbnails', 'auto'), 'thumbnail');
    assert.equal(pageCardVariant('list', 'auto'), 'line');
    assert.equal(pageCardVariant('rows', undefined), 'poster');
    assert.equal(pageCardVariant('list', 'thumbnail'), 'thumbnail');
  });

  it('mise en page : celle du thème, sauf une page qui demande des rangées ; rangées au dernier niveau de regroupements', () => {
    assert.equal(pageLayout('posters', 'grid'), 'grid');
    assert.equal(pageLayout('posters', 'rows'), 'rows');
    assert.equal(pageLayout('rows', 'grid'), 'rows');
    assert.equal(groupsAsRows('rows', 1, 2), true);
    assert.equal(groupsAsRows('rows', 0, 2), false);
    assert.equal(groupsAsRows('grid', 1, 2), false);
  });

  it('nom de la page : texte ou clé des catalogues', () => {
    assert.equal(pageName(SERIES, t), '«pages.series»');
    assert.equal(pageName({ name: 'Films des années 90' }, t), 'Films des années 90');
  });
});

describe('chargement d’une page', () => {
  it('premier niveau : regroupements nommés, « Autres » en dernier, par tranches', async () => {
    const { m, seen } = model();
    await m.show(SERIES, []);
    assert.equal(seen[0]!.loading, true);
    let d = m.current()!;
    assert.equal(d.kind, 'groups');
    assert.equal(d.info, 'series');
    assert.deepEqual(
      d.groups.map((g) => g.name),
      ['Friends', 'Lost'],
    );
    assert.equal(d.hasMore, true);
    assert.equal(d.total, 3);
    await m.more();
    d = m.current()!;
    assert.deepEqual(
      d.groups.map((g) => [g.value, g.name]),
      [
        ['Friends', 'Friends'],
        ['Lost', 'Lost'],
        [null, 'Autres'],
      ],
    );
    assert.equal(d.hasMore, false);
    await m.more();
    assert.equal(m.current()!.groups.length, 3);
  });

  it('chemin dans les regroupements : saisons, puis épisodes ; chemin parcouru tenu à jour', async () => {
    const { m } = model();
    await m.show(SERIES, ['Friends']);
    let d = m.current()!;
    assert.deepEqual(
      d.groups.map((g) => g.name),
      ['Saison 1', 'Saison 2'],
    );
    assert.deepEqual(
      d.crumbs.map((c) => c.label),
      ['«pages.series»', 'Friends'],
    );
    await m.show(SERIES, ['Friends', 1]);
    d = m.current()!;
    assert.equal(d.kind, 'elements');
    assert.equal(d.depth, 2);
    assert.deepEqual(
      d.elements.map((e) => e.key),
      ['Friends-1-a', 'Friends-1-b'],
    );
    assert.deepEqual(d.crumbs.at(-1), { label: 'Saison 1', path: ['Friends', 1] });
    assert.deepEqual(m.route()?.path, ['Friends', 1]);
  });

  it('page ou regroupement disparu : vue vide signalée', async () => {
    const { m } = model();
    await m.show(SERIES, ['Disparue']);
    assert.equal(m.current()!.missing, true);
    assert.equal(m.current()!.loading, false);
  });

  it('rangées : chaque regroupement montre ses premiers éléments', async () => {
    const { m, calls } = model(true);
    await m.show(SERIES, ['Friends']);
    const d = m.current()!;
    assert.deepEqual(
      d.groups.map((g) => g.elements?.map((e) => e.key)),
      [
        ['Friends-1-a', 'Friends-1-b'],
        ['Friends-2-a', 'Friends-2-b'],
      ],
    );
    assert.ok(calls.includes('series ["Friends",1] null'));
    assert.ok(ROW_SIZE >= 10);
  });

  it('une réponse d’une page quittée entre-temps est ignorée', async () => {
    const { level } = fakeLevels();
    let release!: () => void;
    const slow = async (p: string, path: PagePath, c: string | null) => {
      if (path.length === 0) await new Promise<void>((r) => (release = r));
      return level(p, path, c);
    };
    const m = createPageModel({ level: slow, t, rows: () => false, onUpdate: () => {} });
    const first = m.show(SERIES, []);
    await m.show(SERIES, ['Friends']);
    release();
    await first;
    assert.deepEqual(m.current()!.crumbs.length, 2);
    assert.equal(m.current()!.info, 'season');
  });

  it('rechargement : autant de tranches qu’avant, sans passer par une vue vide', async () => {
    const { m, seen } = model();
    await m.show(SERIES, []);
    await m.more();
    const before = seen.length;
    await m.refresh();
    assert.equal(seen.length, before + 1);
    assert.equal(m.current()!.groups.length, 3);
  });
});
