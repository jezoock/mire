// Jeux, télévision et sites dans le catalogue (P2-03), avec le vrai moteur de tags :
// - la configuration de démonstration (test de fumée) donne toutes les sortes d'éléments ;
// - tags `game`, `tv`, `stream`, info `system` posée par la source (le tag automatique « Consoles » ne la double pas) ;
// - les fiches gardées sous une ancienne clé (`r:`, `g:`, `b:`, `v:` d'un marque-page) rejoignent leur élément.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fold, type Config } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { gameBookmarkKey, keyGenre, pcGameKey, romKey, siteKey } from '../../src/main/catalog/keys.ts';
import { createMetadataStore, metadataContributors, metadataOrder } from '../../src/main/catalog/metadata.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { syncFeeds } from '../../src/main/catalog/sync.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { bundledTaggers } from './bundled-taggers.ts';
import { createTargetFinder } from '../../src/main/catalog/targets.ts';
import { createConfigService } from '../../src/main/config/index.ts';
import { gameConfigFeed } from '../../src/main/games/element-sources.ts';
import { createGames } from '../../src/main/games/index.ts';
import type { GamesDeps } from '../../src/main/games/types.ts';
import { builtinTranslator } from '../../src/main/i18n/index.ts';
import { wireLocalPlugin } from '../library/plugin-folders.ts';
import { tvConfigFeed } from '../../src/main/tv/element-sources.ts';
import { createTv } from '../../src/main/tv/index.ts';
import { siteConfigFeed } from '../../src/main/web/element-sources.ts';

const P = process.platform;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-p203-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Configuration de démonstration du test de fumée, avec ses fichiers copiés dans un dossier temporaire. */
function demo(extra: (c: Config) => Config = (c) => c) {
  const dir = fs.mkdtempSync(path.join(tmp, 'demo-'));
  const fixtures = path.join(dir, 'fixtures');
  fs.cpSync(new URL('../e2e/fixtures', import.meta.url), fixtures, { recursive: true });
  const raw = fs.readFileSync(path.join(fixtures, 'config.json'), 'utf8').replaceAll('@FIXTURES@', JSON.stringify(fixtures).slice(1, -1));
  fs.writeFileSync(path.join(dir, 'config.json'), raw);
  const config = createConfigService({ file: path.join(dir, 'config.json') });
  config.load();
  config.update(extra);
  return { dir, fixtures, config };
}

async function wire(dir: string, config: ReturnType<typeof createConfigService>) {
  const catalog = createCatalog({ dir: path.join(dir, 'catalog', 'sources'), debounceMs: 0, onIgnored: () => {} });
  catalog.load();
  const find = createTargetFinder(catalog);
  const overrides = createOverrides({ file: path.join(dir, 'catalog', 'overrides.json'), legacyFile: path.join(dir, 'meta.json'), platform: P, find });
  overrides.load();
  const metadata = createMetadataStore({ file: path.join(dir, 'catalog', 'metadata.json'), legacyFile: path.join(dir, 'db.json'), platform: P, find });
  metadata.load();
  // Comme la racine de composition (src/main/index.ts).
  const engine = createTagEngine({
    catalog,
    overrides,
    registry: createRegistry(builtinTranslator('fr').t),
    rules: () => fileTagRules(undefined),
    contributors: [...bundledTaggers(), ...metadataContributors(metadata, metadataOrder(undefined))],
  });
  metadata.onChange((keys) => engine.refresh(keys));
  catalog.onChange(({ added }) => {
    if (added.length) metadata.adopt(added.map((k) => catalog.get(k)).filter((e) => !!e));
  });
  syncFeeds(catalog, [gameConfigFeed(config.get(), P), tvConfigFeed(config.get()), siteConfigFeed(config.get())]);
  const games = createGames({
    config,
    access: { isAllowed: () => true, isInside: () => true },
    downloads: () => ({ fetchText: async () => '' }),
    scraper: () => null,
    platform: P,
    catalog,
  } as unknown as GamesDeps);
  const tv = createTv({ config, toUi: () => {}, catalog });
  // Dossiers de la bibliothèque : plugin inclus `mire.source.local` (P5-11c).
  const { library } = await wireLocalPlugin({ config, catalog });
  return { catalog, overrides, metadata, engine, games, tv, library };
}

/** Ce que fait l'interface historique au démarrage : bibliothèque, dossiers de jeux, jeux de chaque console, chaînes. */
async function startUi(w: Awaited<ReturnType<typeof wire>>, config: Config) {
  await Promise.all([w.library.scan(), w.games.scanGameSources()]);
  for (const emu of config.emulators) await w.games.listRoms(emu.id);
  await w.tv.channels();
}

describe('configuration de démonstration → catalogue', () => {
  it('toutes les sortes d\u2019éléments : fichiers, jeux de console, jeux PC, chaînes, sites', async () => {
    const { dir, config } = demo();
    const w = await wire(dir, config);
    await startUi(w, config.get());
    const genres = new Set(w.catalog.keys().map(keyGenre));
    for (const g of ['local', 'rom', 'pc', 'tv', 'site'] as const) assert.ok(genres.has(g), g);
    const plugins = new Set(w.catalog.sources().map((s) => s.plugin));
    for (const p of ['mire.source.local', 'jeux-roms', 'jeux-pc-manuel', 'tv-m3u', 'web-perso']) assert.ok(plugins.has(p), p);
  });

  it('tags `game`, `tv`, `stream` ; info `system` des jeux de console une seule fois, celle de la console', async () => {
    const { dir, config } = demo();
    const w = await wire(dir, config);
    await startUi(w, config.get());
    const snes = config.get().emulators[0];
    const rom = w.catalog.keys().find((k) => k.startsWith(`rom:${snes.id}|`))!;
    const e = w.engine.element(rom)!;
    assert.deepEqual(e.tags, ['game']);
    assert.equal(e.infos.system, 'Nintendo - Super Nintendo Entertainment System');
    assert.equal(w.engine.query(['game']).length, w.catalog.keys().filter((k) => /^(rom|pc|gamebm):/.test(k)).length);
    assert.ok(w.engine.query(['tv']).length > 0);
    assert.deepEqual(w.engine.query(['stream']).sort(), [siteKey('arte'), siteKey('radio-france')]);
    assert.equal(w.engine.element(siteKey('radio-france'))?.infos.category, 'music');
    // Une valeur par jeu : celle de la console (source et tag automatique d'accord), `pc` pour les jeux PC.
    const roms = w.catalog.keys().filter((k) => k.startsWith('rom:')).length;
    const pcs = w.catalog.keys().filter((k) => k.startsWith('pc:')).length;
    assert.deepEqual(
      w.engine.infoValues('system').sort((a, b) => String(a.value).localeCompare(String(b.value))),
      [
        { value: 'Nintendo - Super Nintendo Entertainment System', count: roms },
        { value: 'pc', count: pcs },
      ],
    );
    // Une console changée change `system` quand ses jeux sont relus : la source le pose d'après la console, et le tag
    // automatique « Consoles » (plugin inclus, P5-09) ne touche pas un jeu qui en a déjà un.
    config.update((c) => ({ ...c, emulators: c.emulators.map((x) => ({ ...x, system: 'Sega - Mega Drive - Genesis' })) }));
    await w.games.listRoms(snes.id);
    assert.equal(w.engine.element(rom)?.infos.system, 'Sega - Mega Drive - Genesis');
    const tags = Object.fromEntries(w.engine.tagsList().map((t) => [t.id, t]));
    assert.deepEqual([tags.game.origin, tags.game.name, tags.tv.name, tags.stream.name], ['core', 'Jeux', 'Télévision', 'Streaming']);
  });
});

describe('fiches gardées sous une ancienne clé → leur élément', () => {
  it('ROM (`r:`), jeu PC par son nom (`g:`), marque-page de jeu (`b:`), marque-page de page (`v:` + adresse) : sans perte', async () => {
    const BM_URL = 'https://www.arte.tv/fr/videos/1/';
    const { dir, fixtures, config } = demo((c) => ({
      ...c,
      bookmarks: [{ id: 'p1', url: BM_URL, title: 'Documentaire', type: 'movie', season: null, episode: null, site: 'arte.tv', added: 1 }],
      gameBookmarks: [
        { id: 'gb1', source: 'https://jeux/a.zip', kind: 'http', title: 'À venir', console: 'pc', system: '', downloadId: null, done: false, added: 1 },
      ],
    }));
    const romPath = path.join(fixtures, 'bibliotheque', 'Jeux', 'Super Nintendo', 'Course de karts (Europe).sfc');
    const meta = {
      [`r:${romPath}`]: { title: 'Course (corrigé)' },
      [`g:${fold('Aventure de démonstration')}`]: { title: 'Aventure (corrigée)', genre: 'Aventure' },
      'b:gb1': { title: 'Jeu attendu' },
      [`v:${BM_URL}`]: { overview: 'Résumé saisi.' },
      'a:/musique/album': { title: 'Album' },
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
    const rec = (title: string) => ({ title, image: null, source: 'TMDB', rev: 2, at: 1 });
    fs.writeFileSync(
      path.join(dir, 'db.json'),
      JSON.stringify({ items: { [`r:${romPath}`]: rec('Course en ligne'), [`g:${fold('Puzzle de démonstration')}`]: rec('Puzzle en ligne') }, misses: {} }),
    );

    // Premier démarrage : catalogue vide, les fiches des jeux et des pages attendent sous leur ancienne clé…
    const before = (() => {
      const cat = createCatalog({ dir: path.join(dir, 'vide'), debounceMs: 0, onIgnored: () => {} });
      const o = createOverrides({ file: path.join(dir, 'o-vide.json'), legacyFile: path.join(dir, 'meta.json'), platform: P, find: createTargetFinder(cat) });
      o.load();
      return o.legacyAll();
    })();
    const w = await wire(dir, config);
    // … sauf celles dont l'élément vient de la configuration (marque-pages, jeux ajoutés à la main) : reprises au
    // chargement, ou rattachées dès l'arrivée de l'élément. Les ROM arrivent avec la première liste de la console.
    await startUi(w, config.get());
    assert.deepEqual(w.overrides.unmatched(), ['a:/musique/album']);

    const rom = romKey(config.get().emulators[0].id, romPath, P);
    assert.equal(w.engine.element(rom)?.infos.title, 'Course (corrigé)');
    const aventure = pcGameKey(path.join(fixtures, 'bibliotheque', 'Jeux', 'PC', 'aventure.sh'), P);
    assert.deepEqual(w.engine.element(aventure)?.infos.genres, ['Aventure']);
    assert.equal(w.engine.element(gameBookmarkKey('gb1'))?.infos.title, 'Jeu attendu');
    assert.equal(w.engine.element('bm:p1')?.infos.overview, 'Résumé saisi.');
    // Infos en ligne : la fiche de la ROM et celle du jeu PC (par son nom) rejoignent leur élément.
    const puzzle = pcGameKey(path.join(fixtures, 'bibliotheque', 'Jeux', 'PC', 'puzzle.sh'), P);
    assert.equal(w.engine.element(puzzle)?.infos.title, 'Puzzle en ligne');
    assert.ok(w.metadata.forElement(rom)?.size);
    // La façade de l'interface historique rend les mêmes fiches, sous les mêmes clés.
    assert.deepEqual(w.overrides.legacyAll(), before);
  });
});
