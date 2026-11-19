// Infos en ligne dans le catalogue (P2-06) : reprise de l'ancien scrape/db.json sans perte, fiches gardées sous leur
// ancienne clé quand elles ne correspondent à aucun élément, fiches devenues infos d'origine `metadata`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElementSourceRef } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { localFileKey } from '../../src/main/catalog/keys.ts';
import { createMetadataStore, metadataContributors, metadataOrder, recordParts } from '../../src/main/catalog/metadata.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules, normalizeCatalogSettings } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { createTargetFinder } from '../../src/main/catalog/targets.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import { createScrapeEngine } from '../../src/main/scrape/engine.ts';
import type { MetadataProvider, ScrapeRecord } from '../../src/main/scrape/types.ts';

const FILMS: ElementSourceRef = { plugin: 'src-local', instance: '/films' };
const HTTP: ElementSourceRef = { plugin: 'src-http', instance: 'https://nas/films' };

const local = (p: string): ElementInput => ({
  key: localFileKey(p, 'linux'),
  name: path.basename(p),
  open: { kind: 'file', path: p },
  tags: [],
  infos: {},
  images: {},
});
const remote = (url: string): ElementInput => ({ key: `remote:${url}`, name: url, open: { kind: 'file', path: url }, tags: [], infos: {}, images: {} });

const rec = (r: Partial<ScrapeRecord>): ScrapeRecord => ({ title: '', image: null, source: 'TMDB', rev: 2, at: 1, ...r });

// Fiches telles que le moteur de récupération les écrit dans db.json.
const DB = {
  items: {
    'v:/films/Amélie.mkv': rec({
      title: 'Le Fabuleux Destin d’Amélie Poulain',
      year: '2001',
      genre: 'Comédie, Romance',
      overview: 'Paris.',
      image: '/s/img/a.jpg',
      backdrop: '/s/img/b.jpg',
    }),
    'v:https://nas/films/b.mkv': rec({ title: 'Sur le NAS', image: null }),
    'v:https://nas/films/pas-encore.mkv': rec({ title: 'Pas encore analysé' }),
    'a:/musique/Discovery': rec({ title: 'Discovery', artist: 'Daft Punk', year: '2001', source: 'MusicBrainz', image: '/s/img/c.jpg' }),
    'r:/roms/snes/zelda.sfc': rec({ title: 'Zelda', source: 'libretro', image: '/s/img/z.png' }),
    'g:celeste': rec({ title: 'Celeste', source: 'Steam', genre: 'Plateforme' }),
    'b:abc123': rec({ title: 'Jeu en attente', source: 'libretro' }),
  },
  misses: { 'v:/films/inconnu.mkv': 1000, 'g:introuvable': 2000 },
};

function setup(db: unknown = DB, prepare?: (catalog: ReturnType<typeof createCatalog>) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-metadata-'));
  const legacyFile = path.join(dir, 'scrape', 'db.json');
  if (db) {
    fs.mkdirSync(path.dirname(legacyFile));
    fs.writeFileSync(legacyFile, JSON.stringify(db));
  }
  const catalog = createCatalog({ dir: path.join(dir, 'catalog', 'sources'), debounceMs: 0, onIgnored: () => {} });
  prepare?.(catalog);
  const find = createTargetFinder(catalog);
  const overrides = createOverrides({ file: path.join(dir, 'catalog', 'overrides.json'), platform: 'linux', find, onIgnored: () => {} });
  overrides.load();
  const file = path.join(dir, 'catalog', 'metadata.json');
  const metadata = createMetadataStore({ file, legacyFile, platform: 'linux', find, onIgnored: () => {} });
  const report = metadata.load();
  const order = { list: metadataOrder(undefined) };
  const engine = createTagEngine({
    catalog,
    overrides,
    registry: createRegistry((k) => k),
    rules: () => fileTagRules(undefined),
    contributors: metadataContributors(metadata, order.list),
  });
  metadata.onChange((keys) => engine.refresh(keys));
  catalog.onChange(({ added }) => {
    if (added.length) metadata.adopt(added.map((k) => catalog.get(k)!));
  });
  return { dir, file, legacyFile, catalog, overrides, metadata, report, engine };
}

const amelie = localFileKey('/films/Amélie.mkv', 'linux');

describe('reprise de scrape/db.json', () => {
  it('sans perte : le moteur de récupération retrouve toutes les fiches et tous les échecs, sous les mêmes clés', () => {
    const { metadata, legacyFile } = setup();
    assert.deepEqual(metadata.scrapeStore.all(), DB.items);
    for (const [key, at] of Object.entries(DB.misses)) assert.equal(metadata.scrapeStore.missedAt(key), at);
    // L'ancien fichier est laissé en place, intact.
    assert.deepEqual(JSON.parse(fs.readFileSync(legacyFile, 'utf8')), DB);
  });

  it('chaque fiche rejoint la clé de son élément ; album, jeu PC et adresse inconnue restent sous leur ancienne clé', async () => {
    const { report, file, metadata } = setup(DB, (catalog) => catalog.setSource(HTTP, [remote('https://nas/films/b.mkv')]));
    assert.equal(report!.matched, 3);
    assert.deepEqual(report!.unmatched.sort(), ['a:/musique/Discovery', 'g:celeste', 'r:/roms/snes/zelda.sfc', 'v:https://nas/films/pas-encore.mkv']);
    await metadata.flush();
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(saved.elements).sort(), ['gamebm:abc123', amelie, 'remote:https://nas/films/b.mkv'].sort());
    assert.deepEqual(Object.keys(saved.elements[amelie]), ['v:/films/Amélie.mkv']);
    assert.deepEqual(saved.misses, DB.misses);
  });

  it('relu au démarrage suivant à l’identique, sans reprendre db.json une seconde fois', async () => {
    const first = setup();
    await first.metadata.flush();
    fs.writeFileSync(first.legacyFile, JSON.stringify({ items: { 'v:/autre.mkv': rec({ title: 'Autre' }) }, misses: {} }));
    const again = createMetadataStore({ file: first.file, legacyFile: first.legacyFile, platform: 'linux', onIgnored: () => {} });
    assert.equal(again.load(), null);
    assert.deepEqual(again.scrapeStore.all(), DB.items);
  });

  it('une fiche gardée sous une adresse rejoint son élément quand une analyse l’apporte', () => {
    const { catalog, metadata, engine } = setup();
    assert.ok(metadata.unmatched().includes('v:https://nas/films/pas-encore.mkv'));
    catalog.setSource(HTTP, [remote('https://nas/films/pas-encore.mkv')]);
    assert.ok(!metadata.unmatched().includes('v:https://nas/films/pas-encore.mkv'));
    assert.equal(engine.element('remote:https://nas/films/pas-encore.mkv')!.infos.title, 'Pas encore analysé');
    // Le moteur de récupération la retrouve toujours sous sa clé.
    assert.equal(metadata.scrapeStore.get('v:https://nas/films/pas-encore.mkv')!.title, 'Pas encore analysé');
  });

  it('db.json absent ou illisible : base vide', () => {
    assert.deepEqual(setup(null).metadata.scrapeStore.all(), {});
    assert.deepEqual(setup('pas un objet').metadata.scrapeStore.all(), {});
  });
});

describe('fiche → infos et images d’origine metadata', () => {
  it('titre, année, genres, résumé, artiste ; affiche et fond', () => {
    assert.deepEqual(recordParts(DB.items['v:/films/Amélie.mkv']), {
      infos: { title: 'Le Fabuleux Destin d’Amélie Poulain', year: 2001, genres: ['Comédie', 'Romance'], overview: 'Paris.' },
      images: { poster: '/s/img/a.jpg', background: '/s/img/b.jpg' },
    });
    assert.deepEqual(recordParts(DB.items['a:/musique/Discovery']).infos, { title: 'Discovery', artist: 'Daft Punk', year: 2001 });
    // Champs vides : rien n'est posé.
    assert.deepEqual(recordParts(rec({ title: 'X', year: '', genre: '' })), { infos: { title: 'X' }, images: {} });
  });

  it('une fiche TMDB factice récupérée par le moteur se retrouve dans les infos de l’élément, sous la valeur saisie à la main', async () => {
    const { catalog, metadata, engine, dir } = setup(null);
    catalog.setSource(FILMS, [local('/films/Matrix.mkv')]);
    const key = localFileKey('/films/Matrix.mkv', 'linux');
    const tmdb: MetadataProvider = {
      id: 'tmdb',
      kinds: ['video'],
      group: 'videos',
      concurrency: 1,
      key: (item) => `v:${item.path}`,
      collect: () => [],
      scrape: async () => ({ title: 'Matrix', year: '1999', genre: 'Science-Fiction', overview: 'Neo.', image: '/s/img/m.jpg', source: 'TMDB' }),
      candidates: async () => [],
      byId: async () => undefined,
    };
    const scraper = createScrapeEngine({
      dataDir: dir,
      getConfig: () => ({}) as never,
      listRoms: async () => null,
      onProgress: () => {},
      providers: [tmdb],
      store: metadata.scrapeStore,
    });
    assert.deepEqual(await scraper.one({ kind: 'video', item: { path: '/films/Matrix.mkv' } }), { ok: true });
    const e = engine.element(key)!;
    assert.equal(e.infos.title, 'Matrix');
    assert.equal(e.infos.year, 1999);
    assert.deepEqual(e.infos.genres, ['Science-Fiction']);
    assert.equal(e.images.poster, '/s/img/m.jpg');
    // L'interface historique lit toujours la fiche sous son ancienne clé.
    assert.equal(scraper.data()['v:/films/Matrix.mkv'].title, 'Matrix');
    // La valeur saisie à la main l'emporte ; les autres infos en ligne restent.
    engine.setInfos(key, { title: 'Matrix (version longue)' });
    assert.equal(engine.element(key)!.infos.title, 'Matrix (version longue)');
    assert.equal(engine.element(key)!.infos.overview, 'Neo.');
    // Retour à l'automatique : l'info en ligne revient ; fiche oubliée : elle disparaît.
    engine.setInfos(key, { title: null });
    assert.equal(engine.element(key)!.infos.title, 'Matrix');
    scraper.forget('v:/films/Matrix.mkv');
    assert.equal(engine.element(key)!.infos.title, undefined);
    // db.json n'est pas écrit.
    await scraper.flush();
    assert.ok(!fs.existsSync(path.join(dir, 'scrape', 'db.json')));
  });

  it('les infos en ligne l’emportent sur la source ; « Tout effacer » les retire', () => {
    const { catalog, metadata, engine } = setup();
    catalog.setSource(FILMS, [{ ...local('/films/Amélie.mkv'), infos: { title: 'amelie' } }]);
    assert.equal(engine.element(amelie)!.infos.title, 'Le Fabuleux Destin d’Amélie Poulain');
    metadata.scrapeStore.clear();
    assert.equal(engine.element(amelie)!.infos.title, 'amelie');
  });
});

describe('ordre des fournisseurs', () => {
  it('ceux de la configuration d’abord, puis les autres ; un fournisseur inconnu est ignoré', () => {
    assert.deepEqual(metadataOrder(undefined), ['tmdb', 'musicbrainz', 'libretro', 'steam']);
    assert.deepEqual(metadataOrder({ metadataProviders: ['steam', 'inconnu', 'libretro'] }), ['steam', 'libretro', 'tmdb', 'musicbrainz']);
    assert.deepEqual(normalizeCatalogSettings({ metadataProviders: [' Steam ', 'steam', 3, ''] }), { metadataProviders: ['steam'] });
    assert.deepEqual(normalizeCatalogSettings({ metadataProviders: 'steam' }), { metadataProviders: [] });
    // Section absente : rien n'est ajouté.
    assert.deepEqual(normalizeCatalogSettings({}), {});
  });

  it('fournisseurs des plugins actifs (P4-20) : après ceux du cœur, sauf ordre choisi ; ignorés une fois le plugin désactivé', () => {
    const known = ['tmdb', 'musicbrainz', 'libretro', 'steam', 'org.films/infos'];
    assert.deepEqual(metadataOrder(undefined, known), known);
    assert.deepEqual(metadataOrder({ metadataProviders: ['org.films/infos', 'tmdb'] }, known), ['org.films/infos', 'tmdb', 'musicbrainz', 'libretro', 'steam']);
    assert.deepEqual(metadataOrder({ metadataProviders: ['org.films/infos', 'tmdb'] }), ['tmdb', 'musicbrainz', 'libretro', 'steam']);
    assert.deepEqual(normalizeCatalogSettings({ metadataProviders: ['Org.Films/Infos'] }), { metadataProviders: ['org.films/infos'] });
  });

  it('pour une même info, le premier fournisseur de la liste l’emporte', () => {
    const { catalog, metadata, engine } = setup(null);
    catalog.setSource(FILMS, [local('/films/Jeu.mkv')]);
    const key = localFileKey('/films/Jeu.mkv', 'linux');
    // Deux fiches pour un même élément (deux écritures du même fichier), de deux fournisseurs.
    metadata.scrapeStore.set('v:/films/Jeu.mkv', rec({ title: 'Par TMDB', overview: 'TMDB seul.' }));
    metadata.scrapeStore.set('b:x', rec({ title: 'Par Steam', source: 'Steam' }));
    const store = { forElement: (k: string) => (k === key ? new Map([...metadata.forElement(key)!, ...metadata.forElement('gamebm:x')!]) : undefined) };
    engine.setContributors(metadataContributors(store, metadataOrder({ metadataProviders: ['steam'] })));
    assert.equal(engine.element(key)!.infos.title, 'Par Steam');
    assert.equal(engine.element(key)!.infos.overview, 'TMDB seul.');
    engine.setContributors(metadataContributors(store, metadataOrder(undefined)));
    assert.equal(engine.element(key)!.infos.title, 'Par TMDB');
  });
});
