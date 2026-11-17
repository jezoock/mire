// Mesures (P2-09) sur 20 000 éléments factices : `catalog.search` en moins de 50 ms (architecture cible). Première
// recherche (textes préparés à ce moment) et recherches suivantes, pour une recherche précise, une recherche large et
// une recherche par nom de tag. Les temps sont affichés dans le rapport des tests (`diagnostic`).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createPages } from '../../src/main/catalog/pages/index.ts';
import { createSearch } from '../../src/main/catalog/search/index.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { builtinTaggers, taggerContributor } from '../../src/main/catalog/tags/taggers.ts';
import { builtinTranslator } from '../../src/main/i18n/current.ts';
import { fakeCatalog } from './fake-catalog.ts';

const N = 20_000;
const RUNS = 9;

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function time(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe('mesures de la recherche sur 20 000 éléments factices', () => {
  it('catalog.search en moins de 50 ms', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-search-bench-'));
    const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
    const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
    overrides.load();
    const { t: translate } = builtinTranslator('fr');
    const registry = createRegistry(translate);
    const engine = createTagEngine({
      catalog,
      overrides,
      registry,
      rules: () => fileTagRules(undefined),
      contributors: builtinTaggers(() => []).map(taggerContributor),
    });
    for (const { source, elements } of fakeCatalog(N)) catalog.setSource(source, elements);
    const pages = createPages({ file: path.join(dir, 'pages.json'), engine, catalog, translate });
    pages.load();
    const fresh = () => createSearch({ engine, catalog, pages, registry, translate });

    const cases: [string, string][] = [
      ['précise (« série 5 s03 »)', 'série 5 s03'],
      ['large (« morceau », 6 000 éléments)', 'morceau'],
      ['très large (« e », presque tout)', 'e'],
      ['nom de tag et mot (« films 1999 »)', 'films 1999'],
      ['rien trouvé (« zzz »)', 'zzz'],
    ];
    let worstCold = 0;
    let worstWarm = 0;
    for (const [label, q] of cases) {
      const cold = median(Array.from({ length: RUNS }, () => time(() => fresh().search(q))));
      const warmSearch = fresh();
      warmSearch.search('amorce');
      const warm = median(Array.from({ length: RUNS }, () => time(() => warmSearch.search(q))));
      worstCold = Math.max(worstCold, cold);
      worstWarm = Math.max(worstWarm, warm);
      t.diagnostic(`${label} : première recherche ${cold.toFixed(1)} ms, suivantes ${warm.toFixed(1)} ms`);
    }

    const r = fresh().search('morceau');
    assert.equal(r.total, (N * 3) / 10);
    assert.equal(r.groups[0].page, 'music');
    assert.equal(r.groups[0].elements.length, 24);

    // Coût d'un changement une fois les textes préparés : un élément modifié à la main.
    const s = fresh();
    s.search('amorce');
    const one = [...engine.query(['video', 'series'])][0];
    const change = median(Array.from({ length: RUNS }, (_, i) => time(() => engine.setInfos(one, { title: `t${i}` }))));
    t.diagnostic(`un élément modifié à la main, textes préparés et pages : ${change.toFixed(2)} ms (moteur compris)`);
    assert.equal(s.search('t8').total >= 1, true);

    // Les recherches suivantes tiennent l'objectif ; la première prépare les textes de 20 000 éléments (~30 à 40 ms
    // ici, davantage quand le ramasse-miettes passe) : une marge évite un test instable sur une machine chargée.
    assert.ok(worstWarm < 50, `recherche trop lente : ${worstWarm.toFixed(1)} ms`);
    assert.ok(worstCold < 150, `première recherche trop lente : ${worstCold.toFixed(1)} ms`);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
