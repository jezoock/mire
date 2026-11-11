// Plateforme (P1-11) : détection de mpv, VLC et des navigateurs sous Windows, macOS et Linux, sur un système de
// fichiers simulé (aucun programme réel n'est cherché ni lancé).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBrowser, detectPlayer, MPV, VLC } from '../../src/main/platform/index.ts';
import type { DetectEnv } from '../../src/main/platform/index.ts';

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

test.describe('detectPlayer', () => {
  test('Windows : mpv dans Program Files, avant VLC', () => {
    const files = ['C:\\Program Files\\mpv\\mpv.exe', 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe'];
    assert.equal(detectPlayer(fakeEnv('win32', files, WIN_ENV)), 'C:\\Program Files\\mpv\\mpv.exe');
  });

  test('Windows : mpv installé pour l’utilisateur, ou dans C:\\mpv', () => {
    const local = 'C:\\Users\\a\\AppData\\Local\\Programs\\mpv\\mpv.exe';
    assert.equal(detectPlayer(fakeEnv('win32', [local], WIN_ENV)), local);
    assert.equal(detectPlayer(fakeEnv('win32', ['C:\\mpv\\mpv.exe'], WIN_ENV)), 'C:\\mpv\\mpv.exe');
  });

  test('Windows : VLC 32 bits, variables d’environnement absentes', () => {
    const vlc86 = 'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe';
    assert.equal(detectPlayer(fakeEnv('win32', [vlc86], WIN_ENV)), vlc86);
    assert.equal(detectPlayer(fakeEnv('win32', [vlc86], {})), null);
    assert.equal(VLC.detect(fakeEnv('win32', [vlc86], WIN_ENV)), vlc86);
    assert.equal(MPV.detect(fakeEnv('win32', [vlc86], WIN_ENV)), null);
  });

  test('macOS : application mpv, Homebrew, puis VLC', () => {
    assert.equal(detectPlayer(fakeEnv('darwin', ['/opt/homebrew/bin/mpv', '/Applications/VLC.app/Contents/MacOS/VLC'])), '/opt/homebrew/bin/mpv');
    assert.equal(detectPlayer(fakeEnv('darwin', ['/Applications/VLC.app/Contents/MacOS/VLC'])), '/Applications/VLC.app/Contents/MacOS/VLC');
    assert.equal(detectPlayer(fakeEnv('darwin', ['/Applications/mpv.app/Contents/MacOS/mpv'])), '/Applications/mpv.app/Contents/MacOS/mpv');
  });

  test('Linux : mpv, puis VLC (paquet ou snap) ; un dossier ne compte pas', () => {
    assert.equal(detectPlayer(fakeEnv('linux', ['/usr/local/bin/mpv', '/usr/bin/vlc'])), '/usr/local/bin/mpv');
    assert.equal(detectPlayer(fakeEnv('linux', ['/snap/bin/vlc'])), '/snap/bin/vlc');
    assert.equal(detectPlayer(fakeEnv('linux', [], {}, ['/usr/bin/mpv'])), null);
    assert.equal(detectPlayer(fakeEnv('linux', [])), null);
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
