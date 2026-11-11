// Sites et arguments saisis en texte, déplacés de src/renderer/app.js vers src/renderer/domain/sites.ts (P1-23).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { joinArgs, parseArgs, parseSites, searchUrlFor, sitesToText } from '../../../src/renderer/domain/sites.ts';

describe('domain/sites : parseSites et sitesToText', () => {
  it('lit nom, adresse et adresse de recherche dans n’importe quel ordre', () => {
    assert.deepEqual(parseSites('Site A | https://a.fr | https://a.fr/s?q={q}\nhttps://b.fr/?q={q} | https://b.fr | B'), [
      { name: 'Site A', url: 'https://a.fr', search: 'https://a.fr/s?q={q}' },
      { name: 'B', url: 'https://b.fr', search: 'https://b.fr/?q={q}' },
    ]);
  });

  it('sans nom : le serveur ; sans recherche : chaîne vide', () => {
    assert.deepEqual(parseSites('  https://www.c.org/jeux  '), [{ name: 'www.c.org', url: 'https://www.c.org/jeux', search: '' }]);
  });

  it('ignore les lignes vides et celles sans adresse de site', () => {
    assert.deepEqual(parseSites('\n | \nNom seul\nRecherche | https://d.fr/?q={q}\r\n'), []);
    assert.deepEqual(parseSites(''), []);
    assert.deepEqual(parseSites(null), []);
  });

  it('une adresse invalide lève une erreur (comportement conservé)', () => {
    assert.throws(() => parseSites('https://'), TypeError);
  });

  it('sitesToText écrit une ligne par site, sans champ vide', () => {
    const list = [
      { name: 'A', url: 'https://a.fr', search: 'https://a.fr/?q={q}' },
      { name: 'B', url: 'https://b.fr', search: '' },
    ];
    assert.equal(sitesToText(list), 'A | https://a.fr | https://a.fr/?q={q}\nB | https://b.fr');
    assert.deepEqual(parseSites(sitesToText(list)), list);
    assert.equal(sitesToText(null), '');
    assert.equal(sitesToText([]), '');
  });
});

describe('domain/sites : searchUrlFor', () => {
  it('remplace chaque {q} par la recherche encodée', () => {
    assert.equal(searchUrlFor({ search: 'https://s.fr/?q={q}&r={q}' }, 'été & co'), 'https://s.fr/?q=%C3%A9t%C3%A9%20%26%20co&r=%C3%A9t%C3%A9%20%26%20co');
    assert.equal(searchUrlFor({ search: 'https://s.fr/fixe' }, 'x'), 'https://s.fr/fixe');
  });

  it('chaîne vide sans adresse de recherche', () => {
    assert.equal(searchUrlFor({}, 'x'), '');
    assert.equal(searchUrlFor({ search: '' }, 'x'), '');
    assert.equal(searchUrlFor({ search: null }, 'x'), '');
  });
});

describe('domain/sites : parseArgs et joinArgs', () => {
  it('sépare par espaces ; les guillemets forment un seul argument', () => {
    assert.deepEqual(parseArgs('-f  --rom "C:\\Mes jeux\\x.iso" {rom}'), ['-f', '--rom', 'C:\\Mes jeux\\x.iso', '{rom}']);
    assert.deepEqual(parseArgs('""'), ['']);
    assert.deepEqual(parseArgs(''), []);
    assert.deepEqual(parseArgs('   '), []);
  });

  it('joinArgs met entre guillemets les arguments avec espaces', () => {
    assert.equal(joinArgs(['-f', 'C:\\Mes jeux\\x.iso', '{rom}']), '-f "C:\\Mes jeux\\x.iso" {rom}');
    assert.equal(joinArgs([]), '');
    assert.equal(joinArgs(null), '');
    assert.equal(joinArgs(undefined), '');
  });

  it('aller-retour', () => {
    const args = ['--fullscreen', 'C:\\Program Files\\x', '{rom}'];
    assert.deepEqual(parseArgs(joinArgs(args)), args);
  });
});
