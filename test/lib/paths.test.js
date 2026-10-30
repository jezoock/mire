'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isInside } = require('../../lib/paths.js');

const posix = { platform: 'linux' };
const win = { platform: 'win32' };

test('isInside (POSIX) : accepte un fichier sous une des racines', () => {
  const roots = ['/home/moi/Roms/SNES', '/mnt/nas/snes/'];
  assert.equal(isInside('/home/moi/Roms/SNES/Zelda.sfc', roots, posix), true);
  assert.equal(isInside('/home/moi/Roms/SNES/Disques/FF/disque.cue', roots, posix), true);
  assert.equal(isInside('/mnt/nas/snes/Mario.sfc', roots, posix), true);
  assert.equal(isInside('/home/moi/Roms/SNES//double.sfc', roots, posix), true);
});

test('isInside (POSIX) : refuse ce qui est hors des racines', () => {
  const roots = ['/home/moi/Roms/SNES'];
  assert.equal(isInside('/home/moi/.bashrc', roots, posix), false);
  assert.equal(isInside('/etc/passwd', roots, posix), false);
  // Dossier voisin dont le nom commence pareil.
  assert.equal(isInside('/home/moi/Roms/SNES2/jeu.sfc', roots, posix), false);
  // Sensible à la casse hors Windows.
  assert.equal(isInside('/home/moi/roms/snes/Zelda.sfc', roots, posix), false);
});

test('isInside (POSIX) : refuse la racine elle-même et les remontées', () => {
  const roots = ['/home/moi/Roms/SNES'];
  assert.equal(isInside('/home/moi/Roms/SNES', roots, posix), false);
  assert.equal(isInside('/home/moi/Roms/SNES/', roots, posix), false);
  assert.equal(isInside('/home/moi/Roms/SNES/../../.bashrc', roots, posix), false);
  assert.equal(isInside('/home/moi/Roms/SNES/a/../b.sfc', roots, posix), false);
  // Un nom qui commence par deux points n'est pas une remontée.
  assert.equal(isInside('/home/moi/Roms/SNES/..jeu.sfc', roots, posix), true);
});

test('isInside (POSIX) : refuse les entrées invalides', () => {
  const roots = ['/home/moi/Roms/SNES'];
  assert.equal(isInside('Roms/SNES/jeu.sfc', ['Roms/SNES'], posix), false);
  assert.equal(isInside('/home/moi/Roms/SNES/jeu.sfc', ['Roms/SNES', '', null], posix), false);
  assert.equal(isInside('', roots, posix), false);
  assert.equal(isInside(null, roots, posix), false);
  assert.equal(isInside({ path: '/home/moi/Roms/SNES/jeu.sfc' }, roots, posix), false);
  assert.equal(isInside('/home/moi/Roms/SNES/jeu.sfc', [], posix), false);
  assert.equal(isInside('/home/moi/Roms/SNES/jeu.sfc', undefined, posix), false);
  // Une racine « / » ne doit pas tout ouvrir par erreur de calcul : seul ce qui est dessous passe.
  assert.equal(isInside('/', ['/'], posix), false);
});

test('isInside (Windows) : casse et séparateurs indifférents', () => {
  const roots = ['D:\\Jeux\\PS1', '\\\\NAS\\jeux\\ps1'];
  assert.equal(isInside('D:\\Jeux\\PS1\\Crash.cue', roots, win), true);
  assert.equal(isInside('d:\\jeux\\ps1\\Crash.bin', roots, win), true);
  assert.equal(isInside('D:/Jeux/PS1/Sous/Crash.bin', roots, win), true);
  assert.equal(isInside('\\\\nas\\JEUX\\ps1\\Spyro.chd', roots, win), true);
});

test('isInside (Windows) : refuse ce qui est hors des racines', () => {
  const roots = ['D:\\Jeux\\PS1'];
  assert.equal(isInside('C:\\Windows\\System32\\drivers\\etc\\hosts', roots, win), false);
  assert.equal(isInside('E:\\Jeux\\PS1\\Crash.cue', roots, win), false);
  assert.equal(isInside('D:\\Jeux\\PS12\\Crash.cue', roots, win), false);
  assert.equal(isInside('D:\\Jeux\\PS1', roots, win), false);
  assert.equal(isInside('d:\\jeux\\ps1\\', roots, win), false);
  assert.equal(isInside('D:\\Jeux\\PS1\\..\\..\\Users\\moi\\ntuser.dat', roots, win), false);
  assert.equal(isInside('D:\\Jeux\\PS1/../PS2/jeu.iso', roots, win), false);
  assert.equal(isInside('Jeux\\PS1\\Crash.cue', roots, win), false);
});
