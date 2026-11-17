// L'archive de @mire/plugin-sdk (`npm pack`) se suffit à elle-même : installée dans un dossier vide, ses types se
// compilent (sans skipLibCheck) et son outil `mire-plugin` tourne. C'est ainsi que jezoock/mire-addons la consommera.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'mire-sdk-pack-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const npm = (args: string[], cwd: string): string =>
  execFileSync('npm', [...args, '--no-audit', '--no-fund', '--loglevel=error'], { cwd, encoding: 'utf8', stdio: 'pipe', shell: process.platform === 'win32' });

const CONSUMER = `
import { CONTRIBUTION_KINDS, formatTarget, validateManifest, type ElementSource, type MetadataProvider, type PluginContext,
  type PluginManifest, type Tagger, type Target, type WebExtension } from '@mire/plugin-sdk';
import { validatePluginDir } from '@mire/plugin-sdk/validate';

export const tagger: Tagger = { id: 'x', compute: (e) => (e.open.kind === 'file' ? { tags: ['x'], infos: { n: 1 } } : null) };
export const source: ElementSource<string> = { id: 's', tags: [], handles: () => true, instance: (l) => l, scan: async () => [] };
export const fetchIt = (ctx: PluginContext) => ctx.http.getJson<{ a: number }>('https://api.exemple.org/');
export type Providers = [MetadataProvider, WebExtension];
const target: Target = { kind: 'page', id: 'movies' };
const manifest: PluginManifest = { id: 'org.a.b', version: '1.0.0', engines: { mire: '^1.0.0' }, level: 'data', contributes: {}, i18n: 'i18n/' };
export const checks = [CONTRIBUTION_KINDS.length, formatTarget(target), validateManifest(manifest).ok, validatePluginDir('.')];
`;

describe('archive de @mire/plugin-sdk', () => {
  it('s’installe dans un dossier vide, ses types se compilent et son outil tourne', { timeout: 120_000 }, () => {
    npm(['pack', '-w', '@mire/plugin-sdk', '--pack-destination', tmp], ROOT);
    const tgz = readdirSync(tmp).find((f) => f.endsWith('.tgz'));
    assert.ok(tgz, 'archive produite');
    const app = path.join(tmp, 'app');
    mkdirSync(app);
    writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'app', private: true, type: 'module' }));
    npm(['install', '--offline', path.join(tmp, tgz)], app);
    writeFileSync(path.join(app, 'index.ts'), CONSUMER);
    const tsconfig = { module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022', strict: true, noEmit: true, types: [], skipLibCheck: false };
    writeFileSync(path.join(app, 'tsconfig.json'), JSON.stringify({ compilerOptions: tsconfig, include: ['index.ts'] }));
    execFileSync(process.execPath, [TSC, '-p', app], { encoding: 'utf8', stdio: 'pipe' });

    writeFileSync(
      path.join(app, 'mire-plugin.json'),
      JSON.stringify({
        id: 'org.a.b',
        version: '1.0.0',
        engines: { mire: '^1.0.0' },
        level: 'data',
        contributes: { palettes: [{ id: 'p', file: 'p.json' }] },
        i18n: 'i18n',
      }),
    );
    writeFileSync(path.join(app, 'p.json'), '{}');
    mkdirSync(path.join(app, 'i18n'));
    writeFileSync(
      path.join(app, 'i18n', 'en.json'),
      JSON.stringify({ meta: { code: 'en', name: 'English', app: '1.0.0' }, messages: { plugin: { name: 'B' } } }),
    );
    const bin = path.join(app, 'node_modules', '@mire', 'plugin-sdk', 'dist', 'cli.js');
    assert.match(execFileSync(process.execPath, [bin, 'validate', app], { encoding: 'utf8' }), /valide/);
  });
});
