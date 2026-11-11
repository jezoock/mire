// État de l'interface (P1-22) : chaque champ de S lu ou écrit par l'interface est déclaré dans state/,
// et aucun fichier de l'interface n'accède à window.api en dehors de api/.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { I, PAGE, Q, S, V } from '../../src/renderer/state/index.ts';

const RENDERER = path.join(import.meta.dirname, '..', '..', 'src', 'renderer');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(?:js|ts)$/.test(e.name) ? [p] : [];
  });
}

const used = (name: string) => {
  const re = new RegExp(`\\b${name}\\.([A-Za-z_]\\w*)`, 'g');
  const fields = new Set<string>();
  for (const file of sources(RENDERER)) {
    if (file.startsWith(path.join(RENDERER, 'state'))) continue;
    for (const m of fs.readFileSync(file, 'utf8').matchAll(re)) fields.add(m[1] as string);
  }
  return [...fields];
};

describe('state', () => {
  it('S, Q, V et I déclarent tous les champs utilisés par l’interface', () => {
    for (const [name, obj] of Object.entries({ S, Q, V, I })) {
      const missing = used(name).filter((f) => !Object.hasOwn(obj, f));
      assert.deepEqual(missing, [], `champs de ${name} non déclarés`);
    }
  });

  it('valeurs de départ', () => {
    assert.equal(S.section, 'home');
    assert.equal(S.limit, PAGE);
    assert.deepEqual(S.usage, { recent: [], volume: 0.9, queries: [] });
    assert.deepEqual(S.romsWarnings, []);
    assert.equal(S.focusRef, null);
    assert.equal(S.scrapeQuiet, false);
    assert.ok(S.raPick instanceof Set);
    assert.deepEqual(Q, { list: [], i: -1 });
    assert.equal(V.i, -1);
    assert.equal(I.i, 0);
  });
});

describe('api', () => {
  it('window.api n’est lu que dans api/', () => {
    const outside = sources(RENDERER).filter(
      (f) => !f.startsWith(path.join(RENDERER, 'api') + path.sep) && /window\s*(?:\.\s*api\b|\[\s*['"`]api)/.test(fs.readFileSync(f, 'utf8')),
    );
    assert.deepEqual(outside, []);
  });
});
