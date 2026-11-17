// Modifications faites à la main (P2-04) : reprise de l'ancien meta/meta.json sans perte, fiches gardées sous leur
// ancienne clé quand elles ne correspondent à aucun élément, rattachement après une analyse.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElementSourceRef } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { localFileKey } from '../../src/main/catalog/keys.ts';
import { legacyTarget, metaToOverride, overrideToMeta } from '../../src/main/catalog/legacy-meta.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { createTargetFinder, pcNameTarget } from '../../src/main/catalog/targets.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import { createUserMeta } from '../../src/main/meta/user-meta.ts';

const HTTP: ElementSourceRef = { plugin: 'src-http', instance: 'https://nas/films' };
const TV: ElementSourceRef = { plugin: 'src-m3u', instance: 'http://box/liste.m3u' };
const FILMS: ElementSourceRef = { plugin: 'src-local', instance: '/films' };

const local = (p: string): ElementInput => ({
  key: localFileKey(p, 'linux'),
  name: path.basename(p),
  open: { kind: 'file', path: p },
  tags: [],
  infos: {},
  images: {},
});
const remote = (url: string): ElementInput => ({ key: `remote:${url}`, name: url, open: { kind: 'file', path: url }, tags: [], infos: {}, images: {} });
const stream = (url: string): ElementInput => ({ key: `m3u:${TV.instance}|${url}`, name: url, open: { kind: 'stream', url }, tags: [], infos: {}, images: {} });

// Fiches telles que l'interface historique les écrit (patchMeta : textes sans espaces autour).
const LEGACY = {
  'v:/films/Amélie.mkv': {
    title: 'Le Fabuleux Destin',
    year: '2001',
    genre: 'Comédie, Romance',
    overview: 'Paris.',
    image: '/data/meta/img/a.jpg',
    backdrop: '/data/meta/img/b.jpg',
  },
  'v:https://nas/films/b.mkv': { title: 'Sur le NAS' },
  'v:http://box/stream?id=1': { title: 'Chaîne 1' },
  'v:http://box/stream?id=9': { title: 'Pas encore analysée' },
  't:/musique/01 - One More Time.mp3': { title: 'One More Time', genre: 'House' },
  'a:/musique/Discovery': { title: 'Discovery', artist: 'Daft Punk', year: '2001', image: '/data/meta/img/c.jpg' },
  'i:/photos/IMG_1.jpg': { title: 'Plage' },
  'r:/roms/snes/zelda.sfc': { title: 'Zelda' },
  'g:celeste': { title: 'Celeste', genre: 'Plateforme' },
  'b:abc123': { title: 'Jeu en attente' },
  'c:snes': { image: '/data/meta/img/snes.png' },
  'v:/films/annee.mkv': { year: 'vers 1990' },
};

function setup(legacy: Record<string, unknown> | null = LEGACY, prepare?: (catalog: ReturnType<typeof createCatalog>) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-overrides-'));
  const legacyFile = path.join(dir, 'meta', 'meta.json');
  if (legacy) {
    fs.mkdirSync(path.dirname(legacyFile));
    fs.writeFileSync(legacyFile, JSON.stringify(legacy, null, 2));
  }
  const catalog = createCatalog({ dir: path.join(dir, 'catalog', 'sources'), debounceMs: 0, onIgnored: () => {} });
  prepare?.(catalog);
  const file = path.join(dir, 'catalog', 'overrides.json');
  const overrides = createOverrides({ file, legacyFile, platform: 'linux', find: createTargetFinder(catalog), onIgnored: () => {} });
  const report = overrides.load();
  const engine = createTagEngine({ catalog, overrides, registry: createRegistry((k) => k), rules: () => fileTagRules(undefined) });
  const meta = createUserMeta({ overrides, imgDir: path.join(dir, 'meta', 'img'), chooseImage: async () => null });
  return { dir, file, legacyFile, catalog, overrides, report, engine, meta };
}

describe('reprise de meta.json', () => {
  it('sans perte : la façade rend exactement les mêmes fiches, sous les mêmes clés', () => {
    const { meta, legacyFile } = setup();
    assert.deepEqual(meta.all(), LEGACY);
    // L'ancien fichier est laissé en place, intact.
    assert.deepEqual(JSON.parse(fs.readFileSync(legacyFile, 'utf8')), LEGACY);
  });

  it('chaque fiche rejoint la clé de son élément ; dossier, jeu PC, console et adresse inconnue restent sous leur ancienne clé', () => {
    const { overrides, report } = setup(LEGACY, (catalog) => {
      catalog.setSource(HTTP, [remote('https://nas/films/b.mkv')]);
      catalog.setSource(TV, [stream('http://box/stream?id=1')]);
    });
    assert.deepEqual(overrides.keys().sort(), [
      'gamebm:abc123',
      'local:/films/Amélie.mkv',
      'local:/films/annee.mkv',
      'local:/musique/01 - One More Time.mp3',
      'local:/photos/IMG_1.jpg',
      `m3u:${TV.instance}|http://box/stream?id=1`,
      'remote:https://nas/films/b.mkv',
    ]);
    assert.deepEqual(report!.unmatched.sort(), ['a:/musique/Discovery', 'c:snes', 'g:celeste', 'r:/roms/snes/zelda.sfc', 'v:http://box/stream?id=9']);
    assert.equal(report!.matched, 7);
    assert.deepEqual(overrides.get('local:/films/Amélie.mkv'), {
      infos: { title: 'Le Fabuleux Destin', year: 2001, genres: ['Comédie', 'Romance'], overview: 'Paris.' },
      images: { poster: '/data/meta/img/a.jpg', background: '/data/meta/img/b.jpg' },
      legacy: 'v:/films/Amélie.mkv',
    });
    // Une année qui n'est pas un nombre reste un texte.
    assert.deepEqual(overrides.get('local:/films/annee.mkv')!.infos, { year: 'vers 1990' });
  });

  it('les infos reprises s’appliquent aux éléments (titre, année, genres, images)', () => {
    const { catalog, engine } = setup();
    catalog.setSource(FILMS, [local('/films/Amélie.mkv')]);
    const e = engine.element('local:/films/Amélie.mkv')!;
    assert.deepEqual(e.infos, { extension: 'mkv', title: 'Le Fabuleux Destin', year: 2001, genres: ['Comédie', 'Romance'], overview: 'Paris.' });
    assert.deepEqual(e.images, { poster: '/data/meta/img/a.jpg', background: '/data/meta/img/b.jpg' });
    assert.deepEqual(engine.withInfo('genres', 'Romance'), ['local:/films/Amélie.mkv']);
  });

  it('une adresse analysée plus tard rejoint son élément ; la façade la rend toujours sous son ancienne clé', () => {
    const { catalog, overrides, engine, meta } = setup();
    assert.ok(overrides.unmatched().includes('v:http://box/stream?id=9'));
    catalog.setSource(TV, [stream('http://box/stream?id=9')]);
    const key = `m3u:${TV.instance}|http://box/stream?id=9`;
    assert.ok(!overrides.unmatched().includes('v:http://box/stream?id=9'));
    assert.equal(overrides.get(key)!.legacy, 'v:http://box/stream?id=9');
    assert.equal(engine.element(key)!.infos.title, 'Pas encore analysée');
    assert.deepEqual(meta.all(), LEGACY);
  });

  it('une seule fois : relu ensuite depuis overrides.json, même si meta.json change', () => {
    const { file, legacyFile } = setup();
    fs.writeFileSync(legacyFile, JSON.stringify({ 'v:/autre.mkv': { title: 'Autre' } }));
    const overrides = createOverrides({ file, legacyFile, platform: 'linux' });
    assert.equal(overrides.load(), null);
    assert.deepEqual(overrides.legacyAll(), LEGACY);
  });

  it('meta.json absent ou illisible : rien à reprendre', () => {
    assert.equal(setup(null).report, null);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-overrides-'));
    const legacyFile = path.join(dir, 'meta.json');
    fs.writeFileSync(legacyFile, '{ cassé');
    const reasons: string[] = [];
    const overrides = createOverrides({ file: path.join(dir, 'overrides.json'), legacyFile, onIgnored: (f) => reasons.push(f) });
    assert.equal(overrides.load(), null);
    assert.deepEqual(reasons, [legacyFile]);
    assert.deepEqual(overrides.legacyAll(), {});
  });

  it('deux anciennes clés pour un même élément : la seconde reste à part, rien n’est perdu', () => {
    const legacy = { 'v:/films/a.mkv': { title: 'A' }, 'v:/films/./a.mkv': { title: 'A bis' } };
    const { overrides, meta } = setup(legacy);
    assert.deepEqual(overrides.keys(), ['local:/films/a.mkv']);
    assert.deepEqual(overrides.unmatched(), ['v:/films/./a.mkv']);
    assert.deepEqual(meta.all(), legacy);
  });
});

describe('correspondance des anciennes clés', () => {
  it('clé déduite pour un chemin local et un marque-page de jeu ; à retrouver pour une adresse, une ROM ou un jeu PC', () => {
    assert.deepEqual(legacyTarget('v:C:\\Films\\A.mkv', 'win32'), { key: 'local:c:/films/a.mkv' });
    assert.deepEqual(legacyTarget('t:/m/a.mp3', 'linux'), { key: 'local:/m/a.mp3' });
    assert.deepEqual(legacyTarget('i:https://nas/a.jpg', 'linux'), { find: { target: 'https://nas/a.jpg', kinds: ['file', 'stream', 'site'] } });
    assert.deepEqual(legacyTarget('r:/roms/a.sfc', 'linux'), { find: { target: '/roms/a.sfc', kinds: ['game'] } });
    assert.deepEqual(legacyTarget('b:x1', 'linux'), { key: 'gamebm:x1' });
    // Jeu PC : par son nom simplifié, parmi les programmes (P2-03).
    assert.deepEqual(legacyTarget('g:celeste', 'linux'), { find: { target: pcNameTarget('celeste'), kinds: ['program'] } });
    for (const k of ['a:/m', 'g:', 'c:snes', 'b: ', 'sans-prefixe', '']) assert.deepEqual(legacyTarget(k, 'linux'), {}, k);
  });

  it('champs ↔ infos et images, aller-retour', () => {
    const meta = { title: 'T', year: '1999', genre: 'A, B', overview: 'O', artist: 'X', image: '/i.jpg', backdrop: '/b.jpg' };
    const parts = metaToOverride(meta);
    assert.deepEqual(parts, {
      infos: { title: 'T', year: 1999, genres: ['A', 'B'], overview: 'O', artist: 'X' },
      images: { poster: '/i.jpg', background: '/b.jpg' },
    });
    assert.deepEqual(overrideToMeta(parts), meta);
    // Écritures que la façade normalise : « 01999 » reste un texte, des genres sans espace en reçoivent un.
    assert.deepEqual(overrideToMeta(metaToOverride({ year: '01999', genre: 'A,B' })), { year: '01999', genre: 'A, B' });
    assert.equal(overrideToMeta({}), null);
  });
});
