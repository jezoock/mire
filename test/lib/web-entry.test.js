'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { romEntry, resolveWebEntry } = require('../../lib/web-entry.js');
const { DEFAULT_TV } = require('../../lib/config.js');

const SITES = [
  { name: 'Site A', url: 'https://a.example/', search: 'https://a.example/?q={q}' },
  { name: 'Site B', url: 'https://b.example/' },
];

const config = {
  web: [{ id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com/browse', color: '#E50914', mode: 'integrated' }],
  bookmarks: [
    { id: 'b1', title: 'Un film', site: 'Exemple', url: 'https://exemple.fr/film' },
    { id: 'b2', site: 'Exemple', url: 'https://exemple.fr/autre' },
  ],
  tv: { services: structuredClone(DEFAULT_TV), active: 'sfr' },
  emulators: [{ name: 'Super Nintendo' }],
};
const romSites = (i) => (i === 0 || i === 'pc' ? SITES : []);

test.describe('resolveWebEntry', () => {
  test('site enregistré : entrée de la configuration', () => {
    assert.equal(resolveWebEntry('netflix', config).entry, config.web[0]);
  });

  test('sites de jeux d’une console, avec le site choisi', () => {
    assert.deepEqual(resolveWebEntry('rom:0', config, { romSites, site: 1 }).entry, {
      id: 'rom:0',
      name: 'Jeux : Super Nintendo',
      url: 'https://b.example/',
      search: '',
      color: '#6E88F7',
      mode: 'integrated',
      romConsole: 0,
      romSite: 1,
    });
    const pc = resolveWebEntry('rom:pc', config, { romSites }).entry;
    assert.equal(pc.name, 'Jeux : Jeux PC');
    assert.equal(pc.romConsole, 'pc');
    assert.equal(pc.search, SITES[0].search);
  });

  test('console sans site, ou inconnue : erreur', () => {
    const msg = 'Aucun site configuré pour cette console. Ajoutez-en dans « Modifier la console ».';
    assert.deepEqual(resolveWebEntry('rom:1', config, { romSites }), { error: msg });
    assert.deepEqual(resolveWebEntry('rom:0', config), { error: msg });
  });

  test('marque-page : titre, ou à défaut le site', () => {
    assert.deepEqual(resolveWebEntry('bm:b1', config).entry, {
      id: 'bm:b1',
      name: 'Un film',
      url: 'https://exemple.fr/film',
      mode: 'integrated',
      color: '#9B6CF7',
      search: '',
    });
    assert.equal(resolveWebEntry('bm:b2', config).entry.name, 'Exemple');
    assert.deepEqual(resolveWebEntry('bm:zz', config), { error: 'Marque-page introuvable.' });
  });

  test('portails TV livrés d’office : SFR TV, B.tv, Molotov', () => {
    assert.deepEqual(resolveWebEntry('tv:sfr', config).entry, {
      id: 'tv:sfr',
      name: 'SFR TV',
      url: 'https://tv.sfr.fr/',
      mode: 'integrated',
      color: '#E23B3B',
      search: '',
    });
    assert.equal(resolveWebEntry('tv:bouygues', config).entry.url, 'https://www.bouyguestelecom.fr/tv-direct/');
    assert.equal(resolveWebEntry('tv:molotov', config).entry.url, 'https://www.molotov.tv/');
  });

  test('service TV par playlist refusé', () => {
    const r = resolveWebEntry('tv:freebox', config);
    assert.equal(r.entry, undefined);
    assert.match(r.error, /Freebox TV n’est pas un portail web/);
  });

  test('identifiant inconnu', () => {
    assert.deepEqual(resolveWebEntry('inconnu', config), { error: 'Ce site n’existe plus dans la configuration.' });
    assert.deepEqual(resolveWebEntry('tv:web', config), { error: 'Ce service de télévision n’existe plus dans la configuration.' });
    assert.deepEqual(resolveWebEntry('tv:sfr', { web: [] }), { error: 'Ce service de télévision n’existe plus dans la configuration.' });
  });
});

test('romEntry : index de site borné', () => {
  assert.equal(romEntry(config, 0, SITES, 9).romSite, 1);
  assert.equal(romEntry(config, 0, SITES, -3).romSite, 0);
  assert.equal(romEntry(config, 0, SITES, 'x').romSite, 0);
  assert.equal(romEntry(config, 5, SITES), null);
  assert.equal(romEntry(config, 0, []), null);
});
