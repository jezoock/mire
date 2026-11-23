// Mesures (P2-07) sur 20 000 éléments factices : `catalog.page` en moins de 50 ms (architecture cible). Première page,
// page groupée sur plusieurs niveaux, tranche suivante ; à froid (page jamais calculée) et en cache. Les temps sont
// affichés dans le rapport des tests (`diagnostic`).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createPages } from '../../src/main/catalog/pages/index.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { builtinTaggers, taggerContributor } from '../../src/main/catalog/tags/taggers.ts';
import { fakeCatalog } from './fake-catalog.ts';
import { BUILTIN_PAGES } from '../fixtures/builtin-pages.ts';

const N = 20_000;
const RUNS = 9;

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function time(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe('mesures des pages sur 20 000 éléments factices', () => {
  it('catalog.page en moins de 50 ms', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-pages-bench-'));
    const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
    const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
    overrides.load();
    const engine = createTagEngine({
      catalog,
      overrides,
      registry: createRegistry((k) => k),
      rules: () => fileTagRules(undefined),
      contributors: builtinTaggers(() => []).map(taggerContributor),
    });
    for (const { source, elements } of fakeCatalog(N)) catalog.setSource(source, elements);
    const fresh = () => {
      const pages = createPages({ builtin: BUILTIN_PAGES, file: path.join(dir, 'pages.json'), engine, catalog, translate: (k) => k });
      pages.load();
      return pages;
    };

    const cases: [string, (p: ReturnType<typeof fresh>) => unknown][] = [
      ['Séries, première page (97 séries)', (p) => p.page('series')],
      ['Séries → Série 5 → Saison 3 (épisodes triés)', (p) => p.page('series', ['Série 5', 3])],
      ['Films → Autres, 1re tranche (4 000 films triés)', (p) => p.page('movies', [null])],
      ['Films → Autres, tranche suivante', (p) => p.page('movies', [null], '100')],
      ['Musique → Autres (albums)', (p) => p.page('music', [null])],
    ];
    let worst = 0;
    for (const [label, run] of cases) {
      const cold = median(Array.from({ length: RUNS }, () => time(() => run(fresh()))));
      const warmPages = fresh();
      run(warmPages);
      const warm = median(Array.from({ length: RUNS }, () => time(() => run(warmPages))));
      worst = Math.max(worst, cold);
      t.diagnostic(`${label} : à froid ${cold.toFixed(1)} ms, en cache ${warm.toFixed(2)} ms`);
    }

    const series = fresh().page('series', ['Série 5', 3]);
    assert.equal(series?.kind, 'elements');
    const films = fresh().page('movies', [null]);
    assert.equal(films?.total, N / 5);
    assert.equal(films?.next, '100');

    // Coût d'un changement pour les sept pages en cache : un élément changé, puis une analyse complète.
    const all = fresh();
    for (const p of all.list()) all.page(p.id);
    const one = [...engine.query(['video', 'series'])][0];
    const change = median(Array.from({ length: RUNS }, (_, i) => time(() => engine.setInfos(one, { title: `t${i}` }))));
    t.diagnostic(`un élément modifié à la main, sept pages en cache : ${change.toFixed(2)} ms (moteur compris)`);

    assert.ok(worst < 50, `page trop lente : ${worst.toFixed(1)} ms`);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
