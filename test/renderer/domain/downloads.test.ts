// Ligne de détail des téléchargements, déplacée de src/renderer/app.js vers src/renderer/domain/downloads.ts (P1-23).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DL_ACTIVE, DL_STATE, dlMeta } from '../../../src/renderer/domain/downloads.ts';

const MB = 1024 * 1024;

describe('domain/downloads : dlMeta', () => {
  it('en cours : progression, débit, temps restant, destination', () => {
    assert.equal(
      dlMeta({ state: 'downloading', total: 3 * MB, received: 1.5 * MB, speed: 200 * 1024, eta: 120000, dir: '/dl' }),
      'En cours · 1,5 Mo sur 3 Mo · 200 Ko/s · reste 2 min · vers Téléchargements',
    );
  });

  it('terminé : taille totale seule, vers une console, extras', () => {
    assert.equal(
      dlMeta({ state: 'done', total: 2 * MB, received: 2 * MB, speed: 5, eta: 5, consoleName: 'Game Boy', group: 'Pack', companions: 2, extracted: true }),
      'Terminé · 2 Mo · vers Game Boy · fait partie de « Pack » · 2 fichiers du jeu ajoutés · archive décompressée',
    );
    assert.equal(dlMeta({ state: 'done', companions: 1 }), 'Terminé · 1 fichier du jeu ajouté');
  });

  it('taille inconnue : quantité reçue seule, rien si rien n’est reçu', () => {
    assert.equal(dlMeta({ state: 'paused', received: 1024 }), 'En pause · 1 Ko');
    assert.equal(dlMeta({ state: 'waiting' }), 'En attente');
    assert.equal(dlMeta({ state: 'paused', total: MB }), 'En pause · 0 o sur 1 Mo');
  });

  it('torrent actif : nombre de pairs (même zéro) ; inactif : pas de pairs', () => {
    assert.equal(dlMeta({ state: 'waiting', kind: 'torrent' }), 'En attente · 0 pair');
    assert.equal(dlMeta({ state: 'extracting', kind: 'torrent', peers: 3 }), 'Décompression · 3 pairs');
    assert.equal(dlMeta({ state: 'paused', kind: 'torrent', peers: 3 }), 'En pause');
  });

  it('débit et temps restant seulement pendant le téléchargement', () => {
    assert.equal(dlMeta({ state: 'paused', speed: 1024, eta: 60000 }), 'En pause');
    assert.equal(dlMeta({ state: 'downloading', eta: 10000 }), 'En cours · reste moins d’une minute');
  });

  it('état inconnu affiché tel quel, état absent ignoré', () => {
    assert.equal(dlMeta({ state: 'bizarre' }), 'bizarre');
    assert.equal(dlMeta({}), '');
  });

  it('états actifs et libellés', () => {
    assert.deepEqual([...DL_ACTIVE], ['waiting', 'downloading', 'extracting']);
    assert.equal(DL_STATE.external, 'Confié au logiciel de torrent');
    assert.equal(Object.keys(DL_STATE).length, 10);
  });
});
