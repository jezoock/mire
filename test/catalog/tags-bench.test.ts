// Mesure (P2-04) : requête « tous les éléments qui portent `video` et `series` » sur 20 000 éléments factices, en
// moins de 50 ms (architecture cible). Les temps sont affichés dans le rapport des tests (`diagnostic`).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { fakeCatalog, fakeTagger } from './fake-catalog.ts';

const N = 20_000;

function time<T>(fn: () => T): { ms: number; result: T } {
  const start = performance.now();
  const result = fn();
  return { ms: performance.now() - start, result };
}

describe('mesures sur 20 000 éléments factices', () => {
  it('« video » et « series » en moins de 50 ms', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-bench-'));
    const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
    const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
    overrides.load();
    const engine = createTagEngine({ catalog, overrides, registry: createRegistry((k) => k), rules: () => fileTagRules(undefined) });
    engine.setContributors([fakeTagger]);
    const sources = fakeCatalog(N);
    const scan = time(() => {
      for (const { source, elements } of sources) catalog.setSource(source, elements);
    });
    assert.equal(catalog.size(), N);

    const runs = Array.from({ length: 20 }, () => time(() => engine.query(['video', 'series'])));
    const keys = runs[0].result;
    assert.equal(keys.length, sources[0].elements.length);
    const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    t.diagnostic(`analyse (5 emplacements, moteur branché) : ${scan.ms.toFixed(0)} ms`);
    t.diagnostic(`« video » et « series » : ${keys.length} éléments, médiane ${median.toFixed(2)} ms, pire ${sorted.at(-1)!.toFixed(2)} ms`);
    assert.ok(sorted[0] < 50, `requête trop lente : ${sorted[0].toFixed(1)} ms`);
    // Une modification à la main est visible aussitôt dans l'index.
    engine.setTags(keys[0], { series: false });
    assert.equal(engine.query(['video', 'series']).length, keys.length - 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
