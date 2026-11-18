// Mesure de l'explorateur (P4-08) sur 20 000 éléments factices : le modèle de l'interface (`explorer/model.ts`) branché
// sur le vrai service des pages (`catalog.page`, tags compris), sans IPC. Parcours de trois colonnes jusqu'à un élément,
// les 4 000 films par tranches de 100, le tag « Vidéo » (plus de 12 000 éléments) et l'aperçu. Les temps sont affichés dans le
// rapport des tests (`diagnostic`).
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
import { builtinTranslator } from '../../src/main/i18n/current.ts';
import { createExplorerModel, levelNode } from '../../src/renderer/explorer/index.ts';
import type { ExplorerState } from '../../src/renderer/explorer/index.ts';
import { fakeCatalog } from '../catalog/fake-catalog.ts';

const N = 20_000;
// Le tri par nom d'un niveau de 12 400 éléments (première ouverture, avant le cache) prend à lui seul ~70 ms.
const LIMIT = 100;
const RUNS = 5;

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

async function time(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

describe('mesure de l’explorateur sur 20 000 éléments factices', () => {
  it('chaque étape du parcours en moins de 100 ms', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-explorer-bench-'));
    const { t: tr } = builtinTranslator('fr');
    const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
    const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
    overrides.load();
    const engine = createTagEngine({
      catalog,
      overrides,
      registry: createRegistry(tr),
      rules: () => fileTagRules(undefined),
      contributors: builtinTaggers(() => []).map(taggerContributor),
    });
    for (const { source, elements } of fakeCatalog(N)) catalog.setSource(source, elements);
    // Un parcours complet à froid (service des pages neuf, rien en cache) ; rend le temps de chaque étape.
    async function route(): Promise<{ times: Map<string, number>; state: () => ExplorerState }> {
      const pages = createPages({ file: path.join(dir, 'pages.json'), engine, catalog, translate: tr });
      pages.load();
      let state: ExplorerState = { columns: [], preview: null };
      // Comme l'IPC, chaque réponse est copiée (structuredClone) avant d'arriver à l'interface.
      const model = createExplorerModel(
        {
          t: tr,
          plural: (_key, count) => String(count),
          pages: () => pages.list(),
          lists: async () => [],
          tags: async () => structuredClone(engine.tagsList()),
          level: async (id, p, cursor) => structuredClone(pages.page(id, p, cursor)),
          element: async (key) => structuredClone(engine.element(key)),
        },
        (s) => (state = s),
      );
      model.reset();
      const times = new Map<string, number>();
      const step = async (label: string, fn: () => Promise<unknown>) => times.set(label, await time(fn));
      await step('Pages', () => model.open('pages'));
      await step('Séries (97 séries)', () => model.open(levelNode('series', [])));
      await step('Séries › Série 5 (saisons)', () => model.open(levelNode('series', ['Série 5'])));
      await step('Séries › Série 5 › Saison 3 (épisodes)', () => model.open(levelNode('series', ['Série 5', 3])));
      await step('Films (groupés par genre : Autres)', () => model.open(levelNode('movies', [])));
      await step('Films › Autres, 1re tranche sur 4 000', () => model.open(levelNode('movies', [null])));
      await step('Tags', () => model.open('tags'));
      await step('Tags › Vidéo, 1re tranche', () => model.open(levelNode('tag:video', [])));
      const tagColumn = state.columns[2];
      assert.ok((tagColumn?.total ?? 0) > N / 2, String(tagColumn?.total));
      assert.equal(tagColumn?.rows.length, 100);
      const key = tagColumn?.rows[50]?.key as string;
      await step('aperçu d’un élément', () => model.show(key));
      assert.equal(state.preview?.key, key);
      // Le même tag ouvert de nouveau : le niveau est en cache dans le service des pages.
      await model.open('pages');
      await model.open('tags');
      await step('Tags › Vidéo de nouveau (en cache)', () => model.open(levelNode('tag:video', [])));
      // Toutes les tranches de Films › Autres (4 000 éléments, 39 tranches suivantes).
      await model.open('pages');
      await model.open(levelNode('movies', []));
      const films = levelNode('movies', [null]);
      await model.open(films);
      const slices: number[] = [];
      while (state.columns[3]?.remaining) slices.push(await time(() => model.more(films)));
      assert.equal(state.columns[3]?.rows.length, (N * 2) / 10);
      times.set('Films › Autres, tranche suivante la plus lente', Math.max(...slices));
      times.set(
        'Films › Autres, 39 tranches suivantes en tout',
        slices.reduce((a, b) => a + b, 0),
      );
      // Relecture de toutes les colonnes ouvertes (catalogue changé), 4 000 lignes chargées comprises.
      await step('relecture des colonnes ouvertes (4 000 lignes chargées)', () => model.refresh());
      assert.equal(state.columns[3]?.rows.length, (N * 2) / 10);
      return { times, state: () => state };
    }

    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push((await route()).times);
    let worst = 0;
    for (const label of runs[0]?.keys() ?? []) {
      const ms = median(runs.map((r) => r.get(label) as number));
      t.diagnostic(`${label} : ${ms.toFixed(1)} ms (médiane de ${RUNS} parcours à froid)`);
      // Le total des 39 tranches n'est pas une étape : il n'entre pas dans le seuil.
      if (!label.includes('en tout')) worst = Math.max(worst, ms);
    }
    assert.ok(worst < LIMIT, `étape trop lente : ${worst.toFixed(1)} ms`);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
