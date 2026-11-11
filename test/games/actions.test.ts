// Actions sur les jeux (P1-20) : suppression, nettoyage, copie locale d'un jeu en ligne et marque-pages de jeux
// (reprise de la fiche, A4). Dépendances factices, fichiers dans un dossier temporaire ; aucun programme lancé.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createConfigService } from '../../src/main/config/index.ts';
import { cleanupGames } from '../../src/main/games/cleanup.ts';
import { deleteGame } from '../../src/main/games/delete.ts';
import { downloadGame } from '../../src/main/games/roms/download.ts';
import {
  addGameBookmark,
  bookmarkKey,
  downloadGameBookmark,
  identifyGameFile,
  onBookmarkDownloaded,
  removeGameBookmark,
  setGameBookmarkConsole,
} from '../../src/main/games/bookmarks.ts';
import { createGames } from '../../src/main/games/index.ts';
import { createAccessPolicy } from '../../src/main/security/access-policy.ts';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-jeux-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const write = (rel: string, text = 'x') => {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

type Any = any;

// Dépendances factices : vrai service de configuration ; chaque enregistrement est noté « saveConfig » dans le
// journal, comme les appels au gestionnaire de téléchargements et au scraper.
function makeDeps(config: Any = {}, extra: Any = {}) {
  const log: Any[] = [];
  const service = createConfigService({ file: path.join(tmp, `config-${Math.random().toString(36).slice(2)}.json`) });
  service.replace(config);
  service.onChange(() => log.push(['saveConfig']));
  const dl: Any = {
    addUrl: (url: string, dlCtx: Any) => (log.push(['addUrl', url, dlCtx]), { ok: true, id: 'd1' }),
    addPending: (source: string, dlCtx: Any) => (log.push(['addPending', source, dlCtx]), { ok: true, id: 'p1' }),
    remove: (id: string) => log.push(['remove', id]),
    startPending: (id: string) => log.push(['startPending', id]),
    fetchText: async () => '',
  };
  const scraped: Record<string, Any> = {};
  const scraper: Any = {
    one: async (job: Any) => {
      log.push(['scrape', job.kind, job.item.name, job.key]);
      scraped[job.key] = { title: `Fiche de ${job.item.name}` };
      return { ok: true };
    },
    copy: (from: string, to: string) => {
      log.push(['copy', from, to]);
      if (!scraped[from] || scraped[to]) return false;
      scraped[to] = scraped[from];
      return true;
    },
    forget: (key: string) => log.push(['forget', key]),
  };
  const deps: Any = {
    config: service,
    access: createAccessPolicy({ roots: () => [] }),
    downloads: () => dl,
    scraper: () => scraper,
    ...extra,
  };
  return { deps, log, dl, scraped };
}

describe('deleteGame', () => {
  it('retire un jeu PC ajouté à la main', async () => {
    const { deps } = makeDeps({
      games: [
        { name: 'A', path: 'a.exe' },
        { name: 'B', path: 'b.exe' },
      ],
    });
    const r: Any = await deleteGame(deps, { kind: 'game', manualIndex: 0 });
    assert.equal(r.ok, true);
    assert.deepEqual(
      deps.config.get().games.map((g: Any) => g.name),
      ['B'],
    );
    assert.equal(r.config, deps.config.get());
  });

  it('refuse un jeu trouvé dans un dossier, un jeu en ligne ou sans console', async () => {
    const { deps } = makeDeps({ emulators: [{ id: 'nes', name: 'NES', path: 'nes.exe', romsDir: tmp }] });
    assert.match((await deleteGame(deps, { kind: 'game' })).error!, /trouvé automatiquement/);
    assert.match((await deleteGame(deps, { kind: 'rom', consoleId: 'nes', path: 'https://exemple.org/jeu.nes' })).error!, /en ligne/);
    assert.match((await deleteGame(deps, { kind: 'rom', consoleId: 'inconnue', path: write('jeu.nes') })).error!, /aucune console/);
  });

  it('ne supprime pas un fichier hors des dossiers de la console', async () => {
    const outside = write('ailleurs/jeu.nes');
    const { deps } = makeDeps({ emulators: [{ id: 'nes', name: 'NES', path: 'nes.exe', romsDir: path.join(tmp, 'roms') }] });
    const r = await deleteGame(deps, { kind: 'rom', consoleId: 'nes', path: outside });
    assert.match(r.error!, /ne se trouve pas dans les dossiers de NES/);
    assert.ok(fs.existsSync(outside));
  });

  it('supprime un jeu sur disque avec ses pistes, mais pas un dossier', async () => {
    const cue = write('roms/jeu.cue', 'FILE "jeu (piste 1).bin" BINARY\n  TRACK 01 MODE1/2352\n');
    const bin = write('roms/jeu (piste 1).bin');
    write('roms/dossier/x');
    const { deps } = makeDeps({ emulators: [{ id: 'ps1', name: 'PS1', path: 'ps1.exe', romsDir: path.join(tmp, 'roms') }] });
    assert.match((await deleteGame(deps, { kind: 'rom', consoleId: 'ps1', path: path.join(tmp, 'roms', 'dossier') })).error!, /pas un dossier/);
    assert.deepEqual(await deleteGame(deps, { kind: 'rom', consoleId: 'ps1', path: cue }), { ok: true });
    assert.equal(fs.existsSync(cue), false);
    assert.equal(fs.existsSync(bin), false);
  });
});

describe('cleanupGames', () => {
  it('retire les jeux PC dont le fichier a disparu et garde les adresses', async () => {
    const present = write('present.exe');
    const { deps } = makeDeps({
      games: [
        { name: 'Présent', path: present },
        { name: 'Disparu', path: path.join(tmp, 'disparu.exe') },
        { name: 'Steam', path: 'steam://rungameid/1' },
      ],
    });
    const r: Any = await cleanupGames(deps, false);
    assert.deepEqual(
      { ok: r.ok, missingLocal: r.missingLocal, missingRemote: r.missingRemote, removedManual: r.removedManual, checked: r.checked },
      { ok: true, missingLocal: ['Disparu'], missingRemote: [], removedManual: 1, checked: 3 },
    );
    assert.deepEqual(
      deps.config.get().games.map((g: Any) => g.name),
      ['Présent', 'Steam'],
    );
    assert.equal(r.config, deps.config.get());
  });

  it('en ligne : signale les sources web injoignables, sans réseau réel', async () => {
    const emulators = [
      { id: 'nes', name: 'NES', path: 'nes.exe', romsDir: tmp, sources: ['https://ok.test/roms/', 'https://ko.test/roms/', 'https://panne.test/'] },
    ];
    const head = async (url: string) => {
      if (url.includes('panne')) throw new Error('hors ligne');
      return { ok: url.includes('ok.test') };
    };
    const { deps } = makeDeps({ emulators }, { head });
    const r: Any = await cleanupGames(deps, true);
    assert.deepEqual(r.missingRemote, ['NES : https://ko.test/roms/', 'NES : https://panne.test/']);
    assert.equal(r.checked, 3);
  });

  it('ne touche pas à la configuration quand tout est là', async () => {
    const { deps, log } = makeDeps({ games: [{ name: 'Présent', path: write('present.exe') }] });
    const r: Any = await cleanupGames(deps, false);
    assert.equal(r.removedManual, 0);
    assert.equal('config' in r, false);
    assert.deepEqual(log, []);
  });
});

describe('downloadGame', () => {
  it('demande une console existante avec un dossier principal', async () => {
    const { deps } = makeDeps({ emulators: [{ id: 'nes', name: 'NES', path: 'nes.exe' }] });
    assert.match((await downloadGame(deps, 'inconnue', 'https://exemple.org/jeu.nes')).error!, /n’existe plus/);
    assert.match((await downloadGame(deps, 'nes', 'https://exemple.org/jeu.nes')).error!, /dossier principal de NES/);
  });

  it('confie un fichier simple au gestionnaire de téléchargements', async () => {
    const { deps, log } = makeDeps({ emulators: [{ id: 'nes', name: 'NES', path: 'nes.exe', romsDir: tmp }] });
    assert.deepEqual(await downloadGame(deps, 'nes', 'https://exemple.org/jeu.nes'), { ok: true, id: 'd1', count: 1 });
    assert.deepEqual(log, [['addUrl', 'https://exemple.org/jeu.nes', { console: 'nes' }]]);
  });

  it('télécharge l’index d’un jeu sur disque et les pistes manquantes dans un dossier au nom du jeu', async () => {
    const { deps, log, dl } = makeDeps({ emulators: [{ id: 'ps1', name: 'PS1', path: 'ps1.exe', romsDir: tmp }] });
    write('jeu/jeu.bin'); // déjà là : pas retéléchargé
    dl.fetchText = async () => 'FILE "jeu.bin" BINARY\nFILE "jeu 2.bin" BINARY\n';
    const r = await downloadGame(deps, 'ps1', 'https://exemple.org/jeux/jeu.cue');
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

describe('marque-pages de jeux', () => {
  it('refusent un lien invalide', () => {
    const { deps } = makeDeps();
    assert.match(addGameBookmark(deps, { source: 'pas un lien' }).error!, /invalide/);
  });

  it('créent un téléchargement en attente, et demandent la console si elle est inconnue', () => {
    const { deps, log } = makeDeps();
    const r: Any = addGameBookmark(deps, { source: 'magnet:?xt=urn:btih:abc' });
    assert.equal(r.ok, true);
    assert.equal(r.needSystem, true);
    assert.equal(r.bookmark.kind, 'torrent');
    assert.equal(r.bookmark.title, 'magnet:?xt=urn:btih:abc');
    assert.equal(r.bookmark.downloadId, 'p1');
    assert.deepEqual(log[0], ['addPending', 'magnet:?xt=urn:btih:abc', { name: r.bookmark.title, gameBookmark: r.bookmark.id, console: undefined }]);
    assert.deepEqual(deps.config.get().gameBookmarks, [r.bookmark]);
  });

  it('déduisent le titre du lien et rattachent la console ouverte', () => {
    const { deps } = makeDeps({ emulators: [{ id: 'snes', name: 'Super Nintendo', path: 'snes.exe' }] });
    const r: Any = addGameBookmark(deps, { source: 'https://exemple.org/jeux/Mon%20jeu.zip', console: 'snes' });
    assert.equal(r.bookmark.title, 'Mon jeu');
    assert.equal(r.bookmark.kind, 'http');
    assert.equal(r.bookmark.console, 'snes');
    assert.equal(r.needSystem, false);
  });

  it('changent de console, se téléchargent et se retirent avec leur téléchargement', () => {
    const { deps, log } = makeDeps();
    const { bookmark }: Any = addGameBookmark(deps, { source: 'https://exemple.org/jeu.zip', title: 'Jeu' });
    setGameBookmarkConsole(deps, bookmark.id, 'snes');
    assert.equal(deps.config.get().gameBookmarks[0].console, 'snes');
    setGameBookmarkConsole(deps, bookmark.id, 'pc');
    assert.equal(deps.config.get().gameBookmarks[0].console, 'pc');
    assert.match(downloadGameBookmark(deps, 'inconnu').error!, /introuvable/);
    assert.deepEqual(downloadGameBookmark(deps, bookmark.id), { ok: true });
    assert.deepEqual(removeGameBookmark(deps, bookmark.id), { ok: true, config: deps.config.get() });
    assert.deepEqual(deps.config.get().gameBookmarks, []);
    assert.deepEqual(
      log.slice(1).map((l) => l[0] + (l[1] ? ` ${l[1]}` : '')),
      ['saveConfig', 'saveConfig', 'saveConfig', 'startPending p1', 'remove p1', `forget ${bookmarkKey(bookmark.id)}`, 'saveConfig'],
    );
  });
});

describe('marque-pages de jeux : fiche (A4)', () => {
  const snes = { id: 'snes', name: 'Super Nintendo', path: 'snes.exe', system: 'Nintendo - Super Nintendo Entertainment System', extensions: ['sfc', 'zip'] };

  it('l’ajout cherche la fiche sous la clé du marque-page', async () => {
    const { deps, log, scraped } = makeDeps({ emulators: [snes] });
    const games = createGames(deps);
    const r: Any = await games.addBookmark({ source: 'https://exemple.org/Mon%20jeu.zip', console: 'snes' });
    assert.equal(r.ok, true);
    assert.equal(r.scraped, true);
    const key = bookmarkKey(r.bookmark.id);
    assert.deepEqual(
      log.find((l) => l[0] === 'scrape'),
      ['scrape', 'rom', 'Mon jeu', key],
    );
    assert.deepEqual(scraped[key], { title: 'Fiche de Mon jeu' });

    // Jeu PC : l'interface demande toujours le système ; la fiche (Steam) est cherchée quand il est confirmé.
    const pc: Any = await games.addBookmark({ source: 'https://exemple.org/Jeu%20PC.zip', console: 'pc' });
    assert.equal(pc.needSystem, true);
    await games.setBookmarkConsole(pc.bookmark.id, 'pc');
    assert.deepEqual(log.filter((l) => l[0] === 'scrape').pop(), ['scrape', 'pc', 'Jeu PC', bookmarkKey(pc.bookmark.id)]);
  });

  it('système inconnu : pas de recherche à l’ajout, mais quand la console est choisie', async () => {
    const { deps, log } = makeDeps({ emulators: [snes] });
    const games = createGames(deps);
    const r: Any = await games.addBookmark({ source: 'magnet:?xt=urn:btih:abc&dn=Jeu', title: 'Jeu' });
    assert.deepEqual([r.needSystem, r.scraped], [true, false]);
    assert.equal(log.filter((l) => l[0] === 'scrape').length, 0);
    const set: Any = await games.setBookmarkConsole(r.bookmark.id, 'snes');
    assert.deepEqual([set.ok, set.scraped, set.config.gameBookmarks[0].console], [true, true, 'snes']);
  });

  it('une recherche en échec n’empêche pas l’ajout', async () => {
    const { deps } = makeDeps({ emulators: [snes] });
    deps.scraper = () => ({ one: async () => Promise.reject(new Error('hors ligne')), copy: () => false, forget: () => {} });
    const r: Any = await createGames(deps).addBookmark({ source: 'https://exemple.org/Jeu.zip', console: 'snes' });
    assert.deepEqual([r.ok, r.scraped], [true, false]);
    assert.equal(deps.config.get().gameBookmarks.length, 1);
  });

  it('après téléchargement : marqué terminé, fiche reportée sur le fichier du jeu', async () => {
    const { deps, scraped } = makeDeps({ emulators: [{ ...snes, romsDir: tmp }] });
    const { bookmark }: Any = addGameBookmark(deps, { source: 'https://exemple.org/Jeu.sfc', console: 'snes' });
    scraped[bookmarkKey(bookmark.id)] = { title: 'Jeu' };
    const file = write('Jeu.sfc');
    await onBookmarkDownloaded(deps, { gameBookmark: bookmark.id, file, dir: tmp, name: 'Jeu.sfc' });
    assert.equal(deps.config.get().gameBookmarks[0].done, true);
    assert.deepEqual(scraped[`r:${file}`], { title: 'Jeu' });
  });

  it('après téléchargement : un jeu PC ou un fichier non identifiable garde sa fiche sur le marque-page', async () => {
    const { deps, log } = makeDeps({ emulators: [{ ...snes, romsDir: tmp }] });
    const pc: Any = addGameBookmark(deps, { source: 'https://exemple.org/Jeu.zip', console: 'pc' });
    await onBookmarkDownloaded(deps, { gameBookmark: pc.bookmark.id, file: write('Jeu.zip') });
    const rom: Any = addGameBookmark(deps, { source: 'https://exemple.org/Pack.zip', console: 'snes' });
    write('Pack/A.sfc');
    write('Pack/B.sfc');
    await onBookmarkDownloaded(deps, { gameBookmark: rom.bookmark.id, file: path.join(tmp, 'Pack.zip') });
    assert.deepEqual(
      deps.config.get().gameBookmarks.map((b: Any) => b.done),
      [true, true],
    );
    assert.equal(log.filter((l) => l[0] === 'copy').length, 0);
  });

  it('identifyGameFile : fichier seul, archive décompressée, torrent ; la liste .m3u l’emporte sur ses disques', async () => {
    const ps1 = { id: 'ps1', name: 'PS1', path: 'ps1.exe', sources: [], extensions: ['cue', 'bin', 'm3u'] };
    const single = write('a/Jeu.sfc');
    assert.equal(await identifyGameFile({ file: single }, snes as Any), single);
    const extracted = write('b/Jeu/Jeu.sfc');
    write('b/Jeu/lisezmoi.txt');
    assert.equal(await identifyGameFile({ file: path.join(tmp, 'b', 'Jeu.zip') }, snes as Any), extracted);
    const m3u = write('c/Jeu/Jeu.m3u');
    write('c/Jeu/Jeu (Disque 1).cue');
    write('c/Jeu/Jeu (Disque 1).bin');
    write('c/Jeu/Jeu (Disque 2).cue');
    assert.equal(await identifyGameFile({ dir: path.join(tmp, 'c'), name: 'Jeu' }, ps1 as Any), m3u);
    write('d/Jeu/Jeu (Disque 1).cue');
    write('d/Jeu/Jeu (Disque 2).cue');
    assert.equal(await identifyGameFile({ dir: path.join(tmp, 'd'), name: 'Jeu' }, ps1 as Any), null);
    assert.equal(await identifyGameFile({ file: path.join(tmp, 'absent.sfc') }, snes as Any), null);
  });
});
