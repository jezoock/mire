// Racines et fichiers autorisés par la configuration (reprise de allowedRoots / allowedFiles de l'ancien index.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allowedFiles, allowedRoots } from '../../src/main/security/allowed.ts';

const cfg = (over: Record<string, unknown> = {}) =>
  ({
    library: { sources: [{ location: '/home/moi/Films' }, { location: 'https://exemple.fr/films/' }] },
    gameSources: [{ location: '/home/moi/Jeux' }],
    emulators: [
      { id: 'snes', romsDir: '/roms/snes', imagesDir: '/images/snes', sources: ['/nas/snes', 'https://roms.example/snes/'], banner: '/b/snes.png' },
      { id: 'nes', sources: [] },
    ],
    games: [
      { name: 'Jeu', path: '/jeux/jeu.exe', image: '/jeux/jeu.png' },
      { name: 'Sans image', path: '/jeux/x.exe' },
    ],
    ...over,
  }) as never;

describe('allowedRoots', () => {
  it('dossiers des sources, des jeux et des consoles, puis les dossiers de données, dans cet ordre', () => {
    assert.deepEqual(allowedRoots(cfg(), ['/data/scrape/img', '/data/meta/img', '/data/cache/roms']), [
      '/home/moi/Films',
      '/home/moi/Jeux',
      '/roms/snes',
      '/images/snes',
      '/nas/snes',
      '/data/scrape/img',
      '/data/meta/img',
      '/data/cache/roms',
    ]);
  });

  it('ignore les adresses web et un dossier d’images qui n’est pas un chemin', () => {
    const roots = allowedRoots(cfg({ emulators: [{ id: 'x', sources: [], imagesDir: 42 }] }), []);
    assert.deepEqual(roots, ['/home/moi/Films', '/home/moi/Jeux']);
  });
});

describe('allowedFiles', () => {
  it('image des jeux PC et bannière des consoles, sans les champs vides', () => {
    assert.deepEqual(allowedFiles(cfg()), ['/jeux/jeu.png', '/b/snes.png']);
  });
});
