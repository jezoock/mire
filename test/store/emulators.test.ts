// Émulateurs des plugins (P5-19a) : lecture des contributions `apps` de genre `emulator` par le cœur (forme vérifiée,
// motifs simples, adresses `https:`), plugin factice activé puis désactivé, plugin non officiel ignoré ; une console
// installée se lance encore sans le plugin ; installation simulée de RetroArch et DuckStation (mêmes consoles qu'avant).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';
import { readPluginEmulator, readPluginEmulators } from '../../src/main/plugins/emulators.ts';
import { filePattern, linkPattern, readArgs } from '../../src/main/store/catalog/read.ts';
import { EMULATORS } from '../../src/main/store/catalog/index.ts';
import { createStore } from '../../src/main/store/index.ts';
import { findDownloadLink } from '../../src/main/store/installers/download-page.ts';
import { createJournal } from '../../src/main/plugins/journal.ts';
import { createPluginService } from '../../src/main/plugins/service.ts';
import { createPluginState } from '../../src/main/plugins/state.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { DEFAULT_CONFIG } from '../../src/main/config/index.ts';
import { launchRom } from '../../src/main/games/roms/launch.ts';
import { emulatorEntry, fixtureTranslate, pluginEmulators } from './emulator-fixtures.ts';

type Any = any;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-emulateurs-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

// Émulateur factice : un de chaque champ.
const ALPHA = {
  kind: 'emulator',
  site: 'https://alpha.example.org',
  source: { github: 'alpha-emu/alpha', files: { windows: 'alpha-*-win64.zip', linux: 'Alpha-x86_64.AppImage' } },
  program: { windows: 'alpha.exe', linux: 'Alpha-x86_64.AppImage' },
  args: ['--plein-ecran', '{rom}'],
  consoles: [
    { id: 'ps1', libretro: 'Sony - PlayStation', folder: 'PlayStation', extensions: ['.cue', '.chd'] },
    { id: 'gb', libretro: 'Nintendo - Game Boy', folder: 'Game Boy', extensions: ['.gb'], args: ['--gb', '{rom}'] },
  ],
  bios: { portable: { markers: ['portable.txt'], dir: ['bios'] }, windows: ['documents', 'Alpha', 'bios'], linux: ['xdgData', 'alpha', 'bios'] },
};

const entry = (data: unknown, pluginId = 'org.essai.emulateurs', id = 'alpha'): ContributionEntry => ({
  pluginId,
  kind: 'apps',
  id,
  declaration: { id, file: 'alpha.json' },
  data,
});
const read = (data: unknown) => readPluginEmulator(entry(data), (k) => k);
const without = (k: string) => Object.fromEntries(Object.entries(ALPHA).filter(([x]) => x !== k));

describe('lecture des émulateurs', () => {
  it('lit une forme valide : site, source, programme, arguments, consoles, BIOS et textes du plugin', () => {
    const emu = read(ALPHA)!;
    const prefix = 'pluginTexts.org_essai_emulateurs.apps.alpha.';
    assert.deepEqual(
      [emu.id, emu.plugin, emu.site, emu.args, emu.texts, emu.retroarch],
      [
        'alpha',
        'org.essai.emulateurs',
        'https://alpha.example.org',
        ['--plein-ecran', '{rom}'],
        { desc: `${prefix}description`, bios: `${prefix}bios` },
        undefined,
      ],
    );
    // Sans texte du nom : l'identifiant.
    assert.equal(emu.name, 'alpha');
    assert.equal(readPluginEmulator(entry(ALPHA), (k) => (k.endsWith('.name') ? 'Alpha' : k))!.name, 'Alpha');
    assert.deepEqual(
      emu.systems.map((s) => [s.id, s.name, s.folder, s.libretro, s.ext, s.args]),
      [
        ['ps1', 'PlayStation', 'PlayStation', 'Sony - PlayStation', ['.cue', '.chd'], undefined],
        ['gb', 'Game Boy', 'Game Boy', 'Nintendo - Game Boy', ['.gb'], ['--gb', '{rom}']],
      ],
    );
    assert.deepEqual(emu.bios, ALPHA.bios && { portable: ALPHA.bios.portable, win32: ALPHA.bios.windows, linux: ALPHA.bios.linux });
    const src = emu.source as Any;
    assert.equal(src.github, 'alpha-emu/alpha');
    assert.ok(src.win32.test('alpha-1.2-win64.zip') && !src.win32.test('alpha-1.2-win32.zip'));
    // Programme : sans distinction de casse sous Windows seulement.
    assert.ok(emu.exe.win32!.test('ALPHA.EXE') && emu.exe.linux!.test('Alpha-x86_64.AppImage') && !emu.exe.linux!.test('alpha-x86_64.appimage'));
  });

  it('refuse un émulateur dont un champ obligatoire est absent ou mal formé', () => {
    const bad: [string, unknown][] = [
      ['autre genre', { ...ALPHA, kind: 'player' }],
      ['site en http', { ...ALPHA, site: 'http://alpha.example.org' }],
      ['site avec identifiants', { ...ALPHA, site: 'https://moi:secret@alpha.example.org' }],
      ['sans site', without('site')],
      ['dépôt mal écrit', { ...ALPHA, source: { github: '../alpha', files: ALPHA.source.files } }],
      ['dépôt sans fichier', { ...ALPHA, source: { github: 'alpha-emu/alpha', files: {} } }],
      ['source inconnue', { ...ALPHA, source: { ftp: 'ftp://alpha' } }],
      ['buildbot inconnu', { ...ALPHA, source: { buildbot: 'autre' } }],
      ['page en http', { ...ALPHA, source: { page: 'http://alpha.example.org/dl', links: { windows: 'http://alpha.example.org/*.zip' } } }],
      ['sans programme', without('program')],
      ['programme avec un chemin', { ...ALPHA, program: { windows: '..\\cmd.exe' } }],
      ['autre variable', { ...ALPHA, args: ['--titre={title}', '{rom}'] }],
      ['sans {rom}', { ...ALPHA, args: ['--plein-ecran'] }],
      ['deux fois {rom}', { ...ALPHA, args: ['{rom}', '{rom}'] }],
      ['arguments vides', { ...ALPHA, args: [] }],
      ['aucune console utilisable', { ...ALPHA, consoles: [{ id: 'x', libretro: 'Console inconnue', folder: 'X', extensions: ['.x'] }] }],
    ];
    for (const [label, data] of bad) assert.equal(read(data), null, label);
    assert.equal(readPluginEmulator({ ...entry(ALPHA), kind: 'packs' }), null);
    assert.equal(readPluginEmulator(entry(ALPHA, 'org.essai.emulateurs', 'Alpha:1')), null, 'identifiant mal formé');
  });

  it('ignore une console mal formée, et garde les autres', () => {
    const consoles = [
      ALPHA.consoles[0],
      { ...ALPHA.consoles[1], folder: '../Game Boy' },
      { ...ALPHA.consoles[1], id: 'gb2', folder: 'C:\\Jeux' },
      { ...ALPHA.consoles[1], id: 'gb3', extensions: ['gb'] },
      { ...ALPHA.consoles[1], id: 'gb4', libretro: 'Nintendo - Inconnue' },
      { ...ALPHA.consoles[1], id: 'gb5', args: ['{url}'] },
      { ...ALPHA.consoles[0] },
    ];
    assert.deepEqual(
      read({ ...ALPHA, consoles })!.systems.map((s) => s.id),
      ['ps1'],
    );
  });

  it('buildbot : chaque console donne son cœur ; le cœur fabrique la ligne de commande (arguments ignorés)', () => {
    const data = { ...ALPHA, source: { buildbot: 'retroarch' }, consoles: [{ ...ALPHA.consoles[1], core: 'gambatte' }, ALPHA.consoles[0]] };
    const emu = read(data)!;
    assert.deepEqual([emu.retroarch, emu.source, emu.args], [true, undefined, undefined]);
    assert.deepEqual(
      emu.systems.map((s) => [s.id, s.core, s.args]),
      [['gb', 'gambatte', undefined]],
    );
    assert.equal(read({ ...data, consoles: [{ ...ALPHA.consoles[1], core: '../x' }] }), null);
  });

  it('motifs simples : `*` et `?` seulement, ancrés, bornés ; un motif mal formé est ignoré', () => {
    // Les autres caractères sont pris tels quels, jamais comme une expression régulière.
    const p = filePattern('alpha.(v?)+.zip')!;
    assert.ok(p.test('alpha.(v1)+.zip'));
    assert.ok(!p.test('alphaX(v1)+.zip') && !p.test('alpha.(v1).zip') && !p.test('xalpha.(v1)+.zip') && !p.test('alpha.(v1)+.zip.sig'));
    for (const bad of ['', '*', '**', 'a/b.zip', 'a\\b.exe', 'a:b', '*a*b*c*d*e', 'x'.repeat(101), 'a\u0000b', 42, null])
      assert.equal(filePattern(bad), null, String(bad));
    assert.ok(filePattern('*a*b*c*d'));
    // Programme mal formé pour un système : ce système seulement est ignoré.
    const emu = read({ ...ALPHA, program: { windows: 'a/b.exe', linux: 'Alpha-*.AppImage' } })!;
    assert.deepEqual(Object.keys(emu.exe), ['linux']);
    // Fichier mal formé pour un système : la source ne vaut que pour l'autre.
    const src = read({ ...ALPHA, source: { github: 'alpha-emu/alpha', files: { windows: 'a/b', linux: '*.AppImage' } } })!.source as Any;
    assert.deepEqual([src.win32, src.linux instanceof RegExp], [undefined, true]);
  });

  it('page de téléchargement : lien `https:` de l’hôte de la page ou d’un sous-domaine, hôte écrit en entier', () => {
    const host = 'alpha.example.org';
    const link = linkPattern('https://dl.alpha.example.org/releases/*/alpha-*-x64.7z', host)!;
    const html =
      '<a href="https://dl.alpha.example.org/releases/2.1/alpha-2.1-x64.7z">x</a> <a href="https://dl.alpha.example.org/releases/2.1/alpha-2.1-x64.7z.sig">';
    assert.deepEqual(findDownloadLink(html, link), {
      url: 'https://dl.alpha.example.org/releases/2.1/alpha-2.1-x64.7z',
      name: 'alpha-2.1-x64.7z',
      version: '2.1',
    });
    // `*` ne franchit ni `/` ni guillemet ; un lien plus long ne correspond pas.
    assert.equal(findDownloadLink('<a href="https://dl.alpha.example.org/releases/a/b/alpha-1-x64.7z">', link), null);
    assert.equal(findDownloadLink('<a href="https://dl.alpha.example.org/releases/1/alpha-1-x64.7z.sig">', link), null);
    for (const bad of [
      'http://alpha.example.org/a.zip',
      'https://autre.example.net/a.zip',
      'https://*.alpha.example.org/a.zip',
      'https://alpha.example.org.pirate.net/a.zip',
      'https://alpha.example.org',
      'https://alpha.example.org/a b.zip',
      'https://alpha.example.org/a.zip?x=1',
    ])
      assert.equal(linkPattern(bad, host), null, bad);
    // Lien mal formé : la page n'a plus de lien utilisable, l'émulateur est ignoré.
    assert.equal(read({ ...ALPHA, source: { page: 'https://alpha.example.org/dl', links: { windows: 'https://autre.example.net/*.zip' } } }), null);
  });

  it('arguments : `{rom}` une fois, aucune autre variable, bornés', () => {
    assert.deepEqual(readArgs(['-f', '--jeu={rom}']), ['-f', '--jeu={rom}']);
    for (const bad of [['{rom}', '{start}'], ['{ rom }'], ['{rom'], ['x'.repeat(65), '{rom}'], Array(9).fill('{rom}'), 'x', [1, '{rom}']])
      assert.equal(readArgs(bad), null, JSON.stringify(bad));
  });

  it('BIOS mal décrits : ignorés (l’émulateur reste, sans dossier de BIOS)', () => {
    for (const bios of [
      { windows: ['racine', 'x'], linux: ['xdgData', 'x'] },
      { windows: ['documents', '..'], linux: ['xdgData', 'x'] },
      { windows: ['documents', 'a/b'], linux: ['xdgData', 'x'] },
      { windows: ['documents', 'x'] },
    ])
      assert.equal(read({ ...ALPHA, bios })!.bios, undefined, JSON.stringify(bios));
    // Mode portable mal décrit : seul le mode portable est ignoré.
    const b = read({ ...ALPHA, bios: { ...ALPHA.bios, portable: { markers: ['../x'], dir: ['bios'] } } })!.bios!;
    assert.deepEqual([b.portable, b.win32], [undefined, ALPHA.bios.windows]);
  });

  it('deux émulateurs du même identifiant : celui du cœur, puis le premier plugin', () => {
    const list = readPluginEmulators([entry(ALPHA, 'org.zeta'), entry(ALPHA, 'org.beta'), entry({ ...ALPHA }, 'org.beta', 'pcsx2')], EMULATORS, (k) => k);
    assert.deepEqual(
      list.map((e) => [e.id, e.plugin]),
      [['alpha', 'org.beta']],
    );
  });

  it('les plugins RetroArch et DuckStation se lisent en entier (aucun champ ignoré)', () => {
    for (const id of ['retroarch', 'duckstation']) {
      const e = emulatorEntry(id);
      const emu = readPluginEmulator(e, fixtureTranslate)!;
      const data = e.data as Any;
      assert.equal(emu.systems.length, data.consoles.length, id);
      assert.deepEqual(
        Object.keys(emu.exe).sort(),
        Object.keys(data.program)
          .map((k) => (k === 'windows' ? 'win32' : k))
          .sort(),
        id,
      );
      assert.ok(emu.bios?.win32 && emu.bios.linux, id);
      assert.ok(!!emu.bios?.portable === !!data.bios.portable, id);
    }
  });
});

/** Plugin factice : un émulateur, données seules, avec ses textes. */
function fakePlugin(dir: string, id: string) {
  const catalog = (code: string) =>
    JSON.stringify({
      meta: { code, name: code, app: '1.0.0' },
      messages: { plugin: { name: 'Essai' }, apps: { alpha: { name: 'Alpha', description: 'Un émulateur', bios: 'alpha.bin' } } },
    });
  const files: Record<string, string> = {
    'mire-plugin.json': JSON.stringify({
      id,
      version: '1.0.0',
      engines: { mire: '^1.0.0' },
      level: 'data',
      contributes: { apps: [{ id: 'alpha', file: 'alpha.json' }] },
      i18n: 'i18n/',
    }),
    'alpha.json': JSON.stringify(ALPHA),
    'i18n/en.json': catalog('en'),
    'i18n/fr.json': catalog('fr'),
  };
  for (const [rel, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), c);
  }
}

function pluginService(name: string) {
  const bundled = path.join(root, name, 'resources', 'plugins');
  const installed = path.join(root, name, 'userData', 'plugins');
  fs.mkdirSync(bundled, { recursive: true });
  fs.mkdirSync(installed, { recursive: true });
  const s = createPluginService({
    roots: { bundled, installed },
    appVersion: '1.0.0',
    languages: ['fr', 'en'],
    state: createPluginState(path.join(installed, 'state.json')),
    journal: createJournal({ dir: path.join(installed, 'logs') }),
    tagRegistry: createRegistry((k) => k),
    setTexts: () => {},
    translate: (k) => k,
    locale: () => 'fr',
    runners: () => ({
      isolated: () => Promise.reject(new Error('aucun code ici')),
      inProcess: () => Promise.reject(new Error('aucun code ici')),
      base: () => '',
      shutdown: () => {},
    }),
    onTaggersChange: () => {},
    refresh: () => {},
    watchdog: { interval: 0, timeout: 0 },
  });
  return { s, bundled, installed };
}

/** Boutique dont les émulateurs sont ceux du service des plugins, avec une configuration en mémoire. */
function storeWith(name: string, emulators: () => readonly Any[], cfg: Any = { ...DEFAULT_CONFIG, emulators: [] }) {
  let config = cfg;
  const dataDir = path.join(root, name, 'data');
  const store = createStore({
    dataDir,
    defaultRomsRoot: path.join(root, name, 'roms'),
    getConfig: () => config,
    saveConfig: (c) => (config = c),
    onProgress: () => {},
    extract: async () => {},
    emulators,
  });
  return { store, config: () => config, dataDir };
}

describe('émulateurs dans le service des plugins et la boutique', () => {
  it('plugin inclus activé : l’émulateur est dans la boutique ; désactivé : il en sort, sa console installée se lance encore', async () => {
    const { s, bundled } = pluginService('inclus');
    fakePlugin(path.join(bundled, 'org.essai.emulateurs'), 'org.essai.emulateurs');
    await s.start();
    // La console a été installée par la boutique : la configuration garde son programme et ses arguments.
    const ps1 = {
      id: 'alpha:ps1',
      name: 'PlayStation',
      path: '/emu/alpha/Alpha-x86_64.AppImage',
      args: ['--plein-ecran', '{rom}'],
      sources: [],
      romsDir: '/roms/PlayStation',
      extensions: ['.cue'],
      system: 'Sony - PlayStation',
      store: 'alpha:ps1',
    };
    const { store, config } = storeWith('inclus', () => [...s.emulators(EMULATORS), ...EMULATORS], { ...DEFAULT_CONFIG, emulators: [ps1] });
    const card = store.catalog().emulators.find((e: Any) => e.id === 'alpha');
    assert.ok(card);
    assert.deepEqual(
      card.systems.map((x: Any) => [x.id, x.installed]),
      [
        ['ps1', true],
        ['gb', false],
      ],
    );
    assert.equal(card.desc, 'pluginTexts.org_essai_emulateurs.apps.alpha.description');
    // Textes du plugin non branchés ici (traduction par la clé) : le nom retombe sur l'identifiant.
    assert.equal(store.emulatorName('alpha'), 'alpha');

    await s.setEnabled('org.essai.emulateurs', false);
    assert.equal(
      store.catalog().emulators.some((e: Any) => e.id === 'alpha'),
      false,
    );
    assert.equal((await store.install('alpha', [])).ok, false);
    assert.equal(store.biosDir('alpha'), null);
    // Sans le plugin, la console se lance avec le programme et les arguments de la configuration.
    const calls: Any[] = [];
    const deps: Any = {
      config: { get: config },
      access: { isAllowed: () => true },
      launcher: { launchProcess: async (exe: string, args: string[]) => (calls.push([exe, args]), { ok: true }) },
      downloads: () => ({}),
      romCacheDir: () => root,
      toUi: () => {},
    };
    assert.deepEqual(await launchRom(deps, 'alpha:ps1', '/roms/PlayStation/Jeu.cue'), { ok: true });
    assert.deepEqual(calls, [['/emu/alpha/Alpha-x86_64.AppImage', ['--plein-ecran', '/roms/PlayStation/Jeu.cue']]]);
    await s.stop();
  });

  it('plugin installé hors du dépôt officiel : actif, mais aucun émulateur', async () => {
    const { s, installed } = pluginService('local');
    fakePlugin(path.join(installed, 'org.essai.local', '1.0.0'), 'org.essai.local');
    await s.start();
    await s.setEnabled('org.essai.local', true);
    assert.ok(s.list().some((p) => p.id === 'org.essai.local' && p.enabled));
    assert.deepEqual(s.emulators(), []);
    await s.stop();
  });
});

// Installation simulée (pas de réseau : le fetch répond comme GitHub et le buildbot) : mêmes adresses, mêmes fichiers
// et mêmes consoles qu'avant P5-19a, pour la plateforme de la machine de test (Linux ou Windows).
const PLATFORM = process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : null;

describe(
  'installation de RetroArch et DuckStation depuis leurs plugins (source simulée)',
  { skip: !PLATFORM && 'boutique : Windows et Linux seulement' },
  () => {
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    after(() => {
      globalThis.fetch = realFetch;
    });

    function mockFetch(routes: Record<string, () => Response>) {
      globalThis.fetch = (async (url: string | URL) => {
        const u = String(url);
        fetched.push(u);
        const r = routes[u];
        if (!r) throw new Error(`accès réseau inattendu : ${u}`);
        return r();
      }) as typeof fetch;
    }
    const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
    const html = (body: string) => () => new Response(body, { headers: { 'content-type': 'text/html' } });
    const bytes = () => new Response(new Uint8Array(16), { headers: { 'content-length': '16' } });

    it(
      'DuckStation : dernière version GitHub, fichier de la plateforme, console PlayStation',
      { skip: PLATFORM !== 'linux' && 'Linux seulement' },
      async () => {
        fetched.length = 0;
        const repo = 'https://github.com/stenzek/duckstation';
        const file = 'DuckStation-x64.AppImage';
        const others = ['duckstation-windows-arm64-release.zip', 'DuckStation-x64.AppImage', 'duckstation-windows-x64-release.zip'];
        mockFetch({
          [`${repo}/releases/latest`]: redirect(`${repo}/releases/tag/v0.1-9669`),
          [`${repo}/releases/expanded_assets/v0.1-9669`]: html(others.map((f) => `<a href="/stenzek/duckstation/releases/download/v0.1-9669/${f}">`).join('')),
          [`${repo}/releases/download/v0.1-9669/${file}`]: bytes,
        });
        const { store, config, dataDir } = storeWith('duck', pluginEmulators);
        const r = await store.install('duckstation');
        {
          assert.equal(r.ok, true, r.error);
          const exe = path.join(dataDir, 'emulators', 'duckstation', 'DuckStation-x64.AppImage');
          assert.deepEqual(fetched, [`${repo}/releases/latest`, `${repo}/releases/expanded_assets/v0.1-9669`, `${repo}/releases/download/v0.1-9669/${file}`]);
          assert.deepEqual(config().emulators, [
            {
              name: 'PlayStation',
              path: exe,
              args: ['-batch', '-fullscreen', '{rom}'],
              romsDir: path.join(root, 'duck', 'roms', 'PlayStation'),
              extensions: ['.cue', '.chd', '.m3u', '.pbp', '.iso'],
              system: 'Sony - PlayStation',
              store: 'duckstation:ps1',
            },
          ]);
          const card: Any = store.catalog().emulators.find((e: Any) => e.id === 'duckstation');
          assert.deepEqual([card.installed, card.version, card.name], [true, 'v0.1-9669', 'DuckStation']);
          assert.equal(card.bios.hint, 'pluginTexts.mire_emulator_duckstation.apps.duckstation.bios');
        }
      },
    );

    it('RetroArch : programme et cœurs du buildbot, une console par système choisi', { skip: PLATFORM !== 'linux' && 'Linux seulement' }, async () => {
      fetched.length = 0;
      const repo = 'https://github.com/libretro/RetroArch';
      const bb = 'https://buildbot.libretro.com';
      mockFetch({
        [`${repo}/releases/latest`]: redirect(`${repo}/releases/tag/v1.21.0`),
        [`${repo}/releases/expanded_assets/v1.21.0`]: html(''),
        [`${bb}/stable/1.21.0/linux/x86_64/RetroArch.7z`]: bytes,
        [`${bb}/nightly/linux/x86_64/latest/fceumm_libretro.so.zip`]: bytes,
        [`${bb}/nightly/linux/x86_64/latest/genesis_plus_gx_libretro.so.zip`]: bytes,
      });
      let config: Any = { ...DEFAULT_CONFIG, emulators: [] };
      const dataDir = path.join(root, 'ra', 'data');
      // Extraction factice : l'archive du programme donne le programme, celle d'un cœur donne le cœur.
      const extract = async (archive: string, dest: string) => {
        fs.mkdirSync(dest, { recursive: true });
        const name = path.basename(archive).startsWith('RetroArch') ? 'RetroArch-Linux-x86_64.AppImage' : `${path.basename(archive, '.zip')}_libretro.so`;
        fs.writeFileSync(path.join(dest, name), '');
      };
      const store = createStore({
        dataDir,
        defaultRomsRoot: path.join(root, 'ra', 'roms'),
        getConfig: () => config,
        saveConfig: (c) => (config = c),
        onProgress: () => {},
        extract,
        emulators: pluginEmulators,
      });
      assert.equal((await store.install('retroarch', [])).ok, false, 'au moins une console');
      const r = await store.install('retroarch', ['nes', 'md', 'sms']);
      assert.equal(r.ok, true, r.error);
      assert.deepEqual(fetched, [
        `${repo}/releases/latest`,
        `${repo}/releases/expanded_assets/v1.21.0`,
        `${bb}/stable/1.21.0/linux/x86_64/RetroArch.7z`,
        `${bb}/nightly/linux/x86_64/latest/fceumm_libretro.so.zip`,
        `${bb}/nightly/linux/x86_64/latest/genesis_plus_gx_libretro.so.zip`,
      ]);
      const dir = path.join(dataDir, 'emulators', 'retroarch');
      const exe = path.join(dir, 'RetroArch-Linux-x86_64.AppImage');
      const core = (c: string) => path.join(dir, 'cores', `${c}_libretro.so`);
      const roms = (f: string) => path.join(root, 'ra', 'roms', f);
      assert.deepEqual(config.emulators, [
        {
          name: 'NES',
          path: exe,
          args: ['-f', '-L', core('fceumm'), '{rom}'],
          romsDir: roms('NES'),
          extensions: ['.nes', '.fds', '.unf', '.zip'],
          system: 'Nintendo - Nintendo Entertainment System',
          store: 'retroarch:nes',
        },
        {
          name: 'Mega Drive',
          path: exe,
          args: ['-f', '-L', core('genesis_plus_gx'), '{rom}'],
          romsDir: roms('Mega Drive'),
          extensions: ['.md', '.gen', '.smd', '.bin', '.zip'],
          system: 'Sega - Mega Drive - Genesis',
          store: 'retroarch:md',
        },
        {
          name: 'Master System',
          path: exe,
          args: ['-f', '-L', core('genesis_plus_gx'), '{rom}'],
          romsDir: roms('Master System'),
          extensions: ['.sms', '.zip'],
          system: 'Sega - Master System - Mark III',
          store: 'retroarch:sms',
        },
      ]);
      const card: Any = store.catalog().emulators.find((e: Any) => e.id === 'retroarch');
      assert.deepEqual([card.installed, card.version, card.retroarch, card.available], [true, '1.21.0', true, true]);
      assert.equal(card.bios.dir, path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'retroarch', 'system'));
      assert.equal(card.bios.hint, 'pluginTexts.mire_emulator_retroarch.apps.retroarch.bios');
      // Deuxième installation : le programme et les cœurs déjà là sont réutilisés.
      fetched.length = 0;
      assert.equal((await store.install('retroarch', ['gg'])).ok, true);
      assert.deepEqual(fetched, []);
      assert.equal(config.emulators.length, 4);
    });
  },
);
