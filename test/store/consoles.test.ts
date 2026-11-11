// Consoles créées et mises à jour par la boutique (identifiant `store` = `<émulateur>:<système>`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { consoleEntry, mergeConsoles, removeConsoles } from '../../src/main/store/consoles.ts';
import { EMULATORS } from '../../src/main/store/catalog/index.ts';

const duck = EMULATORS.find((e) => e.id === 'duckstation')!;
const ps1 = duck.systems[0];

test('consoles : fiche d’une console de la boutique', () => {
  assert.deepEqual(consoleEntry(duck, ps1, '/emu/duck', ['-batch', '{rom}'], '/roms'), {
    name: 'PlayStation',
    path: '/emu/duck',
    args: ['-batch', '{rom}'],
    romsDir: path.join('/roms', 'PlayStation'),
    extensions: ps1.ext,
    system: 'Sony - PlayStation',
    store: 'duckstation:ps1',
  });
});

test('consoles : ajout, puis mise à jour qui garde le dossier de jeux et les réglages', () => {
  const other = { id: 'x', name: 'Autre', path: '/autre' };
  const first = mergeConsoles([other], [consoleEntry(duck, ps1, '/v1', [], '/roms')]);
  assert.equal(first.length, 2);
  const edited = [other, { ...first[1], id: 'ps1-id', romsDir: '/mes/jeux', banner: 'b.png' }];
  const second = mergeConsoles(edited, [consoleEntry(duck, ps1, '/v2', [], '/roms')]);
  assert.equal(second.length, 2);
  assert.equal(second[0], other);
  assert.deepEqual(second[1], { ...edited[1], path: '/v2', romsDir: '/mes/jeux' });
});

test('consoles : désinstallation de l’émulateur seulement', () => {
  const list = [{ store: 'duckstation:ps1' }, { store: 'retroarch:nes' }, { name: 'à la main' }];
  assert.deepEqual(removeConsoles(list, 'duckstation'), [{ store: 'retroarch:nes' }, { name: 'à la main' }]);
});
