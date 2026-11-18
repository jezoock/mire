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

    const steps: [string, () => Promise<unknown>][] = [
      ['Pages', () => model.open('pages')],
      ['Séries (97 séries)', () => model.open(levelNode('series', []))],
      ['Séries › Série 5 (saisons)', () => model.open(levelNode('series', ['Série 5']))],
      ['Séries › Série 5 › Saison 3 (épisodes)', () => model.open(levelNode('series', ['Série 5', 3]))],
      ['Films (groupés par genre : Autres)', () => model.open(levelNode('movies', []))],
      ['Films › Autres, 1re tranche sur 4 000', () => model.open(levelNode('movies', [null]))],
      ['Tags', () => model.open('tags')],
      ['Tags › Vidéo, 1re tranche', () => model.open(levelNode('tag:video', []))],
    ];
    let worst = 0;
    for (const [label, step] of steps) {
      const ms = await time(step);
      worst = Math.max(worst, ms);
      t.diagnostic(`${label} : ${ms.toFixed(1)} ms`);
    }
    const tagColumn = state.columns[2];
    assert.ok((tagColumn?.total ?? 0) > N / 2, String(tagColumn?.total));
    t.diagnostic(`(tag Vidéo : ${tagColumn?.total} éléments)`);
    assert.equal(tagColumn?.rows.length, 100);

    // Le même tag ouvert de nouveau : le niveau est en cache dans le service des pages.
    await model.open('pages');
    await model.open('tags');
    const warm = await time(() => model.open(levelNode('tag:video', [])));
    t.diagnostic(`Tags › Vidéo de nouveau (en cache) : ${warm.toFixed(1)} ms`);

    // Aperçu d'un élément de la colonne affichée.
    const key = tagColumn?.rows[50]?.key as string;
    const preview = await time(() => model.show(key));
    t.diagnostic(`aperçu d'un élément : ${preview.toFixed(1)} ms`);
    assert.equal(state.preview?.key, key);
    worst = Math.max(worst, preview);

    // Toutes les tranches de Films › Autres (4 000 éléments, 39 tranches suivantes).
    await model.open('pages');
    await model.open(levelNode('movies', []));
    const films = levelNode('movies', [null]);
    await model.open(films);
    const slices: number[] = [];
    while (state.columns[3]?.remaining) slices.push(await time(() => model.more(films)));
    const total = slices.reduce((a, b) => a + b, 0);
    t.diagnostic(`Films › Autres, ${slices.length} tranches suivantes : ${total.toFixed(0)} ms en tout, la plus lente ${Math.max(...slices).toFixed(1)} ms`);
    assert.equal(state.columns[3]?.rows.length, (N * 2) / 10);
    worst = Math.max(worst, ...slices);

    // Relecture de toutes les colonnes ouvertes (catalogue changé), 4 000 lignes chargées comprises.
    const refresh = await time(() => model.refresh());
    t.diagnostic(`relecture des colonnes ouvertes (4 000 lignes chargées) : ${refresh.toFixed(1)} ms`);
    assert.equal(state.columns[3]?.rows.length, (N * 2) / 10);

    assert.ok(worst < LIMIT, `étape trop lente : ${worst.toFixed(1)} ms`);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
