// Titres de morceaux et groupes de dossier, déplacés de src/renderer/domain/items.ts vers @mire/shared (P2-05).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTrack, folderLabel, folderText, splitAlbumFolder, trackNumber } from '@mire/shared';

describe('cleanTrack', () => {
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

describe('folderLabel et folderText', () => {
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

describe('trackNumber et splitAlbumFolder', () => {
  it('numéro de piste en tête du nom', () => {
    assert.equal(trackNumber('01 - One More Time'), 1);
    assert.equal(trackNumber('3. Titre'), 3);
    assert.equal(trackNumber('1-05 - Face B'), 5);
    assert.equal(trackNumber('07_Morceau'), 7);
    assert.equal(trackNumber('12 Chanson'), 12);
    assert.equal(trackNumber('Around the World'), null);
    assert.equal(trackNumber('1999'), null);
  });

  it('dossier « Artiste - Album »', () => {
    assert.deepEqual(splitAlbumFolder('Daft Punk - Discovery'), { artist: 'Daft Punk', album: 'Discovery' });
    assert.equal(splitAlbumFolder('Discovery'), null);
    assert.equal(splitAlbumFolder(undefined), null);
  });
});
