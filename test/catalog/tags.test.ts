// Moteur de tags et d'infos (P2-04) : tags selon le type de fichier et règles modifiables, priorités des origines,
// retraits à la main qui survivent aux analyses, tags de l'utilisateur, index, IPC.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CatalogSettings, ElementSourceRef } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { localFileKey } from '../../src/main/catalog/keys.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createTagEngine, type Contributor } from '../../src/main/catalog/tags/engine.ts';
import { defaultFileTagRules, extensionOf, fileTagRules, normalizeCatalogSettings } from '../../src/main/catalog/tags/file-rules.ts';
import { mergeLayers } from '../../src/main/catalog/tags/merge.ts';
import { coerceInfo, createRegistry, userTagId } from '../../src/main/catalog/tags/registry.ts';
import { createTargetFinder } from '../../src/main/catalog/targets.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import { builtinTranslator } from '../../src/main/i18n/current.ts';
import { normalizeConfig } from '../../src/main/config/normalize/index.ts';
import { CONFIG_VERSION } from '../../src/main/config/defaults.ts';
import { catalogHandlers } from '../../src/main/ipc/handlers/catalog.ts';
import type { MainContext } from '../../src/main/ipc/context.ts';

const FILMS: ElementSourceRef = { plugin: 'src-local', instance: '/films' };
const TV: ElementSourceRef = { plugin: 'src-m3u', instance: 'http://box/liste.m3u' };

function file(p: string, extra: Partial<ElementInput> = {}): ElementInput {
  return {
    key: localFileKey(p, 'linux'),
    name: path.basename(p),
    open: { kind: 'file', path: p },
    tags: ['local'],
    infos: { folder: 'films' },
    images: {},
    ...extra,
  };
}

function setup({ dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-tags-')), language = 'fr' } = {}) {
  const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
  catalog.load();
  const overrides = createOverrides({ file: path.join(dir, 'overrides.json'), platform: 'linux', find: createTargetFinder(catalog) });
  overrides.load();
  const settings: { catalog?: CatalogSettings } = {};
  const registry = createRegistry(builtinTranslator(language).t);
  const engine = createTagEngine({ catalog, overrides, registry, rules: () => fileTagRules(settings.catalog) });
  return { dir, catalog, overrides, engine, settings };
}

const amelie = localFileKey('/films/Amélie.mkv', 'linux');

describe('tags selon le type de fichier', () => {
  it('vidéo, musique, image d’après les formats reconnus ; l’extension devient une info', () => {
    const { catalog, engine } = setup();
    catalog.setSource(FILMS, [file('/films/Amélie.mkv'), file('/films/b.MP3'), file('/films/c.jpg'), file('/films/d.txt'), file('/films/sans')]);
    assert.deepEqual(engine.element(amelie)!.tags.sort(), ['local', 'video']);
    assert.deepEqual(engine.element(amelie)!.infos, { extension: 'mkv', folder: 'films' });
    assert.deepEqual(engine.element(localFileKey('/films/b.MP3', 'linux'))!.tags.sort(), ['audio', 'local']);
    assert.deepEqual(engine.element(localFileKey('/films/c.jpg', 'linux'))!.tags.sort(), ['image', 'local']);
    assert.deepEqual(engine.element(localFileKey('/films/d.txt', 'linux'))!.tags, ['local']);
    assert.deepEqual(engine.element(localFileKey('/films/sans', 'linux'))!.infos, { folder: 'films' });
  });

  it('entrée M3U : extension de l’adresse, sinon type de média déclaré par la source', () => {
    const { catalog, engine } = setup();
    const entry = (url: string, mediaType?: string): ElementInput => ({
      key: `m3u:${TV.instance}|${url}`,
      name: url,
      open: { kind: 'stream', url },
      tags: ['remote'],
      infos: mediaType ? { mediaType } : {},
      images: {},
    });
    catalog.setSource(TV, [
      entry('http://box/a.mp3?x=1'),
      entry('http://box/stream?id=2', 'audio'),
      entry('http://box/live.php', 'video'),
      entry('http://box/x'),
    ]);
    const tags = (url: string) => engine.element(`m3u:${TV.instance}|${url}`)!.tags.sort();
    assert.deepEqual(tags('http://box/a.mp3?x=1'), ['audio', 'remote']);
    assert.deepEqual(tags('http://box/stream?id=2'), ['audio', 'remote']);
    assert.deepEqual(tags('http://box/live.php'), ['remote', 'video']);
    assert.deepEqual(tags('http://box/x'), ['remote']);
  });

  it('règles modifiées dans la configuration : seules les extensions changées, sans changer la version', () => {
    const { catalog, engine, settings } = setup();
    catalog.setSource(FILMS, [file('/films/Amélie.mkv'), file('/films/clip.ts'), file('/films/note.nfo')]);
    settings.catalog = normalizeCatalogSettings({ fileTags: { MKV: [], '.ts': ['Audio'], nfo: ['Fiche Kodi'], 'x/y': ['video'] } });
    assert.deepEqual(settings.catalog, { fileTags: { '.mkv': [], '.ts': ['audio'], '.nfo': ['fiche-kodi'] } });
    engine.refreshRules();
    assert.deepEqual(engine.element(amelie)!.tags, ['local']);
    assert.deepEqual(engine.element(localFileKey('/films/clip.ts', 'linux'))!.tags.sort(), ['audio', 'local']);
    assert.deepEqual(engine.element(localFileKey('/films/note.nfo', 'linux'))!.tags.sort(), ['fiche-kodi', 'local']);
    assert.deepEqual(engine.query(['video']), []);
    // La configuration garde la section telle quelle ; absente, elle n'est pas ajoutée.
    const withRules = normalizeConfig({ version: 8, catalog: { fileTags: { '.TS': ['audio'] } } });
    assert.deepEqual(withRules.catalog, { fileTags: { '.ts': ['audio'] } });
    assert.equal(withRules.version, CONFIG_VERSION);
    assert.equal('catalog' in normalizeConfig({ version: 8 }), false);
  });

  it('règles par défaut : une par extension reconnue', () => {
    const rules = defaultFileTagRules();
    assert.deepEqual(rules.get('.mkv'), ['video']);
    assert.deepEqual(rules.get('.flac'), ['audio']);
    assert.deepEqual(rules.get('.heic'), ['image']);
    assert.equal(extensionOf('https://nas/a%20b.MKV?x=1#y'), '.mkv');
    assert.equal(extensionOf('C:\\Films\\a.b\\film'), '');
  });
});

describe('priorités des origines', () => {
  it('infos : à la main, puis infos en ligne (ordre des fournisseurs), puis tags automatiques, puis source, puis fichier', () => {
    const merged = mergeLayers(
      [
        { origin: 'metadata', infos: { title: 'TMDB', year: 2001 } },
        { origin: 'metadata', infos: { title: 'Autre fournisseur', genres: ['Comédie'], year: 1999 } },
        { origin: 'source', infos: { title: 'Source', folder: 'films', extension: 'source' } },
        { origin: 'tagger', infos: { title: 'Tag automatique', series: 'Amélie' } },
        { origin: 'file', infos: { extension: 'mkv', title: 'Fichier' } },
      ],
      { infos: { year: 2002 } },
    );
    assert.deepEqual(merged.infos, { extension: 'source', title: 'TMDB', folder: 'films', series: 'Amélie', genres: ['Comédie'], year: 2002 });
  });

  it('tags : réunion des origines automatiques ; un retrait à la main l’emporte, un ajout s’ajoute', () => {
    const merged = mergeLayers(
      [
        { origin: 'file', tags: ['video'] },
        { origin: 'source', tags: ['local'] },
        { origin: 'tagger', tags: ['series', 'movie'] },
      ],
      { tags: { movie: false, favori: true, absent: false } },
    );
    assert.deepEqual(merged.tags.sort(), ['favori', 'local', 'series', 'video']);
  });

  it('images : à la main, puis infos en ligne, puis source', () => {
    const merged = mergeLayers(
      [
        { origin: 'source', images: { poster: '/src.jpg', background: '/fanart.jpg' } },
        { origin: 'metadata', images: { poster: '/tmdb.jpg' } },
      ],
      { images: { background: '/moi.jpg' } },
    );
    assert.deepEqual(merged.images, { poster: '/tmdb.jpg', background: '/moi.jpg' });
  });

  it('dans le moteur : contributions automatiques, puis modifications à la main', () => {
    const { catalog, engine } = setup();
    catalog.setSource(FILMS, [file('/films/Amélie.mkv', { infos: { folder: 'films', title: 'Source' } })]);
    const tagger: Contributor = { id: 't', origin: 'tagger', compute: () => ({ tags: ['movie'], infos: { title: 'Tag', year: 2001 } }) };
    const tmdb: Contributor = { id: 'm1', origin: 'metadata', compute: () => ({ infos: { title: 'Le Fabuleux Destin' } }) };
    const other: Contributor = { id: 'm2', origin: 'metadata', compute: () => ({ infos: { title: 'Autre', overview: 'Résumé' } }) };
    engine.setContributors([tagger, tmdb, other]);
    assert.deepEqual(engine.element(amelie)!.infos, { extension: 'mkv', folder: 'films', title: 'Le Fabuleux Destin', year: 2001, overview: 'Résumé' });
    assert.deepEqual(engine.element(amelie)!.tags.sort(), ['local', 'movie', 'video']);
    engine.setInfos(amelie, { title: 'Amélie' });
    assert.equal(engine.element(amelie)!.infos.title, 'Amélie');
    engine.setInfos(amelie, { title: null });
    assert.equal(engine.element(amelie)!.infos.title, 'Le Fabuleux Destin');
  });
});

describe('modifications à la main', () => {
  it('un retrait à la main l’emporte sur l’automatique et survit aux analyses et au redémarrage', () => {
    const { dir, catalog, engine } = setup();
    catalog.setSource(FILMS, [file('/films/Amélie.mkv')]);
    engine.setTags(amelie, { video: false, local: false });
    assert.deepEqual(engine.element(amelie)!.tags, []);
    // Nouvelle analyse, élément changé : le retrait tient.
    catalog.setSource(FILMS, [file('/films/Amélie.mkv', { name: 'Amélie (2001)' })]);
    assert.deepEqual(engine.element(amelie)!.tags, []);
    assert.deepEqual(engine.query(['video']), []);
    // L'élément disparaît puis revient : le retrait tient toujours.
    catalog.setSource(FILMS, []);
    assert.equal(engine.element(amelie), null);
    catalog.setSource(FILMS, [file('/films/Amélie.mkv')]);
    assert.deepEqual(engine.element(amelie)!.tags, []);
    // Redémarrage : relu depuis overrides.json.
    const again = setup({ dir });
    assert.deepEqual(again.engine.element(amelie)!.tags, []);
    // Retour à l'automatique.
    again.engine.setTags(amelie, { video: null });
    assert.deepEqual(again.engine.element(amelie)!.tags, ['video']);
  });

  it('un tag inconnu ajouté devient un tag de l’utilisateur (identifiant : nom simplifié)', () => {
    const { dir, catalog, engine } = setup();
    catalog.setSource(FILMS, [file('/films/Amélie.mkv')]);
    const e = engine.setTags(amelie, { ' Vus en 2024 ': true, Video: true });
    assert.deepEqual(e!.tags.sort(), ['local', 'video', 'vus-en-2024']);
    const again = setup({ dir });
    const user = again.engine.tagsList().find((t) => t.id === 'vus-en-2024');
    assert.deepEqual(user, { id: 'vus-en-2024', name: 'Vus en 2024', origin: 'user', count: 1 });
    assert.equal(userTagId('Été 2024 !'), 'ete-2024');
  });

  it('infos : valeur ramenée au type de l’info, identifiant ou valeur invalide ignorés', () => {
    const { catalog, engine } = setup();
    catalog.setSource(FILMS, [file('/films/Amélie.mkv')]);
    const e = engine.setInfos(amelie, { year: '2001', genres: 'Comédie, Romance', title: '  Amélie ', 'mauvais id': 'x', overview: 12, rating: 4.5 });
    assert.deepEqual(e!.infos, { extension: 'mkv', folder: 'films', year: 2001, genres: ['Comédie', 'Romance'], title: 'Amélie', rating: 4.5 });
    assert.equal(coerceInfo('number', 'deux mille'), undefined);
    assert.equal(coerceInfo('boolean', 'oui'), undefined);
    assert.deepEqual(coerceInfo(undefined, ['a']), ['a']);
  });

  it('élément pas encore analysé : la modification est gardée ; clé invalide refusée', () => {
    const { catalog, engine, overrides } = setup();
    assert.equal(engine.setTags(amelie, { favori: true }), null);
    assert.deepEqual(overrides.get(amelie)?.tags, { favori: true });
    catalog.setSource(FILMS, [file('/films/Amélie.mkv')]);
    assert.ok(engine.element(amelie)!.tags.includes('favori'));
    assert.equal(engine.setTags('inconnu:x', { a: true }), null);
    assert.equal(engine.setTags(amelie, null), null);
    assert.equal(overrides.get('inconnu:x'), undefined);
  });
});

describe('index', () => {
  it('tag → clés et info → valeur → clés, à jour après chaque analyse et chaque modification', () => {
    const { catalog, engine } = setup();
    catalog.setSource(FILMS, [file('/films/Amélie.mkv'), file('/films/b.mp3'), file('/films/c.mkv')]);
    const c = localFileKey('/films/c.mkv', 'linux');
    assert.deepEqual(engine.query(['video', 'local']).sort(), [amelie, c].sort());
    assert.deepEqual(engine.query(['video'], ['favori']).sort(), [amelie, c].sort());
    engine.setTags(c, { favori: true });
    assert.deepEqual(engine.query(['video'], ['favori']), [amelie]);
    assert.deepEqual(engine.query(['favori', 'video']), [c]);
    assert.deepEqual(engine.query([]), []);
    engine.setInfos(amelie, { genres: ['Comédie', 'Romance'] });
    engine.setInfos(c, { genres: 'Romance' });
    assert.deepEqual(engine.withInfo('genres', 'Romance').sort(), [amelie, c].sort());
    assert.deepEqual(
      engine.infoValues('extension').sort((a, b) => String(a.value).localeCompare(String(b.value))),
      [
        { value: 'mkv', count: 2 },
        { value: 'mp3', count: 1 },
      ],
    );
    catalog.removeSource(FILMS);
    assert.deepEqual(engine.query(['video']), []);
    assert.deepEqual(engine.withInfo('genres', 'Romance'), []);
    assert.deepEqual(engine.infoValues('extension'), []);
  });

  it('tags.list : tags du cœur avec leur nom, puis de l’utilisateur, puis ceux posés sans être déclarés', () => {
    const { catalog, engine } = setup({ language: 'en' });
    catalog.setSource(FILMS, [file('/films/Amélie.mkv')]);
    engine.setContributors([{ id: 't', origin: 'tagger', compute: () => ({ tags: ['anime'] }) }]);
    engine.setTags(amelie, { 'Mes favoris': true });
    const list = engine.tagsList();
    assert.deepEqual(list.slice(0, 3), [
      { id: 'video', name: 'Video', origin: 'core', count: 1 },
      { id: 'audio', name: 'Music', origin: 'core', count: 0 },
      { id: 'image', name: 'Image', origin: 'core', count: 0 },
    ]);
    assert.deepEqual(list.slice(-2), [
      { id: 'mes-favoris', name: 'Mes favoris', origin: 'user', count: 1 },
      { id: 'anime', name: 'anime', origin: 'other', count: 1 },
    ]);
    // Tags automatiques internes (P2-05) : déclarés, avec leur nom.
    assert.deepEqual(
      list.find((t) => t.id === 'series'),
      { id: 'series', name: 'TV shows', origin: 'core', count: 0 },
    );
    assert.equal(setup().engine.tagsList()[0].name, 'Vidéo');
  });

  it('IPC : catalogElement rend l’élément effectif ; catalogSetTags, catalogSetInfos, tagsList', () => {
    const { catalog, engine } = setup();
    catalog.setSource(FILMS, [file('/films/Amélie.mkv')]);
    const h = catalogHandlers({ catalog, tags: engine } as unknown as MainContext);
    assert.deepEqual(h.catalogElement(amelie)!.tags.sort(), ['local', 'video']);
    assert.equal(h.catalogElement('local:/inconnu'), null);
    assert.deepEqual(h.catalogSetTags(amelie, { local: false })!.tags, ['video']);
    assert.equal(h.catalogSetInfos(amelie, { year: 2001 })!.infos.year, 2001);
    assert.equal(h.tagsList().find((t) => t.id === 'local')!.count, 0);
  });
});
