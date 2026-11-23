// Lecteurs externes des plugins (P5-20) : lecture des contributions `apps` de genre `player` par le cœur (données
// vérifiées et bornées, emplacement ou option mal formés ignorés), et prise en compte d'un plugin factice activé puis
// désactivé ; un plugin qui ne vient ni de Mire ni du dépôt officiel ne fait lancer aucun programme.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkLocation, readExternalPlayer, readExternalPlayers } from '../../src/main/plugins/apps.ts';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';
import { createJournal } from '../../src/main/plugins/journal.ts';
import { createPluginService } from '../../src/main/plugins/service.ts';
import { createPluginState } from '../../src/main/plugins/state.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';

const entry = (data: unknown, pluginId = 'org.essai.lecteurs', id = 'alpha'): ContributionEntry => ({
  pluginId,
  kind: 'apps',
  id,
  declaration: { id, file: 'alpha.json' },
  data,
});

const ALPHA = {
  kind: 'player',
  priority: 10,
  names: ['alpha'],
  locations: {
    windows: ['{programFiles}\\Alpha\\alpha.exe', 'D:\\alpha\\ALPHA.EXE'],
    mac: ['/Applications/Alpha.app/Contents/MacOS/Alpha'],
    linux: ['/usr/bin/alpha'],
  },
  options: { fullscreen: '--plein', title: '--titre={title}', start: '--debut={start}' },
};

describe('lecture des lecteurs externes', () => {
  it('lit les noms, les emplacements par système, les options, la priorité et le nom affiché', () => {
    assert.deepEqual(readExternalPlayer(entry(ALPHA)), {
      id: 'org.essai.lecteurs/alpha',
      name: 'pluginTexts.org_essai_lecteurs.apps.alpha.name',
      priority: 10,
      names: ['alpha'],
      locations: {
        win32: ['{programFiles}\\Alpha\\alpha.exe', 'D:\\alpha\\ALPHA.EXE'],
        darwin: ['/Applications/Alpha.app/Contents/MacOS/Alpha'],
        linux: ['/usr/bin/alpha'],
      },
      options: { fullscreen: '--plein', title: '--titre={title}', start: '--debut={start}' },
    });
  });

  it('emplacement refusé : relatif, partage réseau, `..`, variable inconnue, autre programme, caractère de contrôle', () => {
    const names = ['alpha'];
    for (const bad of [
      'alpha',
      'bin/alpha',
      '\\\\serveur\\partage\\alpha.exe',
      'C:\\Alpha\\..\\Windows\\alpha.exe',
      '{windir}\\alpha.exe',
      'C:\\{programFiles}\\alpha.exe',
      '{programFiles}alpha.exe',
      'C:\\Windows\\System32\\cmd.exe',
      'C:\\alpha\\alpha.exe\u0000',
      'C:\\' + 'a'.repeat(300) + '\\alpha.exe',
      3,
      null,
    ])
      assert.equal(checkLocation(bad, 'windows', names), null, String(bad));
    for (const bad of ['/bin/sh', 'usr/bin/alpha', '/usr/../bin/alpha', '{programFiles}/alpha', '/opt/./alpha'])
      assert.equal(checkLocation(bad, 'linux', names), null, bad);
    assert.equal(checkLocation('C:/Outils/alpha.exe', 'windows', names), 'C:/Outils/alpha.exe');
    assert.equal(checkLocation('/opt/alpha/alpha', 'linux', names), '/opt/alpha/alpha');
  });

  it('options limitées à leur forme ; le reste est ignoré', () => {
    const p = readExternalPlayer(
      entry({
        ...ALPHA,
        options: { fullscreen: '--plein --autre', title: '--script=/tmp/x.lua', start: '--debut={title}', extra: '--x' },
      }),
    );
    assert.deepEqual(p?.options, {});
    const q = readExternalPlayer(entry({ ...ALPHA, options: { fullscreen: '-f', title: '--titre=x{title}', start: '--debut={start}' } }));
    assert.deepEqual(q?.options, { fullscreen: '-f', start: '--debut={start}' });
  });

  it('données mal formées : aucun lecteur ; noms bornés ; priorité hors bornes : 50', () => {
    for (const bad of [
      null,
      'alpha',
      [],
      { names: ['alpha'] },
      { kind: 'emulator', names: ['alpha'] },
      { kind: 'player', names: ['Alpha/..', ''] },
      { kind: 'player' },
    ])
      assert.equal(readExternalPlayer(entry(bad)), null, JSON.stringify(bad));
    assert.equal(readExternalPlayer(entry({ ...ALPHA, priority: 500 }))?.priority, 50);
    assert.deepEqual(readExternalPlayer(entry({ kind: 'player', names: ['a', 'b', 'c', 'd', 'e'] }))?.names, ['a', 'b', 'c', 'd']);
    // Sans emplacement valide : le lecteur reste, cherché par son nom.
    assert.deepEqual(readExternalPlayer(entry({ kind: 'player', names: ['alpha'], locations: { linux: ['/bin/sh'] } }))?.locations, {});
  });

  it('ordre de préférence : priorité, puis identifiant ; seulement les contributions `apps`', () => {
    const list = readExternalPlayers([
      entry({ kind: 'player', names: ['c'] }, 'org.c', 'c'),
      entry({ kind: 'player', names: ['b'], priority: 40 }, 'org.b', 'b'),
      entry({ kind: 'player', names: ['a'], priority: 40 }, 'org.a', 'a'),
      { ...entry({ kind: 'player', names: ['p'] }, 'org.p', 'p'), kind: 'gamepads' },
    ]);
    assert.deepEqual(
      list.map((p) => p.id),
      ['org.a/a', 'org.b/b', 'org.c/c'],
    );
  });
});

const root = mkdtempSync(path.join(os.tmpdir(), 'mire-apps-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** Plugin factice : un lecteur externe, données seules. */
function fakePlugin(dir: string, id: string) {
  const catalog = (code: string) =>
    JSON.stringify({ meta: { code, name: code, app: '1.0.0' }, messages: { plugin: { name: 'Essai' }, apps: { alpha: { name: 'Alpha' } } } });
  const files: Record<string, string> = {
    'mire-plugin.json': JSON.stringify({
      id,
      version: '1.0.0',
      engines: { mire: '^1.0.0' },
      level: 'data',
      contributes: { apps: [{ id: 'alpha', file: 'alpha.json' }] },
      i18n: 'i18n/',
    }),
    'alpha.json': JSON.stringify(ALPHA),
    'i18n/en.json': catalog('en'),
    'i18n/fr.json': catalog('fr'),
  };
  for (const [rel, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), c);
  }
}

function service(name: string) {
  const bundled = path.join(root, name, 'resources', 'plugins');
  const installed = path.join(root, name, 'userData', 'plugins');
  mkdirSync(bundled, { recursive: true });
  mkdirSync(installed, { recursive: true });
  const s = createPluginService({
    roots: { bundled, installed },
    appVersion: '1.0.0',
    languages: ['fr', 'en'],
    state: createPluginState(path.join(installed, 'state.json')),
    journal: createJournal({ dir: path.join(installed, 'logs') }),
    tagRegistry: createRegistry((k) => k),
    setTexts: () => {},
    translate: (k) => k,
    locale: () => 'fr',
    runners: () => ({
      isolated: () => Promise.reject(new Error('aucun code ici')),
      inProcess: () => Promise.reject(new Error('aucun code ici')),
      base: () => '',
      shutdown: () => {},
    }),
    onTaggersChange: () => {},
    refresh: () => {},
    watchdog: { interval: 0, timeout: 0 },
  });
  return { s, bundled, installed };
}

describe('lecteurs externes dans le service des plugins', () => {
  it('plugin inclus activé : son lecteur est lu ; désactivé : il disparaît et le changement est signalé', async () => {
    const { s, bundled } = service('inclus');
    fakePlugin(path.join(bundled, 'org.essai.lecteurs'), 'org.essai.lecteurs');
    const changes: string[][] = [];
    s.onContributionsChange((kinds) => changes.push(kinds));
    await s.start();
    assert.deepEqual(
      s.externalPlayers().map((p) => [p.id, p.names]),
      [['org.essai.lecteurs/alpha', ['alpha']]],
    );
    await s.setEnabled('org.essai.lecteurs', false);
    assert.deepEqual(s.externalPlayers(), []);
    assert.deepEqual(changes, [['apps'], ['apps']]);
    await s.stop();
  });

  it('plugin installé hors du dépôt officiel : actif, mais aucun lecteur', async () => {
    const { s, installed } = service('local');
    fakePlugin(path.join(installed, 'org.essai.local', '1.0.0'), 'org.essai.local');
    await s.start();
    await s.setEnabled('org.essai.local', true);
    assert.ok(s.list().some((p) => p.id === 'org.essai.local' && p.enabled));
    assert.deepEqual(s.externalPlayers(), []);
    await s.stop();
  });
});
