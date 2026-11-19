// Découverte et vérification des plugins : racines, versions, liens symboliques, manifeste, engines.mire, niveau.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPlugin, discoverPlugins, type CheckResult } from '../../src/main/plugins/discovery.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'mire-discovery-'));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;

const catalog = (code: string, messages: Record<string, unknown>) => ({ meta: { code, name: code, app: '1.0.0' }, messages });
const EN = { plugin: { name: 'Years' }, tags: { dated: 'Dated' }, infos: { decade: 'Decade' } };

function manifest(patch: Record<string, unknown> = {}) {
  return {
    id: 'org.exemple.annees',
    version: '1.0.0',
    engines: { mire: '^1.0.0' },
    level: 'code',
    contributes: { taggers: [{ id: 'annee', main: 'tags.js', tags: ['dated'], infos: { decade: { type: 'number' } } }] },
    i18n: 'i18n/',
    ...patch,
  };
}

/** Écrit un dossier de plugin ; `files` : contenu par chemin (objet → JSON). */
function write(dir: string, files: Record<string, unknown>) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  }
}
const codePlugin = (m = manifest()) => ({
  'mire-plugin.json': m,
  'tags.js': 'export default () => ({ id: "annee", compute: () => null });',
  'i18n/en.json': catalog('en', EN),
  'i18n/fr.json': catalog('fr', { plugin: { name: 'Années' } }),
});

function roots() {
  const base = path.join(root, `r${++n}`);
  const installed = path.join(base, 'userData', 'plugins');
  const bundled = path.join(base, 'resources', 'plugins');
  mkdirSync(installed, { recursive: true });
  mkdirSync(bundled, { recursive: true });
  return { base, installed, bundled };
}

const check = (c: Parameters<typeof checkPlugin>[0], appVersion = '1.0.0') => checkPlugin(c, { appVersion, languages: ['fr', 'en'] });
const refused = (r: CheckResult) => (r.ok ? null : r.refusal.code);

describe('découverte', () => {
  it('trouve les plugins installés (version la plus haute) et inclus, ignore le reste', () => {
    const r = roots();
    write(path.join(r.installed, 'org.exemple.annees', '1.0.0'), codePlugin());
    write(path.join(r.installed, 'org.exemple.annees', '1.10.0'), codePlugin(manifest({ version: '1.10.0' })));
    write(path.join(r.installed, 'org.exemple.annees', 'brouillon'), codePlugin());
    write(path.join(r.installed, 'Pas-Un-Id', '1.0.0'), codePlugin());
    write(path.join(r.bundled, 'mire.exemple'), codePlugin(manifest({ id: 'mire.exemple' })));
    const d = discoverPlugins(r);
    assert.deepEqual(
      d.candidates.map((c) => [c.id, c.version, c.origin]),
      [
        ['mire.exemple', null, 'bundled'],
        ['org.exemple.annees', '1.10.0', 'installed'],
      ],
    );
    assert.deepEqual(d.skipped, []);
  });

  it('écarte un dossier dont le chemin réel sort de sa racine (lien symbolique)', () => {
    const r = roots();
    const outside = path.join(r.base, 'ailleurs');
    write(outside, codePlugin());
    mkdirSync(path.join(r.installed, 'org.exemple.annees'));
    symlinkSync(outside, path.join(r.installed, 'org.exemple.annees', '1.0.0'));
    const d = discoverPlugins(r);
    assert.deepEqual(d.candidates, []);
    assert.equal(d.skipped[0].refusal.code, 'outside');
  });

  it('sans dossier de plugins : rien', () => {
    assert.deepEqual(discoverPlugins({ bundled: null, installed: path.join(root, 'absent') }), { candidates: [], skipped: [] });
  });
});

describe('vérification', () => {
  const candidate = (
    files: Record<string, unknown>,
    origin: 'installed' | 'bundled' = 'installed',
    id = 'org.exemple.annees',
    version: string | null = '1.0.0',
  ) => {
    const dir = path.join(root, `p${++n}`);
    write(dir, files);
    return { id, version: origin === 'bundled' ? null : version, origin, dir, repository: null as string | null };
  };

  it('accepte un plugin de code et lit ses textes', async () => {
    const r = await check(candidate(codePlugin()));
    assert.ok(r.ok);
    assert.equal(r.plugin.manifest.level, 'code');
    assert.deepEqual(Object.keys(r.plugin.texts).sort(), ['en', 'fr']);
    assert.equal((r.plugin.texts.en.tags as Record<string, string>).dated, 'Dated');
  });

  it('accepte un plugin de données et lit ses fichiers JSON', async () => {
    const m = manifest({ id: 'org.exemple.couleurs', level: 'data', contributes: { palettes: [{ id: 'nuit', file: 'nuit.json' }] } });
    const r = await check(
      candidate(
        { 'mire-plugin.json': m, 'nuit.json': { accent: '#123456' }, 'i18n/en.json': catalog('en', { plugin: { name: 'Colours' } }) },
        'installed',
        'org.exemple.couleurs',
      ),
    );
    assert.ok(r.ok);
    assert.deepEqual(r.plugin.data.get('palettes/nuit'), { accent: '#123456' });
  });

  it('refuse un manifeste invalide, un identifiant ou une version qui ne correspondent pas au dossier', async () => {
    assert.equal(refused(await check(candidate({ 'mire-plugin.json': { id: 'x' } }))), 'invalid');
    assert.equal(refused(await check(candidate(codePlugin(), 'installed', 'org.exemple.autre'))), 'mismatch');
    assert.equal(refused(await check(candidate(codePlugin(), 'installed', 'org.exemple.annees', '2.0.0'))), 'mismatch');
  });

  it('refuse un plugin fait pour une autre version de Mire (engines.mire)', async () => {
    const r = await check(candidate(codePlugin(manifest({ engines: { mire: '^2.0.0' } }))), '1.0.0');
    assert.ok(!r.ok);
    assert.deepEqual(r.refusal, { code: 'engine', vars: { range: '^2.0.0', version: '1.0.0' } });
  });

  it('refuse un niveau qui ne correspond pas au contenu', async () => {
    // « data » avec un fichier de code.
    const data = manifest({ level: 'data', contributes: { palettes: [{ id: 'nuit', file: 'nuit.json' }] } });
    assert.equal(
      refused(
        await check(candidate({ 'mire-plugin.json': data, 'nuit.json': {}, 'cache/x.mjs': '', 'i18n/en.json': catalog('en', { plugin: { name: 'P' } }) })),
      ),
      'level',
    );
    // « code » sans aucune contribution de code.
    const code = manifest({ contributes: { palettes: [{ id: 'nuit', file: 'nuit.json' }] } });
    assert.equal(
      refused(await check(candidate({ 'mire-plugin.json': code, 'nuit.json': {}, 'i18n/en.json': catalog('en', { plugin: { name: 'P' } }) }))),
      'level',
    );
    // « data » qui déclare du code : refusé par le validateur du SDK.
    assert.equal(refused(await check(candidate(codePlugin(manifest({ level: 'data' }))))), 'invalid');
  });

  it('refuse un plugin privileged installé, l’accepte inclus', async () => {
    const m = manifest({ id: 'mire.web.bloqueur', level: 'privileged', contributes: { webExtensions: [{ id: 'bloqueur', main: 'ext.js' }] } });
    const files = {
      'mire-plugin.json': m,
      'ext.js': '',
      'i18n/en.json': catalog('en', { plugin: { name: 'B' } }),
      'i18n/fr.json': catalog('fr', { plugin: { name: 'B' } }),
    };
    const installed = { ...files, 'mire-plugin.json': { ...m, id: 'org.exemple.bloqueur' } };
    assert.equal(refused(await check(candidate(installed, 'installed', 'org.exemple.bloqueur'))), 'privileged');
    assert.ok((await check(candidate(files, 'bundled', 'mire.web.bloqueur'))).ok);
  });

  it('refuse un lien symbolique qui sort du dossier, ou un fichier de données illisible', async () => {
    const c = candidate(codePlugin());
    writeFileSync(path.join(root, 'secret.txt'), 'secret');
    symlinkSync(path.join(root, 'secret.txt'), path.join(c.dir, 'lien.txt'));
    assert.equal(refused(await check(c)), 'outside');
    const m = manifest({ id: 'org.exemple.couleurs', level: 'data', contributes: { palettes: [{ id: 'nuit', file: 'nuit.json' }] } });
    const bad = candidate(
      { 'mire-plugin.json': m, 'nuit.json': '{ pas du json', 'i18n/en.json': catalog('en', { plugin: { name: 'C' } }) },
      'installed',
      'org.exemple.couleurs',
    );
    assert.equal(refused(await check(bad)), 'data');
  });
});
