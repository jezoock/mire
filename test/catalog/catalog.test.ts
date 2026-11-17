// Catalogue d'éléments (P2-01) : stockage en mémoire, persistance par emplacement de source, événements.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElementSourceRef } from '@mire/shared';
import { createCatalog, type CatalogChange, type ElementInput } from '../../src/main/catalog/index.ts';
import { localFileKey, siteKey } from '../../src/main/catalog/keys.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { readSourceFile, sourceFileName } from '../../src/main/catalog/persistence.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { catalogHandlers } from '../../src/main/ipc/handlers/catalog.ts';
import type { MainContext } from '../../src/main/ipc/context.ts';

const freshDir = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-catalog-')), 'catalog', 'sources');

const FILMS: ElementSourceRef = { plugin: 'mire.library', instance: 'src-films' };
const SITES: ElementSourceRef = { plugin: 'mire.web', instance: 'sites' };

const film = (file: string, name = path.basename(file)): ElementInput => ({
  key: localFileKey(file, 'linux'),
  name,
  open: { kind: 'file', path: file },
  tags: ['video'],
  infos: { extension: path.extname(file) },
  images: {},
});

const site = (id: string): ElementInput => ({
  key: siteKey(id),
  name: id,
  open: { kind: 'site', url: `https://${id}.example/`, site: id },
  tags: ['stream'],
  infos: {},
  images: { logo: `/logos/${id}.png` },
});

function setup(dir = freshDir()) {
  let clock = 1000;
  const changes: CatalogChange[] = [];
  const catalog = createCatalog({ dir, debounceMs: 5, now: () => clock, onIgnored: () => {} });
  catalog.onChange((c) => changes.push(c));
  return { dir, catalog, changes, tick: (ms = 1) => (clock += ms) };
}

describe('catalogue : en mémoire', () => {
  it('garde les éléments d’une analyse, avec leur source et leur date d’ajout', () => {
    const { catalog, changes } = setup();
    const change = catalog.setSource(FILMS, [film('/films/Alien.mkv'), film('/films/Brazil.mkv')]);
    assert.deepEqual(change, { added: ['local:/films/Alien.mkv', 'local:/films/Brazil.mkv'], changed: [], removed: [] });
    assert.deepEqual(changes, [change]);
    assert.equal(catalog.size(), 2);
    assert.deepEqual(catalog.element('local:/films/Alien.mkv'), { ...film('/films/Alien.mkv'), source: FILMS, added: 1000 });
    assert.equal(catalog.element('local:/films/Casino.mkv'), null);
    assert.equal(catalog.element(42), null);
  });

  it('une nouvelle analyse annonce les ajouts, les changements et les retraits, et garde la date d’ajout', () => {
    const { catalog, changes, tick } = setup();
    catalog.setSource(FILMS, [film('/films/Alien.mkv'), film('/films/Brazil.mkv')]);
    tick(500);
    const change = catalog.setSource(FILMS, [film('/films/Brazil.mkv', 'Brazil (1985)'), film('/films/Casino.mkv')]);
    assert.deepEqual(change, { added: ['local:/films/Casino.mkv'], changed: ['local:/films/Brazil.mkv'], removed: ['local:/films/Alien.mkv'] });
    assert.equal(catalog.element('local:/films/Brazil.mkv')!.added, 1000);
    assert.equal(catalog.element('local:/films/Casino.mkv')!.added, 1500);
    assert.equal(changes.length, 2);
  });

  it('une analyse identique ne change rien et n’annonce rien', () => {
    const { catalog, changes, tick } = setup();
    catalog.setSource(FILMS, [film('/films/Alien.mkv')]);
    tick();
    assert.deepEqual(catalog.setSource(FILMS, [film('/films/Alien.mkv')]), { added: [], changed: [], removed: [] });
    assert.equal(changes.length, 1);
  });

  it('empreintes (P2-04) : un seul élément changé parmi d’autres est le seul annoncé ; les autres gardent leur objet', () => {
    const { catalog } = setup();
    const many = Array.from({ length: 50 }, (_, i) => film(`/films/${i}.mkv`));
    catalog.setSource(FILMS, many);
    const before = catalog.get('local:/films/1.mkv');
    const next = many.map((e) => structuredClone(e));
    next[7].infos = { extension: '.avi' };
    assert.deepEqual(catalog.setSource(FILMS, next), { added: [], changed: ['local:/films/7.mkv'], removed: [] });
    assert.equal(catalog.get('local:/films/1.mkv'), before);
    assert.deepEqual(catalog.element('local:/films/7.mkv')!.infos, { extension: '.avi' });
    // La source garde la main sur ce qu'elle a donné.
    next[7].infos.extension = '.mov';
    assert.deepEqual(catalog.element('local:/films/7.mkv')!.infos, { extension: '.avi' });
    // Retour à l'identique, puis une même clé fournie par un second emplacement : rien n'est annoncé.
    assert.deepEqual(catalog.setSource(FILMS, many).changed, ['local:/films/7.mkv']);
    assert.deepEqual(catalog.setSource(SITES, [film('/films/1.mkv')]), { added: [], changed: [], removed: [] });
  });

  it('les sources sont indépendantes ; une clé fournie par deux emplacements reste tant que l’un la fournit', () => {
    const { catalog } = setup();
    const SERIES: ElementSourceRef = { plugin: 'mire.library', instance: 'src-series' };
    catalog.setSource(FILMS, [film('/films/Alien.mkv')]);
    catalog.setSource(SITES, [site('netflix')]);
    // Le même fichier, vu par un dossier inclus dans le premier : il reste à l'emplacement qui l'a fourni d'abord.
    assert.deepEqual(catalog.setSource(SERIES, [film('/films/Alien.mkv', 'Autre nom')]), { added: [], changed: [], removed: [] });
    assert.equal(catalog.element('local:/films/Alien.mkv')!.name, 'Alien.mkv');
    assert.equal(catalog.size(), 2);
    // Premier emplacement retiré : l'élément passe au second.
    assert.deepEqual(catalog.removeSource(FILMS), { added: [], changed: ['local:/films/Alien.mkv'], removed: [] });
    assert.deepEqual(catalog.element('local:/films/Alien.mkv')!.source, SERIES);
    assert.deepEqual(catalog.removeSource(SERIES), { added: [], changed: [], removed: ['local:/films/Alien.mkv'] });
    assert.deepEqual(catalog.keys(), ['web:netflix']);
    assert.deepEqual(catalog.sources(), [SITES]);
  });

  it('rend une copie : la modifier ne touche pas au catalogue', () => {
    const { catalog } = setup();
    catalog.setSource(SITES, [site('netflix')]);
    const e = catalog.element('web:netflix')!;
    e.tags.push('modifié');
    assert.deepEqual(catalog.element('web:netflix')!.tags, ['stream']);
  });

  it('refuse un élément sans clé ; deux éléments de même clé : le dernier l’emporte', () => {
    const { catalog } = setup();
    assert.throws(() => catalog.setSource(FILMS, [{ ...film('/a.mkv'), key: '' }]), /sans clé/);
    catalog.setSource(FILMS, [film('/a.mkv', 'premier'), film('/a.mkv', 'second')]);
    assert.equal(catalog.element('local:/a.mkv')!.name, 'second');
  });

  it('désabonnement', () => {
    const { catalog } = setup();
    const seen: CatalogChange[] = [];
    const off = catalog.onChange((c) => seen.push(c));
    off();
    catalog.setSource(SITES, [site('netflix')]);
    assert.deepEqual(seen, []);
  });
});

describe('catalogue : persistance', () => {
  it('aller-retour : un fichier par emplacement, relu tel quel au redémarrage', async () => {
    const first = setup();
    first.catalog.setSource(FILMS, [film('/films/Alien.mkv'), film('/films/Brazil.mkv')]);
    first.catalog.setSource(SITES, [site('netflix'), site('arte')]);
    await first.catalog.flush();
    assert.deepEqual(fs.readdirSync(first.dir).sort(), [sourceFileName(FILMS), sourceFileName(SITES)].sort());

    const again = setup(first.dir);
    again.catalog.load();
    assert.deepEqual(again.catalog.keys().sort(), first.catalog.keys().sort());
    for (const key of first.catalog.keys()) assert.deepEqual(again.catalog.element(key), first.catalog.element(key));
    assert.deepEqual(again.catalog.sources().length, 2);
  });

  it('après un redémarrage, la même analyse donne les mêmes clés, ne change rien et garde les dates d’ajout', async () => {
    const first = setup();
    first.catalog.setSource(FILMS, [film('/films/Alien.mkv'), film('/films/Brazil.mkv')]);
    await first.catalog.flush();

    const again = setup(first.dir);
    again.catalog.load();
    again.tick(10_000);
    // Nouvelle analyse : autre ordre.
    const change = again.catalog.setSource(FILMS, [film('/films/Brazil.mkv'), film('/films/Alien.mkv')]);
    assert.deepEqual(change, { added: [], changed: [], removed: [] });
    assert.equal(again.catalog.element('local:/films/Alien.mkv')!.added, 1000);
  });

  it('une analyse qui ne change rien ne réécrit pas le fichier ; un changement le réécrit', async () => {
    const { catalog, dir, tick } = setup();
    catalog.setSource(FILMS, [film('/films/Alien.mkv'), film('/films/Brazil.mkv')]);
    await catalog.flush();
    const file = path.join(dir, sourceFileName(FILMS));
    fs.rmSync(file);
    tick(10);
    // Même analyse, dans un autre ordre : rien à écrire.
    catalog.setSource(FILMS, [film('/films/Brazil.mkv'), film('/films/Alien.mkv')]);
    await catalog.flush();
    assert.equal(fs.existsSync(file), false);
    catalog.setSource(FILMS, [film('/films/Brazil.mkv'), film('/films/Alien.mkv', 'Alien, le huitième passager')]);
    await catalog.flush();
    assert.equal(readSourceFile(JSON.parse(fs.readFileSync(file, 'utf8')))?.scanned, 1010);
    // Un emplacement nouveau, même vide, a son fichier.
    catalog.setSource(SITES, []);
    await catalog.flush();
    assert.ok(fs.existsSync(path.join(dir, sourceFileName(SITES))));
  });

  it('le fichier écrit est un fichier d’emplacement valide', async () => {
    const { catalog, dir } = setup();
    catalog.setSource(SITES, [site('netflix')]);
    await catalog.flush();
    const raw = JSON.parse(fs.readFileSync(path.join(dir, sourceFileName(SITES)), 'utf8'));
    const data = readSourceFile(raw)!;
    assert.deepEqual(data.source, SITES);
    assert.equal(data.scanned, 1000);
    assert.deepEqual(
      data.elements.map((e) => e.key),
      ['web:netflix'],
    );
  });

  it('un emplacement retiré : son fichier est supprimé', async () => {
    const { catalog, dir } = setup();
    catalog.setSource(FILMS, [film('/films/Alien.mkv')]);
    catalog.setSource(SITES, [site('netflix')]);
    await catalog.flush();
    catalog.removeSource(FILMS);
    await catalog.flush();
    assert.deepEqual(fs.readdirSync(dir), [sourceFileName(SITES)]);
    assert.deepEqual(catalog.removeSource(FILMS), { added: [], changed: [], removed: [] });
  });

  it('un emplacement retiré puis revenu avant l’écriture : son fichier reste', async () => {
    const { catalog, dir } = setup();
    catalog.setSource(FILMS, [film('/films/Alien.mkv')]);
    catalog.removeSource(FILMS);
    catalog.setSource(FILMS, [film('/films/Brazil.mkv')]);
    await catalog.flush();
    const again = setup(dir);
    again.catalog.load();
    assert.deepEqual(again.catalog.keys(), ['local:/films/Brazil.mkv']);
  });

  it('dossier absent : catalogue vide, rien n’est créé', () => {
    const { catalog, dir } = setup();
    catalog.load();
    assert.equal(catalog.size(), 0);
    assert.equal(fs.existsSync(dir), false);
  });

  it('écarte un fichier illisible ou d’une autre version, et les éléments mal formés', () => {
    const dir = freshDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'casse.json'), '{ pas du json');
    fs.writeFileSync(path.join(dir, 'futur.json'), JSON.stringify({ version: 99, source: FILMS, elements: [] }));
    const good = { ...site('arte'), source: { plugin: 'autre', instance: 'x' }, added: 5 };
    fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify({ version: 1, source: SITES, scanned: 7, elements: [good, { key: 'web:sans-nom' }, null] }));
    const ignored: string[] = [];
    const catalog = createCatalog({ dir, onIgnored: (file) => ignored.push(path.basename(file)) });
    catalog.load();
    assert.deepEqual(catalog.keys(), ['web:arte']);
    // La source est celle du fichier, pas celle écrite dans l'élément.
    assert.deepEqual(catalog.element('web:arte')!.source, SITES);
    assert.deepEqual(ignored.sort(), ['casse.json', 'futur.json']);
  });

  it('nom de fichier : lisible, sans caractère interdit, différent pour chaque emplacement', () => {
    const a = sourceFileName({ plugin: 'mire.library', instance: 'C:\\Films\\Séries*?' });
    assert.match(a, /^mire\.library--c-films-s-ries-[0-9a-f]{10}\.json$/);
    assert.notEqual(a, sourceFileName({ plugin: 'mire.library', instance: 'C:/Films/Séries' }));
  });
});

describe('catalogue : IPC', () => {
  it('catalogElement rend l’élément d’après sa clé, ou null', () => {
    const { catalog } = setup();
    catalog.setSource(SITES, [site('netflix')]);
    const overrides = createOverrides({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-catalog-')), 'overrides.json') });
    overrides.load();
    const tags = createTagEngine({ catalog, overrides, registry: createRegistry((k) => k), rules: () => fileTagRules(undefined) });
    const handlers = catalogHandlers({ catalog, tags } as unknown as MainContext);
    assert.equal(handlers.catalogElement('web:netflix')!.name, 'netflix');
    assert.equal(handlers.catalogElement('web:inconnu'), null);
  });
});
