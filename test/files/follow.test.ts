// Gestion des fichiers (P2-10) : le catalogue suit. Au renommage ou au déplacement d'un fichier ou d'un dossier, les
// modifications faites à la main, les infos en ligne et les listes passent sous les nouvelles clés (celles de tout
// ce que contient un dossier) ; après une suppression, l'élément quitte le catalogue et une liste le garde, indisponible.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElementSourceRef } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { localFileKey, movedKey, pcGameKey, romKey } from '../../src/main/catalog/keys.ts';
import { movedLegacyKey } from '../../src/main/catalog/legacy-meta.ts';
import { createLists } from '../../src/main/catalog/lists/index.ts';
import { createMetadataStore, metadataContributors, metadataOrder } from '../../src/main/catalog/metadata.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import { catalogFollow } from '../../src/main/files/follow.ts';
import { createUsageService } from '../../src/main/usage/index.ts';
import type { ScrapeRecord } from '../../src/main/scrape/types.ts';

const LIB: ElementSourceRef = { plugin: 'src-local', instance: '/bib' };
const key = (p: string) => localFileKey(p, 'linux');
const file = (p: string): ElementInput => ({ key: key(p), name: path.basename(p), open: { kind: 'file', path: p }, tags: [], infos: {}, images: {} });
const rec = (title: string) => ({ rev: 1, at: 1, source: 'tmdb', title }) as unknown as ScrapeRecord;

const A = '/bib/Films/a.mkv';
const C = '/bib/Films/Saga/c.mkv';
const OTHER = '/bib/Filmsx/d.mkv';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-follow-'));
  const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
  catalog.load();
  catalog.setSource(LIB, [A, C, OTHER].map(file));
  const overrides = createOverrides({ file: path.join(dir, 'overrides.json'), platform: 'linux' });
  overrides.load();
  const metadata = createMetadataStore({ file: path.join(dir, 'metadata.json'), platform: 'linux', onIgnored: () => {} });
  metadata.load();
  const engine = createTagEngine({
    catalog,
    overrides,
    registry: createRegistry((k) => k),
    rules: () => fileTagRules(undefined),
    contributors: metadataContributors(metadata, metadataOrder(undefined)),
  });
  const lists = createLists({ file: path.join(dir, 'lists.json'), engine, newId: () => 'l1', platform: 'linux' });
  lists.load();
  const usage = createUsageService({ file: path.join(dir, 'usage.json'), debounceMs: 0, platform: 'linux' });
  usage.load();
  let rescans = 0;
  const follow = catalogFollow({ catalog, overrides, metadata, lists, usage, rescan: () => rescans++, platform: 'linux' });
  return { catalog, overrides, metadata, engine, lists, usage, follow, rescans: () => rescans };
}

describe('gestion des fichiers : le catalogue suit', () => {
  it('dossier renommé : modifications, fiches en ligne et listes passent sous les clés de tout ce qu’il contient', () => {
    const s = setup();
    s.overrides.legacySet(`v:${A}`, { title: 'Mon A', year: '2001' });
    s.overrides.setInfos(key(OTHER), { year: 1999 });
    s.metadata.scrapeStore.set(`v:${C}`, rec('C en ligne'));
    s.metadata.scrapeStore.miss(`v:${A}`, 5);
    s.lists.create('À voir');
    s.lists.add('l1', [key(OTHER), key(C), key(A)]);

    s.follow.moved('/bib/Films', '/bib/Cinema');

    const A2 = '/bib/Cinema/a.mkv';
    const C2 = '/bib/Cinema/Saga/c.mkv';
    // Modifications faites à la main, et leur lien avec l'ancien meta.json.
    assert.equal(s.overrides.get(key(A)), undefined);
    assert.deepEqual(s.overrides.get(key(A2))?.infos, { title: 'Mon A', year: 2001 });
    assert.deepEqual(s.overrides.legacyAll(), { [`v:${A2}`]: { title: 'Mon A', year: '2001' } });
    // Un dossier au nom proche (« Filmsx ») ne bouge pas.
    assert.deepEqual(s.overrides.get(key(OTHER))?.infos, { year: 1999 });
    // Infos en ligne, sous la nouvelle clé d'élément et la nouvelle clé du fournisseur.
    assert.equal(s.metadata.forElement(key(C)), undefined);
    assert.equal(s.metadata.forElement(key(C2))?.get('tmdb')?.infos?.title, 'C en ligne');
    assert.equal(s.metadata.scrapeStore.get(`v:${C2}`)?.title, 'C en ligne');
    assert.equal(s.metadata.scrapeStore.missedAt(`v:${A2}`), 5);
    // Listes : même ordre, nouvelles clés.
    assert.deepEqual(
      s.lists.get('l1')!.items.map((i) => i.key),
      [key(OTHER), key(C2), key(A2)],
    );
    // Les anciens éléments quittent le catalogue ; une analyse est demandée.
    assert.equal(s.catalog.element(key(A)), null);
    assert.ok(s.catalog.element(key(OTHER)));
    assert.equal(s.rescans(), 1);

    // L'analyse suivante apporte les éléments sous leur nouveau chemin : tout est là.
    s.catalog.setSource(LIB, [A2, C2, OTHER].map(file));
    assert.equal(s.engine.element(key(A2))?.infos.year, 2001);
    assert.equal(s.engine.element(key(C2))?.infos.title, 'C en ligne');
    assert.deepEqual(
      s.lists.get('l1')!.items.map((i) => [i.name, i.available]),
      [
        ['d.mkv', true],
        ['c.mkv', true],
        ['a.mkv', true],
      ],
    );
  });

  it('fichier renommé : seule sa clé change ; une modification restée à l’arrivée est remplacée', () => {
    const s = setup();
    const B = '/bib/Films/b.mkv';
    s.overrides.setInfos(key(A), { year: 2001 });
    s.overrides.setInfos(key(B), { year: 1900 });
    s.follow.moved(A, B);
    assert.deepEqual(s.overrides.get(key(B))?.infos, { year: 2001 });
    assert.equal(s.overrides.get(key(A)), undefined);
    assert.ok(s.catalog.element(key(C)));
  });

  it('élément déjà dans la liste sous la nouvelle clé : il n’y est pas deux fois', () => {
    const s = setup();
    s.lists.create('À voir');
    s.lists.add('l1', [key(A), key(OTHER)]);
    s.follow.moved(A, OTHER);
    assert.deepEqual(
      s.lists.get('l1')!.items.map((i) => i.key),
      [key(OTHER)],
    );
  });

  it('dossier renommé : positions de reprise et « Reprendre » passent sous le nouveau chemin', () => {
    const s = setup();
    s.usage.saveResume(A, 600, 3000);
    s.usage.saveResume(OTHER, 700, 3000);
    s.usage.addRecent({ path: OTHER, name: 'd.mkv', kind: 'video' });
    s.usage.addRecent({ path: C, name: 'c.mkv', kind: 'video' });

    s.follow.moved('/bib/Films', '/bib/Cinema');

    const A2 = '/bib/Cinema/a.mkv';
    const C2 = '/bib/Cinema/Saga/c.mkv';
    assert.equal(s.usage.resume(A2), 600);
    assert.equal(s.usage.resume(A), 0);
    assert.equal(s.usage.resume(OTHER), 700, 'un dossier au nom proche ne bouge pas');
    assert.deepEqual(
      s.usage.get().recent.map((r) => [r.path, r.key, r.name]),
      [
        [C2, key(C2), 'c.mkv'],
        [OTHER, key(OTHER), 'd.mkv'],
      ],
    );
  });

  it('fichier renommé : sa position le suit et remplace celle restée à l’arrivée ; « Reprendre » sans doublon', () => {
    const s = setup();
    const B = '/bib/Films/b.mkv';
    s.usage.saveResume(A, 600, 3000);
    s.usage.saveResume(B, 100, 3000);
    s.usage.addRecent({ path: B, name: 'b.mkv', kind: 'video' });
    s.usage.addRecent({ path: A, name: 'a.mkv', kind: 'video' });
    s.follow.moved(A, B);
    assert.deepEqual(s.usage.get().resume, { [key(B)]: 600 });
    assert.deepEqual(
      s.usage.get().recent.map((r) => [r.path, r.name]),
      [[B, 'a.mkv']],
    );
  });

  it('suppression : position de reprise et « Reprendre » restent (une vidéo remise de la corbeille retrouve sa position)', () => {
    const s = setup();
    s.usage.saveResume(C, 600, 3000);
    s.usage.addRecent({ path: C, name: 'c.mkv', kind: 'video' });
    const before = s.usage.get();
    s.follow.removed('/bib/Films/Saga');
    assert.equal(s.usage.get(), before);
    assert.equal(s.usage.resume(C), 600);
  });

  it('suppression : l’élément quitte le catalogue, la liste le garde indisponible, les modifications restent', () => {
    const s = setup();
    s.overrides.setInfos(key(C), { year: 2001 });
    s.lists.create('À voir');
    s.lists.add('l1', [key(C)]);
    s.follow.removed('/bib/Films/Saga');
    assert.equal(s.catalog.element(key(C)), null);
    assert.ok(s.catalog.element(key(A)));
    assert.deepEqual(
      s.lists.get('l1')!.items.map((i) => [i.key, i.available]),
      [[key(C), false]],
    );
    assert.deepEqual(s.overrides.get(key(C))?.infos, { year: 2001 });
    assert.equal(s.rescans(), 0);
  });
});

describe('clés après un déplacement', () => {
  it('fichier local, jeu de console, jeu PC ; le reste ne change pas', () => {
    assert.equal(movedKey(key('/a/b/c.mkv'), '/a/b', '/x', 'linux'), key('/x/c.mkv'));
    assert.equal(movedKey(key('/a/b'), '/a/b', '/x', 'linux'), key('/x'));
    assert.equal(movedKey(key('/a/bc/d.mkv'), '/a/b', '/x', 'linux'), null);
    assert.equal(movedKey(romKey('snes|1', '/roms/z.sfc', 'linux'), '/roms', '/jeux', 'linux'), romKey('snes|1', '/jeux/z.sfc', 'linux'));
    assert.equal(movedKey(pcGameKey('/jeux/x.exe', 'linux'), '/jeux', '/pc', 'linux'), pcGameKey('/pc/x.exe', 'linux'));
    assert.equal(movedKey(pcGameKey('steam://rungameid/1', 'linux'), '/jeux', '/pc', 'linux'), null);
    assert.equal(movedKey('remote:https://nas/a.mkv', '/a', '/b', 'linux'), null);
    assert.equal(movedKey('tv:svc|1', '/a', '/b', 'linux'), null);
  });

  it('sous Windows : sans casse, `\\` ou `/`', () => {
    const k = localFileKey('C:\\Films\\Saga\\C.mkv', 'win32');
    assert.equal(movedKey(k, 'c:/films', 'D:\\Cinema', 'win32'), localFileKey('d:/cinema/saga/c.mkv', 'win32'));
    assert.equal(movedKey(k, 'C:\\Film', 'D:\\Cinema', 'win32'), null);
  });

  it('anciennes clés (meta.json, fiches en ligne) : chemin réécrit avec la forme du système', () => {
    assert.equal(movedLegacyKey('v:/a/b/c.mkv', '/a/b', '/x', 'linux'), 'v:/x/c.mkv');
    assert.equal(movedLegacyKey('a:/a/b', '/a/b', '/x', 'linux'), 'a:/x');
    assert.equal(movedLegacyKey('v:https://nas/a/b', '/a', '/x', 'linux'), null);
    assert.equal(movedLegacyKey('g:jeu', '/a', '/x', 'linux'), null);
    assert.equal(movedLegacyKey('t:C:\\Musique\\Album\\01.flac', 'c:\\musique', 'D:\\Sons', 'win32'), 't:D:\\Sons\\Album\\01.flac');
  });
});
