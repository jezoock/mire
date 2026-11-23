// Éditeurs des regroupements (P4-22) : un album ou une série désignés par leur chemin dans une page ; infos, tags et
// images posés sur tous leurs éléments en une seule écriture ; renommage (info qui sert à regrouper, valeur d'une
// liste) ; réinitialisation ; fiche trouvée en ligne ; IPC.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElementSourceRef } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { localFileKey } from '../../src/main/catalog/keys.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createPages } from '../../src/main/catalog/pages/index.ts';
import { editGroup, groupFacts, groupOf, renamedInfo, setGroupImages } from '../../src/main/catalog/groups.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import { builtinTranslator } from '../../src/main/i18n/current.ts';
import { catalogHandlers } from '../../src/main/ipc/handlers/catalog.ts';
import type { MainContext } from '../../src/main/ipc/context.ts';
import { BUILTIN_PAGES } from '../fixtures/builtin-pages.ts';

const LIB: ElementSourceRef = { plugin: 'src-local', instance: '/bib' };

function file(p: string, infos: ElementInput['infos']): ElementInput {
  return { key: localFileKey(p, 'linux'), name: path.basename(p), open: { kind: 'file', path: p }, tags: ['local'], infos, images: {} };
}

const TRACKS = [
  file('/bib/Orchestre/Premier album/01.mp3', { artist: 'Orchestre', album: 'Premier album' }),
  file('/bib/Orchestre/Premier album/02.mp3', { artist: 'Orchestre', album: 'Premier album', year: 1999 }),
  file('/bib/Orchestre/Second album/01.mp3', { artist: 'Orchestre', album: 'Second album' }),
];
const ALBUM = ['Orchestre', 'Premier album'];
const key = (p: string) => localFileKey(p, 'linux');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-groups-'));
  const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
  const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
  overrides.load();
  const { t } = builtinTranslator('fr');
  const engine = createTagEngine({ catalog, overrides, registry: createRegistry(t), rules: () => fileTagRules(undefined) });
  const pages = createPages({ builtin: BUILTIN_PAGES, file: path.join(dir, 'pages.json'), engine, catalog, translate: t, onIgnored: () => {} });
  pages.load();
  catalog.setSource(LIB, TRACKS);
  return { dir, catalog, overrides, engine, pages, deps: { pages, tags: engine } };
}

describe('regroupements : lecture', () => {
  it('un album désigné par son chemin : son info, sa valeur et ses éléments', () => {
    const { deps } = setup();
    const g = groupOf(deps, 'music', ALBUM)!;
    assert.equal(g.info, 'album');
    assert.equal(g.value, 'Premier album');
    assert.deepEqual(g.elements.map((e) => e.name).sort(), ['01.mp3', '02.mp3']);
    // Un niveau au-dessus : tous les éléments, quel que soit le nombre de niveaux en dessous.
    assert.equal(groupOf(deps, 'music', ['Orchestre'])!.elements.length, 3);
  });

  it('page inconnue, chemin vide, trop long ou regroupement vide : null', () => {
    const { deps } = setup();
    assert.equal(groupOf(deps, 'inconnue', ALBUM), null);
    assert.equal(groupOf(deps, 'music', []), null);
    assert.equal(groupOf(deps, 'music', [...ALBUM, 'x']), null);
    assert.equal(groupOf(deps, 'music', ['Orchestre', 'Pas un album']), null);
    assert.equal(groupOf(deps, 'music', 'Orchestre'), null);
  });
});

describe('regroupements : modification', () => {
  it('infos, tags et images valent pour tous les éléments, en une seule écriture', () => {
    const { deps, engine, pages } = setup();
    const changes: string[][] = [];
    engine.onChange((keys) => changes.push(keys));
    const pageChanges: string[][] = [];
    pages.onChange((ids) => pageChanges.push(ids));
    const g = editGroup(deps, 'music', ALBUM, { infos: { year: 2001, genres: ['Jazz'] }, tags: { 'À écouter': true, local: false } })!;
    for (const e of g.elements) {
      assert.equal(e.infos.year, 2001);
      assert.deepEqual(e.infos.genres, ['Jazz']);
      assert.ok(e.tags.includes('a-ecouter'));
      assert.ok(!e.tags.includes('local'));
    }
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].sort(), [key('/bib/Orchestre/Premier album/01.mp3'), key('/bib/Orchestre/Premier album/02.mp3')].sort());
    assert.equal(pageChanges.length, 1);
    // L'autre album n'est pas touché.
    assert.equal(engine.element(key('/bib/Orchestre/Second album/01.mp3'))!.infos.year, undefined);
    const withImages = setGroupImages(deps, 'music', ALBUM, { poster: '/meta/img/a.jpg', name: '/x' } as never)!;
    assert.deepEqual(
      withImages.elements.map((e) => e.images),
      [{ poster: '/meta/img/a.jpg' }, { poster: '/meta/img/a.jpg' }],
    );
    const cleared = editGroup(deps, 'music', ALBUM, { clearImages: ['poster'] })!;
    assert.deepEqual(
      cleared.elements.map((e) => e.images),
      [{}, {}],
    );
  });

  it('renommer change l’info qui sert à regrouper ; le regroupement est rendu à son nouveau chemin', () => {
    const { deps, pages } = setup();
    const g = editGroup(deps, 'music', ALBUM, { rename: 'Premier album (réédition)', infos: { album: 'ignoré' } })!;
    assert.deepEqual(g.path, ['Orchestre', 'Premier album (réédition)']);
    assert.equal(g.elements.length, 2);
    const lvl = pages.page('music', ['Orchestre']);
    assert.deepEqual(lvl?.kind === 'groups' ? lvl.groups.map((x) => x.value) : [], ['Premier album (réédition)', 'Second album']);
    assert.equal(groupOf(deps, 'music', ALBUM), null);
  });

  it('renommer une valeur d’une liste (un genre) garde les autres valeurs', () => {
    assert.deepEqual(renamedInfo(['Drame', 'Comédie'], 'Drame', 'Drama'), ['Drama', 'Comédie']);
    assert.deepEqual(renamedInfo(['Comédie'], null, 'Drame'), ['Comédie', 'Drame']);
    assert.deepEqual(renamedInfo(['Drame', 'Drama'], 'Drame', 'Drama'), ['Drama']);
    assert.equal(renamedInfo('Ancien', 'Ancien', 'Nouveau'), 'Nouveau');
    assert.equal(renamedInfo(undefined, null, 'Nouveau'), 'Nouveau');
  });

  it('réinitialiser : chaque élément revient à l’automatique', () => {
    const { deps, engine, overrides } = setup();
    editGroup(deps, 'music', ALBUM, { infos: { year: 2001 }, tags: { local: false } });
    const renamed = editGroup(deps, 'music', ALBUM, { rename: 'Autre nom' })!;
    const back = editGroup(deps, 'music', renamed.path, { reset: true });
    // Le nom d'origine revient : le regroupement renommé a disparu.
    assert.equal(back, null);
    const g = groupOf(deps, 'music', ALBUM)!;
    assert.deepEqual(
      g.elements.map((e) => e.infos.year),
      [undefined, 1999],
    );
    for (const e of g.elements) assert.ok(e.tags.includes('local'));
    assert.equal(overrides.get(key('/bib/Orchestre/Premier album/01.mp3')), undefined);
    assert.equal(engine.element(key('/bib/Orchestre/Premier album/02.mp3'))!.infos.album, 'Premier album');
  });

  it('modification invalide : null, rien n’est changé', () => {
    const { deps, engine } = setup();
    assert.equal(editGroup(deps, 'music', ALBUM, null), null);
    assert.equal(editGroup(deps, 'music', ['Orchestre', 'Pas un album'], { reset: true }), null);
    assert.equal(engine.element(key('/bib/Orchestre/Premier album/02.mp3'))!.infos.year, 1999);
  });

  it('fiche trouvée en ligne : seulement ses infos texte', () => {
    assert.deepEqual(
      groupFacts({ title: ' Kind of Blue ', year: '1959', genre: 'Jazz', artist: 'Miles Davis', overview: '', image: '/x.jpg', source: 'MusicBrainz' }),
      {
        title: 'Kind of Blue',
        year: '1959',
        genre: 'Jazz',
        artist: 'Miles Davis',
      },
    );
  });
});

describe('regroupements : IPC', () => {
  it('catalogGroup, catalogEditGroup, catalogGroupPickImage refuse une image inconnue', async () => {
    const { catalog, engine, pages } = setup();
    const h = catalogHandlers({ catalog, tags: engine, pages } as unknown as MainContext);
    assert.equal(h.catalogGroup('music', ALBUM)!.elements.length, 2);
    assert.deepEqual(h.catalogEditGroup('music', ALBUM, { rename: 'Nouveau' })!.path, ['Orchestre', 'Nouveau']);
    assert.equal(await h.catalogGroupPickImage('music', ['Orchestre', 'Nouveau'], 'name' as never), null);
    assert.equal(await h.catalogGroupPickImage('music', ALBUM, 'poster'), null);
  });

  it('catalogGroupFetch : images de la fiche posées sur les éléments, infos proposées', async () => {
    const { catalog, engine, pages } = setup();
    const jobs: unknown[] = [];
    const scraper = {
      lookup: async (job: unknown) => {
        jobs.push(job);
        return { ok: true, facts: { title: 'Premier album', year: '1999', artist: 'Orchestre', image: '/scrape/img/a.jpg', source: 'MusicBrainz' } };
      },
    };
    const h = catalogHandlers({ catalog, tags: engine, pages, scraper } as unknown as MainContext);
    const r = await h.catalogGroupFetch('music', ALBUM, { kind: 'album', item: { folder: 'Premier album' }, pick: { id: 'mb-1', title: 'Premier album' } });
    assert.ok(r.ok);
    assert.deepEqual(r.facts, { title: 'Premier album', year: '1999', artist: 'Orchestre' });
    assert.deepEqual(
      r.group!.elements.map((e) => e.images.poster),
      ['/scrape/img/a.jpg', '/scrape/img/a.jpg'],
    );
    assert.deepEqual(jobs, [
      {
        kind: 'album',
        item: { folder: 'Premier album' },
        override: { pick: { id: 'mb-1', title: 'Premier album' } },
        key: 'group:music:["Orchestre","Premier album"]:mb-1',
      },
    ]);
    // Sans fiche choisie, ou fournisseur en erreur : rien n'est posé.
    assert.deepEqual(await h.catalogGroupFetch('music', ALBUM, { kind: 'album' }), { ok: false });
    const failing = catalogHandlers({
      catalog,
      tags: engine,
      pages,
      scraper: { lookup: async () => ({ ok: false, error: 'Refusé' }) },
    } as unknown as MainContext);
    assert.deepEqual(await failing.catalogGroupFetch('music', ALBUM, { kind: 'album', pick: { id: 'x' } }), { ok: false, error: 'Refusé' });
  });
});
