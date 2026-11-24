// Serveur web et liste M3U lus par un plugin (P5-12), avec un plugin factice branché comme dans Mire : contexte réel
// (`ctx.http` et l'accord de l'adresse saisie, ici sur 127.0.0.1), pont des sources et bibliothèque du cœur. Les vrais
// plugins (`mire.source.http`, `mire.source.m3u`) sont publiés dans mire-addons avec leurs propres tests.
//
// Vérifié ici : mêmes clés que le cœur (`remote:`, `m3u:`) donc listes, reprise, fiches et tags retrouvés ; mêmes
// fichiers pour l'interface historique ; sous-titres en ligne téléchargés par le cœur ; plugin désactivé : rien, sans
// erreur, l'état le dit, et tout revient à la réactivation.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ContributionKind } from '@mire/plugin-sdk';
import type { Config, LibrarySource } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { m3uEntryKey, remoteFileKey } from '../../src/main/catalog/keys.ts';
import { libraryLocations } from '../../src/main/library/locations.ts';
import { createLibraryService } from '../../src/main/library/service.ts';
import { createPluginBridges, type BridgeService } from '../../src/main/plugins/bridges.ts';
import { createContextHandler } from '../../src/main/plugins/context.ts';
import { createPluginStorage } from '../../src/main/plugins/plugin-storage.ts';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';
import { indexServer } from './fixtures.ts';

const server = await indexServer();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-remote-'));
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
const base = server.base;
const PLATFORM = process.platform;

/**
 * Plugin factice : lit la page ou la liste par `ctx.http` (l'accord est donc vérifié), puis rend des éléments écrits
 * à la main, comme les rendraient les vrais plugins.
 */
function fakeSource(ctx: { http: { getText(url: string): Promise<string | null> } }, down: { message: string | null }) {
  return {
    handles: (loc: { url?: string }) => !!loc?.url,
    async scan(loc: { url: string }) {
      // Serveur éteint : la source lève une erreur au message affichable (contrat du SDK).
      if (down.message !== null) throw new Error(down.message);
      const text = await ctx.http.getText(loc.url);
      if (text === null) throw new Error('absent');
      if (/\.m3u$/.test(loc.url)) {
        return [
          {
            key: m3uEntryKey(loc.url, 'http://flux/a', PLATFORM),
            name: 'Chaîne A',
            open: { kind: 'stream', url: 'http://flux/a' },
            infos: { playlist: 'chaines', mediaType: 'video' },
            images: { logo: 'http://logo/a.png' },
          },
          {
            key: m3uEntryKey(loc.url, `${base}/listes/musique/b.mp3`, PLATFORM),
            name: 'Morceau',
            open: { kind: 'stream', url: `${base}/listes/musique/b.mp3` },
            infos: { playlist: 'chaines' },
          },
        ];
      }
      const film = `${base}/films/Am%C3%A9lie%20(2001).mkv`;
      return [
        {
          key: remoteFileKey(film),
          name: 'Amélie (2001)',
          open: { kind: 'file', path: film },
          tags: ['remote'],
          infos: {
            folder: 'films',
            server: new URL(base).host,
            // Le second n'est pas sous l'adresse de l'emplacement : le cœur ne le téléchargera pas.
            subtitles: [`${base}/films/Am%C3%A9lie%20(2001).fr.srt`, `${base}/autre/Am%C3%A9lie%20(2001).en.srt`],
          },
          images: { poster: `${base}/films/Am%C3%A9lie%20(2001).jpg`, background: `${base}/films/fanart.jpg` },
        },
        {
          key: remoteFileKey(`${base}/films/S%C3%A9rie/S%C3%A9rie%20S01E04.mp4`),
          name: 'Série S01E04',
          open: { kind: 'file', path: `${base}/films/S%C3%A9rie/S%C3%A9rie%20S01E04.mp4` },
          infos: { folder: 'Série' },
          images: { poster: `${base}/films/S%C3%A9rie/cover.jpg` },
        },
      ];
    },
  };
}

async function wire(sources: LibrarySource[]) {
  const config = { get: () => ({ library: { sources }, bookmarks: [] }) as unknown as Config };
  const catalog = createCatalog({ dir: fs.mkdtempSync(path.join(tmp, 'catalogue-')), debounceMs: 0, onIgnored: () => {} });
  const manifest = { id: 'mire.source.factice', level: 'code', permissions: {} };
  let bridges: ReturnType<typeof createPluginBridges> | undefined;
  const forPlugin = createContextHandler({
    pickFolder: async () => null,
    folders: { list: () => [], add: () => {} },
    origins: { list: (id) => bridges?.assignedUrls(id) ?? [] },
    storage: () => createPluginStorage(path.join(tmp, '.aucun'), 0),
  });
  const port = forPlugin({ id: manifest.id, manifest: manifest as never });
  const down = { message: null as string | null };
  const calls: unknown[] = [];
  const source = fakeSource({ http: { getText: (url) => port.handle('http.getText', [url], new AbortController().signal) as Promise<string | null> } }, down);
  const entry = { pluginId: manifest.id, kind: 'sources', id: 'src-factice', declaration: { id: 'src-factice' } } as unknown as ContributionEntry;
  let enabled = true;
  const listeners = new Set<(kinds: ContributionKind[]) => void>();
  const logs: string[] = [];
  const service: BridgeService = {
    contributions: (kind) => (enabled && kind === 'sources' ? [entry] : []),
    onContributionsChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    call: async (_id, _kind, _c, method, args = [], options) => {
      if (method === 'scan') calls.push(options);
      return structuredClone(await (source as unknown as Record<string, (...a: unknown[]) => unknown>)[method](...structuredClone(args)));
    },
    levelOf: () => (enabled ? 'code' : null),
    folders: () => [],
    hosts: () => [],
    sourceRights: () => ({ trusted: true, folders: false }),
  };
  bridges = createPluginBridges({ service, catalog, log: (m) => logs.push(m) });
  const b = bridges;
  const library = createLibraryService({
    config,
    access: { allowFile: () => {}, isAllowed: () => false },
    catalog,
    claimed: (k) => b.claimed(k),
    pluginScans: () => b.rescan(),
    pluginFailure: (k) => b.failure(k),
  });
  await b.setLocations(libraryLocations(sources));
  return {
    down,
    calls,
    bridges: b,
    catalog,
    library,
    logs,
    async setEnabled(value: boolean) {
      enabled = value;
      for (const l of listeners) l(['sources']);
      await b.idle();
      await b.rescan();
    },
  };
}

describe('serveur web lu par un plugin', () => {
  const sources: LibrarySource[] = [
    { id: 'v', kind: 'video', location: `${base}/films/` },
    { id: 'i', kind: 'image', location: `${base}/films/` },
  ];

  it('mêmes clés `remote:` qu’au cœur, et mêmes fichiers pour l’interface historique', async () => {
    const { catalog, library, logs } = await wire(sources);
    const { items, status } = await library.scan();
    const film = `${base}/films/Am%C3%A9lie%20(2001).mkv`;
    assert.deepEqual(logs, []);
    const el = catalog.element(remoteFileKey(film));
    assert.equal(el?.source.plugin, 'mire.source.factice');
    assert.equal(el?.source.instance, `${base}/films/`);
    assert.deepEqual(
      items.map((i) => [i.name, i.kind, i.folder, i.dir, i.remote, i.cover, i.fanart]),
      [
        ['Amélie (2001)', 'video', 'films', `${base}/films/`, true, `${base}/films/Am%C3%A9lie%20(2001).jpg`, `${base}/films/fanart.jpg`],
        ['Série S01E04', 'video', 'Série', `${base}/films/S%C3%A9rie/`, true, `${base}/films/S%C3%A9rie/cover.jpg`, null],
      ],
    );
    assert.deepEqual([items[1].seriesTitle, items[1].season, items[1].episode], ['Série', 1, 4]);
    assert.deepEqual(status, { v: { ok: true, error: null, count: 2 }, i: { ok: true, error: null, count: 0 } });
  });

  it('sous-titres trouvés à côté d’une vidéo : téléchargés par le cœur, seulement sous l’adresse de l’emplacement', async () => {
    const { library } = await wire(sources);
    const film = `${base}/films/Am%C3%A9lie%20(2001).mkv`;
    assert.deepEqual(await library.findSubtitles(film), []);
    await library.scan();
    const subs = await library.findSubtitles(film);
    assert.deepEqual(
      subs.map((s) => [s.label, s.lang]),
      [['fr', 'fr']],
    );
    assert.match(subs[0].vtt, /^WEBVTT[\s\S]*00:00:01\.000 --> 00:00:02\.000/);
  });

  it('plugin désactivé : rien, sans erreur, l’état le dit ; réactivé : les mêmes éléments reviennent', async () => {
    const { catalog, library, setEnabled } = await wire(sources);
    await library.scan();
    const keys = catalog.keys().sort();
    await setEnabled(false);
    const off = await library.scan();
    assert.deepEqual(off.items, []);
    assert.equal(off.status.v.ok, true);
    assert.match(off.status.v.note ?? '', /aucun plugin activé/);
    assert.equal(catalog.size(), 0);
    await setEnabled(true);
    const on = await library.scan();
    assert.equal(on.items.length, 2);
    assert.deepEqual(catalog.keys().sort(), keys);
  });
});

describe('liste M3U en ligne lue par un plugin', () => {
  it('mêmes clés `m3u:` qu’au cœur, flux pour l’interface historique', async () => {
    const list = `${base}/listes/chaines.m3u`;
    const { catalog, library } = await wire([
      { id: 'v', kind: 'video', location: list },
      { id: 'a', kind: 'audio', location: list },
    ]);
    const { items, status } = await library.scan();
    assert.deepEqual(catalog.keys().sort(), [m3uEntryKey(list, 'http://flux/a', PLATFORM), m3uEntryKey(list, `${base}/listes/musique/b.mp3`, PLATFORM)].sort());
    assert.deepEqual(
      items.map((i) => [i.name, i.kind, i.path, i.native, i.folder, i.dir, i.cover]),
      [
        ['Chaîne A', 'video', 'http://flux/a', true, 'chaines', list, 'http://logo/a.png'],
        ['Morceau', 'audio', `${base}/listes/musique/b.mp3`, true, 'chaines', list, null],
      ],
    );
    assert.deepEqual(status, { v: { ok: true, error: null, count: 1 }, a: { ok: true, error: null, count: 1 } });
  });

  it('adresse inaccessible : l’état le dit, rien n’est ajouté', async () => {
    const { catalog, library, logs } = await wire([{ id: 'x', kind: 'video', location: `${base}/absente.m3u` }]);
    await library.scan();
    assert.equal(catalog.size(), 0);
    assert.ok(logs.some((m) => /absente\.m3u/.test(m)));
  });
});

describe('emplacement injoignable : le plugin reste actif, le catalogue garde la dernière analyse', () => {
  const sources: LibrarySource[] = [{ id: 'v', kind: 'video', location: `${base}/films/` }];

  it('erreur du plugin : éléments gardés, son message dans l’état de la source ; effacée après une analyse réussie', async () => {
    const { catalog, library, down, calls } = await wire(sources);
    await library.scan();
    const keys = catalog.keys().sort();
    assert.equal(keys.length, 2);
    // L'analyse d'un emplacement demande que l'exception du plugin ne le désactive pas.
    assert.ok(calls.every((o) => (o as { keepOnPluginError?: boolean }).keepOnPluginError === true));
    down.message = 'serveur injoignable';
    const off = await library.scan();
    assert.deepEqual(off.status.v, { ok: false, error: 'Emplacement inaccessible : serveur injoignable', count: 2 });
    assert.deepEqual(catalog.keys().sort(), keys);
    assert.equal(off.items.length, 2);
    down.message = null;
    const on = await library.scan();
    assert.deepEqual(on.status.v, { ok: true, error: null, count: 2 });
  });

  it('message long tronqué (500 caractères) ; message vide : texte du cœur seul', async () => {
    const { library, down } = await wire(sources);
    down.message = `<b>${'x'.repeat(600)}`;
    const { status } = await library.scan();
    assert.equal(status.v.error, `Emplacement inaccessible : <b>${'x'.repeat(497)}`);
    down.message = '';
    assert.equal((await library.scan()).status.v.error, 'Emplacement inaccessible.');
  });

  it('emplacement retiré de la configuration : son échec est oublié', async () => {
    const { bridges, library, down } = await wire(sources);
    down.message = 'serveur injoignable';
    await library.scan();
    assert.equal(bridges.failure(`${base}/films/`), 'serveur injoignable');
    await bridges.setLocations([]);
    assert.equal(bridges.failure(`${base}/films/`), null);
  });
});
