// Mesures (P2-04, P2-05) sur 20 000 éléments factices : coût des cinq tags automatiques internes (premier calcul et
// analyse répétée), et requête « tous les éléments qui portent `video` et `series` » en moins de 50 ms (architecture
// cible). Les temps sont affichés dans le rapport des tests (`diagnostic`).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createTagEngine, type Contributor } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { builtinTaggers, taggerContributor } from '../../src/main/catalog/tags/taggers.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import { fakeCatalog } from './fake-catalog.ts';

const N = 20_000;

function time<T>(fn: () => T): { ms: number; result: T } {
  const start = performance.now();
  const result = fn();
  return { ms: performance.now() - start, result };
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Catalogue et moteur ; `scan` : premier calcul (catalogue vide), `again` : analyse répétée qui change chaque élément. */
function measure(contributors: Contributor[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-bench-'));
  const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
  const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
  overrides.load();
  const engine = createTagEngine({ catalog, overrides, registry: createRegistry((k) => k), rules: () => fileTagRules(undefined), contributors });
  const sources = fakeCatalog(N);
  const scan = time(() => {
    for (const { source, elements } of sources) catalog.setSource(source, elements);
  });
  // Analyse répétée : chaque élément revient avec une info changée, il est donc recalculé.
  const touched = (round: number) =>
    sources.map(({ source, elements }) => ({ source, elements: elements.map((e): ElementInput => ({ ...e, infos: { ...e.infos, round } })) }));
  const again = [1, 2, 3, 4, 5].map((round) => {
    const next = touched(round);
    return time(() => {
      for (const { source, elements } of next) catalog.setSource(source, elements);
    }).ms;
  });
  const recompute = [1, 2, 3, 4, 5].map(() => time(() => engine.setContributors(contributors)).ms);
  return { dir, catalog, engine, sources, scan: scan.ms, again: median(again), recompute: median(recompute) };
}

describe('mesures sur 20 000 éléments factices', () => {
  it('coût des cinq tags automatiques ; « video » et « series » en moins de 50 ms', (t) => {
    const bare = measure([]);
    const full = measure(builtinTaggers(() => []).map(taggerContributor));
    const { catalog, engine, sources } = full;
    assert.equal(catalog.size(), N);

    const runs = Array.from({ length: 20 }, () => time(() => engine.query(['video', 'series'])));
    const keys = runs[0].result;
    assert.equal(keys.length, sources[0].elements.length);
    const sorted = runs.map((r) => r.ms).sort((a, b) => a - b);
    const extra = (a: number, b: number) => `${b.toFixed(0)} ms (sans tags automatiques : ${a.toFixed(0)} ms)`;
    t.diagnostic(`premier calcul (5 emplacements, moteur branché) : ${extra(bare.scan, full.scan)}`);
    t.diagnostic(`analyse répétée, chaque élément changé (médiane) : ${extra(bare.again, full.again)}`);
    t.diagnostic(`recalcul de tout l’index (médiane) : ${extra(bare.recompute, full.recompute)}`);
    t.diagnostic(`« video » et « series » : ${keys.length} éléments, médiane ${median(sorted).toFixed(2)} ms, pire ${sorted.at(-1)!.toFixed(2)} ms`);
    assert.ok(sorted[0] < 50, `requête trop lente : ${sorted[0].toFixed(1)} ms`);
    // Les films, la musique et les photos sont aussi rangés.
    assert.equal(engine.query(['movie']).length, sources[1].elements.length);
    assert.equal(engine.withInfo('album', 'Album 0').length > 0, true);
    // Une modification à la main est visible aussitôt dans l'index.
    engine.setTags(keys[0], { series: false });
    assert.equal(engine.query(['video', 'series']).length, keys.length - 1);
    for (const m of [bare, full]) fs.rmSync(m.dir, { recursive: true, force: true });
  });
});
