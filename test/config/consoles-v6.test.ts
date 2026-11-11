// Identifiants stables des consoles (P1-07, migration v6) : attribution des identifiants, migration de la
// configuration et des fiches de `telechargements.json`, et suppression d'une console sans décalage des références.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { consoleIdAt, createConfigService, findConsole, migrate, normalizeConfig } from '../../src/main/config/index.ts';
import { assignConsoleIds } from '../../src/main/config/normalize/consoles.ts';

const require = createRequire(import.meta.url);
const { createDownloads } = require('../../src/main/downloads.js');

type Any = any;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-consoles-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;
const freshDir = () => fs.mkdirSync(path.join(root, `donnees-${++n}`), { recursive: true }) as string;
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file: string, data: unknown) => fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');

// Trois consoles d'une configuration v5 : une de la boutique, deux ajoutées à la main.
const v5Consoles = () => [
  { name: 'PlayStation', path: '/emu/duckstation', romsDir: '/roms/psx', store: 'duckstation:psx', sources: [] },
  { name: 'Super Nintendo', path: '/emu/snes9x', romsDir: '/roms/snes', sources: [] },
  { name: 'Mega Drive', path: '/emu/genesis', romsDir: '/roms/md', sources: [] },
];
const SLUG_ID = (name: string) => new RegExp(`^${name}-[0-9a-f]{6}$`);

function makeDownloads(dataDir: string, getConfig: () => Any) {
  return createDownloads({
    dataDir,
    getConfig,
    getSession: () => ({ downloadURL: () => {} }),
    defaultDir: path.join(dataDir, 'Téléchargements'),
    onChange: () => {},
    onFinished: () => {},
  });
}

test.describe('identifiants des consoles', () => {
  test('boutique : la valeur de « store » ; sinon le nom simplifié et un suffixe', () => {
    const list: Any[] = [{ name: 'PlayStation', store: 'duckstation:psx' }, { name: 'Super Nintendo' }, { name: '' }, { name: 'PC' }];
    assignConsoleIds(list);
    assert.equal(list[0].id, 'duckstation:psx');
    assert.match(list[1].id, SLUG_ID('super-nintendo'));
    assert.match(list[2].id, SLUG_ID('console'));
    // « pc » désigne les jeux PC : une console nommée « PC » reçoit son suffixe comme les autres.
    assert.match(list[3].id, SLUG_ID('pc'));
  });

  test('un identifiant existant est gardé, même si le nom change ; un doublon ou « pc » est remplacé', () => {
    const list: Any[] = [
      { id: 'snes-123456', name: 'Autre nom' },
      { id: 'snes-123456', name: 'Copie' },
      { id: 'pc', name: 'Faux PC' },
      { id: 'mame:arcade', name: 'Arcade', store: 'mame:arcade' },
      { name: 'Arcade bis', store: 'mame:arcade' },
    ];
    assignConsoleIds(list);
    assert.equal(list[0].id, 'snes-123456');
    assert.match(list[1].id, SLUG_ID('copie'));
    assert.match(list[2].id, SLUG_ID('faux-pc'));
    assert.equal(list[3].id, 'mame:arcade');
    assert.match(list[4].id, SLUG_ID('arcade-bis'));
    assert.equal(new Set(list.map((e) => e.id)).size, list.length);
  });

  test('normalizeConfig : chaque console a un identifiant, conservé d’une normalisation à l’autre', () => {
    const once = normalizeConfig({ version: 6, emulators: v5Consoles() });
    assert.deepEqual(
      once.emulators.map((e) => typeof e.id),
      ['string', 'string', 'string'],
    );
    const twice = normalizeConfig(structuredClone(once));
    assert.deepEqual(
      twice.emulators.map((e) => e.id),
      once.emulators.map((e) => e.id),
    );
  });

  test('findConsole : par identifiant, null si la console n’existe pas', () => {
    const config = { emulators: [{ id: 'a' }, { id: 'b' }] };
    assert.equal(findConsole(config, 'b'), config.emulators[1]);
    assert.equal(findConsole(config, 'c'), null);
    assert.equal(findConsole(config, null), null);
    assert.equal(findConsole(config, 1), null);
  });
});

test.describe('migration v5 → v6', () => {
  test('consoles, marque-pages de jeux : position → identifiant, « pc » et vide inchangés', () => {
    const raw: Any = {
      version: 5,
      emulators: [...v5Consoles(), { name: 'Sans chemin' }],
      gameBookmarks: [
        { id: 'b0', source: 'magnet:?a', console: 0 },
        { id: 'b2', source: 'magnet:?b', console: 2 },
        { id: 'texte', source: 'magnet:?c', console: '1' },
        { id: 'pc', source: 'magnet:?d', console: 'pc' },
        { id: 'aucune', source: 'magnet:?e', console: null },
        { id: 'supprimee', source: 'magnet:?f', console: 7 },
      ],
    };
    const { config, from, changed }: Any = migrate(raw);
    assert.equal(from, 5);
    assert.equal(changed, true);
    assert.equal(config.version, 6);
    const [psx, snes, md] = config.emulators;
    assert.equal(psx.id, 'duckstation:psx');
    assert.match(snes.id, SLUG_ID('super-nintendo'));
    assert.match(md.id, SLUG_ID('mega-drive'));
    assert.deepEqual(
      config.gameBookmarks.map((b: Any) => [b.id, b.console]),
      [
        ['b0', 'duckstation:psx'],
        ['b2', md.id],
        ['texte', snes.id],
        ['pc', 'pc'],
        ['aucune', null],
        ['supprimee', null],
      ],
    );
    // La normalisation garde les identifiants attribués par la migration, et les mêmes consoles qu'avant.
    const c = normalizeConfig(config);
    assert.deepEqual(
      c.emulators.map((e) => [e.id, e.name, e.path, e.romsDir]),
      [
        [psx.id, 'PlayStation', '/emu/duckstation', '/roms/psx'],
        [snes.id, 'Super Nintendo', '/emu/snes9x', '/roms/snes'],
        [md.id, 'Mega Drive', '/emu/genesis', '/roms/md'],
      ],
    );
    assert.deepEqual(
      c.gameBookmarks.map((b) => b.console),
      ['duckstation:psx', md.id, snes.id, 'pc', null, null],
    );
  });

  test('positions comptées dans la liste normalisée : une console sans chemin n’en occupe pas', () => {
    const { config }: Any = migrate({ version: 5, emulators: [{ name: 'Sans chemin' }, ...v5Consoles()], gameBookmarks: [{ source: 'x', console: 1 }] });
    // L'interface ne voyait pas la console sans chemin : la position 1 était la Super Nintendo.
    assert.equal(config.gameBookmarks[0].console, normalizeConfig(config).emulators[1].id);
    assert.equal(normalizeConfig(config).emulators[1].name, 'Super Nintendo');
  });

  test('configuration sans consoles ni marque-pages : rien n’est ajouté', () => {
    const { config }: Any = migrate({ version: 5, ui: {} });
    assert.equal('emulators' in config, false);
    assert.equal('gameBookmarks' in config, false);
  });

  test('consoleIdAt : position → identifiant, hors liste → null, le reste tel quel', () => {
    const emulators = [{ id: 'a' }, { id: 'b' }];
    assert.equal(consoleIdAt(emulators, 1), 'b');
    assert.equal(consoleIdAt(emulators, 2), null);
    assert.equal(consoleIdAt(emulators, undefined), null);
    assert.equal(consoleIdAt(emulators, 'pc'), 'pc');
    assert.equal(consoleIdAt(emulators, 'a'), 'a');
  });

  test('au démarrage : config.json et téléchargements en attente passent aux identifiants', async () => {
    const dataDir = freshDir();
    const file = path.join(dataDir, 'config.json');
    writeJson(file, { version: 5, emulators: v5Consoles(), gameBookmarks: [{ id: 'bm', source: 'magnet:?x', title: 'Jeu', console: 2, downloadId: 'dl' }] });
    writeJson(path.join(dataDir, 'telechargements.json'), {
      items: [
        {
          id: 'dl',
          kind: 'torrent',
          createdAt: 2,
          name: 'Jeu',
          source: 'magnet:?x',
          dir: '/roms/md',
          console: 2,
          consoleName: 'Mega Drive',
          state: 'pending',
          installers: [],
        },
        { id: 'fini', kind: 'http', createdAt: 1, name: 'Démo.zip', dir: '/dl', console: null, state: 'done', installers: [] },
        { id: 'orphelin', kind: 'http', createdAt: 0, name: 'Vieux.zip', dir: '/roms/x', console: 9, state: 'done', installers: [] },
      ],
    });
    const service = createConfigService({ file });
    const config = service.load();
    const md = config.emulators[2];
    assert.equal(md.name, 'Mega Drive');
    // La configuration migrée est réenregistrée tout de suite au format v6.
    const saved = readJson(file);
    assert.equal(saved.version, 6);
    assert.equal(saved.emulators[2].id, md.id);
    assert.equal(saved.gameBookmarks[0].console, md.id);

    const downloads = makeDownloads(dataDir, service.get);
    await downloads.start();
    await downloads.flush();
    const byId = Object.fromEntries(downloads.list().map((d: Any) => [d.id, d.console]));
    assert.deepEqual(byId, { dl: md.id, fini: null, orphelin: null });
    const items = readJson(path.join(dataDir, 'telechargements.json')).items;
    assert.equal(items.find((d: Any) => d.id === 'dl').console, md.id);
  });
});

test.describe('scénario : trois consoles, on supprime la première', () => {
  test('le marque-page et le téléchargement en attente visent toujours la troisième console (config v5)', async () => {
    const dataDir = freshDir();
    const file = path.join(dataDir, 'config.json');
    writeJson(file, { version: 5, emulators: v5Consoles(), gameBookmarks: [{ id: 'bm', source: 'magnet:?x', title: 'Sonic', console: 2, downloadId: 'dl' }] });
    writeJson(path.join(dataDir, 'telechargements.json'), {
      items: [
        {
          id: 'dl',
          kind: 'torrent',
          createdAt: 1,
          name: 'Sonic',
          source: 'magnet:?x',
          dir: '/roms/md',
          console: 2,
          consoleName: 'Mega Drive',
          state: 'pending',
          installers: [],
        },
      ],
    });
    let service = createConfigService({ file });
    service.load();
    let downloads = makeDownloads(dataDir, service.get);
    await downloads.start();
    await downloads.flush();

    // Suppression de la première console, comme le fait « Supprimer la console » de l'interface.
    const first = service.get().emulators[0].id;
    service.replace({ ...service.get(), emulators: service.get().emulators.filter((e) => e.id !== first) });

    // Nouveau démarrage : tout est relu depuis le disque.
    service = createConfigService({ file });
    const config = service.load();
    downloads = makeDownloads(dataDir, service.get);
    await downloads.start();
    assert.deepEqual(
      config.emulators.map((e) => e.name),
      ['Super Nintendo', 'Mega Drive'],
    );
    assert.equal(findConsole(config, config.gameBookmarks[0].console)?.name, 'Mega Drive');
    const dl = downloads.list().find((d: Any) => d.id === 'dl');
    assert.equal(findConsole(config, dl.console)?.name, 'Mega Drive');
  });

  test('installation v6 : un téléchargement en attente garde le dossier de sa console', async () => {
    const dataDir = freshDir();
    const service = createConfigService({ file: path.join(dataDir, 'config.json') });
    service.load();
    service.replace({ ...service.get(), emulators: v5Consoles() });
    const third = service.get().emulators[2];
    service.update((c) => ({
      ...c,
      gameBookmarks: [
        { id: 'bm', source: 'magnet:?x', kind: 'torrent', title: 'Sonic', console: third.id, system: '', downloadId: null, done: false, added: 1 },
      ],
    }));
    const downloads = makeDownloads(dataDir, service.get);
    await downloads.start();
    const { id } = downloads.addPending('https://exemple.org/sonic.zip', { name: 'Sonic', console: third.id });

    service.update((c) => ({ ...c, emulators: c.emulators.slice(1) }));

    const it = downloads.list().find((d: Any) => d.id === id);
    assert.deepEqual([it.console, it.dir, it.consoleName], [third.id, '/roms/md', 'Mega Drive']);
    assert.equal(findConsole(service.get(), it.console)?.romsDir, '/roms/md');
    assert.equal(findConsole(service.get(), service.get().gameBookmarks[0].console)?.name, 'Mega Drive');
    await downloads.flush();
  });
});
