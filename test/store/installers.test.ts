// Analyse des pages de versions GitHub et de la page de téléchargement de Dolphin, sur du HTML enregistré.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseReleaseAssets, tagFromLocation } from '../../src/main/store/installers/github-release.ts';
import { findDownloadLink } from '../../src/main/store/installers/download-page.ts';
import { coreUrl, retroarchUrl } from '../../src/main/store/installers/retroarch.ts';
import { EMULATORS } from '../../src/main/store/catalog/index.ts';

// Aucun accès réseau pendant les tests : le moindre appel à fetch fait échouer le test.
globalThis.fetch = () => {
  throw new Error('accès réseau interdit pendant les tests');
};

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'store', name), 'utf8');
const emulator = (id: string) => EMULATORS.find((e) => e.id === id)!;

test('GitHub : étiquette lue dans la redirection de releases/latest', () => {
  assert.equal(tagFromLocation('https://github.com/stenzek/duckstation/releases/tag/v0.1-9669'), 'v0.1-9669');
  assert.equal(tagFromLocation('https://github.com/a/b/releases/tag/nightly%2B1?x=1'), 'nightly+1');
  assert.equal(tagFromLocation('https://github.com/libretro/RetroArch/releases'), null);
  assert.equal(tagFromLocation(''), null);
});

test('GitHub : fichiers de la version, sans les archives des sources', () => {
  const assets = parseReleaseAssets(fixture('github-expanded-assets-duckstation.html'), 'stenzek/duckstation');
  const prefix = 'https://github.com/stenzek/duckstation/releases/download/v0.1-9669/';
  assert.deepEqual(assets, [
    { name: 'DuckStation-x64.AppImage', url: `${prefix}DuckStation-x64.AppImage` },
    { name: 'duckstation-windows-arm64-release.zip', url: `${prefix}duckstation-windows-arm64-release.zip` },
    { name: 'duckstation-windows-x64-release.zip', url: `${prefix}duckstation-windows-x64-release.zip` },
    { name: 'DuckStation Symbols (x64).7z', url: `${prefix}DuckStation%20Symbols%20(x64).7z` },
  ]);
  assert.deepEqual(parseReleaseAssets(fixture('github-expanded-assets-duckstation.html'), 'autre/depot'), []);
});

test('GitHub : le motif du catalogue choisit le bon fichier de DuckStation', () => {
  const assets = parseReleaseAssets(fixture('github-expanded-assets-duckstation.html'), 'stenzek/duckstation');
  const src = emulator('duckstation').source!;
  assert.equal(assets.find((a) => src.win32!.test(a.name))?.name, 'duckstation-windows-x64-release.zip');
  assert.equal(assets.find((a) => src.linux!.test(a.name))?.name, 'DuckStation-x64.AppImage');
});

test('Page de téléchargement : lien Windows x64 de la version stable de Dolphin', () => {
  const pattern = emulator('dolphin').source!.win32!;
  assert.deepEqual(findDownloadLink(fixture('dolphin-download.html'), pattern), {
    url: 'https://dl.dolphin-emu.org/releases/2509/dolphin-2509-x64.7z',
    name: 'dolphin-2509-x64.7z',
    version: '2509',
  });
  assert.equal(findDownloadLink('<html>page changée</html>', pattern), null);
});

test('RetroArch : adresses du buildbot', () => {
  assert.equal(retroarchUrl('1.21.0', 'win32'), 'https://buildbot.libretro.com/stable/1.21.0/windows/x86_64/RetroArch.7z');
  assert.equal(retroarchUrl('1.21.0', 'linux'), 'https://buildbot.libretro.com/stable/1.21.0/linux/x86_64/RetroArch.7z');
  assert.equal(coreUrl('snes9x', 'win32'), 'https://buildbot.libretro.com/nightly/windows/x86_64/latest/snes9x_libretro.dll.zip');
  assert.equal(coreUrl('fceumm', 'linux'), 'https://buildbot.libretro.com/nightly/linux/x86_64/latest/fceumm_libretro.so.zip');
});
