// Logique métier sortie des handlers IPC (P1-08) : marque-pages de streaming, export et import de la configuration
// (les jeux ont leurs tests dans test/games/). Contexte factice, fichiers dans un dossier temporaire.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createConfigService, DEFAULT_CONFIG } from '../../src/main/config/index.ts';
import { exportConfig, importConfig } from '../../src/main/ipc/handlers/config.ts';
import { createAccessPolicy } from '../../src/main/security/access-policy.ts';
import { addBookmark, removeBookmark } from '../../src/main/ipc/handlers/bookmarks.ts';
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
    access: createAccessPolicy({ roots: () => [] }),
    scraper: { one: async (job: Any) => (log.push(['scrape', job.item.name, job.override]), { ok: true }) },
    electron: { dialog: {}, shell: {}, app: {} },
    mainWindow: null,
    ...extra,
  };
  return { ctx: ctx as MainContext, log };
}

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
