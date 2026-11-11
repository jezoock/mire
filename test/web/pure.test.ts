// Vues web (P1-12) : fonctions pures — identité « Chrome » et exception Google, raccourcis et touches de la manette,
// modèle de recherche, résolution des entrées, permissions, liens ouverts dans une nouvelle fenêtre.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../../src/main/config/index.ts';
import {
  chromeLikeUserAgent,
  consoleSites,
  createEntryRegistry,
  downloadContextOf,
  isPermissionAllowed,
  isSigninPage,
  nativeUserAgent,
  padInputEvents,
  roundRect,
  searchTemplate,
  shortcutAction,
  signinUserAgent,
  windowOpenAction,
  withSearchTemplate,
} from '../../src/main/web/index.ts';

type Any = any;

const ELECTRON_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Mire/1.0.0 Chrome/152.0.7444.59 Electron/44.9.3 Safari/537.36';

describe('identité', () => {
  test('« Chrome » : sans Electron ni Mire, version réduite', () => {
    assert.equal(
      chromeLikeUserAgent(ELECTRON_UA, 'Mire'),
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    );
  });

  test('nom d’application avec caractères spéciaux : échappé', () => {
    assert.equal(chromeLikeUserAgent('A Mi.re/2 Chrome/1.2.3 B', 'Mi.re'), 'A Chrome/1.0.0.0 B');
    assert.equal(chromeLikeUserAgent('A Mixre/2 B', 'Mi.re'), 'A Mixre/2 B');
  });

  test('identité d’origine : Electron gardé, Mire retiré', () => {
    const ua = nativeUserAgent(ELECTRON_UA, 'Mire');
    assert.match(ua, /Electron\/44\.9\.3/);
    assert.match(ua, /Chrome\/152\.0\.7444\.59/);
    assert.doesNotMatch(ua, /Mire\//);
    assert.equal(nativeUserAgent(ELECTRON_UA, 'Electron'), ELECTRON_UA);
  });

  test('exception Google : seulement la page de connexion', () => {
    assert.equal(isSigninPage('https://accounts.google.com/v3/signin'), true);
    assert.equal(isSigninPage('https://ACCOUNTS.google.com/'), true);
    assert.equal(isSigninPage('https://www.google.com/'), false);
    assert.equal(isSigninPage('https://accounts.google.com.evil.example/'), false);
    assert.equal(isSigninPage('pas une adresse'), false);
    assert.equal(signinUserAgent('https://accounts.google.com/', 'UA'), 'UA');
    assert.equal(signinUserAgent('https://www.youtube.com/', 'UA'), '');
  });
});

describe('raccourcis', () => {
  const idle = { immersive: false, html: false };
  const key = (k: string, mods: Any = {}) => ({ type: 'keyDown', key: k, ...mods });

  test('touches de Mire', () => {
    assert.equal(shortcutAction(key('F11'), idle), 'toggle-immersive');
    assert.equal(shortcutAction(key('F9'), idle), 'mire');
    assert.equal(shortcutAction(key('F5'), idle), 'reload');
    assert.equal(shortcutAction(key('r', { control: true }), idle), 'reload');
    assert.equal(shortcutAction(key('R', { meta: true }), idle), 'reload');
    assert.equal(shortcutAction(key('w', { control: true }), idle), 'close');
    assert.equal(shortcutAction(key('W', { meta: true }), idle), 'close');
    assert.equal(shortcutAction(key('ArrowLeft', { alt: true }), idle), 'back');
    assert.equal(shortcutAction(key('ArrowRight', { alt: true }), idle), 'forward');
  });

  test('touches laissées à la page', () => {
    assert.equal(shortcutAction(key('r'), idle), null);
    assert.equal(shortcutAction(key('w'), idle), null);
    assert.equal(shortcutAction(key('ArrowLeft'), idle), null);
    assert.equal(shortcutAction(key('Escape'), idle), null);
  });

  test('Échap quitte le mode immersif, pas le plein écran du lecteur vidéo', () => {
    assert.equal(shortcutAction(key('Escape'), { immersive: true, html: false }), 'leave-immersive');
    assert.equal(shortcutAction(key('Escape'), { immersive: true, html: true }), null);
  });

  test('manette : appui, caractère, relâchement', () => {
    assert.deepEqual(padInputEvents('Enter'), [
      { type: 'keyDown', keyCode: 'Return', modifiers: [] },
      { type: 'char', keyCode: '\r', modifiers: [] },
      { type: 'keyUp', keyCode: 'Return', modifiers: [] },
    ]);
    assert.deepEqual(padInputEvents('ShiftTab'), [
      { type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] },
      { type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] },
    ]);
    assert.deepEqual(padInputEvents('Inconnue'), []);
    assert.deepEqual(padInputEvents('toString'), []);
  });
});

describe('modèle de recherche', () => {
  test('« mire » remplacé par {q}, dans le chemin ou les paramètres', () => {
    assert.deepEqual(searchTemplate('https://www.netflix.com/search?q=mire'), { ok: true, template: 'https://www.netflix.com/search?q={q}' });
    assert.deepEqual(searchTemplate('https://site.example/recherche/Mire/page/1'), { ok: true, template: 'https://site.example/recherche/{q}/page/1' });
  });

  test('« mire » dans le nom du site : ignoré', () => {
    assert.deepEqual(searchTemplate('https://mire.example/s?q=mire'), { ok: true, template: 'https://mire.example/s?q={q}' });
    assert.equal(searchTemplate('https://mire.example/accueil').ok, false);
  });

  test('erreurs : pas de recherche, adresse illisible', () => {
    assert.match((searchTemplate('https://www.netflix.com/browse') as Any).error, /Cherchez d’abord le mot « mire »/);
    assert.deepEqual(searchTemplate('pas une adresse'), { ok: false, error: 'Adresse de page illisible.' });
  });

  test('enregistré sur le site, ou sur le site choisi de la console', () => {
    const config: Any = {
      web: [
        { id: 'a', search: '' },
        { id: 'b', search: 'x' },
      ],
      emulators: [{ id: 'snes', romSites: [] }, { id: 'nes' }],
      pcSites: [],
    };
    const sites = [
      { name: 'S1', url: 'https://s1/', search: '' },
      { name: 'S2', url: 'https://s2/', search: '' },
    ];
    assert.deepEqual(withSearchTemplate(config, { id: 'a', url: '' }, 'T').web, [
      { id: 'a', search: 'T' },
      { id: 'b', search: 'x' },
    ]);
    const rom = withSearchTemplate(config, { id: 'rom:snes', url: '', romConsole: 'snes', romSite: 1 }, 'T', sites);
    assert.deepEqual(rom.emulators[0].romSites, [sites[0], { ...sites[1], search: 'T' }]);
    assert.equal(rom.emulators[1], config.emulators[1]);
    const pc = withSearchTemplate(config, { id: 'rom:pc', url: '', romConsole: 'pc', romSite: 0 }, 'T', sites);
    assert.deepEqual(pc.pcSites, [{ ...sites[0], search: 'T' }, sites[1]]);
  });
});

describe('entrées', () => {
  const config: Any = {
    ...structuredClone(DEFAULT_CONFIG),
    web: [{ id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com/', mode: 'integrated', search: '' }],
    bookmarks: [{ id: 'b1', title: 'Film', site: 'Ex', url: 'https://ex.example/film' }],
    emulators: [
      {
        id: 'snes-1',
        name: 'Super Nintendo',
        romSites: [
          { name: 'A', url: 'https://a/' },
          { name: 'B', url: '' },
        ],
      },
      { id: 'nes-1', name: 'NES' },
    ],
    pcSites: [{ name: 'PC', url: 'https://pc/' }],
  };
  const defaults = { defaultRomSites: (system: string) => [{ name: `défaut ${system}`, url: 'https://d/', search: '' }], guessSystem: () => 'nes' };

  test('sites d’une console : sa liste (sans adresse vide), sinon ceux de son système ; jeux PC', () => {
    assert.deepEqual(consoleSites(config, 'snes-1', defaults), [{ name: 'A', url: 'https://a/' }]);
    assert.deepEqual(consoleSites(config, 'nes-1', defaults), [{ name: 'défaut nes', url: 'https://d/', search: '' }]);
    assert.deepEqual(consoleSites(config, 'pc', defaults), config.pcSites);
    assert.deepEqual(consoleSites(config, 'inconnue', defaults), []);
  });

  test('résolution par préfixe', () => {
    const reg = createEntryRegistry();
    const romSites = (i: string) => consoleSites(config, i, defaults);
    assert.equal(reg.resolve('netflix', config).entry, config.web[0]);
    assert.equal(reg.resolve('rom:snes-1', config, { romSites }).entry?.romConsole, 'snes-1');
    assert.equal(reg.resolve('bm:b1', config).entry?.url, 'https://ex.example/film');
    assert.match(reg.resolve('tv:inconnu', config).error || '', /n’existe plus/);
    assert.match(reg.resolve('absent', config).error || '', /n’existe plus/);
    assert.deepEqual(reg.prefixes(), ['rom:', 'bm:', 'tv:']);
  });

  test('résolveur ajouté (addon) ; préfixe déjà pris refusé', () => {
    const reg = createEntryRegistry();
    reg.register({ prefix: 'addon:', resolve: (id) => ({ entry: { id, url: 'https://addon/', name: 'Addon' } }) });
    assert.deepEqual(reg.resolve('addon:x', config).entry, { id: 'addon:x', url: 'https://addon/', name: 'Addon' });
    assert.throws(() => reg.register({ prefix: 'rom:', resolve: () => ({ error: '' }) }), /déjà utilisé/);
  });
});

describe('liens ouverts dans une nouvelle fenêtre', () => {
  const rom = { romConsole: 'snes-1' };
  test('fichier de jeu depuis « Ajouter des jeux » : téléchargé, paramètres compris', () => {
    assert.equal(windowOpenAction('https://autre.example/jeu.zip', rom, 'https://site.example/'), 'download');
    assert.equal(windowOpenAction('https://autre.example/jeu.zip?dl=1', rom, 'https://site.example/'), 'download');
    assert.equal(windowOpenAction('https://autre.example/page?f=jeu.zip', rom, 'https://site.example/'), 'deny');
    assert.equal(windowOpenAction('https://autre.example/page', { romConsole: 'pc' }, 'https://site.example/'), 'download');
  });

  test('même site : chargé dans la vue ; autre site ou protocole : refusé', () => {
    assert.equal(windowOpenAction('https://www.site.example/b', {}, 'https://site.example/a'), 'load');
    assert.equal(windowOpenAction('https://site.example/jeu.zip', {}, 'https://site.example/a'), 'load');
    assert.equal(windowOpenAction('https://pub.example/', {}, 'https://site.example/a'), 'deny');
    assert.equal(windowOpenAction('javascript:alert(1)', rom, 'https://site.example/a'), 'deny');
  });

  test('dossier d’un téléchargement : la console, sauf jeux PC et autres sites', () => {
    assert.deepEqual(downloadContextOf({ romConsole: 'snes-1' }), { console: 'snes-1' });
    assert.deepEqual(downloadContextOf({ romConsole: 'pc' }), {});
    assert.deepEqual(downloadContextOf({}), {});
    assert.deepEqual(downloadContextOf(null), {});
  });
});

test('permissions : liste fermée', () => {
  for (const p of ['fullscreen', 'mediaKeySystem', 'protected-media-identifier', 'storage-access']) assert.equal(isPermissionAllowed(p), true);
  for (const p of ['geolocation', 'notifications', 'media', 'openExternal', 'clipboard-read']) assert.equal(isPermissionAllowed(p), false);
});

test('position arrondie, jamais négative', () => {
  assert.deepEqual(roundRect({ x: -3, y: 10.6, width: 99.4, height: 20.5 }), { x: 0, y: 11, width: 99, height: 21 });
  assert.deepEqual(roundRect(null), { x: 0, y: 0, width: 0, height: 0 });
});
