// Logique métier sortie des handlers IPC (P1-08) : suppression et nettoyage des jeux, copie locale d'un jeu,
// marque-pages, export et import de la configuration. Contexte factice, fichiers dans un dossier temporaire.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createConfigService, DEFAULT_CONFIG } from '../../src/main/config/index.ts';
import { exportConfig, importConfig } from '../../src/main/ipc/handlers/config.ts';
import { cleanupGames, deleteGame, downloadGame } from '../../src/main/ipc/handlers/games.ts';
import {
  addBookmark,
  addGameBookmark,
  downloadGameBookmark,
  removeBookmark,
  removeGameBookmark,
  setGameBookmarkConsole,
} from '../../src/main/ipc/handlers/bookmarks.ts';
import type { MainContext } from '../../src/main/ipc/context.ts';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-ipc-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const write = (rel: string, text = 'x') => {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

type Any = any;

// Contexte factice : vrai service de configuration (fichier dans le dossier temporaire) ; chaque enregistrement est
// noté « saveConfig » dans le journal.
function makeContext(config: Any = {}, extra: Any = {}) {
  const log: Any[] = [];
  const service = createConfigService({ file: path.join(tmp, `config-${Math.random().toString(36).slice(2)}.json`) });
  service.replace(config);
  service.onChange(() => log.push(['saveConfig']));
  const ctx: Any = {
    config: service,
    consoleLocations(emu: Any) {
      const main = emu.romsDir ? [{ location: emu.romsDir, remote: false }] : [];
      return [...main, ...(emu.sources || []).map((loc: string) => ({ location: loc, remote: /^https?:/.test(loc) }))];
    },
    downloads: {
      addUrl: (url: string, dlCtx: Any) => (log.push(['addUrl', url, dlCtx]), { ok: true, id: 'd1' }),
      addPending: (source: string, dlCtx: Any) => (log.push(['addPending', source, dlCtx]), { id: 'p1' }),
      remove: (id: string) => log.push(['remove', id]),
      startPending: (id: string) => log.push(['startPending', id]),
    },
    scraper: { one: async (job: Any) => (log.push(['scrape', job.item.name, job.override]), { ok: true }) },
    electron: { dialog: {}, shell: {}, app: {} },
    mainWindow: null,
    ...extra,
  };
  return { ctx: ctx as MainContext, log };
}

describe('deleteGame', () => {
  it('retire un jeu PC ajouté à la main', async () => {
    const { ctx } = makeContext({
      games: [
        { name: 'A', path: 'a.exe' },
        { name: 'B', path: 'b.exe' },
      ],
    });
    const r: Any = await deleteGame(ctx, { kind: 'game', manualIndex: 0 });
    assert.equal(r.ok, true);
    assert.deepEqual(
      ctx.config.get().games.map((g: Any) => g.name),
      ['B'],
    );
    assert.equal(r.config, ctx.config.get());
  });

  it('refuse un jeu trouvé dans un dossier, un jeu en ligne ou sans console', async () => {
    const { ctx } = makeContext({ emulators: [{ id: 'nes', name: 'NES', path: 'nes.exe', romsDir: tmp }] });
    assert.match((await deleteGame(ctx, { kind: 'game' })).error!, /trouvé automatiquement/);
    assert.match((await deleteGame(ctx, { kind: 'rom', consoleId: 'nes', path: 'https://exemple.org/jeu.nes' })).error!, /en ligne/);
    assert.match((await deleteGame(ctx, { kind: 'rom', consoleId: 'inconnue', path: write('jeu.nes') })).error!, /aucune console/);
  });

  it('ne supprime pas un fichier hors des dossiers de la console', async () => {
    const outside = write('ailleurs/jeu.nes');
    const { ctx } = makeContext({ emulators: [{ id: 'nes', name: 'NES', path: 'nes.exe', romsDir: path.join(tmp, 'roms') }] });
    const r = await deleteGame(ctx, { kind: 'rom', consoleId: 'nes', path: outside });
    assert.match(r.error!, /ne se trouve pas dans les dossiers de NES/);
    assert.ok(fs.existsSync(outside));
  });

  it('supprime un jeu sur disque avec ses pistes, mais pas un dossier', async () => {
    const cue = write('roms/jeu.cue', 'FILE "jeu (piste 1).bin" BINARY\n  TRACK 01 MODE1/2352\n');
    const bin = write('roms/jeu (piste 1).bin');
    write('roms/dossier/x');
    const { ctx } = makeContext({ emulators: [{ id: 'ps1', name: 'PS1', path: 'ps1.exe', romsDir: path.join(tmp, 'roms') }] });
    assert.match((await deleteGame(ctx, { kind: 'rom', consoleId: 'ps1', path: path.join(tmp, 'roms', 'dossier') })).error!, /pas un dossier/);
    assert.deepEqual(await deleteGame(ctx, { kind: 'rom', consoleId: 'ps1', path: cue }), { ok: true });
    assert.equal(fs.existsSync(cue), false);
    assert.equal(fs.existsSync(bin), false);
  });
});

describe('cleanupGames', () => {
  it('retire les jeux PC dont le fichier a disparu et garde les adresses', async () => {
    const present = write('present.exe');
    const { ctx } = makeContext({
      games: [
        { name: 'Présent', path: present },
        { name: 'Disparu', path: path.join(tmp, 'disparu.exe') },
        { name: 'Steam', path: 'steam://rungameid/1' },
      ],
    });
    const r: Any = await cleanupGames(ctx, false);
    assert.deepEqual(
      { ok: r.ok, missingLocal: r.missingLocal, missingRemote: r.missingRemote, removedManual: r.removedManual, checked: r.checked },
      { ok: true, missingLocal: ['Disparu'], missingRemote: [], removedManual: 1, checked: 3 },
    );
    assert.deepEqual(
      ctx.config.get().games.map((g: Any) => g.name),
      ['Présent', 'Steam'],
    );
    assert.equal(r.config, ctx.config.get());
  });

  it('ne touche pas à la configuration quand tout est là', async () => {
    const { ctx, log } = makeContext({ games: [{ name: 'Présent', path: write('present.exe') }] });
    const r: Any = await cleanupGames(ctx, false);
    assert.equal(r.removedManual, 0);
    assert.equal('config' in r, false);
    assert.deepEqual(log, []);
  });
});

describe('downloadGame', () => {
  it('demande une console existante avec un dossier principal', async () => {
    const { ctx } = makeContext({ emulators: [{ id: 'nes', name: 'NES', path: 'nes.exe' }] });
    assert.match((await downloadGame(ctx, 'inconnue', 'https://exemple.org/jeu.nes')).error!, /n’existe plus/);
    assert.match((await downloadGame(ctx, 'nes', 'https://exemple.org/jeu.nes')).error!, /dossier principal de NES/);
  });

  it('confie un fichier simple au gestionnaire de téléchargements', async () => {
    const { ctx, log } = makeContext({ emulators: [{ id: 'nes', name: 'NES', path: 'nes.exe', romsDir: tmp }] });
    assert.deepEqual(await downloadGame(ctx, 'nes', 'https://exemple.org/jeu.nes'), { ok: true, id: 'd1', count: 1 });
    assert.deepEqual(log, [['addUrl', 'https://exemple.org/jeu.nes', { console: 'nes' }]]);
  });

  it('télécharge l’index d’un jeu sur disque et les pistes manquantes dans un dossier au nom du jeu', async () => {
    const { ctx, log } = makeContext({ emulators: [{ id: 'ps1', name: 'PS1', path: 'ps1.exe', romsDir: tmp }] });
    write('jeu/jeu.bin'); // déjà là : pas retéléchargé
    (ctx.downloads as Any).fetchText = async () => 'FILE "jeu.bin" BINARY\nFILE "jeu 2.bin" BINARY\n';
    const r = await downloadGame(ctx, 'ps1', 'https://exemple.org/jeux/jeu.cue');
    assert.deepEqual(r, { ok: true, count: 2, total: 3 });
    assert.deepEqual(
      log.map((l) => [l[1], l[2].saveAs, l[2].group]),
      [
        ['https://exemple.org/jeux/jeu.cue', path.join(tmp, 'jeu', 'jeu.cue'), 'jeu'],
        ['https://exemple.org/jeux/jeu%202.bin', path.join(tmp, 'jeu', 'jeu 2.bin'), 'jeu'],
      ],
    );
  });
});

describe('marque-pages de streaming', () => {
  it('refusent une adresse invalide ou un titre vide', async () => {
    const { ctx } = makeContext();
    assert.match((await addBookmark(ctx, { url: 'ftp://x', title: 'A' })).error!, /Adresse/);
    assert.match((await addBookmark(ctx, { url: 'https://www.exemple.org/serie', title: ' ' })).error!, /titre/);
  });

  it('s’ajoutent, se scrapent aussitôt et se retirent', async () => {
    const { ctx, log } = makeContext();
    const r: Any = await addBookmark(ctx, { url: 'https://www.exemple.org/serie', title: 'Série', type: 'tv', season: '2', episode: '3' });
    assert.equal(r.ok, true);
    assert.equal(r.scraped, true);
    assert.deepEqual(
      { ...r.bookmark, id: '', added: 0 },
      { id: '', url: 'https://www.exemple.org/serie', title: 'Série', type: 'tv', season: 2, episode: 3, site: 'exemple.org', added: 0 },
    );
    assert.deepEqual(ctx.config.get().bookmarks, [r.bookmark]);
    assert.deepEqual(log[1], ['scrape', 'Série', { type: 'tv', title: 'Série', year: '' }]);
    assert.deepEqual(removeBookmark(ctx, r.bookmark.id), { ok: true, config: ctx.config.get() });
    assert.deepEqual(ctx.config.get().bookmarks, []);
  });

  it('s’ajoutent même si le scraping échoue', async () => {
    const { ctx } = makeContext({}, { scraper: { one: async () => Promise.reject(new Error('hors ligne')) } });
    const consoleError = console.error;
    console.error = () => {};
    try {
      const r: Any = await addBookmark(ctx, { url: 'https://exemple.org/film', title: 'Film' });
      assert.equal(r.ok, true);
      assert.equal(r.scraped, false);
      assert.equal(r.bookmark.type, 'movie');
      assert.equal(r.bookmark.season, null);
    } finally {
      console.error = consoleError;
    }
  });
});

describe('marque-pages de jeux', () => {
  it('refusent un lien invalide', () => {
    const { ctx } = makeContext();
    assert.match(addGameBookmark(ctx, { source: 'pas un lien' }).error!, /invalide/);
  });

  it('créent un téléchargement en attente, et demandent la console si elle est inconnue', () => {
    const { ctx, log } = makeContext();
    const r: Any = addGameBookmark(ctx, { source: 'magnet:?xt=urn:btih:abc' });
    assert.equal(r.ok, true);
    assert.equal(r.needSystem, true);
    assert.equal(r.bookmark.kind, 'torrent');
    assert.equal(r.bookmark.title, 'magnet:?xt=urn:btih:abc');
    assert.equal(r.bookmark.downloadId, 'p1');
    assert.deepEqual(log[0], ['addPending', 'magnet:?xt=urn:btih:abc', { name: r.bookmark.title, gameBookmark: r.bookmark.id, console: undefined }]);
    assert.deepEqual(ctx.config.get().gameBookmarks, [r.bookmark]);
  });

  it('déduisent le titre du lien et rattachent la console ouverte', () => {
    const { ctx } = makeContext({ emulators: [{ id: 'snes', name: 'Super Nintendo', path: 'snes.exe' }] });
    const r: Any = addGameBookmark(ctx, { source: 'https://exemple.org/jeux/Mon%20jeu.zip', console: 'snes' });
    assert.equal(r.bookmark.title, 'Mon jeu');
    assert.equal(r.bookmark.kind, 'http');
    assert.equal(r.bookmark.console, 'snes');
    assert.equal(r.needSystem, false);
  });

  it('changent de console, se téléchargent et se retirent avec leur téléchargement', () => {
    const { ctx, log } = makeContext();
    const { bookmark }: Any = addGameBookmark(ctx, { source: 'https://exemple.org/jeu.zip', title: 'Jeu' });
    setGameBookmarkConsole(ctx, bookmark.id, 'snes');
    assert.equal(ctx.config.get().gameBookmarks[0].console, 'snes');
    setGameBookmarkConsole(ctx, bookmark.id, 'pc');
    assert.equal(ctx.config.get().gameBookmarks[0].console, 'pc');
    assert.match(downloadGameBookmark(ctx, 'inconnu').error!, /introuvable/);
    assert.deepEqual(downloadGameBookmark(ctx, bookmark.id), { ok: true });
    assert.deepEqual(removeGameBookmark(ctx, bookmark.id), { ok: true, config: ctx.config.get() });
    assert.deepEqual(ctx.config.get().gameBookmarks, []);
    assert.deepEqual(
      log.slice(1).map((l) => l[0] + (l[1] ? ` ${l[1]}` : '')),
      ['saveConfig', 'saveConfig', 'saveConfig', 'startPending p1', 'remove p1', 'saveConfig'],
    );
  });
});

describe('export et import de la configuration', () => {
  const dialogs = (save: Any, open: Any) => ({
    electron: { dialog: { showSaveDialog: async () => save, showOpenDialog: async () => open }, shell: {}, app: {} },
  });

  it('export : écrit la configuration là où l’utilisateur l’a choisi', async () => {
    const file = path.join(tmp, 'export.json');
    const { ctx } = makeContext({ games: [{ name: 'A', path: 'a.exe' }] }, dialogs({ canceled: false, filePath: file }, null));
    assert.deepEqual(await exportConfig(ctx), { ok: true, path: file });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), ctx.config.get());
    const canceled = makeContext({}, dialogs({ canceled: true }, null)).ctx;
    assert.deepEqual(await exportConfig(canceled), { ok: false, canceled: true });
  });

  it('import : refuse un fichier illisible', async () => {
    const file = write('abime.json', '{');
    const { ctx } = makeContext({}, dialogs(null, { canceled: false, filePaths: [file] }));
    assert.match((await importConfig(ctx, 'replace')).error!, /JSON illisible/);
    const canceled = makeContext({}, dialogs(null, { canceled: true, filePaths: [] })).ctx;
    assert.deepEqual(await importConfig(canceled), { ok: false, canceled: true });
  });

  it('import : remplace, ou complète sans doublon', async () => {
    const file = write(
      'import.json',
      JSON.stringify({
        ...DEFAULT_CONFIG,
        games: [
          { name: 'B', path: 'b.exe' },
          { name: 'A', path: 'a.exe' },
        ],
      }),
    );
    const base = {
      games: [
        { name: 'A', path: 'a.exe' },
        { name: 'C', path: 'c.exe' },
      ],
    };
    const merge = makeContext(base, dialogs(null, { canceled: false, filePaths: [file] })).ctx;
    const r: Any = await importConfig(merge, 'merge');
    assert.equal(r.ok, true);
    assert.deepEqual(
      r.config.games.map((g: Any) => g.name),
      ['A', 'C', 'B'],
    );
    const replace = makeContext(base, dialogs(null, { canceled: false, filePaths: [file] })).ctx;
    const r2: Any = await importConfig(replace, 'replace');
    assert.deepEqual(
      r2.config.games.map((g: Any) => g.name),
      ['B', 'A'],
    );
    assert.equal(r2.config, replace.config.get());
  });
});
