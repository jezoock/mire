// Profils de manettes des plugins (P5-04) : lecture des contributions `gamepads` par le cœur (données vérifiées et
// bornées, motif invalide ignoré), et prise en compte d'un plugin factice activé puis désactivé.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPattern, readGamepadProfile, readGamepadProfiles } from '../../src/main/plugins/gamepads.ts';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';
import { createJournal } from '../../src/main/plugins/journal.ts';
import { createPluginService } from '../../src/main/plugins/service.ts';
import { createPluginState } from '../../src/main/plugins/state.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';

const entry = (data: unknown, pluginId = 'org.essai.manettes', id = 'pad'): ContributionEntry => ({
  pluginId,
  kind: 'gamepads',
  id,
  declaration: { id, file: 'pad.json' },
  data,
});

describe('lecture des profils de manettes', () => {
  it('lit les motifs, la priorité, les libellés et le nom', () => {
    const p = readGamepadProfile(
      entry({ match: ['^alpha', '0aaa'], priority: 10, buttons: { a: '✕', lb: 'L1', select: { text: 'buttons.share' }, start: 'Go' } }),
    );
    assert.deepEqual(p, {
      id: 'org.essai.manettes/pad',
      name: 'pluginTexts.org_essai_manettes.gamepads.pad.name',
      match: ['^alpha', '0aaa'],
      priority: 10,
      // `start` n'a pas de libellé dans l'aide : ignoré.
      glyphs: { a: '✕', lb: 'L1', select: 'pluginTexts.org_essai_manettes.buttons.share' },
    });
  });

  it('motif invalide ou risqué ignoré, les autres restent', () => {
    for (const bad of ['(', '[z-a]', '(a+)+', '(a|b)*c', '(x)\\1', 'a'.repeat(65), '', 3, null]) assert.equal(checkPattern(bad), null, String(bad));
    assert.equal(checkPattern('^wireless controller'), '^wireless controller');
    assert.deepEqual(readGamepadProfile(entry({ match: ['(', 'beta', '(a+)+'] }))?.match, ['beta']);
    // Aucun motif valide : pas de profil.
    assert.equal(readGamepadProfile(entry({ match: ['('] })), null);
    // Nombre de motifs borné.
    const many = Array.from({ length: 40 }, (_, i) => `m${i}`);
    assert.equal(readGamepadProfile(entry({ match: many }))?.match.length, 16);
  });

  it('libellés : symbole court sans caractère de contrôle, ou clé de texte bien formée ; le reste est ignoré', () => {
    const p = readGamepadProfile(
      entry({
        match: ['x'],
        buttons: {
          a: '<b>A</b>',
          b: 'B\u0000',
          x: { text: '../../etc' },
          y: { text: 'buttons.y' },
          lb: '  L  ',
          rb: 'shell.pad.open',
          lt: ['LT'],
        },
      }),
    );
    assert.deepEqual(p?.glyphs, { y: 'pluginTexts.org_essai_manettes.buttons.y', lb: 'L' });
  });

  it('données mal formées : aucun profil ; priorité hors bornes : 50', () => {
    for (const bad of [null, 'xbox', [], { match: 'xbox' }, { buttons: {} }]) assert.equal(readGamepadProfile(entry(bad)), null);
    assert.equal(readGamepadProfile(entry({ match: ['x'], priority: 500 }))?.priority, 50);
    assert.equal(readGamepadProfile(entry({ match: ['x'], priority: 1.5 }))?.priority, 50);
  });

  it("ordre d'essai : priorité, puis identifiant ; seulement les contributions `gamepads`", () => {
    const list = readGamepadProfiles([
      entry({ match: ['c'] }, 'org.c', 'c'),
      entry({ match: ['b'], priority: 40 }, 'org.b', 'b'),
      entry({ match: ['a'], priority: 40 }, 'org.a', 'a'),
      { ...entry({ match: ['p'] }, 'org.p', 'p'), kind: 'palettes' },
    ]);
    assert.deepEqual(
      list.map((p) => p.id),
      ['org.a/a', 'org.b/b', 'org.c/c'],
    );
  });
});

const root = mkdtempSync(path.join(os.tmpdir(), 'mire-gamepads-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** Plugin inclus factice : une famille de manettes, données seules. */
function fakePlugin(dir: string) {
  const catalog = (code: string) =>
    JSON.stringify({ meta: { code, name: code, app: '1.0.0' }, messages: { plugin: { name: 'Essai' }, gamepads: { pad: { name: 'Alpha' } } } });
  const files: Record<string, string> = {
    'mire-plugin.json': JSON.stringify({
      id: 'org.essai.manettes',
      version: '1.0.0',
      engines: { mire: '^1.0.0' },
      level: 'data',
      contributes: { gamepads: [{ id: 'pad', file: 'pad.json' }] },
      i18n: 'i18n/',
    }),
    'pad.json': JSON.stringify({ match: ['^alpha', '('], buttons: { a: '✕' } }),
    'i18n/en.json': catalog('en'),
    'i18n/fr.json': catalog('fr'),
  };
  for (const [rel, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), c);
  }
}

describe('profils de manettes dans le service des plugins', () => {
  it('plugin activé : son profil est lu ; désactivé : il disparaît et le changement est signalé', async () => {
    const bundled = path.join(root, 'resources', 'plugins');
    const installed = path.join(root, 'userData', 'plugins');
    mkdirSync(installed, { recursive: true });
    fakePlugin(path.join(bundled, 'org.essai.manettes'));
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
    const changes: string[][] = [];
    s.onContributionsChange((kinds) => changes.push(kinds));
    await s.start();
    assert.deepEqual(s.gamepadProfiles(), [
      { id: 'org.essai.manettes/pad', name: 'pluginTexts.org_essai_manettes.gamepads.pad.name', match: ['^alpha'], priority: 50, glyphs: { a: '✕' } },
    ]);
    await s.setEnabled('org.essai.manettes', false);
    assert.deepEqual(s.gamepadProfiles(), []);
    assert.deepEqual(changes, [['gamepads'], ['gamepads']]);
    await s.stop();
  });
});
