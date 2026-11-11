// Politique d'accès aux fichiers : racines, fichiers désignés, fichiers ouverts, Windows, cache des racines.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAccessPolicy } from '../../src/main/security/access-policy.ts';

describe('createAccessPolicy (POSIX)', () => {
  const policy = () =>
    createAccessPolicy({
      roots: () => ['/home/moi/Films', '/mnt/nas/roms/'],
      files: () => ['/home/moi/Images/jeu.png', '', undefined as unknown as string],
      platform: 'linux',
    });

  it('accepte un fichier sous une racine, refuse le reste', () => {
    const p = policy();
    assert.equal(p.isAllowed('/home/moi/Films/Alien.mkv'), true);
    assert.equal(p.isAllowed('/mnt/nas/roms/snes/Zelda.sfc'), true);
    assert.equal(p.isAllowed('/home/moi/.ssh/id_rsa'), false);
    assert.equal(p.isAllowed('/home/moi/FilmsCaches/x.mkv'), false);
  });

  it('refuse la racine elle-même, un segment « .. », un chemin relatif ou vide', () => {
    const p = policy();
    assert.equal(p.isAllowed('/home/moi/Films'), false);
    assert.equal(p.isAllowed('/home/moi/Films/../.ssh/id_rsa'), false);
    assert.equal(p.isAllowed('Films/Alien.mkv'), false);
    assert.equal(p.isAllowed(''), false);
    assert.equal(p.isAllowed(null), false);
    assert.equal(p.isAllowed(42), false);
  });

  it('accepte un fichier désigné par la configuration, et lui seul', () => {
    const p = policy();
    assert.equal(p.isAllowed('/home/moi/Images/jeu.png'), true);
    assert.equal(p.isAllowed('/home/moi/Images/autre.png'), false);
  });

  it('accepte un fichier ouvert explicitement, sensible à la casse', () => {
    const p = policy();
    assert.equal(p.isAllowed('/tmp/video.mp4'), false);
    p.allowFile('/tmp/video.mp4');
    assert.equal(p.isAllowed('/tmp/video.mp4'), true);
    assert.equal(p.isAllowed('/tmp/VIDEO.mp4'), false);
    assert.equal(p.isAllowed('/tmp/autre.mp4'), false);
  });

  it('isInside suit la même règle', () => {
    const p = policy();
    assert.equal(p.isInside('/a/b/c.nes', ['/a/b']), true);
    assert.equal(p.isInside('/a/bc.nes', ['/a/b']), false);
  });
});

describe('createAccessPolicy (Windows)', () => {
  const p = createAccessPolicy({
    roots: () => ['D:\\Films', '\\\\NAS\\Roms'],
    files: () => ['C:\\Jeux\\Image.PNG'],
    platform: 'win32',
  });

  it('ignore la casse et accepte les deux séparateurs', () => {
    assert.equal(p.isAllowed('d:\\films\\Alien.mkv'), true);
    assert.equal(p.isAllowed('D:/Films/Alien.mkv'), true);
    assert.equal(p.isAllowed('\\\\nas\\roms\\snes\\zelda.sfc'), true);
    assert.equal(p.isAllowed('c:\\jeux\\image.png'), true);
    assert.equal(p.isAllowed('C:\\Windows\\win.ini'), false);
  });

  it('fichier ouvert : casse ignorée', () => {
    p.allowFile('E:\\Vidéos\\Clip.MP4');
    assert.equal(p.isAllowed('e:\\vidéos\\clip.mp4'), true);
  });
});

describe('createAccessPolicy : cache des racines', () => {
  it('calcule les racines une fois, puis à nouveau après invalidate()', () => {
    let calls = 0;
    let roots = ['/films'];
    const p = createAccessPolicy({
      roots: () => (calls++, roots),
      platform: 'linux',
    });
    for (let i = 0; i < 1000; i++) p.isAllowed(`/films/f${i}.mkv`);
    assert.equal(calls, 1);
    roots = ['/series'];
    assert.equal(p.isAllowed('/series/s.mkv'), false);
    p.invalidate();
    assert.equal(p.isAllowed('/series/s.mkv'), true);
    assert.equal(p.isAllowed('/films/f.mkv'), false);
    assert.equal(calls, 2);
  });
});
