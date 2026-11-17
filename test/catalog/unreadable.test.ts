// Fichiers du catalogue illisibles (P2-12) : overrides.json, metadata.json, pages.json et lists.json sont mis de côté
// (`<fichier>.illisible-<date>`, comme config.json) et signalés dans le journal ; ils ne sont jamais écrasés en silence.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { createLists } from '../../src/main/catalog/lists/index.ts';
import { createMetadataStore } from '../../src/main/catalog/metadata.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createPages } from '../../src/main/catalog/pages/index.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import type { ScrapeRecord } from '../../src/main/scrape/types.ts';

const BROKEN = '{ "version": 1, "elements": {';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-illisible-'));
  const logs: string[] = [];
  const onIgnored = (f: string, reason: string) => logs.push(`${path.basename(f)} : ${reason}`);
  return { dir, logs, onIgnored, file: (name: string) => path.join(dir, name) };
}

/** Fichiers mis de côté pour `name`, avec leur contenu. */
const keptCopies = (dir: string, name: string) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${name}.illisible-`))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));

function engineFor(dir: string) {
  const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
  const overrides = createOverrides({ file: path.join(dir, 'o.json'), platform: 'linux', onIgnored: () => {} });
  overrides.load();
  const engine = createTagEngine({ catalog, overrides, registry: createRegistry((k) => k), rules: () => fileTagRules(undefined) });
  return { catalog, engine };
}

describe('fichiers du catalogue illisibles : mis de côté, jamais écrasés en silence', () => {
  it('overrides.json : mis de côté, signalé ; l’ancien meta.json n’est pas repris, même au démarrage suivant', () => {
    const s = setup();
    fs.writeFileSync(s.file('overrides.json'), BROKEN);
    fs.writeFileSync(s.file('meta.json'), JSON.stringify({ 'v:/bib/a.mkv': { title: 'Ancien' } }));
    const open = () => createOverrides({ file: s.file('overrides.json'), legacyFile: s.file('meta.json'), platform: 'linux', onIgnored: s.onIgnored });
    const overrides = open();
    assert.equal(overrides.load(), null);
    assert.deepEqual(keptCopies(s.dir, 'overrides.json'), [BROKEN]);
    assert.equal(s.logs.length, 1);
    assert.match(s.logs[0], /^overrides\.json : .* ; mis de côté dans overrides\.json\.illisible-\d+$/);
    overrides.setInfos('local:/bib/b.mkv', { year: 2001 });
    assert.deepEqual(keptCopies(s.dir, 'overrides.json'), [BROKEN], 'la copie reste après une écriture');
    // Démarrage suivant : le nouveau fichier est lu, rien n'est repris de meta.json, rien n'est de nouveau mis de côté.
    const again = open();
    assert.equal(again.load(), null);
    assert.equal(again.get('local:/bib/a.mkv'), undefined);
    assert.deepEqual(again.get('local:/bib/b.mkv')?.infos, { year: 2001 });
    assert.equal(keptCopies(s.dir, 'overrides.json').length, 1);
  });

  it('metadata.json : mis de côté, signalé ; l’ancien db.json n’est pas repris au démarrage suivant', async () => {
    const s = setup();
    fs.writeFileSync(s.file('metadata.json'), BROKEN);
    fs.writeFileSync(s.file('db.json'), JSON.stringify({ items: { 'v:/bib/a.mkv': { rev: 1, at: 1, source: 'tmdb', title: 'Ancien' } } }));
    const open = () => createMetadataStore({ file: s.file('metadata.json'), legacyFile: s.file('db.json'), platform: 'linux', onIgnored: s.onIgnored });
    const metadata = open();
    assert.equal(metadata.load(), null);
    assert.deepEqual(keptCopies(s.dir, 'metadata.json'), [BROKEN]);
    assert.match(s.logs[0], /^metadata\.json : .* ; mis de côté dans metadata\.json\.illisible-\d+$/);
    metadata.scrapeStore.set('v:/bib/b.mkv', { rev: 1, at: 1, source: 'tmdb', title: 'B' } as unknown as ScrapeRecord);
    await metadata.flush();
    const again = open();
    assert.equal(again.load(), null);
    assert.equal(again.scrapeStore.get('v:/bib/a.mkv'), undefined);
    assert.equal(again.scrapeStore.get('v:/bib/b.mkv')?.title, 'B');
    assert.equal(keptCopies(s.dir, 'metadata.json').length, 1);
  });

  it('pages.json : mis de côté, signalé ; les pages prêtes à l’emploi restent', () => {
    const s = setup();
    const { catalog, engine } = engineFor(s.dir);
    fs.writeFileSync(s.file('pages.json'), BROKEN);
    const pages = createPages({ file: s.file('pages.json'), engine, catalog, translate: (k) => k, onIgnored: s.onIgnored });
    pages.load();
    assert.equal(pages.list().length, 7);
    assert.deepEqual(keptCopies(s.dir, 'pages.json'), [BROKEN]);
    assert.match(s.logs[0], /^pages\.json : .* ; mis de côté dans pages\.json\.illisible-\d+$/);
    assert.equal(pages.remove('tv'), true);
    assert.deepEqual(keptCopies(s.dir, 'pages.json'), [BROKEN]);
  });

  it('lists.json : mis de côté, signalé', () => {
    const s = setup();
    const { engine } = engineFor(s.dir);
    fs.writeFileSync(s.file('lists.json'), BROKEN);
    const lists = createLists({ file: s.file('lists.json'), engine, newId: () => 'l1', platform: 'linux', onIgnored: s.onIgnored });
    lists.load();
    assert.deepEqual(lists.list(), []);
    assert.deepEqual(keptCopies(s.dir, 'lists.json'), [BROKEN]);
    assert.match(s.logs[0], /^lists\.json : .* ; mis de côté dans lists\.json\.illisible-\d+$/);
    lists.create('À voir');
    assert.deepEqual(keptCopies(s.dir, 'lists.json'), [BROKEN]);
  });
});
