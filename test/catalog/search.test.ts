// Recherche dans le catalogue (P2-09) : cas repris de la recherche de l'interface historique
// (`test/renderer/domain/search.test.ts` : tous les mots, ordre libre, casse et accents ignorés), infos texte, noms des
// tags, résultats groupés par page, éléments hors pages, limite, suivi des changements et IPC.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fold, type ElementSourceRef, type SearchResult } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { localFileKey } from '../../src/main/catalog/keys.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createPages } from '../../src/main/catalog/pages/index.ts';
import { createSearch, infoTexts, quickFold, searchWords, SEARCH_LIMIT } from '../../src/main/catalog/search/index.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { CORE_INFOS, createRegistry, searchedAs } from '../../src/main/catalog/tags/registry.ts';
import { builtinTaggers, taggerContributor } from '../../src/main/catalog/tags/taggers.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import { builtinTranslator } from '../../src/main/i18n/current.ts';
import { catalogHandlers } from '../../src/main/ipc/handlers/catalog.ts';
import type { MainContext } from '../../src/main/ipc/context.ts';

const LIB: ElementSourceRef = { plugin: 'src-local', instance: '/bib' };

function file(p: string, infos: ElementInput['infos'] = {}): ElementInput {
  return { key: localFileKey(p, 'linux'), name: path.basename(p, path.extname(p)), open: { kind: 'file', path: p }, tags: ['local'], infos, images: {} };
}

function setup(elements: ElementInput[], language = 'fr') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-search-'));
  const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
  const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
  overrides.load();
  const { t } = builtinTranslator(language);
  const registry = createRegistry(t);
  const engine = createTagEngine({
    catalog,
    overrides,
    registry,
    rules: () => fileTagRules(undefined),
    contributors: builtinTaggers(() => []).map(taggerContributor),
  });
  const pages = createPages({ file: path.join(dir, 'pages.json'), engine, catalog, translate: t, onIgnored: () => {} });
  pages.load();
  catalog.setSource(LIB, elements);
  const search = createSearch({ engine, catalog, pages, registry, translate: t });
  return { catalog, engine, pages, search };
}

/** Noms trouvés, tous groupes confondus (un élément une fois). */
const found = (r: SearchResult) => [...new Set(r.groups.flatMap((g) => g.elements.map((e) => e.name)))].sort();
const groupsOf = (r: SearchResult) => r.groups.map((g) => [g.page, g.name, g.total, g.elements.map((e) => e.name)]);

describe('catalog/search : comparaison (reprise de la recherche actuelle)', () => {
  const { search } = setup([file('/bib/Le Château Ambulant.txt'), file('/bib/Chateau de sable.txt'), file('/bib/Ambulance.txt')]);

  it('tous les mots, dans n’importe quel ordre, casse et accents ignorés', () => {
    assert.deepEqual(found(search.search('CHÂTEAU')), ['Chateau de sable', 'Le Château Ambulant']);
    assert.deepEqual(found(search.search('ambul chateau')), ['Le Château Ambulant']);
    assert.deepEqual(found(search.search('  ambul   ')), ['Ambulance', 'Le Château Ambulant']);
    assert.deepEqual(search.search('zzz'), { query: 'zzz', total: 0, groups: [] });
  });

  it('sans recherche, ou faite d’espaces : aucun résultat', () => {
    for (const q of ['', '   ', null, 42]) assert.deepEqual(search.search(q).groups, []);
  });

  it('mots de la recherche : simplifiés comme `matcher`', () => {
    assert.deepEqual(searchWords('  Été  2 '), ['ete', '2']);
    assert.deepEqual(searchWords(null), []);
  });

  it('quickFold donne le même résultat que fold', () => {
    for (const v of ['ABC def', 'Château', 'ÉTÉ 2024', 'Ça', 'ﬁn', '']) assert.equal(quickFold(v), fold(v));
  });
});

describe('catalog/search : infos texte et noms des tags', () => {
  it('les infos texte et les éléments texte des listes comptent, pas les nombres', () => {
    const { engine, search } = setup([file('/bib/a.mkv', { folder: 'Vacances' }), file('/bib/b.mkv')]);
    const b = localFileKey('/bib/b.mkv', 'linux');
    engine.setInfos(b, { title: 'Titre officiel', genres: ['Comédie', 'Drame'], year: 2024 });
    assert.deepEqual(found(search.search('vacances')), ['a']);
    assert.deepEqual(found(search.search('officiel comedie')), ['b']);
    assert.deepEqual(found(search.search('2024')), [], 'année : un nombre, pas un texte');
  });

  it('infoTexts suit le registre ; une info non déclarée compte si c’est un texte, une info non cherchable jamais', () => {
    const { infoSearch } = createRegistry((k) => k);
    const infos = {
      title: 'T',
      year: 1999,
      genres: ['G', 3 as unknown as string],
      plugin: 'P',
      other: 5,
      extension: 'mkv',
      subtitles: ['a.srt'],
      server: 'nas',
      mediaType: 'video',
    };
    assert.deepEqual(infoTexts(infos, infoSearch), ['T', 'G', 'P']);
  });

  it('les infos non cherchables (extension, sous-titres, serveur, genre de média) ne trouvent rien', () => {
    const { search } = setup([file('/bib/Vacances.mkv', { subtitles: ['/bib/Vacances.fr.srt'], server: 'nas.local' }), file('/bib/Mkv expliqué.txt')]);
    assert.deepEqual(found(search.search('mkv')), ['Mkv expliqué'], 'le nom reste cherché, pas l’extension');
    assert.deepEqual(found(search.search('srt')), []);
    assert.deepEqual(found(search.search('nas')), []);
  });

  it('searchedAs : vrai par défaut pour les textes et les listes, jamais pour les nombres', () => {
    assert.equal(searchedAs({ type: 'text' }), 'text');
    assert.equal(searchedAs({ type: 'list' }), 'list');
    assert.equal(searchedAs({ type: 'text', searchable: false }), null);
    assert.equal(searchedAs({ type: 'number', searchable: true }), null);
    assert.equal(searchedAs({ type: 'boolean' }), null);
    assert.equal(searchedAs(undefined), 'text');
    for (const id of ['extension', 'subtitles', 'server', 'mediaType']) assert.equal(CORE_INFOS[id].searchable, false, id);
    for (const id of ['title', 'folder', 'playlist', 'genres', 'series', 'album', 'artist', 'overview', 'system', 'category'])
      assert.equal(searchedAs(CORE_INFOS[id]), CORE_INFOS[id].type, id);
  });

  it('les noms des tags, dans la langue de l’interface ; les tags de l’utilisateur aussi', () => {
    const elements = [file('/bib/Intouchables.mkv'), file('/bib/notes.txt')];
    const fr = setup(elements);
    assert.deepEqual(found(fr.search.search('films')), ['Intouchables']);
    assert.deepEqual(found(fr.search.search('ordinateur notes')), ['notes'], 'tag `local` : « Sur cet ordinateur »');
    const en = setup(elements, 'en');
    assert.deepEqual(found(en.search.search('movies')), ['Intouchables']);
    assert.deepEqual(found(en.search.search('films')), []);
    fr.engine.setTags(localFileKey('/bib/notes.txt', 'linux'), { 'Vus en 2024': true });
    assert.deepEqual(found(fr.search.search('vus 2024')), ['notes']);
  });
});

describe('catalog/search : résultats groupés par page', () => {
  const elements = [
    file('/bib/Friends S01E03.mkv'),
    file('/bib/Friends et voisins.mkv'),
    file('/bib/friends.mp3'),
    file('/bib/Friends.txt'),
    file('/bib/Autre.mkv'),
  ];

  it('un groupe par page qui a des résultats, dans l’ordre du menu, puis les éléments hors pages', () => {
    const { search } = setup(elements);
    const r = search.search('friends');
    assert.equal(r.total, 4);
    assert.deepEqual(groupsOf(r), [
      ['movies', 'Films', 1, ['Friends et voisins']],
      ['series', 'Séries', 1, ['Friends S01E03']],
      ['music', 'Musique', 1, ['friends']],
      [null, 'Autres éléments', 1, ['Friends']],
    ]);
    assert.ok(r.groups[0].elements[0].tags.includes('movie'), 'éléments avec leurs tags et infos effectifs');
  });

  it('un élément dans plusieurs pages est dans chacun de leurs groupes, et compte une fois ; `where` est suivi', () => {
    const { pages, search } = setup(elements);
    assert.equal(pages.save({ id: 'tout', name: 'Tout', require: ['local'], where: [{ info: 'extension', equals: 'mkv' }] }).ok, true);
    const r = search.search('friends');
    assert.equal(r.total, 4);
    const tout = r.groups.find((g) => g.page === 'tout');
    assert.deepEqual(tout && [tout.name, tout.total], ['Tout', 2]);
    assert.deepEqual(
      r.groups.at(-1)?.elements.map((e) => e.name),
      ['Friends'],
      'le .txt reste hors pages',
    );
  });

  it('le nom d’abord, puis par nom ; `limit` éléments par groupe avec le total', () => {
    const many = Array.from({ length: 30 }, (_, i) => file(`/bib/Note ${String(i).padStart(2, '0')}.txt`));
    const { engine, search } = setup([...many, file('/bib/zzz.txt')]);
    engine.setInfos(localFileKey('/bib/zzz.txt', 'linux'), { title: 'note' });
    const r = search.search('note');
    assert.equal(r.groups[0].total, 31);
    assert.equal(r.groups[0].elements.length, SEARCH_LIMIT);
    assert.equal(r.groups[0].elements[0].name, 'Note 00');
    assert.equal(search.search('note', { limit: 40 }).groups[0].elements.at(-1)?.name, 'zzz', 'trouvé par son titre : après');
    assert.equal(search.search('note', { limit: 1000 }).groups[0].elements.length, 31);
    assert.equal(search.search('note', { limit: -1 }).groups[0].elements.length, SEARCH_LIMIT);
  });
});

describe('catalog/search : suivi des changements', () => {
  it('rien n’est préparé avant la première recherche ; ensuite, les changements du moteur sont suivis', () => {
    const { catalog, engine, search } = setup([file('/bib/a.txt'), file('/bib/b.txt')]);
    const a = localFileKey('/bib/a.txt', 'linux');
    assert.deepEqual(found(search.search('pomme')), []);
    engine.setInfos(a, { title: 'Pomme' });
    assert.deepEqual(found(search.search('pomme')), ['a']);
    catalog.setSource(LIB, [file('/bib/b.txt'), file('/bib/Pomme verte.txt')]);
    assert.deepEqual(found(search.search('pomme')), ['Pomme verte'], 'élément retiré, élément ajouté');
    // Beaucoup d'éléments d'un coup : les textes sont oubliés, puis recalculés.
    catalog.setSource(
      LIB,
      Array.from({ length: 600 }, (_, i) => file(`/bib/pomme ${i}.txt`)),
    );
    assert.equal(search.search('pomme').total, 600);
    catalog.removeSource(LIB);
    assert.equal(search.search('pomme').total, 0);
  });
});

describe('catalog/search : calcul à la demande', () => {
  it('createSearch ne parcourt pas le catalogue ; la première recherche, si', () => {
    const { catalog, engine, pages } = setup([file('/bib/a.txt')]);
    let walks = 0;
    const counted = { ...engine, keys: () => (walks++, engine.keys()) };
    const search = createSearch({ engine: counted, catalog, pages, registry: createRegistry((k) => k), translate: (k) => k });
    assert.equal(walks, 0);
    search.search('a');
    search.search('b');
    assert.equal(walks, 1);
  });
});

describe('catalog/search : IPC', () => {
  it('catalogSearch passe la recherche et les options', () => {
    const { search } = setup([file('/bib/Été.txt')]);
    const h = catalogHandlers({ search } as unknown as MainContext);
    assert.deepEqual(found(h.catalogSearch('ete', { limit: 5 })), ['Été']);
  });
});
