// Plugins inclus (P3-05) : chaque dossier de plugins/ (copié dans resources/plugins/ par `npm run build`, emporté
// par l'installateur) est un plugin officiel valide, de la version de Mire, avec ses textes en français et en anglais.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePluginDir } from '../../packages/plugin-sdk/src/validate-dir.ts';
import { satisfies } from '../../src/main/plugins/semver.ts';
import { checkPlugin, discoverPlugins } from '../../src/main/plugins/discovery.ts';
import { readGamepadProfiles } from '../../src/main/plugins/gamepads.ts';
import { readExternalPlayers } from '../../src/main/plugins/apps.ts';
import { playerArgs } from '../../src/main/platform/index.ts';
import { contributionEntries } from '../../src/main/plugins/registry.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGINS = path.join(ROOT, 'plugins');
const appVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const ids = readdirSync(PLUGINS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

describe('plugins inclus (sources)', () => {
  it('il y en a au moins un (le plugin d’exemple)', () => {
    assert.ok(ids.includes('mire.exemple.inclus'));
  });

  for (const id of ids) {
    it(`${id} est valide, compatible et traduit`, async () => {
      const dir = path.join(PLUGINS, id);
      const r = await validatePluginDir(dir, { official: true });
      assert.deepEqual(r.ok ? [] : r.issues, []);
      const m = JSON.parse(readFileSync(path.join(dir, 'mire-plugin.json'), 'utf8'));
      assert.equal(m.id, id);
      assert.ok(satisfies(appVersion, m.engines.mire), `${m.engines.mire} / ${appVersion}`);
      for (const lang of ['fr', 'en']) assert.ok(readdirSync(path.join(dir, m.i18n)).includes(`${lang}.json`), lang);
    });
  }
});

// Copie de mire-addons (`scripts/bundle-plugin.mjs`, P5-04) : chaque dossier est accepté par la découverte du cœur,
// sans refus, comme le sera resources/plugins/ construit à partir de lui.
describe('plugins inclus (découverte)', () => {
  it('chaque dossier est découvert et vérifié sans refus', async () => {
    const found = discoverPlugins({ bundled: PLUGINS, installed: path.join(PLUGINS, '.aucun') });
    assert.deepEqual(found.skipped, []);
    assert.deepEqual(found.candidates.map((c) => c.id).sort(), [...ids].sort());
    for (const c of found.candidates) {
      const r = await checkPlugin(c, { appVersion, languages: ['fr', 'en'] });
      assert.deepEqual(r.ok ? null : r.refusal, null, c.id);
    }
  });

  it('les trois profils de manettes donnent chacun un profil lisible par le cœur', async () => {
    const families = ['xbox', 'playstation', 'nintendo'];
    const entries = [];
    for (const f of families) {
      const [c] = discoverPlugins({ bundled: PLUGINS, installed: path.join(PLUGINS, '.aucun') }).candidates.filter((x) => x.id === `mire.gamepad.${f}`);
      assert.ok(c, f);
      const r = await checkPlugin(c, { appVersion, languages: ['fr', 'en'] });
      assert.ok(r.ok, f);
      entries.push(...contributionEntries(r.plugin.manifest, r.plugin.dir, r.plugin.data, path.join));
    }
    const profiles = readGamepadProfiles(entries);
    assert.deepEqual(
      profiles.map((p) => [p.id, Object.keys(p.glyphs).length]),
      families.map((f) => [`mire.gamepad.${f}/${f}`, 9]),
    );
  });

  // P5-20 : le plugin inclus des lecteurs externes donne mpv puis VLC, complets, avec les arguments d'avant le plugin.
  it('les lecteurs mpv et VLC sont lisibles par le cœur, complets, avec les mêmes arguments qu’avant', async () => {
    const [c] = discoverPlugins({ bundled: PLUGINS, installed: path.join(PLUGINS, '.aucun') }).candidates.filter((x) => x.id === 'mire.players.external');
    assert.ok(c);
    const r = await checkPlugin(c, { appVersion, languages: ['fr', 'en'] });
    assert.ok(r.ok);
    const players = readExternalPlayers(contributionEntries(r.plugin.manifest, r.plugin.dir, r.plugin.data, path.join));
    assert.deepEqual(
      players.map((p) => [p.id, p.names, Object.keys(p.locations), Object.keys(p.options)]),
      ['mpv', 'vlc'].map((f) => [`mire.players.external/${f}`, [f], ['win32', 'darwin', 'linux'], ['fullscreen', 'title', 'start']]),
    );
    const [mpv, vlc] = players;
    assert.deepEqual(mpv.locations.win32?.length, 3);
    assert.deepEqual(playerArgs(mpv, { url: '/films/a.avi', title: 'Film', start: 754.9 }), [
      '--fs',
      '--force-media-title=Film',
      '--start=754',
      '/films/a.avi',
    ]);
    assert.deepEqual(playerArgs(vlc, { url: '/films/a.avi', title: 'Film', start: 90 }), [
      '--fullscreen',
      '--meta-title=Film',
      '--start-time=90',
      '/films/a.avi',
    ]);
  });
});
