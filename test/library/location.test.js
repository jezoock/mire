'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLocation, locationError } = require('../../src/main/library/location.ts');

const WIN = { platform: 'win32' };
const MAC = { platform: 'darwin' };
const LINUX = { platform: 'linux', uid: 1000 };

test('adresses web', () => {
  assert.deepEqual(resolveLocation(' https://serveur/films/ ', LINUX), { type: 'url', url: 'https://serveur/films/' });
  assert.deepEqual(resolveLocation('HTTP://serveur/liste.m3u', WIN), { type: 'url', url: 'HTTP://serveur/liste.m3u' });
});

test('chemins locaux', () => {
  assert.deepEqual(resolveLocation('D:\\Films', WIN), { type: 'path', path: 'D:\\Films', network: false });
  assert.deepEqual(resolveLocation('/home/moi/Films', LINUX), { type: 'path', path: '/home/moi/Films', network: false });
  assert.deepEqual(resolveLocation(null, MAC), { type: 'path', path: '', network: false });
});

test('partage \\\\NAS\\Films : réseau sur tous les systèmes', () => {
  for (const opts of [WIN, MAC, LINUX]) {
    assert.deepEqual(resolveLocation('\\\\NAS\\Films', opts), { type: 'path', path: '\\\\NAS\\Films', network: true });
  }
});

test('partage //NAS/Films : converti sous Windows seulement', () => {
  assert.deepEqual(resolveLocation('//NAS/Films', WIN), { type: 'path', path: '\\\\NAS\\Films', network: true });
  assert.deepEqual(resolveLocation('//NAS/Films', LINUX), { type: 'path', path: '//NAS/Films', network: false });
});

test.describe('smb://', () => {
  test('Windows : chemin UNC', () => {
    assert.deepEqual(resolveLocation('smb://nas/films', WIN), { type: 'path', path: '\\\\nas\\films', network: true });
    assert.deepEqual(resolveLocation('smb://NAS/Films/S%C3%A9ries/2024/', WIN), { type: 'path', path: '\\\\NAS\\Films\\Séries\\2024', network: true });
  });

  test('macOS : /Volumes', () => {
    assert.deepEqual(resolveLocation('smb://nas/films/S%C3%A9ries', MAC), { type: 'path', path: '/Volumes/films/Séries', network: true });
  });

  test('Linux : gvfs, serveur et partage en minuscules', () => {
    assert.deepEqual(resolveLocation('smb://NAS/Films/Bad%ZZ', { platform: 'linux', uid: 1234 }), {
      type: 'path',
      path: '/run/user/1234/gvfs/smb-share:server=nas,share=films/Bad%ZZ',
      network: true,
    });
  });

  test('sans partage : traité comme un chemin', () => {
    assert.deepEqual(resolveLocation('smb://nas', LINUX), { type: 'path', path: 'smb://nas', network: false });
  });
});

test('sans second paramètre : système courant', () => {
  const expected = resolveLocation('smb://nas/films', { platform: process.platform });
  assert.deepEqual(resolveLocation('smb://nas/films'), expected);
});

// Les chemins macOS et Linux gardent des barres obliques, même sur un Windows qui simule ces systèmes.
test('smb:// sous macOS et Linux : barres obliques sur tous les systèmes', () => {
  assert.equal(resolveLocation('smb://nas/films/a/b', MAC).path, '/Volumes/films/a/b');
  assert.equal(resolveLocation('smb://nas/films/a', LINUX).path, '/run/user/1000/gvfs/smb-share:server=nas,share=films/a');
});

test("message d'erreur : partage réseau ou dossier", () => {
  assert.match(locationError('smb://nas/films', { network: true }), /^Partage réseau inaccessible : smb:\/\/nas\/films\./);
  assert.equal(locationError('/films', { network: false }), 'Dossier introuvable : /films');
});
