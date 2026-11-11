// Recherche déplacée de src/renderer/app.js vers src/renderer/domain/search.ts (P1-23).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterQ, localResults, matcher } from '../../../src/renderer/domain/search.ts';
import type { Infos, Item } from '../../../src/renderer/domain/types.ts';

const none: Infos = { scrape: {}, meta: {} };
const byName = (it: { name: string }) => it.name;

describe('domain/search : matcher et filterQ', () => {
  const items = [{ name: 'Le Château Ambulant' }, { name: 'Chateau de sable' }, { name: 'Ambulance' }];

  it('tous les mots, dans n’importe quel ordre, casse et accents ignorés', () => {
    assert.deepEqual(filterQ(items, 'CHÂTEAU', byName).map(byName), ['Le Château Ambulant', 'Chateau de sable']);
    assert.deepEqual(filterQ(items, 'ambul chateau', byName).map(byName), ['Le Château Ambulant']);
    assert.deepEqual(filterQ(items, '  ambul   ', byName).map(byName), ['Le Château Ambulant', 'Ambulance']);
    assert.deepEqual(filterQ(items, 'zzz', byName), []);
  });

  it('sans recherche : la liste elle-même', () => {
    assert.equal(filterQ(items, '', byName), items);
    assert.equal(filterQ(items, null, byName), items);
  });

  it('recherche faite d’espaces : tout correspond (copie de la liste)', () => {
    const out = filterQ(items, '   ', byName);
    assert.deepEqual(out, items);
    assert.notEqual(out, items);
  });

  it('matcher teste un texte', () => {
    const m = matcher('été 2');
    assert.equal(m('Vacances ETE 2024'), true);
    assert.equal(m('Vacances 2024'), false);
    assert.equal(matcher('')('n’importe quoi'), true);
  });
});

describe('domain/search : localResults', () => {
  const many = (n: number, make: (i: number) => Item) => Array.from({ length: n }, (_, i) => make(i));

  it('cherche dans chaque catégorie avec ses propres champs', () => {
    const infos: Infos = { scrape: { 'v:/v/1.mkv': { title: 'Titre officiel' } }, meta: {} };
    const r = localResults(
      'officiel',
      {
        videos: [
          { kind: 'video', name: '1', path: '/v/1.mkv', folder: 'Films', dir: '/v' },
          { kind: 'video', name: '2', path: '/v/2.mkv', folder: 'Films', dir: '/v' },
        ],
        tracks: [{ kind: 'audio', name: 'officiel', folder: 'A', dir: '/a' }],
        images: [{ kind: 'image', name: 'x', folder: 'Officiel' }],
        channels: [{ number: 1, name: 'Chaîne officielle' }],
        games: [{ name: 'g', sTitle: '', sGenre: 'Officiel' }],
        roms: [{ name: 'r', displayName: 'Rom', emuName: 'Console officielle', path: '/r' }],
      },
      infos,
    );
    assert.deepEqual(
      r.videos.map((v) => v.name),
      ['1'],
    );
    assert.equal(r.videos[0].sTitle, 'Titre officiel', 'les vidéos reçoivent leurs infos');
    assert.equal(r.tracks.length, 1);
    assert.equal(r.images.length, 1);
    assert.equal(r.channels.length, 1);
    assert.equal(r.games.length, 1);
    assert.deepEqual(
      r.roms.map((x) => [x.kind, x.displayName]),
      [['rom', 'Rom']],
    );
  });

  it('le dossier et le numéro de chaîne comptent ; les genres des morceaux non', () => {
    const r = localResults(
      'saison 12',
      {
        videos: [{ kind: 'video', name: 'e1', path: '/s/Saison 1/e1', folder: 'Saison 1', dir: '/Série/Saison 1' }],
        tracks: [{ kind: 'audio', name: 't', folder: 'Saison 12', dir: '/m/Saison 12', sGenre: 'saison' }],
        images: [],
        channels: [{ number: 12, name: 'Saison' }],
        games: [],
        roms: [],
      },
      none,
    );
    assert.equal(r.videos.length, 0);
    assert.equal(r.tracks.length, 1);
    assert.equal(r.channels.length, 1);
  });

  it('limite chaque catégorie et tolère l’absence de chaînes', () => {
    const r = localResults(
      'a',
      {
        videos: many(30, (i) => ({ kind: 'video', name: `a${i}`, path: `/a${i}` })),
        tracks: many(30, (i) => ({ kind: 'audio', name: `a${i}`, dir: '/d' })),
        images: many(30, (i) => ({ kind: 'image', name: `a${i}`, folder: 'f' })),
        channels: null,
        games: many(30, (i) => ({ name: `a${i}` })),
        roms: many(30, (i) => ({ name: `a${i}`, displayName: `a${i}`, emuName: 'E', path: `/r${i}` })),
      },
      none,
    );
    assert.deepEqual([r.videos.length, r.tracks.length, r.images.length, r.channels.length, r.games.length, r.roms.length], [24, 12, 24, 0, 12, 24]);
  });
});
