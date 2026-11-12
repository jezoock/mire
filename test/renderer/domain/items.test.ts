// Logique des éléments déplacée de src/renderer/app.js vers src/renderer/domain/items.ts (P1-23).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTrack, folderLabel, folderText, genresOf, labelOf, metaKey, scrapeKey, withScrape } from '../../../src/renderer/domain/items.ts';
import type { Infos } from '../../../src/renderer/domain/types.ts';

const none: Infos = { scrape: {}, meta: {} };

describe('domain/items : cleanTrack', () => {
  it('retire le numéro de piste', () => {
    assert.equal(cleanTrack('01 - One More Time'), 'One More Time');
    assert.equal(cleanTrack('3. Titre'), 'Titre');
    assert.equal(cleanTrack('1-05 - Face B'), 'Face B');
    assert.equal(cleanTrack('07_Morceau'), 'Morceau');
    assert.equal(cleanTrack('12 Chanson'), 'Chanson');
  });

  it('garde le nom quand il n’y a pas de numéro, ou quand il ne resterait rien', () => {
    assert.equal(cleanTrack('Around the World'), 'Around the World');
    assert.equal(cleanTrack('1999'), '1999');
    assert.equal(cleanTrack('01 - '), '01 - ');
    assert.equal(cleanTrack(''), '');
  });
});

describe('domain/items : labelOf', () => {
  it('préfère le titre saisi ou récupéré, puis le nom lisible, puis le nom', () => {
    assert.equal(labelOf({ sTitle: 'Titre', displayName: 'Affiché', name: 'nom' }), 'Titre');
    assert.equal(labelOf({ displayName: 'Affiché', name: 'nom' }), 'Affiché');
    assert.equal(labelOf({ kind: 'video', name: '01 - nom' }), '01 - nom');
  });

  it('nettoie le nom d’un morceau', () => {
    assert.equal(labelOf({ kind: 'audio', name: '02 - Digital Love' }), 'Digital Love');
  });
});

describe('domain/items : scrapeKey et metaKey', () => {
  it('donne la clé selon le type', () => {
    assert.equal(scrapeKey({ kind: 'video', path: '/v/a.mkv' }), 'v:/v/a.mkv');
    assert.equal(scrapeKey({ kind: 'audio', dir: '/m/album', path: '/m/album/1.mp3' }), 'a:/m/album');
    assert.equal(scrapeKey({ kind: 'rom', path: '/r/x.sfc' }), 'r:/r/x.sfc');
    assert.equal(scrapeKey({ kind: 'game', name: 'Été Éternel' }), 'g:ete eternel');
    assert.equal(scrapeKey({ kind: 'gamebm', bookmarkId: 'b1' }), 'b:b1');
    assert.equal(scrapeKey({ kind: 'image', path: '/i/p.jpg' }), 'i:/i/p.jpg');
  });

  it('chaîne vide pour un type sans infos', () => {
    assert.equal(scrapeKey({ kind: 'channel' }), '');
    assert.equal(scrapeKey({}), '');
  });

  it('metaKey distingue le morceau et l’album, sinon reprend scrapeKey', () => {
    const t = { kind: 'audio', path: '/m/a/1.mp3', dir: '/m/a' };
    assert.equal(metaKey(t, 'track'), 't:/m/a/1.mp3');
    assert.equal(metaKey(t, 'album'), 'a:/m/a');
    assert.equal(metaKey(t), 'a:/m/a');
    assert.equal(metaKey({ kind: 'video', path: '/v.mkv' }), 'v:/v.mkv');
    assert.equal(metaKey({ kind: 'rom', path: '/r.gb' }, 'rom'), 'r:/r.gb');
  });
});

describe('domain/items : withScrape', () => {
  it('sans infos : champs vides, élément d’origine intact', () => {
    const v = { kind: 'video', path: '/v.mkv', name: 'v' };
    const out = withScrape(v, none);
    assert.deepEqual(out, { ...v, sYear: '', sGenre: '', sOverview: '', sArtist: '', sImage: null, uImage: null, sBackdrop: null });
    assert.notEqual(out, v);
    assert.deepEqual(v, { kind: 'video', path: '/v.mkv', name: 'v' });
  });

  it('les infos saisies passent avant celles récupérées en ligne', () => {
    const v = { kind: 'video', path: '/v.mkv', name: 'v', fanart: '/fan.jpg' };
    const infos: Infos = {
      scrape: { 'v:/v.mkv': { title: 'En ligne', year: '1999', genre: 'Drame', overview: 'r1', image: '/sc.jpg', backdrop: '/scb.jpg' } },
      meta: { 'v:/v.mkv': { title: 'Saisi', year: '2001', image: '/um.jpg' } },
    };
    const out = withScrape(v, infos);
    assert.equal(out.sTitle, 'Saisi');
    assert.equal(out.sYear, '2001');
    assert.equal(out.sGenre, 'Drame');
    assert.equal(out.sOverview, 'r1');
    assert.equal(out.sImage, '/sc.jpg');
    assert.equal(out.uImage, '/um.jpg');
    assert.equal(out.sBackdrop, '/fan.jpg', 'le fond du dossier passe avant celui récupéré');
  });

  it('épisode de série : le titre récupéré est celui de la série, pas de l’épisode', () => {
    const v = { kind: 'video', path: '/s/e1.mkv', name: 'e1' };
    const out = withScrape(v, { scrape: { 'v:/s/e1.mkv': { series: true, title: 'Ma série' } }, meta: {} });
    assert.equal(out.sTitle, undefined);
    assert.equal(out.sSeries, 'Ma série');
    const deduced = withScrape({ ...v, seriesTitle: 'Déduite' }, none);
    assert.equal(deduced.sSeries, 'Déduite');
  });

  it('jeux : titre récupéré ; morceau : ses propres infos passent avant celles de l’album', () => {
    assert.equal(withScrape({ kind: 'game', name: 'x' }, { scrape: { 'g:x': { title: 'X' } }, meta: {} }).sTitle, 'X');
    assert.equal(withScrape({ kind: 'gamebm', bookmarkId: 'b', name: 'y' }, { scrape: { 'b:b': { title: 'Y' } }, meta: {} }).sTitle, 'Y');
    assert.equal(withScrape({ kind: 'rom', path: '/r', name: 'r' }, { scrape: { 'r:/r': { title: 'R' } }, meta: {} }).sTitle, undefined);
    const t = { kind: 'audio', path: '/a/1.mp3', dir: '/a', name: '1' };
    const infos: Infos = {
      scrape: { 'a:/a': { genre: 'Pop', artist: 'Groupe' } },
      meta: { 'a:/a': { title: 'Album', genre: 'Rock' }, 't:/a/1.mp3': { title: 'Morceau', genre: 'Jazz' } },
    };
    const out = withScrape(t, infos);
    assert.equal(out.sTitle, 'Morceau', 'le titre de l’album ne s’applique pas au morceau');
    assert.equal(out.sGenre, 'Jazz');
    assert.equal(out.sArtist, 'Groupe');
    assert.equal(withScrape(t, { scrape: {}, meta: { 'a:/a': { title: 'Album' } } }).sTitle, undefined);
  });

  it('mémoïsé : même résultat tant que l’élément et ses fiches ne changent pas', () => {
    const v = { kind: 'video', path: '/m.mkv', name: 'm' };
    const sc = { title: 'Film' };
    const infos: Infos = { scrape: { 'v:/m.mkv': sc }, meta: {} };
    const a = withScrape(v, infos);
    assert.equal(withScrape(v, infos), a, 'pas de nouveau calcul');
    // Nouvel objet d'infos, mêmes fiches (S.scrape relu sans changement pour cet élément) : toujours le même résultat.
    assert.equal(withScrape(v, { scrape: { 'v:/m.mkv': sc, autre: {} }, meta: {} }), a);
  });

  it('mémoïsé : recalculé dès qu’une fiche change ou disparaît', () => {
    const t = { kind: 'audio', path: '/a/1.mp3', dir: '/a', name: '1' };
    const scrape = { 'a:/a': { genre: 'Pop' } };
    const a = withScrape(t, { scrape, meta: {} });
    const b = withScrape(t, { scrape: { 'a:/a': { genre: 'Rock' } }, meta: {} });
    assert.notEqual(b, a);
    assert.equal(b.sGenre, 'Rock');
    const c = withScrape(t, { scrape: { 'a:/a': { genre: 'Rock' } }, meta: { 'a:/a': { genre: 'Funk' } } });
    assert.equal(c.sGenre, 'Funk');
    const d = withScrape(t, { scrape: { 'a:/a': { genre: 'Rock' } }, meta: { 't:/a/1.mp3': { genre: 'Soul' } } });
    assert.equal(d.sGenre, 'Soul', 'la fiche du morceau compte aussi');
    assert.equal(withScrape(t, none).sGenre, '');
  });

  it('mémoïsé : un autre élément identique est calculé à part', () => {
    const infos: Infos = { scrape: {}, meta: {} };
    const a = withScrape({ kind: 'video', path: '/x' }, infos);
    const b = withScrape({ kind: 'video', path: '/x' }, infos);
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
  });
});

describe('domain/items : genresOf', () => {
  it('sépare et nettoie les genres', () => {
    assert.deepEqual(genresOf({ sGenre: 'Action, Aventure ,,  Drame ' }), ['Action', 'Aventure', 'Drame']);
  });

  it('liste vide sans genre', () => {
    assert.deepEqual(genresOf({}), []);
    assert.deepEqual(genresOf({ sGenre: '' }), []);
    assert.deepEqual(genresOf({ sGenre: ' , ' }), []);
  });
});

describe('domain/items : folderLabel et folderText', () => {
  it('un dossier générique prend le nom du dossier parent', () => {
    const it1 = { folder: 'Saison 1', dir: '/series/Ma Série/Saison 1' };
    assert.deepEqual(folderLabel(it1), { title: 'Ma Série', sub: 'Saison 1' });
    assert.equal(folderText(it1), 'Ma Série, Saison 1');
    assert.deepEqual(folderLabel({ folder: 'CD 2', dir: 'C:\\Musique\\Album\\CD 2' }), { title: 'Album', sub: 'CD 2' });
  });

  it('un dossier parlant est gardé tel quel', () => {
    const it1 = { folder: 'Vacances', dir: '/photos/Vacances' };
    assert.deepEqual(folderLabel(it1), { title: 'Vacances', sub: '' });
    assert.equal(folderText(it1), 'Vacances');
  });

  it('dossier générique à la racine : pas de parent, le dossier seul', () => {
    assert.deepEqual(folderLabel({ folder: 'Season 2', dir: '/Season 2' }), { title: 'Season 2', sub: '' });
    assert.deepEqual(folderLabel({ folder: 'Disc 1' }), { title: 'Disc 1', sub: '' });
    assert.deepEqual(folderLabel({}), { title: undefined, sub: '' });
  });
});
