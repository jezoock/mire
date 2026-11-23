// Palettes des plugins (P5-02) : lecture des contributions `palettes` par le cœur (jetons vérifiés et bornés, palette
// du cœur non remplaçable), et prise en compte d'un plugin factice activé puis désactivé.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PALETTE_TOKENS, checkPaletteToken, parsePaletteData } from '@mire/shared';
import { readPluginPalette, readPluginPalettes } from '../../src/main/plugins/palettes.ts';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';
import { createJournal } from '../../src/main/plugins/journal.ts';
import { createPluginService } from '../../src/main/plugins/service.ts';
import { createPluginState } from '../../src/main/plugins/state.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';

/** Jetons obligatoires valides : tous en couleur, sauf `ring-mix`. */
const TOKENS: Record<string, string> = Object.fromEntries(PALETTE_TOKENS.map((t) => [t, t === 'ring-mix' ? '80%' : '#102030']));

const entry = (data: unknown, pluginId = 'org.essai.palettes', id = 'sable'): ContributionEntry => ({
  pluginId,
  kind: 'palettes',
  id,
  declaration: { id, file: `palettes/${id}.json` },
  data,
});

describe('jetons de palette', () => {
  it('couleur #rrggbb, pourcentage de 0 à 100, longueur de 0 à 8 px', () => {
    assert.equal(checkPaletteToken('bg', '#A1B2C3'), '#a1b2c3');
    assert.equal(checkPaletteToken('ring-from', '#ffe600'), '#ffe600');
    assert.equal(checkPaletteToken('ring-mix', '0%'), '0%');
    assert.equal(checkPaletteToken('mono-mix', '100%'), '100%');
    assert.equal(checkPaletteToken('ring-w', '8px'), '8px');
    assert.equal(checkPaletteToken('mire-edge', '0px'), '0px');
  });

  it('refuse toute autre valeur : CSS, url(), expressions, hors bornes, jeton inconnu', () => {
    const bad: [string, unknown][] = [
      ['bg', 'red'],
      ['bg', '#fff'],
      ['bg', '#1020304'],
      ['bg', '#102030; background: url(https://x)'],
      ['bg', 'url(https://exemple.org/a.png)'],
      ['bg', 'var(--text)'],
      ['bg', '#102030 !important'],
      ['bg', 3],
      ['ring-mix', '101%'],
      ['ring-mix', '50'],
      ['ring-mix', 'calc(50%)'],
      ['ring-w', '9px'],
      ['ring-w', '3em'],
      ['ring-w', '-1px'],
      ['mire-edge', '1.5px'],
      ['font-family', 'serif'],
      ['__proto__', '#102030'],
    ];
    for (const [name, value] of bad) assert.equal(checkPaletteToken(name, value), null, `${name}: ${String(value)}`);
  });

  it('palette complète : mode et jetons ; facultatif invalide ou inconnu ignoré', () => {
    const p = parsePaletteData({ scheme: 'light', tokens: { ...TOKENS, 'ring-w': '4px', 'mono-mix': '200%', autre: '#000000' }, extra: 1 });
    assert.deepEqual(p, { scheme: 'light', tokens: { ...TOKENS, 'ring-w': '4px' } });
  });

  it('jeton obligatoire absent ou invalide, mode inconnu, forme inattendue : pas de palette', () => {
    const { bg: _bg, ...noBg } = TOKENS;
    for (const bad of [
      null,
      'x',
      [],
      { scheme: 'light' },
      { scheme: 'gris', tokens: TOKENS },
      { scheme: 'dark', tokens: noBg },
      { scheme: 'dark', tokens: { ...TOKENS, text: 'black' } },
      { scheme: 'dark', tokens: [TOKENS] },
    ]) {
      assert.equal(parsePaletteData(bad), null, JSON.stringify(bad));
    }
  });
});

describe('lecture des palettes des plugins', () => {
  it('identifiant de la contribution, nom tiré des textes du plugin, fond = jeton bg', () => {
    assert.deepEqual(readPluginPalette(entry({ scheme: 'dark', tokens: TOKENS })), {
      id: 'sable',
      plugin: 'org.essai.palettes',
      name: 'pluginTexts.org_essai_palettes.palettes.sable.name',
      scheme: 'dark',
      background: '#102030',
      tokens: TOKENS,
    });
  });

  it('refusée : identifiant invalide, palette du cœur, données invalides, autre nature', () => {
    const ok = { scheme: 'dark', tokens: TOKENS };
    assert.equal(readPluginPalette(entry(ok, 'org.x', 'Sable')), null);
    assert.equal(readPluginPalette(entry(ok, 'org.x', 'ecran')), null);
    assert.equal(readPluginPalette(entry(ok, 'org.x', 'contraste')), null);
    assert.equal(readPluginPalette(entry({ scheme: 'dark' })), null);
    assert.equal(readPluginPalette({ ...entry(ok), kind: 'gamepads' }), null);
  });

  it('même identifiant dans deux plugins : le premier activé l’emporte', () => {
    const list = readPluginPalettes([
      entry({ scheme: 'dark', tokens: TOKENS }, 'org.a', 'sable'),
      entry({ scheme: 'light', tokens: TOKENS }, 'org.b', 'sable'),
      entry({ scheme: 'light', tokens: TOKENS }, 'org.b', 'dune'),
    ]);
    assert.deepEqual(
      list.map((p) => [p.plugin, p.id]),
      [
        ['org.a', 'sable'],
        ['org.b', 'dune'],
      ],
    );
  });
});

const root = mkdtempSync(path.join(os.tmpdir(), 'mire-palettes-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** Plugin factice (inclus, donc actif d'office) : une palette, données seules. */
function fakePlugin(dir: string) {
  const catalog = (code: string) =>
    JSON.stringify({ meta: { code, name: code, app: '1.0.0' }, messages: { plugin: { name: 'Essai' }, palettes: { sable: { name: 'Sable' } } } });
  const files: Record<string, string> = {
    'mire-plugin.json': JSON.stringify({
      id: 'org.essai.palettes',
      version: '1.0.0',
      engines: { mire: '^1.0.0' },
      level: 'data',
      contributes: { palettes: [{ id: 'sable', file: 'palettes/sable.json' }] },
      i18n: 'i18n/',
    }),
    'palettes/sable.json': JSON.stringify({ scheme: 'light', tokens: TOKENS }),
    'i18n/en.json': catalog('en'),
    'i18n/fr.json': catalog('fr'),
  };
  for (const [rel, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), c);
  }
}

describe('palettes dans le service des plugins', () => {
  it('avant le démarrage : pas prêtes ; plugin activé : sa palette ; désactivé : elle disparaît, changement signalé', async () => {
    const bundled = path.join(root, 'resources', 'plugins');
    const installed = path.join(root, 'userData', 'plugins');
    mkdirSync(installed, { recursive: true });
    fakePlugin(path.join(bundled, 'org.essai.palettes'));
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
    assert.deepEqual(s.palettes(), { ready: false, palettes: [] });
    const changes: string[][] = [];
    s.onContributionsChange((kinds) => changes.push(kinds));
    await s.start();
    const { ready, palettes } = s.palettes();
    assert.equal(ready, true);
    assert.deepEqual(
      palettes.map((p) => [p.id, p.plugin, p.scheme, p.background]),
      [['sable', 'org.essai.palettes', 'light', '#102030']],
    );
    await s.setEnabled('org.essai.palettes', false);
    assert.deepEqual(s.palettes(), { ready: true, palettes: [] });
    assert.deepEqual(changes, [['palettes'], ['palettes']]);
    await s.stop();
  });
});
