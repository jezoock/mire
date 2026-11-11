// Fournisseur libretro (P1-16) : jaquettes, captures, genres et années, avec des réponses enregistrées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bestMatch, libretroProvider, romKey } from '../../src/main/scrape/providers/libretro.ts';
import { ScrapeRefusal } from '../../src/main/scrape/refusal.ts';
import { loadRoutes } from './fake-fetch.ts';
import { imageSource, providerContext } from './helpers.ts';
import { roms } from './scenario.ts';

const SNES = 'Nintendo_-_Super_Nintendo_Entertainment_System';
const GB = 'Nintendo_-_Game_Boy';
const thumb = (repo: string, folder: string, name: string) =>
  `https://raw.githubusercontent.com/libretro-thumbnails/${repo}/master/${folder}/${encodeURIComponent(name)}.png`;
const gbConfig = { emulators: [{ id: 'gb', name: 'Game Boy', path: 'gb.exe', extensions: ['.gb'], sources: [] }] };

test('jeu reconnu : jaquette de la région préférée, capture en fond, genre traduit et année', async (t) => {
  const { ctx } = providerContext(t, loadRoutes('libretro'));
  const r = await libretroProvider().scrape({ ...roms[0], emu: 'snes' }, undefined, ctx('r:smw'));
  assert.equal(r?.title, 'Super Mario World');
  assert.equal(r?.genre, 'Plateformes');
  assert.equal(r?.year, '1992');
  assert.equal(imageSource(r?.image), thumb(SNES, 'Named_Boxarts', 'Super Mario World (Europe)'));
  assert.equal(imageSource(r?.backdrop), thumb(SNES, 'Named_Snaps', 'Super Mario World (Europe)'));
});

test('jaquette choisie : sans capture, l’écran titre sert de fond', async (t) => {
  const { ctx } = providerContext(t, loadRoutes('libretro'));
  const r = await libretroProvider().byId({ id: 'Super Mario World (USA)' }, { path: '/r/x', name: 'x', emu: 'snes' }, ctx('r:x'));
  assert.equal(imageSource(r?.backdrop), thumb(SNES, 'Named_Titles', 'Super Mario World (USA)'));
  assert.equal(r?.year, '1992'); // faits de la clé « super mario world »
});

test('système inconnu : refus avec le message habituel', async (t) => {
  const { ctx } = providerContext(t, loadRoutes('libretro'));
  await assert.rejects(libretroProvider().scrape({ name: 'x', emu: 'inconnue' }, undefined, ctx()), (err: Error) => {
    return err instanceof ScrapeRefusal && err.message === 'Système de la console inconnu : ajoutez « system » dans sa configuration.';
  });
});

test('liste par l’API GitHub quand le serveur libretro ne la donne pas, puis gardée en cache disque', async (t) => {
  const routes = {
    'https://thumbnails.libretro.com/Nintendo%20-%20Game%20Boy/Named_Boxarts/.index': { text: '<html>erreur</html>' },
    [`https://api.github.com/repos/libretro-thumbnails/${GB}/git/trees/master?recursive=1`]: {
      json: { tree: [{ path: 'Named_Boxarts/Tetris (World).png' }, { path: 'Named_Snaps/Tetris (World).png' }, { path: 'README.md' }] },
    },
    [thumb(GB, 'Named_Boxarts', 'Tetris (World)')]: { image: 'image/png' },
  };
  const { ctx, fetch, cacheDir } = providerContext(t, routes, gbConfig as never);
  const r = await libretroProvider().scrape({ path: '/t', name: 'Tetris', emu: 'gb' }, undefined, ctx());
  assert.equal(imageSource(r?.image), thumb(GB, 'Named_Boxarts', 'Tetris (World)'));
  assert.equal(fetch.headers[1].accept, 'application/vnd.github+json');
  await new Promise((resolve) => setTimeout(resolve, 20)); // écriture du cache en arrière-plan
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cacheDir, `${GB}.json`), 'utf8')), ['Tetris (World)']);
  // Nouveau fournisseur (redémarrage) : la liste vient du cache disque.
  const before = fetch.calls.length;
  const items = await libretroProvider().candidates({ item: { emu: 'gb' }, query: 'tetris' }, ctx());
  assert.deepEqual(
    items.map((i) => i.id),
    ['Tetris (World)'],
  );
  assert.equal(fetch.calls.slice(before).filter((u) => u.includes('Named_Boxarts/.index') || u.includes('api.github.com')).length, 0);
});

test('sans liste : noms devinés avec les régions courantes ; rien trouvé → null ; annulation → undefined', async (t) => {
  const found = thumb(GB, 'Named_Boxarts', 'Zelda (France)');
  const { ctx, fetch, state } = providerContext(t, { [found]: { image: 'image/png' } }, gbConfig as never);
  const lr = libretroProvider();
  const r = await lr.scrape({ path: '/z', name: 'Zelda', emu: 'gb' }, undefined, ctx());
  assert.equal(imageSource(r?.image), found);
  assert.deepEqual(
    fetch.calls.filter((u) => u.includes('Named_Boxarts/Zelda')).map((u) => decodeURIComponent(u.split('/').pop()!)),
    ['Zelda.png', 'Zelda (Europe).png', 'Zelda (France).png'],
  );
  assert.equal(await lr.scrape({ path: '/n', name: 'Nul', emu: 'gb' }, undefined, ctx()), null);
  state.cancel = true;
  assert.equal(await lr.scrape({ path: '/n', name: 'Nul', emu: 'gb' }, undefined, ctx()), undefined);
  await assert.rejects(lr.candidates({ item: { emu: 'gb' }, query: 'x' }, ctx()), {
    message: 'La liste des jaquettes de ce système est indisponible pour le moment.',
  });
});

test('collect : jeux des consoles au système reconnu, avec l’identifiant de leur console', async (t) => {
  const { ctx } = providerContext(t, {});
  const items = await libretroProvider().collect({}, ctx());
  assert.deepEqual(
    items.map((i) => [i.path, i.emu]),
    roms.map((r) => [r.path, 'snes']),
  );
});

test('romKey et bestMatch', () => {
  assert.equal(romKey('Super Mario World (Europe) (En,Fr) [!]'), 'super mario world');
  assert.equal(bestMatch(['Tetris (USA)', 'Tetris (France)'], 'Tetris'), 'Tetris (France)');
  assert.equal(bestMatch(['Super Mario Worlds (USA)'], 'Super Mario World'), 'Super Mario Worlds (USA)');
  assert.equal(bestMatch(['Super Mario Kart (USA)'], 'Super Mario World'), null);
  assert.equal(bestMatch(['Tetris (USA)'], '(Europe)'), null);
});
