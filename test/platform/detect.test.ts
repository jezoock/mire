// Plateforme (P1-11) : détection des lecteurs externes (décrits par des plugins factices, P5-20) et des navigateurs
// sous Windows, macOS et Linux, sur un système de fichiers simulé (aucun programme réel n'est cherché ni lancé). Les
// emplacements de mpv et VLC sont des données du plugin `mire.players.external`, testées avec lui.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBrowser, detectPlayer, playerCandidates } from '../../src/main/platform/index.ts';
import type { DetectEnv, ExternalPlayerSpec } from '../../src/main/platform/index.ts';

const WIN_ENV = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' };

// Système simulé : seuls les fichiers listés existent ; un dossier du même nom n'est pas un programme.
function fakeEnv(platform: NodeJS.Platform, files: string[], env: Record<string, string> = {}, dirs: string[] = []): DetectEnv {
  return {
    platform,
    env,
    fs: {
      statSync(file: string) {
        if (files.includes(file)) return { isFile: () => true };
        if (dirs.includes(file)) return { isFile: () => false };
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    },
  };
}

// Lecteurs factices, tels que les lit `src/main/plugins/apps.ts` : Alpha préféré, puis Beta.
const player = (id: string, priority: number, locations: ExternalPlayerSpec['locations']): ExternalPlayerSpec => ({
  id: `org.essai/${id}`,
  name: id,
  priority,
  names: [id],
  locations,
  options: {},
});
const ALPHA = player('alpha', 10, {
  win32: ['{programFiles}\\Alpha\\alpha.exe', '{localAppData}\\Programs\\Alpha\\alpha.exe', 'C:\\alpha\\alpha.exe'],
  darwin: ['/Applications/Alpha.app/Contents/MacOS/alpha', '/opt/homebrew/bin/alpha'],
  linux: ['/usr/bin/alpha', '/usr/local/bin/alpha'],
});
const BETA = player('beta', 20, {
  win32: ['{programFiles}\\Beta\\beta.exe', '{programFilesX86}\\Beta\\beta.exe'],
  darwin: ['/Applications/Beta.app/Contents/MacOS/beta'],
  linux: ['/usr/bin/beta', '/snap/bin/beta'],
});
const PLAYERS = [ALPHA, BETA];

test.describe('detectPlayer', () => {
  test('Windows : dossiers d’installation remplacés, Alpha avant Beta', () => {
    const files = ['C:\\Program Files\\Alpha\\alpha.exe', 'C:\\Program Files\\Beta\\beta.exe'];
    assert.equal(detectPlayer(PLAYERS, fakeEnv('win32', files, WIN_ENV)), 'C:\\Program Files\\Alpha\\alpha.exe');
    const local = 'C:\\Users\\a\\AppData\\Local\\Programs\\Alpha\\alpha.exe';
    assert.equal(detectPlayer(PLAYERS, fakeEnv('win32', [local], WIN_ENV)), local);
    assert.equal(detectPlayer(PLAYERS, fakeEnv('win32', ['C:\\alpha\\alpha.exe'], WIN_ENV)), 'C:\\alpha\\alpha.exe');
  });

  test('Windows : Program Files (x86), variables d’environnement absentes', () => {
    const beta86 = 'C:\\Program Files (x86)\\Beta\\beta.exe';
    assert.equal(detectPlayer(PLAYERS, fakeEnv('win32', [beta86], WIN_ENV)), beta86);
    assert.equal(detectPlayer(PLAYERS, fakeEnv('win32', [beta86], {})), null);
    assert.deepEqual(playerCandidates(BETA.locations, fakeEnv('win32', [], {})), [null, null]);
  });

  test('macOS et Linux : ordre des plugins ; un dossier ne compte pas ; autre Unix : emplacements de Linux', () => {
    assert.equal(
      detectPlayer(PLAYERS, fakeEnv('darwin', ['/opt/homebrew/bin/alpha', '/Applications/Beta.app/Contents/MacOS/beta'])),
      '/opt/homebrew/bin/alpha',
    );
    assert.equal(detectPlayer(PLAYERS, fakeEnv('darwin', ['/Applications/Beta.app/Contents/MacOS/beta'])), '/Applications/Beta.app/Contents/MacOS/beta');
    assert.equal(detectPlayer(PLAYERS, fakeEnv('linux', ['/usr/local/bin/alpha', '/usr/bin/beta'])), '/usr/local/bin/alpha');
    assert.equal(detectPlayer(PLAYERS, fakeEnv('linux', ['/snap/bin/beta'])), '/snap/bin/beta');
    assert.equal(detectPlayer(PLAYERS, fakeEnv('linux', [], {}, ['/usr/bin/alpha'])), null);
    assert.equal(detectPlayer(PLAYERS, fakeEnv('freebsd', ['/usr/bin/beta'])), '/usr/bin/beta');
  });

  test('aucun plugin : aucun lecteur', () => {
    assert.equal(detectPlayer([], fakeEnv('linux', ['/usr/bin/alpha'])), null);
  });
});

test.describe('detectBrowser', () => {
  test('Windows : Edge d’abord, puis Chrome (machine, puis utilisateur)', () => {
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const chromeUser = 'C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
    assert.equal(detectBrowser(fakeEnv('win32', [chrome, edge], WIN_ENV)), edge);
    assert.equal(detectBrowser(fakeEnv('win32', [chromeUser, chrome], WIN_ENV)), chrome);
    assert.equal(detectBrowser(fakeEnv('win32', [chromeUser], WIN_ENV)), chromeUser);
    assert.equal(detectBrowser(fakeEnv('win32', [], WIN_ENV)), null);
  });

  test('macOS : Chrome, Edge, puis Brave', () => {
    const brave = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
    const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
    assert.equal(detectBrowser(fakeEnv('darwin', [brave, edge])), edge);
    assert.equal(detectBrowser(fakeEnv('darwin', [brave])), brave);
  });

  test('Linux : Chrome, Edge, puis Chromium', () => {
    assert.equal(detectBrowser(fakeEnv('linux', ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'])), '/usr/bin/google-chrome-stable');
    assert.equal(detectBrowser(fakeEnv('linux', ['/snap/bin/chromium'])), '/snap/bin/chromium');
    assert.equal(detectBrowser(fakeEnv('linux', [])), null);
  });
});
