// Validation d'un dossier de plugin (@mire/plugin-sdk) et outil `mire-plugin validate` : fichiers déclarés, textes.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePluginDir } from '../../packages/plugin-sdk/src/validate-dir.ts';

const CLI = fileURLToPath(new URL('../../packages/plugin-sdk/src/cli.ts', import.meta.url));
const root = mkdtempSync(path.join(os.tmpdir(), 'mire-plugin-'));
after(() => rmSync(root, { recursive: true, force: true }));

const manifest = (patch: Record<string, unknown> = {}) => ({
  id: 'org.exemple.series',
  version: '1.0.0',
  engines: { mire: '^1.0.0' },
  level: 'code',
  contributes: { taggers: [{ id: 'series', main: 'index.js', tags: ['anime'] }], pages: [{ id: 'animes', file: 'pages/animes.json' }] },
  settings: [{ key: 'strict', type: 'toggle', default: false }],
  i18n: 'i18n/',
  ...patch,
});

const catalog = (code: string, messages: Record<string, unknown>) => ({ meta: { code, name: code, app: '1.0.0' }, messages });
const EN = { plugin: { name: 'Series' }, tags: { anime: 'Anime' }, settings: { strict: { label: 'Strict' } } };

let n = 0;
/** Crée un dossier de plugin : `files` donne le contenu de chaque fichier (objet → JSON). */
function plugin(files: Record<string, unknown>): string {
  const dir = path.join(root, String(n++));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const complete = (patch: Record<string, unknown> = {}) => ({
  'mire-plugin.json': manifest(),
  'index.js': 'export default () => ({});',
  'pages/animes.json': {},
  'i18n/en.json': catalog('en', EN),
  ...patch,
});

const codes = async (dir: string, official = false) => (await validatePluginDir(dir, { official })).issues.map((i) => `${i.code} ${i.path}`);

describe('dossier de plugin', () => {
  it('accepte un plugin complet', async () => {
    assert.deepEqual(await codes(plugin(complete())), []);
  });

  it('signale un manifeste absent ou illisible', async () => {
    assert.deepEqual(await codes(plugin({ 'index.js': '' })), ['missing-manifest mire-plugin.json']);
    assert.deepEqual(await codes(plugin({ 'mire-plugin.json': '{ "id": ' })), ['invalid-json mire-plugin.json']);
  });

  it('s’arrête au manifeste invalide', async () => {
    const dir = plugin(complete({ 'mire-plugin.json': manifest({ level: 'data' }) }));
    assert.deepEqual(await codes(dir), ['code-in-data contributes.taggers[0]']);
  });

  it('signale un fichier déclaré absent', async () => {
    const files: Record<string, unknown> = complete();
    delete files['pages/animes.json'];
    assert.deepEqual(await codes(plugin(files)), ['missing-file contributes.pages[0].file']);
  });

  it('exige les textes anglais', async () => {
    const files: Record<string, unknown> = complete();
    delete files['i18n/en.json'];
    assert.deepEqual(await codes(plugin(files)), ['missing-catalog i18n/en.json']);
    const partial = plugin(complete({ 'i18n/en.json': catalog('en', { plugin: { name: 'Series' }, tags: { anime: ' ' } }) }));
    assert.deepEqual(await codes(partial), ['missing-text i18n/en.json#messages.tags.anime', 'missing-text i18n/en.json#messages.settings.strict.label']);
    const wrongCode = plugin(complete({ 'i18n/en.json': catalog('fr', EN) }));
    assert.deepEqual(await codes(wrongCode), ['invalid-catalog i18n/en.json#meta.code']);
  });

  it('exige aussi les textes français pour le dépôt officiel', async () => {
    const dir = plugin(complete({ 'mire-plugin.json': manifest({ id: 'mire.series' }) }));
    assert.deepEqual(await codes(dir), ['reserved-prefix id']);
    assert.deepEqual(await codes(dir, true), ['missing-catalog i18n/fr.json']);
    writeFileSync(path.join(dir, 'i18n/fr.json'), JSON.stringify(catalog('fr', EN)));
    assert.deepEqual(await codes(dir, true), []);
  });
});

describe('mire-plugin validate', () => {
  const run = (...args: string[]): { status: number; out: string } => {
    try {
      return { status: 0, out: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' }) };
    } catch (err) {
      const e = err as { status: number; stderr: string };
      return { status: e.status, out: e.stderr };
    }
  };

  it('rend 0 pour un plugin valide, 1 sinon, 2 pour une commande mal écrite', () => {
    assert.equal(run('validate', plugin(complete())).status, 0);
    const bad = run('validate', plugin(complete({ 'mire-plugin.json': manifest({ id: 'mire.series' }) })));
    assert.equal(bad.status, 1);
    assert.match(bad.out, /reserved-prefix/);
    assert.equal(run('validate', plugin(complete({ 'mire-plugin.json': manifest({ id: 'mire.series' }) })), '--official').status, 1);
    assert.equal(run('check', '.').status, 2);
    assert.equal(run('validate', '.', '--strict').status, 2);
  });
});
