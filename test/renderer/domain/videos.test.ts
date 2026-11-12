// Séries, sources et tris des vidéos, déplacés de src/renderer/app.js vers src/renderer/domain/videos.ts (P1-23).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bySource,
  episodesOfSeason,
  episodesOfSeries,
  seasonsOf,
  seriesKeyOf,
  sortVideos,
  sourceOf,
  sourcesOf,
  videoCards,
} from '../../../src/renderer/domain/videos.ts';

const names = (list: { name?: string }[]) => list.map((x) => x.name);

describe('domain/videos : séries', () => {
  it('seriesKeyOf replie le titre de série, null pour une vidéo seule', () => {
    assert.equal(seriesKeyOf({ sSeries: 'Été Brûlant' }), 'ete brulant');
    assert.equal(seriesKeyOf({ seriesTitle: 'Déduite' }), 'deduite');
    assert.equal(seriesKeyOf({ sSeries: 'A', seriesTitle: 'B' }), 'a');
    assert.equal(seriesKeyOf({ name: 'film' }), null);
    assert.equal(seriesKeyOf({ sSeries: '' }), null);
  });

  it('videoCards réunit les épisodes à la place du premier et les compte', () => {
    const items = [
      { name: 'film1' },
      { name: 's1e1', sSeries: 'Série' },
      { name: 'film2' },
      { name: 's1e2', seriesTitle: 'série' },
      { name: 'autre', sSeries: 'Autre' },
    ];
    const cards = videoCards(items);
    assert.deepEqual(cards, [
      { series: false, item: items[0] },
      { series: true, key: 'serie', item: items[1], count: 2 },
      { series: false, item: items[2] },
      { series: true, key: 'autre', item: items[4], count: 1 },
    ]);
    assert.deepEqual(videoCards([]), []);
  });

  it('episodesOfSeries garde l’ordre de la liste', () => {
    const vids = [{ name: 'b', sSeries: 'S' }, { name: 'x' }, { name: 'a', sSeries: 's' }];
    assert.deepEqual(names(episodesOfSeries(vids, 's')), ['b', 'a']);
    assert.deepEqual(episodesOfSeries(vids, 'inconnue'), []);
  });

  it('seasonsOf trie les saisons ; 0 pour les épisodes sans saison', () => {
    assert.deepEqual(seasonsOf([{ season: 2 }, { season: 10 }, {}, { season: 2 }, { season: null }]), [0, 2, 10]);
    assert.deepEqual(seasonsOf([]), []);
  });

  it('episodesOfSeason trie par numéro ; sans saison choisie, les épisodes sans saison', () => {
    const eps = [
      { name: 'e3', season: 1, episode: 3 },
      { name: 'x', season: 2, episode: 1 },
      { name: 'e1', season: 1, episode: 1 },
      { name: 'bonus', season: 1 },
      { name: 'libre' },
    ];
    assert.deepEqual(names(episodesOfSeason(eps, 1)), ['bonus', 'e1', 'e3']);
    assert.deepEqual(names(episodesOfSeason(eps, 0)), ['libre']);
    assert.deepEqual(names(episodesOfSeason(eps, null)), ['libre']);
    assert.deepEqual(names(episodesOfSeason(eps, undefined)), ['libre']);
  });
});

describe('domain/videos : sources', () => {
  it('sourceOf reconnaît streaming, en ligne, jeux PC, serveur et dossiers', () => {
    assert.equal(sourceOf({ bookmark: 'x' }), 'Streaming');
    assert.equal(sourceOf({ downloadBookmark: true, remote: true }), 'Streaming');
    assert.equal(sourceOf({ remote: true, dir: 'https://a.b/' }), 'En ligne');
    assert.equal(sourceOf({ auto: true }), 'Jeux PC');
    assert.equal(sourceOf({ manualIndex: 0 }), 'Jeux PC');
    assert.equal(sourceOf({ kind: 'game' }), 'Jeux PC');
    assert.equal(sourceOf({ dir: 'https://www.serveur.fr/films/' }), 'serveur.fr');
    assert.equal(sourceOf({ dir: 'HTTP://nas.local:8080/x' }), 'nas.local');
    assert.equal(sourceOf({ dir: 'https://[mauvaise' }), 'En ligne');
    assert.equal(sourceOf({ dir: '/home/films' }), 'Dossiers');
    assert.equal(sourceOf({ path: 'https://a.fr/v.mkv' }), 'Dossiers', 'sans dossier : « Dossiers »');
    assert.equal(sourceOf({}), 'Dossiers');
  });

  it('sourcesOf liste les sources dans l’ordre d’apparition, sans doublon', () => {
    assert.deepEqual(sourcesOf([{ dir: '/a' }, { bookmark: 1 }, { dir: '/b' }, { dir: 'https://s.fr/' }]), ['Dossiers', 'Streaming', 's.fr']);
    assert.deepEqual(sourcesOf([]), []);
  });

  it('bySource filtre, ou rend la liste telle quelle sans source', () => {
    const items = [
      { name: 'a', dir: '/a' },
      { name: 'b', bookmark: 1 },
    ];
    assert.deepEqual(names(bySource(items, 'Streaming')), ['b']);
    assert.equal(bySource(items, ''), items);
    assert.equal(bySource(items, null), items);
    assert.deepEqual(bySource(items, 'Inconnue'), []);
  });
});

describe('domain/videos : sortVideos', () => {
  const items = [
    { name: 'b', sYear: '1999', dir: '/x' },
    { name: 'Épisode 10', sYear: '2010', bookmark: 1 },
    { name: 'a', sYear: '', dir: '/x' },
    { name: 'épisode 9', sYear: 'inconnue', dir: '/x' },
  ];

  it('par titre par défaut (accents ignorés, nombres dans l’ordre)', () => {
    assert.deepEqual(names(sortVideos(items, 'title')), ['a', 'b', 'épisode 9', 'Épisode 10']);
    assert.deepEqual(names(sortVideos(items, '')), names(sortVideos(items, 'title')));
    assert.deepEqual(names(sortVideos(items, null)), names(sortVideos(items, 'title')));
  });

  it('par année, récentes d’abord ; sans année valable en dernier, dans l’ordre d’origine', () => {
    assert.deepEqual(names(sortVideos(items, 'year')), ['Épisode 10', 'b', 'a', 'épisode 9']);
  });

  it('par source puis par titre', () => {
    assert.deepEqual(names(sortVideos(items, 'source')), ['a', 'b', 'épisode 9', 'Épisode 10']);
  });

  it('tri inconnu : ordre d’origine ; la liste d’origine n’est jamais modifiée', () => {
    const before = names(items);
    const out = sortVideos(items, 'autre');
    assert.deepEqual(names(out), before);
    assert.notEqual(out, items);
    sortVideos(items, 'title');
    assert.deepEqual(names(items), before);
  });
});
