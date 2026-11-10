// Utilitaires d'adresses de @mire/shared.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hostOf, siteOf, safeDecode, isHttpUrl, isUrlTarget } from '@mire/shared';

describe('hostOf', () => {
  it('nom d’hôte en minuscules', () => {
    assert.equal(hostOf('https://WWW.Exemple.FR/page?x=1'), 'www.exemple.fr');
    assert.equal(hostOf('http://192.168.1.10:8080/films/'), '192.168.1.10');
  });

  it('adresse invalide → texte vide', () => {
    assert.equal(hostOf('pas une adresse'), '');
    assert.equal(hostOf(''), '');
  });
});

describe('siteOf', () => {
  it('deux derniers niveaux du nom d’hôte', () => {
    assert.equal(siteOf('https://www.netflix.com/browse'), 'netflix.com');
    assert.equal(siteOf('https://assets.nflxext.com/x.js'), 'nflxext.com');
    assert.equal(siteOf('http://localhost:3000/'), 'localhost');
  });

  it('adresse invalide → texte vide', () => {
    assert.equal(siteOf('/chemin/local'), '');
  });
});

it('safeDecode : décode, ou rend le texte tel quel s’il est mal encodé', () => {
  assert.equal(safeDecode('Le%20Film%20%C3%A9t%C3%A9.mkv'), 'Le Film été.mkv');
  assert.equal(safeDecode('100%.mkv'), '100%.mkv');
  assert.equal(safeDecode('%E9t%E9'), '%E9t%E9');
});

it('isHttpUrl', () => {
  assert.equal(isHttpUrl('https://exemple.fr'), true);
  assert.equal(isHttpUrl('HTTP://exemple.fr/films/'), true);
  assert.equal(isHttpUrl('ftp://exemple.fr'), false);
  assert.equal(isHttpUrl('https:exemple.fr'), false);
  assert.equal(isHttpUrl('C:\\Films'), false);
  assert.equal(isHttpUrl(undefined), false);
  assert.equal(isHttpUrl(null), false);
});

it('isUrlTarget', () => {
  assert.equal(isUrlTarget('steam://rungameid/1'), true);
  assert.equal(isUrlTarget('https://exemple.fr'), true);
  assert.equal(isUrlTarget('com.epicgames.launcher://apps/x'), true);
  assert.equal(isUrlTarget('C:\\Jeux\\jeu.exe'), false);
  assert.equal(isUrlTarget('/usr/bin/jeu'), false);
});
