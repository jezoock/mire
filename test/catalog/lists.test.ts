// Listes (P2-08) : création, nom, suppression ; ajout, retrait et déplacement d'éléments (ordre gardé) ; élément
// disparu du catalogue puis revenu ; liste vue comme une page (`catalog.page('list:<id>')`) ; `lists.json` et IPC.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listIdOfPage, listPageId, validateList, type ElementSourceRef, type PageLevel } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { localFileKey } from '../../src/main/catalog/keys.ts';
import { createLists, LISTS_VERSION } from '../../src/main/catalog/lists/index.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createPages, PAGE_SIZE } from '../../src/main/catalog/pages/index.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { bundledTaggers } from './bundled-taggers.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import { builtinTranslator } from '../../src/main/i18n/current.ts';
import { catalogHandlers } from '../../src/main/ipc/handlers/catalog.ts';
import type { MainContext } from '../../src/main/ipc/context.ts';
import { BUILTIN_PAGES } from '../fixtures/builtin-pages.ts';

const LIB: ElementSourceRef = { plugin: 'src-local', instance: '/bib' };

function file(p: string): ElementInput {
  return { key: localFileKey(p, 'linux'), name: path.basename(p, path.extname(p)), open: { kind: 'file', path: p }, tags: ['local'], infos: {}, images: {} };
}
const key = (p: string) => localFileKey(p, 'linux');

function setup(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-lists-'))) {
  const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
  catalog.load();
  const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
  overrides.load();
  const { t } = builtinTranslator('fr');
  const engine = createTagEngine({
    catalog,
    overrides,
    registry: createRegistry(t),
    rules: () => fileTagRules(undefined),
    contributors: bundledTaggers(),
  });
  const ignored: string[] = [];
  const listsFile = path.join(dir, 'lists.json');
  let n = 0;
  const lists = createLists({ file: listsFile, engine, onIgnored: (_f, r) => ignored.push(r), newId: () => `l${++n}` });
  lists.load();
  const events: string[][] = [];
  lists.onChange((ids) => events.push(ids));
  return { dir, catalog, engine, lists, listsFile, ignored, events, t };
}

const FILMS = ['/bib/Alien.mkv', '/bib/Brazil.mkv', '/bib/Casablanca.mkv', '/bib/Dune.mkv'];
const names = (lvl: PageLevel | null) => (lvl?.kind === 'elements' ? lvl.elements.map((e) => e.name) : assert.fail('éléments attendus'));
const order = (s: ReturnType<typeof setup>, id: string) => s.lists.get(id)!.items.map((i) => i.name);

describe('Listes', () => {
  it('crée, renomme et supprime une liste', () => {
    const s = setup();
    assert.equal(s.lists.create('   '), null);
    assert.equal(s.lists.create(42), null);
    assert.deepEqual(s.lists.create('À voir'), { id: 'l1', name: 'À voir', count: 0 });
    assert.deepEqual(s.lists.create({ key: 'lists.favorites' }), { id: 'l2', name: { key: 'lists.favorites' }, count: 0 });
    assert.equal(s.lists.rename('l1', 'À revoir'), true);
    assert.equal(s.lists.rename('l1', ''), false);
    assert.equal(s.lists.rename('inconnue', 'X'), false);
    assert.deepEqual(
      s.lists.list().map((l) => l.name),
      ['À revoir', { key: 'lists.favorites' }],
    );
    assert.equal(s.lists.remove('l2'), true);
    assert.equal(s.lists.remove('l2'), false);
    assert.equal(s.lists.get('l2'), null);
    assert.deepEqual(s.events, [['l1'], ['l2'], ['l1'], ['l2']]);
  });

  it("garde l'ordre choisi : ajout à une position, sans doublon, retrait et déplacement", () => {
    const s = setup();
    s.catalog.setSource(LIB, FILMS.map(file));
    const { id } = s.lists.create('Soirée')!;
    assert.equal(s.lists.add(id, [key(FILMS[2]), key(FILMS[0])]), 2);
    assert.deepEqual(order(s, id), ['Casablanca', 'Alien']);
    // Position donnée ; un élément déjà là ou absent du catalogue est ignoré.
    assert.equal(s.lists.add(id, [key(FILMS[3]), key(FILMS[0]), key('/bib/Absent.mkv'), 7], 1), 1);
    assert.deepEqual(order(s, id), ['Casablanca', 'Dune', 'Alien']);
    assert.equal(s.lists.add(id, [key(FILMS[1])], 99), 1);
    assert.deepEqual(order(s, id), ['Casablanca', 'Dune', 'Alien', 'Brazil']);
    assert.equal(s.lists.move(id, key(FILMS[1]), 0), true);
    assert.equal(s.lists.move(id, key(FILMS[2]), 10), true);
    assert.equal(s.lists.move(id, key('/bib/Absent.mkv'), 0), false);
    assert.equal(s.lists.move(id, key(FILMS[0]), -1), false);
    assert.deepEqual(order(s, id), ['Brazil', 'Dune', 'Alien', 'Casablanca']);
    assert.equal(s.lists.removeItems(id, [key(FILMS[3]), key('/bib/Absent.mkv')]), 1);
    assert.equal(s.lists.removeItems(id, [key(FILMS[3])]), 0);
    assert.deepEqual(order(s, id), ['Brazil', 'Alien', 'Casablanca']);
    assert.equal(s.lists.add('inconnue', [key(FILMS[0])]), null);

    // L'ordre est relu tel quel ; l'ordre des éléments du catalogue n'y change rien.
    const again = setup(s.dir);
    assert.deepEqual(order(again, id), ['Brazil', 'Alien', 'Casablanca']);
    assert.deepEqual(names(again.lists.page(listPageId(id))), ['Brazil', 'Alien', 'Casablanca']);
  });

  it('garde un élément disparu, marqué indisponible, et le retrouve quand il revient', () => {
    const s = setup();
    s.catalog.setSource(LIB, FILMS.map(file));
    const { id } = s.lists.create('Soirée')!;
    s.lists.add(id, [key(FILMS[0]), key(FILMS[1]), key(FILMS[2])]);
    const other = s.lists.create('Autre')!.id;
    s.events.length = 0;

    // Brazil disparaît : il reste à sa place, avec son nom, et la liste est annoncée (pas l'autre).
    s.catalog.setSource(LIB, [FILMS[0], FILMS[2], FILMS[3]].map(file));
    assert.deepEqual(s.events, [[id]]);
    assert.deepEqual(
      s.lists.get(id)!.items.map((i) => [i.name, i.available]),
      [
        ['Alien', true],
        ['Brazil', false],
        ['Casablanca', true],
      ],
    );
    const lvl = s.lists.page(listPageId(id));
    assert.equal(lvl?.kind, 'elements');
    const gone = lvl!.kind === 'elements' ? lvl!.elements[1] : assert.fail();
    assert.equal(gone.unavailable, true);
    assert.equal(gone.name, 'Brazil');
    assert.deepEqual(gone.open, { kind: 'file', path: FILMS[1] });
    assert.deepEqual(gone.tags, []);
    assert.equal(lvl!.kind === 'elements' && lvl!.elements[0].unavailable, undefined);

    // Toujours là après un redémarrage, sans rien recalculer.
    const again = setup(s.dir);
    assert.deepEqual(
      again.lists.get(id)!.items.map((i) => i.available),
      [true, false, true],
    );

    // Il revient : disponible à la même place, liste annoncée.
    s.events.length = 0;
    s.catalog.setSource(LIB, FILMS.map(file));
    assert.deepEqual(s.events, [[id]]);
    assert.deepEqual(
      s.lists.get(id)!.items.map((i) => [i.name, i.available]),
      [
        ['Alien', true],
        ['Brazil', true],
        ['Casablanca', true],
      ],
    );
    assert.equal(
      s.lists.page(listPageId(id))!.kind === 'elements' && (s.lists.page(listPageId(id)) as { elements: { unavailable?: true }[] }).elements[1].unavailable,
      undefined,
    );
    assert.deepEqual(s.lists.get(other)!.items, []);

    // Retiré de la liste pendant son absence : il n'y revient pas.
    s.catalog.setSource(LIB, [FILMS[0]].map(file));
    s.lists.removeItems(id, [key(FILMS[1])]);
    s.events.length = 0;
    s.catalog.setSource(LIB, FILMS.map(file));
    assert.deepEqual(order(s, id), ['Alien', 'Casablanca']);
    assert.deepEqual(s.events, [[id]]);
  });

  it("garde le dernier nom connu d'un élément renommé", () => {
    const s = setup();
    s.catalog.setSource(LIB, [file(FILMS[0])]);
    const { id } = s.lists.create('L')!;
    s.lists.add(id, [key(FILMS[0])]);
    s.catalog.setSource(LIB, [{ ...file(FILMS[0]), name: 'Alien (1979)' }]);
    s.catalog.setSource(LIB, []);
    assert.deepEqual(s.lists.get(id)!.items, [{ key: key(FILMS[0]), name: 'Alien (1979)', available: false }]);
    const saved = JSON.parse(fs.readFileSync(s.listsFile, 'utf8'));
    assert.equal(saved.lists[0].items[0].name, 'Alien (1979)');
  });

  it('sert de page : tranches dans l’ordre de la liste, sans regroupement', () => {
    const s = setup();
    const many = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => `/bib/F${String(i).padStart(3, '0')}.mkv`);
    s.catalog.setSource(LIB, many.map(file));
    const { id } = s.lists.create('Beaucoup')!;
    s.lists.add(id, [...many].reverse().map(key));
    const first = s.lists.page(listPageId(id), [], null)!;
    assert.equal(first.page, 'list:l1');
    assert.equal(first.total, PAGE_SIZE + 5);
    assert.equal(first.next, String(PAGE_SIZE));
    assert.equal(names(first)[0], `F${PAGE_SIZE + 4}`);
    const second = s.lists.page(listPageId(id), [], first.next)!;
    assert.equal(second.next, null);
    assert.deepEqual(names(second), ['F004', 'F003', 'F002', 'F001', 'F000']);
    assert.equal(s.lists.page(listPageId(id), ['x']), null);
    assert.equal(s.lists.page('list:inconnue'), null);
    assert.equal(s.lists.page(id), null);
    assert.equal(listIdOfPage('series'), null);
    assert.equal(listIdOfPage('list:l1'), 'l1');
  });

  it('écarte une liste ou un élément mal formé de lists.json sans perdre le reste', () => {
    const s = setup();
    const item = { key: key(FILMS[0]), name: 'Alien', source: LIB, open: { kind: 'file', path: FILMS[0] }, added: 1 };
    fs.writeFileSync(
      s.listsFile,
      JSON.stringify({
        version: LISTS_VERSION,
        lists: [
          {
            id: 'bonne',
            name: 'Bonne',
            items: [item, { key: 'x', name: 'Sans ouverture' }, item, { ...item, key: key(FILMS[1]), open: { kind: 'game', console: 'snes' } }],
          },
          { id: 'Mauvaise Id', name: 'X', items: [] },
          { id: 'bonne', name: 'Doublon', items: [] },
          { id: 'sans-nom', items: [] },
        ],
      }),
    );
    const again = setup(s.dir);
    assert.deepEqual(
      again.lists.list().map((l) => [l.id, l.count]),
      [['bonne', 1]],
    );
    assert.equal(again.ignored.length, 4);
    assert.equal(validateList({ id: 'a', name: 'A', items: [], extra: 1 }).ok, false);

    fs.writeFileSync(s.listsFile, JSON.stringify({ version: 99, lists: [] }));
    const other = setup(s.dir);
    assert.deepEqual(other.lists.list(), []);
    assert.deepEqual(other.ignored, ['version 99']);
  });

  it('IPC : lists.* et catalog.page sur une liste ou une page', () => {
    const s = setup();
    s.catalog.setSource(LIB, FILMS.map(file));
    const pages = createPages({
      builtin: BUILTIN_PAGES,
      file: path.join(s.dir, 'pages.json'),
      engine: s.engine,
      catalog: s.catalog,
      translate: s.t,
      onIgnored: () => {},
    });
    pages.load();
    const h = catalogHandlers({ tags: s.engine, pages, lists: s.lists } as unknown as MainContext);
    const { id } = h.listsCreate('Ma liste')!;
    assert.equal(h.listsAdd(id, [key(FILMS[1]), key(FILMS[0])]), 2);
    assert.equal(h.listsMove(id, key(FILMS[0]), 0), true);
    assert.equal(h.listsRename(id, 'Renommée'), true);
    assert.deepEqual(names(h.catalogPage(listPageId(id), [], null)), ['Alien', 'Brazil']);
    assert.equal(h.catalogPage('movies', [], null)?.kind, 'groups');
    assert.equal(h.listsRemoveItems(id, [key(FILMS[1])]), 1);
    assert.deepEqual(h.listsList(), [{ id, name: 'Renommée', count: 1 }]);
    assert.equal(h.listsGet(id)!.items.length, 1);
    assert.equal(h.listsRemove(id), true);
  });
});

describe('Listes : ordre (P4-21)', () => {
  it('les listes nommées passent d’abord, dans cet ordre ; les autres suivent', () => {
    const s = setup();
    for (const n of ['A', 'B', 'C']) s.lists.create(n);
    assert.equal(s.lists.reorder(['l3', 'l1']), true);
    assert.deepEqual(
      s.lists.list().map((l) => l.name),
      ['C', 'A', 'B'],
    );
    assert.deepEqual(s.events.at(-1), ['l3', 'l1', 'l2']);
    const again = setup(s.dir);
    assert.deepEqual(
      again.lists.list().map((l) => l.id),
      ['l3', 'l1', 'l2'],
    );
  });

  it('refusé : identifiant inconnu, doublon, trop d’identifiants, autre chose qu’une liste', () => {
    const s = setup();
    for (const n of ['A', 'B']) s.lists.create(n);
    assert.equal(s.lists.reorder(['l1', 'x']), false);
    assert.equal(s.lists.reorder(['l1', 'l1']), false);
    assert.equal(s.lists.reorder(['l1', 'l2', 'l3']), false);
    assert.equal(s.lists.reorder('l1'), false);
    assert.equal(s.lists.reorder([{}]), false);
    assert.deepEqual(
      s.lists.list().map((l) => l.id),
      ['l1', 'l2'],
    );
  });
});
