// Tags automatiques branchés sur le moteur (P2-05, puis plugins depuis P5-09). Les tags automatiques de séries, films,
// musique, consoles et photos sont des plugins inclus (`plugins/mire.tags.*`, leurs tests dans leur dossier) ; le cœur
// garde ici des tests avec un tag automatique factice, passé par le pont des plugins (`src/main/plugins/taggers.ts`) :
// résultat filtré, tags d'un plugin désactivé qui disparaissent, tags et infos saisis à la main qui restent.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Element, ElementSourceRef } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { localFileKey } from '../../src/main/catalog/keys.ts';
import { metadataContributors } from '../../src/main/catalog/metadata.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createTagEngine, type TagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import { builtinTranslator } from '../../src/main/i18n/current.ts';
import { createPluginTaggers, sanitizeTaggerResult } from '../../src/main/plugins/taggers.ts';
import { bundledTaggers } from './bundled-taggers.ts';

const SERIES: ElementSourceRef = { plugin: 'src-local', instance: '/series' };
const PLUGIN = 'org.exemple.episodes';
const DECLARED = { tags: ['episode-tag'], infos: { saison: { type: 'number' as const } } };

/** Tag automatique factice : « S01E03 » dans le nom → tag `episode-tag`, info `saison` ; et un tag non déclaré. */
const fakeCompute = (e: Readonly<Element>) => {
  const m = /S(\d+)E\d+/.exec(e.name);
  return m && e.tags.includes('video') ? { tags: ['episode-tag', 'non-declare'], infos: { saison: m[1], autre: 'x' } } : null;
};

const input = (p: string): ElementInput => ({
  key: localFileKey(p, 'linux'),
  name: path.parse(p).name,
  open: { kind: 'file', path: p },
  tags: ['local'],
  infos: { folder: 'series' },
  images: {},
});

/** Moteur avec le pont des plugins ; `enable()` active le plugin factice, `disable()` le désactive (comme le service). */
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-taggers-'));
  const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
  catalog.load();
  const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
  overrides.load();
  const registry = createRegistry(builtinTranslator('fr').t);
  let engine: TagEngine | null = null;
  let batches = 0;
  const bridge = createPluginTaggers({ refresh: (keys) => engine?.refresh(keys), onError: () => {} });
  engine = createTagEngine({ catalog, overrides, registry, rules: () => fileTagRules(undefined) });
  const e = engine;
  return {
    dir,
    catalog,
    engine: e,
    batches: () => batches,
    enable() {
      registry.declarePlugin(PLUGIN, { ...DECLARED, textPrefix: 'pluginTexts.org_exemple_episodes.' });
      bridge.add({
        pluginId: PLUGIN,
        id: 'episodes',
        ...DECLARED,
        computeBatch: async (elements) => {
          batches++;
          return elements.map(fakeCompute);
        },
      });
      e.setContributors(bridge.contributors());
    },
    disable() {
      bridge.remove(PLUGIN);
      registry.removePlugin(PLUGIN);
      e.setContributors(bridge.contributors());
    },
  };
}

/** Laisse le pont calculer ses lots (microtâches, puis promesses de l'hôte factice). */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('tags automatiques d’un plugin, branchés sur le moteur', () => {
  it('résultat ramené à ce que la contribution déclare (tags, infos et leur type)', () => {
    assert.deepEqual(sanitizeTaggerResult(fakeCompute({ name: 'X S02E01', tags: ['video'] } as Element), DECLARED), {
      tags: ['episode-tag'],
      infos: { saison: 2 },
    });
    assert.equal(sanitizeTaggerResult({ tags: ['non-declare'], infos: { autre: 'x' } }, DECLARED), null);
  });

  it('calculé par lots dans l’hôte, puis posé sur l’élément ; rien sur ce qui ne le concerne pas', async () => {
    const t = setup();
    t.catalog.setSource(SERIES, [input('/series/Friends S01E03.mkv'), input('/series/Amélie.mkv')]);
    const key = localFileKey('/series/Friends S01E03.mkv', 'linux');
    t.enable();
    // Avant le premier lot : rien encore.
    assert.equal(t.engine.element(key)!.tags.includes('episode-tag'), false);
    await settle();
    const e = t.engine.element(key)!;
    assert.ok(e.tags.includes('episode-tag'), e.tags.join());
    assert.equal(e.tags.includes('non-declare'), false);
    assert.equal(e.infos.saison, 1);
    assert.equal(e.infos.autre, undefined);
    assert.deepEqual(t.engine.query(['episode-tag']), [key]);
    assert.equal(t.batches(), 1);
    // Le tag du plugin a son nom (textes du plugin) et son origine dans la liste des tags.
    assert.deepEqual(
      t.engine.tagsList().find((x) => x.id === 'episode-tag'),
      { id: 'episode-tag', name: 'pluginTexts.org_exemple_episodes.tags.episode-tag', origin: 'plugin', count: 1 },
    );
    fs.rmSync(t.dir, { recursive: true, force: true });
  });

  it('plugin désactivé : ses tags et ses infos disparaissent ; les tags et infos saisis à la main restent', async () => {
    const t = setup();
    t.catalog.setSource(SERIES, [input('/series/Friends S01E03.mkv'), input('/series/Lost S02E01.mkv')]);
    const friends = localFileKey('/series/Friends S01E03.mkv', 'linux');
    const lost = localFileKey('/series/Lost S02E01.mkv', 'linux');
    t.enable();
    await settle();
    t.engine.setTags(friends, { 'Vus en 2024': true });
    t.engine.setInfos(friends, { saison: 7 });
    // Retiré à la main sur Lost : il le reste, plugin actif ou non.
    t.engine.setTags(lost, { 'episode-tag': false });
    assert.equal(t.engine.element(friends)!.infos.saison, 7);
    t.disable();
    const f = t.engine.element(friends)!;
    assert.equal(f.tags.includes('episode-tag'), false);
    assert.ok(f.tags.includes('vus-en-2024'));
    assert.equal(f.infos.saison, 7);
    assert.deepEqual(t.engine.query(['episode-tag']), []);
    assert.equal(t.engine.element(lost)!.infos.saison, undefined);
    // Le tag du plugin quitte la liste ; celui de l'utilisateur y reste.
    const list = t.engine.tagsList();
    assert.equal(
      list.some((x) => x.id === 'episode-tag'),
      false,
    );
    assert.deepEqual(
      list.find((x) => x.id === 'vus-en-2024'),
      { id: 'vus-en-2024', name: 'Vus en 2024', origin: 'user', count: 1 },
    );
    // Réactivé : ses tags reviennent, sauf là où l'utilisateur l'a retiré.
    t.enable();
    await settle();
    assert.ok(t.engine.element(friends)!.tags.includes('episode-tag'));
    assert.equal(t.engine.element(lost)!.tags.includes('episode-tag'), false);
    fs.rmSync(t.dir, { recursive: true, force: true });
  });

  it('un tag d’un plugin actif ajouté à la main n’est pas un nouveau tag de l’utilisateur', async () => {
    const t = setup();
    t.catalog.setSource(SERIES, [input('/series/Amélie.mkv')]);
    const key = localFileKey('/series/Amélie.mkv', 'linux');
    t.enable();
    await settle();
    t.engine.setTags(key, { 'episode-tag': true });
    assert.ok(t.engine.element(key)!.tags.includes('episode-tag'));
    assert.equal(
      t.engine.tagsList().some((x) => x.id === 'episode-tag' && x.origin === 'user'),
      false,
    );
    fs.rmSync(t.dir, { recursive: true, force: true });
  });
});

describe('tags automatiques des plugins inclus dans le moteur', () => {
  function engineWith(contributors: ReturnType<typeof bundledTaggers>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-taggers-'));
    const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
    catalog.load();
    const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
    overrides.load();
    const registry = createRegistry(builtinTranslator('fr').t);
    return { dir, catalog, engine: createTagEngine({ catalog, overrides, registry, rules: () => fileTagRules(undefined), contributors }) };
  }

  it('« Friends S01E03.mkv » porte `video`, `series`, série « Friends », saison 1, épisode 3', () => {
    const { dir, catalog, engine } = engineWith(bundledTaggers());
    const key = localFileKey('/series/Friends/Friends S01E03.mkv', 'linux');
    catalog.setSource(SERIES, [input('/series/Friends/Friends S01E03.mkv')]);
    const e = engine.element(key)!;
    assert.ok(e.tags.includes('video') && e.tags.includes('series'), e.tags.join());
    assert.equal(e.tags.includes('movie'), false);
    assert.deepEqual([e.infos.series, e.infos.season, e.infos.episode], ['Friends', 1, 3]);
    assert.deepEqual(engine.query(['video', 'series']), [key]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('les infos en ligne passent avant celles des tags automatiques, quel que soit l’ordre ; la main avant tout', () => {
    const p = '/films/Amelie (2001).mkv';
    const key = localFileKey(p, 'linux');
    // Fiche TMDB factice : titre en ligne, sans année.
    const store = { forElement: (k: string) => (k === key ? new Map([['tmdb', { infos: { title: 'Le Fabuleux Destin d’Amélie Poulain' } }]]) : undefined) };
    const online = metadataContributors(store, ['tmdb']);
    const automatic = bundledTaggers();
    const { dir, catalog, engine } = engineWith([...online, ...automatic]);
    catalog.setSource({ plugin: 'src-local', instance: '/films' }, [
      { key, name: 'Amelie (2001)', open: { kind: 'file', path: p }, tags: ['local'], infos: { folder: 'films' }, images: {} },
    ]);
    let e = engine.element(key)!;
    assert.equal(e.infos.title, 'Le Fabuleux Destin d’Amélie Poulain');
    // Ce que la fiche ne donne pas vient des tags automatiques.
    assert.equal(e.infos.year, 2001);
    assert.ok(e.tags.includes('movie'));
    engine.setContributors([...automatic, ...online]);
    assert.equal(engine.element(key)!.infos.title, 'Le Fabuleux Destin d’Amélie Poulain');
    engine.setInfos(key, { title: 'Amélie' });
    e = engine.element(key)!;
    assert.equal(e.infos.title, 'Amélie');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
