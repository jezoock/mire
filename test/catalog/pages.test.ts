// Pages et regroupements (P2-07) : définition et schéma, filtre (`require`, `exclude`, `where`), regroupements sur
// plusieurs niveaux et groupe « Autres », tri, tranches, `pages.json`, événements et IPC.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePage, type ElementSourceRef, type PageDefinition, type PageLevel } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { localFileKey, pcGameKey, romKey } from '../../src/main/catalog/keys.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createPages, PAGE_SIZE } from '../../src/main/catalog/pages/index.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { BUILTIN_PAGES } from '../fixtures/builtin-pages.ts';
import { bundledTaggers } from './bundled-taggers.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import { builtinTranslator } from '../../src/main/i18n/current.ts';
import { catalogHandlers } from '../../src/main/ipc/handlers/catalog.ts';
import type { MainContext } from '../../src/main/ipc/context.ts';
import { channelElement } from '../../src/main/tv/element-sources.ts';

const LIB: ElementSourceRef = { plugin: 'src-local', instance: '/bib' };
const GAMES: ElementSourceRef = { plugin: 'jeux-roms', instance: 'snes|/roms' };

function file(p: string, infos: ElementInput['infos'] = {}, extra: Partial<ElementInput> = {}): ElementInput {
  return {
    key: localFileKey(p, 'linux'),
    name: path.basename(p, path.extname(p)),
    open: { kind: 'file', path: p },
    tags: ['local'],
    infos,
    images: {},
    ...extra,
  };
}

function setup(language = 'fr') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-pages-'));
  const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
  const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
  overrides.load();
  const { t } = builtinTranslator(language);
  const engine = createTagEngine({
    catalog,
    overrides,
    registry: createRegistry(t),
    rules: () => fileTagRules(undefined),
    contributors: bundledTaggers(),
  });
  const file_ = path.join(dir, 'pages.json');
  const pages = createPages({ builtin: BUILTIN_PAGES, file: file_, engine, catalog, translate: t, onIgnored: () => {} });
  pages.load();
  return { dir, file: file_, catalog, engine, pages, t };
}

const names = (lvl: PageLevel | null) => (lvl?.kind === 'elements' ? lvl.elements.map((e) => e.name) : assert.fail('éléments attendus'));
const groups = (lvl: PageLevel | null) => (lvl?.kind === 'groups' ? lvl.groups.map((g) => [g.value, g.count]) : assert.fail('regroupements attendus'));

const SHOWS = [
  '/bib/Friends/Saison 1/Friends S01E03.mkv',
  '/bib/Friends/Saison 1/Friends S01E01.mkv',
  '/bib/Friends/Saison 2/Friends S02E01.mkv',
  '/bib/Friends/Saison 1/Friends S01E02.mkv',
  '/bib/Lost/Lost S01E01.mkv',
  '/bib/Films/Amélie (2001).mkv',
];

describe('définition d’une page', () => {
  it('les sept pages prêtes à l’emploi respectent le schéma', () => {
    assert.deepEqual(
      BUILTIN_PAGES.map((p) => p.id),
      ['movies', 'series', 'music', 'images', 'streaming', 'tv', 'games'],
    );
    for (const p of BUILTIN_PAGES) assert.deepEqual(validatePage(p), { ok: true, page: p });
  });

  it('rend les champs qui ne conviennent pas', () => {
    const r = validatePage({
      id: 'Mauvais id',
      name: '',
      require: ['video', 3],
      where: [
        { info: 'year', between: [1990, '1999'] },
        { info: 'year', equals: 1990 },
      ],
      groupBy: ['Pas une info'],
      sort: [{ by: 'year', order: 'haut' }],
      display: 'cartes',
      menu: { pinned: 'oui' },
      inconnu: 1,
    });
    assert.deepEqual(r.ok ? [] : r.errors.sort(), ['display', 'groupBy.0', 'id', 'inconnu', 'menu', 'name', 'require.1', 'sort.0.order', 'where.0'].sort());
  });

  it('retire les tags en double', () => {
    const r = validatePage({ id: 'a', name: { key: 'pages.series' }, require: ['video', 'video'] });
    assert.ok(r.ok);
    assert.deepEqual(r.page.require, ['video']);
  });
});

describe('calcul d’une page', () => {
  it('Séries → Friends → Saison 1 → épisodes dans l’ordre', () => {
    const { catalog, pages } = setup();
    catalog.setSource(
      LIB,
      SHOWS.map((p) => file(p)),
    );
    const top = pages.page('series');
    assert.equal(top?.kind === 'groups' && top.info, 'series');
    assert.deepEqual(groups(top), [
      ['Friends', 4],
      ['Lost', 1],
    ]);
    assert.deepEqual(groups(pages.page('series', ['Friends'])), [
      [1, 3],
      [2, 1],
    ]);
    assert.deepEqual(names(pages.page('series', ['Friends', 1])), ['Friends S01E01', 'Friends S01E02', 'Friends S01E03']);
    const ep = pages.page('series', ['Friends', 1]);
    assert.equal(ep?.kind === 'elements' && ep.elements[0].infos.episode, 1);
  });

  it('Jeux groupés par console', () => {
    const { catalog, pages } = setup();
    const rom = (p: string): ElementInput => ({
      key: romKey('snes', p, 'linux'),
      name: path.basename(p, path.extname(p)),
      open: { kind: 'game', console: 'snes', path: p },
      tags: ['game'],
      infos: {},
      images: {},
    });
    catalog.setSource(GAMES, [rom('/roms/Zelda.sfc'), rom('/roms/Mario.sfc'), rom('/roms/Metroid.gba')]);
    catalog.setSource({ plugin: 'jeux-pc', instance: '/jeux' }, [
      {
        key: pcGameKey('/jeux/Celeste/Celeste.exe', 'linux'),
        name: 'Celeste',
        open: { kind: 'program', path: '/jeux/Celeste/Celeste.exe' },
        tags: ['game'],
        infos: { system: 'pc' },
        images: {},
      },
    ]);
    // Le tag automatique « Consoles » pose le nom du système ; un jeu PC garde celui de sa source.
    const snes = 'Nintendo - Super Nintendo Entertainment System';
    assert.deepEqual(groups(pages.page('games')), [
      ['Nintendo - Game Boy Advance', 1],
      [snes, 2],
      ['pc', 1],
    ]);
    assert.deepEqual(names(pages.page('games', [snes])), ['Mario', 'Zelda']);
  });

  it('require, exclude et conditions sur les infos', () => {
    const { catalog, pages } = setup();
    // Des sites (pas des fichiers) : les tags automatiques n'y touchent pas, les infos sont celles de la source.
    const site = (name: string, tags: string[], infos: ElementInput['infos']): ElementInput => ({
      key: `web:${name}`,
      name,
      open: { kind: 'site', url: `https://${name}.test/` },
      tags,
      infos,
      images: {},
    });
    catalog.setSource(LIB, [
      site('a', ['video'], { year: 1994, genres: ['Drame', 'Comédie'], title: 'Le Grand Bleu' }),
      site('b', ['video'], { year: 1999, genres: ['Action'], title: 'Matrix' }),
      site('c', ['video'], { year: 2001, title: 'Amélie' }),
      site('d', ['audio'], { year: 1995 }),
      site('e', ['video', 'vu'], { year: 'vers 1990' }),
    ]);
    const run = (def: Partial<PageDefinition>) => {
      assert.ok(pages.save({ id: 'essai', name: 'Essai', require: [], ...def }).ok);
      return names(pages.page('essai')).sort();
    };
    assert.deepEqual(run({ require: ['video'] }), ['a', 'b', 'c', 'e']);
    assert.deepEqual(run({ require: ['video'], exclude: ['vu'] }), ['a', 'b', 'c']);
    assert.deepEqual(run({ exclude: ['video'] }), ['d']);
    assert.deepEqual(run({ require: ['video'], where: [{ info: 'year', between: [1990, 1999] }] }), ['a', 'b']);
    assert.deepEqual(run({ where: [{ info: 'year', between: [1990, 1999] }] }), ['a', 'b', 'd']);
    assert.deepEqual(run({ where: [{ info: 'year', equals: 2001 }] }), ['c']);
    assert.deepEqual(run({ where: [{ info: 'genres', equals: 'drame' }] }), ['a']);
    assert.deepEqual(run({ where: [{ info: 'title', contains: 'GRAND' }] }), ['a']);
    assert.deepEqual(run({ where: [{ info: 'genres', contains: 'com' }] }), ['a']);
    assert.deepEqual(run({ where: [{ info: 'year', between: ['vers', 'z'] }] }), ['e']);
    assert.deepEqual(
      run({
        require: ['video'],
        where: [
          { info: 'year', between: [1990, 1999] },
          { info: 'genres', equals: 'Action' },
        ],
      }),
      ['b'],
    );
  });

  it('« Autres » pour les éléments sans l’info, en dernier ; une liste range l’élément dans chacun de ses groupes', () => {
    const { catalog, pages, t } = setup();
    catalog.setSource(LIB, [
      file('/bib/a.mkv', { genres: ['Drame', 'Comédie'] }),
      file('/bib/b.mkv', { genres: ['Action'] }),
      file('/bib/c.mkv'),
      file('/bib/d.mkv', { genres: [] }),
    ]);
    assert.ok(pages.save({ id: 'genres', name: 'Genres', require: ['video'], groupBy: ['genres'] }).ok);
    const top = pages.page('genres');
    assert.deepEqual(groups(top), [
      ['Action', 1],
      ['Comédie', 1],
      ['Drame', 1],
      [null, 2],
    ]);
    assert.equal(top?.kind === 'groups' && top.groups[3].name, t('pages.others'));
    assert.equal(t('pages.others'), 'Autres');
    assert.deepEqual(names(pages.page('genres', [null])), ['c', 'd']);
    assert.deepEqual(names(pages.page('genres', ['Drame'])), ['a']);
  });

  it('tri : critère après critère, valeurs absentes en dernier, ordre inverse, puis par nom', () => {
    const { catalog, pages } = setup();
    catalog.setSource(LIB, [
      file('/bib/z.mkv', { year: 2000 }),
      file('/bib/a.mkv', { year: 2010 }),
      file('/bib/m.mkv'),
      file('/bib/b.mkv', { year: 2000 }),
      file('/bib/Film 10.mkv'),
      file('/bib/Film 9.mkv'),
    ]);
    assert.ok(pages.save({ id: 'tri', name: 'Tri', require: ['video'], sort: [{ by: 'year', order: 'desc' }] }).ok);
    assert.deepEqual(names(pages.page('tri')), ['a', 'b', 'z', 'Film 9', 'Film 10', 'm']);
  });

  it('résultats par tranches (curseur)', () => {
    const { catalog, pages } = setup();
    const n = PAGE_SIZE * 2 + 50;
    catalog.setSource(
      LIB,
      Array.from({ length: n }, (_, i) => file(`/bib/v${String(i).padStart(3, '0')}.mkv`)),
    );
    assert.ok(pages.save({ id: 'tout', name: 'Tout', require: ['video'] }).ok);
    const seen: string[] = [];
    let cursor: string | null = null;
    let calls = 0;
    do {
      const lvl = pages.page('tout', [], cursor);
      assert.equal(lvl?.total, n);
      seen.push(...names(lvl));
      cursor = lvl!.next;
      calls++;
    } while (cursor);
    assert.equal(calls, 3);
    assert.equal(seen.length, n);
    assert.equal(new Set(seen).size, n);
    assert.equal(seen[PAGE_SIZE], 'v100');
  });

  it('page inconnue ou chemin qui ne convient pas : null', () => {
    const { pages } = setup();
    assert.equal(pages.page('inconnue'), null);
    assert.equal(pages.page('series', ['a', 1, 2]), null);
    assert.equal(pages.page('series', [{}]), null);
    assert.equal(pages.page('series', 'Friends'), null);
    assert.deepEqual(pages.page('series', [], 'pas un curseur')?.total, 0);
  });

  it('Télévision : chaînes triées par numéro (info `channel` de la source)', () => {
    const { catalog, pages } = setup();
    const svc = { id: 'freebox', quality: 'hd' } as Parameters<typeof channelElement>[0];
    const ch = (number: number | null, name: string) =>
      channelElement(svc, { number, name, logo: '', group: '', variants: [{ q: 'hd', label: 'HD', url: `http://box/${name}` }] } as Parameters<
        typeof channelElement
      >[1]);
    assert.deepEqual(ch(2, 'France 2').infos, { channel: 2 });
    assert.deepEqual(ch(null, 'Sans numéro').infos, {});
    catalog.setSource({ plugin: 'tv-m3u', instance: 'freebox' }, [ch(10, 'TMC'), ch(2, 'France 2'), ch(null, 'Sans numéro'), ch(1, 'TF1')]);
    assert.deepEqual(names(pages.page('tv')), ['TF1', 'France 2', 'TMC', 'Sans numéro']);
  });

  it('tag:<id> (explorateur) : les éléments du tag par nom, sans regroupement, à jour après un changement', () => {
    const { catalog, engine, pages } = setup();
    catalog.setSource(LIB, [file('/bib/Zorro.mkv'), file('/bib/Amélie.mkv'), file('/bib/chanson.mp3')]);
    assert.deepEqual(names(pages.page('tag:video')), ['Amélie', 'Zorro']);
    assert.equal(pages.page('tag:video', ['x']), null);
    assert.deepEqual(names(pages.page('tag:inconnu')), []);
    assert.equal(pages.page('tag:'), null);
    // Jamais listée, et un changement du moteur l'efface du cache.
    assert.ok(!pages.list().some((p) => p.id.startsWith('tag:')));
    engine.setTags(localFileKey('/bib/Zorro.mkv', 'linux'), { video: false });
    assert.deepEqual(names(pages.page('tag:video')), ['Amélie']);
  });
});

describe('pages.json', () => {
  it('modifier, supprimer et rétablir une page prête à l’emploi ; créer une page ; relire', () => {
    const { file: f, engine, catalog, pages, t } = setup();
    assert.deepEqual(
      pages.list().map((p) => p.id),
      ['movies', 'series', 'music', 'images', 'streaming', 'tv', 'games'],
    );
    assert.equal(fs.existsSync(f), false);
    const series = pages.get('series')!;
    assert.ok(pages.save({ ...series, groupBy: ['series'] }).ok);
    assert.ok(pages.save({ id: 'annees-90', name: 'Films des années 90', require: ['movie'], where: [{ info: 'year', between: [1990, 1999] }] }).ok);
    assert.equal(pages.remove('games'), true);
    assert.equal(pages.remove('games'), false);
    assert.equal(pages.remove('inconnue'), false);
    const r = pages.save({ id: 'x', name: 'X' });
    assert.deepEqual(r, { ok: false, errors: ['require'] });

    const again = createPages({ builtin: BUILTIN_PAGES, file: f, engine, catalog, translate: t, onIgnored: () => {} });
    again.load();
    assert.deepEqual(
      again.list().map((p) => p.id),
      ['movies', 'series', 'music', 'images', 'streaming', 'tv', 'annees-90'],
    );
    assert.deepEqual(again.get('series')!.groupBy, ['series']);
    assert.equal(again.get('games'), null);
    assert.ok(again.save(BUILTIN_PAGES.find((p) => p.id === 'games')!).ok);
    assert.equal(again.get('games')!.id, 'games');
    assert.equal(again.remove('series'), true);
    assert.equal(again.get('series'), null);
    const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.deepEqual(Object.keys(saved.pages).sort(), ['annees-90', 'games']);
    assert.deepEqual(saved.removed, ['series']);
  });

  it('fichier illisible ou page mal formée : écartés', () => {
    const { file: f, engine, catalog, t } = setup();
    const ignored: string[] = [];
    fs.writeFileSync(
      f,
      JSON.stringify({ version: 1, pages: { bonne: { id: 'bonne', name: 'B', require: [] }, mauvaise: { id: 'mauvaise' } }, removed: ['tv', 'inconnue'] }),
    );
    const pages = createPages({ builtin: BUILTIN_PAGES, file: f, engine, catalog, translate: t, onIgnored: (_f, reason) => ignored.push(reason) });
    pages.load();
    assert.ok(pages.get('bonne'));
    assert.equal(pages.get('mauvaise'), null);
    assert.equal(pages.get('tv'), null);
    assert.deepEqual(ignored, ['page mauvaise']);
    fs.writeFileSync(f, '{ pas du json');
    pages.load();
    assert.equal(pages.list().length, 7);
  });
});

describe('changements', () => {
  it('annonce les pages touchées et met leur contenu à jour, sans calcul avant la première demande', () => {
    const { catalog, engine, pages } = setup();
    catalog.setSource(
      LIB,
      SHOWS.map((p) => file(p)),
    );
    const events: string[][] = [];
    pages.onChange((ids) => events.push(ids));
    assert.deepEqual(names(pages.page('series', ['Friends', 1])), ['Friends S01E01', 'Friends S01E02', 'Friends S01E03']);

    catalog.setSource(
      LIB,
      [...SHOWS, '/bib/Friends/Saison 1/Friends S01E04.mkv'].map((p) => file(p)),
    );
    assert.deepEqual(events, [['series']]);
    assert.deepEqual(names(pages.page('series', ['Friends', 1])).at(-1), 'Friends S01E04');

    // Un tag retiré à la main fait sortir l'élément de la page.
    engine.setTags(localFileKey('/bib/Friends/Saison 1/Friends S01E04.mkv', 'linux'), { series: false });
    assert.deepEqual(events.at(-1), ['series']);
    assert.equal(names(pages.page('series', ['Friends', 1])).length, 3);

    // Retiré du catalogue.
    catalog.setSource(
      LIB,
      SHOWS.filter((p) => !p.includes('Lost')).map((p) => file(p)),
    );
    assert.deepEqual(events.at(-1), ['series']);
    assert.deepEqual(groups(pages.page('series')), [['Friends', 4]]);

    // Un film n'est pas un épisode : seule la page Films est touchée.
    catalog.setSource(
      LIB,
      [...SHOWS.filter((p) => !p.includes('Lost')), '/bib/Films/Matrix (1999).mkv'].map((p) => file(p)),
    );
    assert.deepEqual(events.at(-1), ['movies']);

    // Définition modifiée.
    pages.save({ ...pages.get('series')!, groupBy: ['series'] });
    assert.deepEqual(events.at(-1), ['series']);
    assert.equal(pages.page('series', ['Friends'])?.kind, 'elements');
  });
});

describe('IPC', () => {
  it('pages.* et catalog.page passent au service des pages', () => {
    const { catalog, engine, pages } = setup();
    catalog.setSource(
      LIB,
      SHOWS.map((p) => file(p)),
    );
    const h = catalogHandlers({ tags: engine, pages } as unknown as MainContext);
    assert.equal(h.pagesList().length, 7);
    assert.equal(h.pagesGet('series')!.id, 'series');
    assert.equal(h.pagesSave({ id: 'a', name: 'A', require: ['video'] }).ok, true);
    assert.equal(h.pagesRemove('a'), true);
    assert.deepEqual(groups(h.catalogPage('series', [], null)), [
      ['Friends', 4],
      ['Lost', 1],
    ]);
  });
});

describe('administration des pages (P4-21)', () => {
  const FILMS = ['/bib/Films/Le Grand Bleu (1988).mkv', '/bib/Films/Matrix (1999).mkv', '/bib/Films/Pulp Fiction (1994).mkv', '/bib/Films/Amélie (2001).mkv'];
  const NINETIES = { id: 'films-des-annees-90', name: 'Films des années 90', require: ['video', 'movie'], where: [{ info: 'year', between: [1990, 1999] }] };

  it('aperçu : nombre d’éléments d’une définition, sans l’enregistrer', () => {
    const { catalog, pages } = setup();
    catalog.setSource(
      LIB,
      FILMS.map((p) => file(p)),
    );
    assert.deepEqual(pages.preview(NINETIES), { ok: true, count: 2 });
    assert.equal(pages.get(NINETIES.id), null);
    assert.deepEqual(pages.preview({ ...NINETIES, where: [{ info: 'year', between: [1990, 2010] }] }), { ok: true, count: 3 });
    const bad = pages.preview({ ...NINETIES, where: [{ info: 'year', entre: 1990 }] });
    assert.equal(bad.ok, false);
  });

  it('origine et nombre d’éléments de chaque page', () => {
    const { catalog, pages } = setup();
    catalog.setSource(
      LIB,
      FILMS.map((p) => file(p)),
    );
    assert.ok(pages.save(NINETIES).ok);
    assert.ok(pages.save({ ...pages.get('music')!, display: 'rows' }).ok);
    const byId = new Map(pages.overview().map((o) => [o.page.id, o]));
    assert.equal(byId.get('movies')?.origin, 'builtin');
    assert.equal(byId.get('movies')?.count, 4);
    assert.equal(byId.get('music')?.origin, 'modified');
    assert.deepEqual([byId.get(NINETIES.id)?.origin, byId.get(NINETIES.id)?.count], ['user', 2]);
  });

  it('retour à la page prête à l’emploi d’origine, modifiée ou supprimée', () => {
    const { file: f, pages, engine, catalog, t } = setup();
    const events: string[][] = [];
    pages.onChange((ids) => events.push(ids));
    pages.save({ ...pages.get('movies')!, name: 'Mes films', groupBy: [] });
    assert.deepEqual(pages.reset('movies'), BUILTIN_PAGES[0]);
    assert.deepEqual(pages.get('movies'), BUILTIN_PAGES[0]);
    assert.deepEqual(events.at(-1), ['movies']);
    pages.remove('games');
    assert.equal(pages.get('games'), null);
    assert.equal(pages.reset('games')?.id, 'games');
    assert.equal(pages.get('games')?.id, 'games');
    // Gardé dans pages.json : une autre instance relit la même chose.
    const again = createPages({ builtin: BUILTIN_PAGES, file: f, engine, catalog, translate: t, onIgnored: () => {} });
    again.load();
    assert.equal(again.overview().find((o) => o.page.id === 'movies')?.origin, 'builtin');
    assert.equal(again.get('games')?.id, 'games');
    // Une page créée par l'utilisateur n'a pas d'origine à retrouver.
    pages.save(NINETIES);
    assert.equal(pages.reset(NINETIES.id), null);
    assert.equal(pages.reset(42), null);
  });

  it('tailles permises : tags, conditions, tris et textes', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    assert.equal(validatePage({ id: 'a', name: 'A', require: many(32) }).ok, true);
    assert.deepEqual(validatePage({ id: 'a', name: 'A', require: many(33) }), { ok: false, errors: ['require'] });
    assert.deepEqual(validatePage({ id: 'a', name: 'A', require: [], exclude: many(33) }), { ok: false, errors: ['exclude'] });
    const where = Array.from({ length: 17 }, () => ({ info: 'year', equals: 1 }));
    assert.deepEqual(validatePage({ id: 'a', name: 'A', require: [], where }), { ok: false, errors: ['where'] });
    const sort = Array.from({ length: 9 }, () => ({ by: 'year' }));
    assert.deepEqual(validatePage({ id: 'a', name: 'A', require: [], sort }), { ok: false, errors: ['sort'] });
    assert.deepEqual(validatePage({ id: 'a', name: 'A', require: [], where: [{ info: 'title', contains: 'x'.repeat(201) }] }), {
      ok: false,
      errors: ['where.0'],
    });
  });

  it('IPC : pagesOverview, pagesPreview et pagesReset vérifient leurs arguments', () => {
    const { catalog, engine, pages } = setup();
    catalog.setSource(
      LIB,
      FILMS.map((p) => file(p)),
    );
    const h = catalogHandlers({ tags: engine, pages } as unknown as MainContext);
    assert.equal(h.pagesOverview().length, 7);
    assert.deepEqual(h.pagesPreview(NINETIES as PageDefinition), { ok: true, count: 2 });
    assert.equal(h.pagesPreview(null as unknown as PageDefinition).ok, false);
    assert.equal(h.pagesPreview({ ...NINETIES, id: '../x' } as PageDefinition).ok, false);
    assert.equal(h.pagesReset('movies')?.id, 'movies');
    assert.equal(h.pagesReset({} as unknown as string), null);
    assert.equal(h.pagesReset('inconnue'), null);
  });
});
