// Plugins inclus (P3-05) : chaque dossier de plugins/ (copié dans resources/plugins/ par `npm run build`, emporté
// par l'installateur) est un plugin officiel valide, de la version de Mire, avec ses textes en français et en anglais.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePluginDir } from '../../packages/plugin-sdk/src/validate-dir.ts';
import { satisfies } from '../../src/main/plugins/semver.ts';

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
