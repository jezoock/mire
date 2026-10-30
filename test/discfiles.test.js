'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Aucun accès réseau pendant les tests : le moindre appel à fetch fait échouer le test.
globalThis.fetch = () => {
  throw new Error('accès réseau interdit pendant les tests');
};

const { isDescriptor, decode, safeRel, parseRefs, refUrl, resolveRemote, missingLocal } = require('../discfiles');

test('isDescriptor : index de disque reconnus, sans tenir compte de la casse ni de la requête', () => {
  assert.equal(isDescriptor('Jeu.CUE'), true);
  assert.equal(isDescriptor('https://ex.org/jeu.m3u?dl=1'), true);
  assert.equal(isDescriptor('piste.bin'), false);
});

test('safeRel : chemins relatifs normalisés', () => {
  assert.equal(safeRel('Disque 1/piste.bin'), 'Disque 1/piste.bin');
  assert.equal(safeRel('dossier\\piste.bin'), 'dossier/piste.bin');
  assert.equal(safeRel('./a//b'), 'a/b');
  assert.equal(safeRel('  piste.bin  '), 'piste.bin');
  assert.equal(safeRel('a..b'), 'a..b');
});

test('safeRel : refuse chemins absolus, remontées et lettres de lecteur', () => {
  assert.equal(safeRel('/etc/passwd'), null);
  assert.equal(safeRel('a/../b'), null);
  assert.equal(safeRel('..\\..\\Windows\\system.ini'), null);
  assert.equal(safeRel('C:/Jeux/piste.bin'), null);
  assert.equal(safeRel('c:piste.bin'), null);
  assert.equal(safeRel('\\\\serveur\\partage'), null);
});

test('safeRel : vide ou sans nom de fichier → null', () => {
  assert.equal(safeRel(''), null);
  assert.equal(safeRel(null), null);
  assert.equal(safeRel(undefined), null);
  assert.equal(safeRel('.'), null);
});

test('parseRefs .cue : noms avec et sans guillemets, doublons retirés', () => {
  const cue = ['FILE "Track 01.bin" BINARY', '  TRACK 01 MODE2/2352', 'FILE track02.bin BINARY', 'file "Track 01.bin" BINARY'].join('\r\n');
  assert.deepEqual(parseRefs('Jeu.cue', cue), ['Track 01.bin', 'track02.bin']);
});

test('parseRefs .cue : références dangereuses ignorées, texte vide', () => {
  assert.deepEqual(parseRefs('Jeu.cue', 'FILE "../../secret.bin" BINARY\nFILE "/etc/passwd" BINARY'), []);
  assert.deepEqual(parseRefs('Jeu.cue', ''), []);
  assert.deepEqual(parseRefs('Jeu.cue', undefined), []);
});

test('parseRefs : les adresses complètes sont écartées, quel que soit l’index', () => {
  const m3u = 'https://ex.org/a/Disc 1.cue\n"http://ex.org/a/Disc 2.cue"\nfile:///jeux/Disc 3.cue\nDisc 4.cue';
  assert.deepEqual(parseRefs('Jeu.m3u', m3u), ['Disc 4.cue']);
  assert.deepEqual(parseRefs('Jeu.cue', 'FILE "https://ex.org/a/piste.bin" BINARY\nFILE "piste.bin" BINARY'), ['piste.bin']);
  assert.deepEqual(parseRefs('Jeu.gdi', '1\n1 0 4 2352 "https://ex.org/a/track01.bin" 0'), []);
});

test('parseRefs .toc : lignes DATAFILE et FILE', () => {
  assert.deepEqual(parseRefs('Jeu.toc', 'CD_ROM\nDATAFILE "data.bin"\nFILE "audio.bin" 0'), ['data.bin', 'audio.bin']);
});

test('parseRefs .gdi : première ligne ignorée, noms avec et sans guillemets', () => {
  const gdi = '3\n1 0 4 2352 track01.bin 0\n2 600 0 2352 "track 02.raw" 0\n3 45000 4 2352 ../x.bin 0';
  assert.deepEqual(parseRefs('Jeu.gdi', gdi), ['track01.bin', 'track 02.raw']);
  assert.deepEqual(parseRefs('Jeu.gdi', '1 0 4 2352 track01.bin 0'), []);
});

test('parseRefs .m3u : commentaires ignorés, guillemets retirés', () => {
  assert.deepEqual(parseRefs('Jeu.m3u', '#EXTM3U\nDisc 1.cue\n"Disc 2.cue"\n/absolu.cue'), ['Disc 1.cue', 'Disc 2.cue']);
});

test('parseRefs .ccd et .mds : fichiers compagnons de même nom', () => {
  assert.deepEqual(parseRefs('Jeu.CCD', 'contenu ignoré'), ['Jeu.img', 'Jeu.sub']);
  assert.deepEqual(parseRefs('Jeu.mds', ''), ['Jeu.mdf']);
});

test('parseRefs : extension inconnue → aucune référence', () => {
  assert.deepEqual(parseRefs('Jeu.iso', 'FILE "piste.bin" BINARY'), []);
});

test('decode : UTF-8 avec BOM', () => {
  assert.equal(decode(Buffer.from('\uFEFFFILE "Épisode.bin"', 'utf8')), 'FILE "Épisode.bin"');
});

test('decode : Latin-1 quand le texte n’est pas de l’UTF-8 valide', () => {
  assert.equal(decode(Buffer.from('FILE "Épisode.bin"', 'latin1')), 'FILE "Épisode.bin"');
  assert.equal(decode(Buffer.alloc(0)), '');
});

test('refUrl : chaque partie du chemin est encodée', () => {
  assert.equal(refUrl('Disc 1/Piste #1.bin', 'https://ex.org/jeux/a/Jeu.cue'), 'https://ex.org/jeux/a/Disc%201/Piste%20%231.bin');
  assert.equal(refUrl('piste?.bin', 'https://ex.org/a/'), 'https://ex.org/a/piste%3F.bin');
});

// Faux site : adresse → contenu de l'index ; une adresse absente fait échouer la lecture.
function fakeSite(pages) {
  const asked = [];
  const fetchText = async (url) => {
    asked.push(url);
    if (!(url in pages)) throw new Error(`introuvable : ${url}`);
    return pages[url];
  };
  return { fetchText, asked };
}

test('resolveRemote : suit .m3u → .cue → .bin', async () => {
  const base = 'https://ex.org/jeux/ff7/';
  const { fetchText, asked } = fakeSite({
    [`${base}FF7.m3u`]: 'Disc 1.cue\nDisc 2.cue',
    [`${base}Disc%201.cue`]: 'FILE "Disc 1.bin" BINARY',
    [`${base}Disc%202.cue`]: 'FILE "Disc 2.bin" BINARY',
  });
  assert.deepEqual(await resolveRemote(`${base}FF7.m3u`, fetchText), [
    { url: `${base}FF7.m3u`, rel: 'FF7.m3u' },
    { url: `${base}Disc%201.cue`, rel: 'Disc 1.cue' },
    { url: `${base}Disc%201.bin`, rel: 'Disc 1.bin' },
    { url: `${base}Disc%202.cue`, rel: 'Disc 2.cue' },
    { url: `${base}Disc%202.bin`, rel: 'Disc 2.bin' },
  ]);
  // Les pistes .bin ne sont jamais lues, seuls les index le sont.
  assert.deepEqual(asked, [`${base}FF7.m3u`, `${base}Disc%201.cue`, `${base}Disc%202.cue`]);
});

test('resolveRemote : un fichier qui n’est pas un index est rendu seul, sans lecture', async () => {
  const { fetchText, asked } = fakeSite({});
  assert.deepEqual(await resolveRemote('https://ex.org/a/jeu.iso', fetchText), [{ url: 'https://ex.org/a/jeu.iso', rel: 'jeu.iso' }]);
  assert.deepEqual(asked, []);
});

test('resolveRemote : ne quitte jamais le site ni le dossier de l’index', async () => {
  const { fetchText, asked } = fakeSite({
    'https://ex.org/jeux/a/Jeu.m3u': 'https://autre.org/jeux/a/Disc 1.cue\n//autre.org/Disc 2.cue\n../b/Disc 3.cue\nDisc 4.cue',
  });
  const files = await resolveRemote('https://ex.org/jeux/a/Jeu.m3u', fetchText);
  for (const { url } of [...files, ...asked.map((url) => ({ url }))]) {
    assert.ok(url.startsWith('https://ex.org/jeux/a/'), url);
  }
  assert.deepEqual(
    files.map((f) => f.rel),
    ['Jeu.m3u', 'Disc 4.cue'],
  );
  assert.deepEqual(asked, ['https://ex.org/jeux/a/Jeu.m3u', 'https://ex.org/jeux/a/Disc%204.cue']);
});

test('resolveRemote : un .m3u peut citer ses disques par leur adresse complète dans le même dossier', async () => {
  const base = 'https://ex.org/jeux/a/';
  const { fetchText, asked } = fakeSite({
    [`${base}Jeu.m3u`]: `${base}Disc 1.cue\n"${base}CD/Disc%202.cue"\nDisc 1.cue\nDisc 3.cue`,
    [`${base}Disc%201.cue`]: 'FILE "Disc 1.bin" BINARY',
    [`${base}CD/Disc%202.cue`]: 'FILE "Disc 2.bin" BINARY',
  });
  assert.deepEqual(await resolveRemote(`${base}Jeu.m3u`, fetchText), [
    { url: `${base}Jeu.m3u`, rel: 'Jeu.m3u' },
    { url: `${base}Disc%201.cue`, rel: 'Disc 1.cue' },
    { url: `${base}Disc%201.bin`, rel: 'Disc 1.bin' },
    { url: `${base}CD/Disc%202.cue`, rel: 'CD/Disc 2.cue' },
    { url: `${base}CD/Disc%202.bin`, rel: 'CD/Disc 2.bin' },
    { url: `${base}Disc%203.cue`, rel: 'Disc 3.cue' },
  ]);
  // L'ordre des disques est celui de la liste ; la même adresse, écrite de deux façons, n'est lue qu'une fois.
  assert.deepEqual(asked, [`${base}Jeu.m3u`, `${base}Disc%201.cue`, `${base}CD/Disc%202.cue`, `${base}Disc%203.cue`]);
});

test('resolveRemote : une adresse complète hors du dossier de l’index ou vers un autre site est ignorée, sans requête', async () => {
  const { fetchText, asked } = fakeSite({
    'https://ex.org/jeux/a/Jeu.m3u': [
      'https://autre.org/jeux/a/Disc 1.cue',
      'http://ex.org/jeux/a/Disc 2.cue',
      'https://ex.org/jeux/b/Disc 3.cue',
      'https://ex.org/jeux/a/../b/Disc 4.cue',
      'ftp://ex.org/jeux/a/Disc 5.cue',
      'https://[invalide/Disc 6.cue',
    ].join('\n'),
  });
  assert.deepEqual(await resolveRemote('https://ex.org/jeux/a/Jeu.m3u', fetchText), [{ url: 'https://ex.org/jeux/a/Jeu.m3u', rel: 'Jeu.m3u' }]);
  assert.deepEqual(asked, ['https://ex.org/jeux/a/Jeu.m3u']);
});

test('resolveRemote : aucun chemin rendu ne commence par un schéma', async () => {
  const { fetchText } = fakeSite({
    'https://ex.org/a/Jeu.m3u': 'https://ex.org/a/Disc 1.cue\nhttps://autre.org/a/Disc 2.cue\nfile:///etc/Disc 3.cue',
    'https://ex.org/a/Disc%201.cue': 'FILE "https://ex.org/a/piste.bin" BINARY\nFILE "Disc 1.bin" BINARY',
  });
  const files = await resolveRemote('https://ex.org/a/Jeu.m3u', fetchText);
  assert.deepEqual(
    files.map((f) => f.rel),
    ['Jeu.m3u', 'Disc 1.cue', 'Disc 1.bin'],
  );
  for (const { rel } of files) assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(rel), rel);
});

test('resolveRemote : un index illisible est gardé sans être suivi', async () => {
  const { fetchText } = fakeSite({ 'https://ex.org/a/Jeu.m3u': 'Disc 1.cue' });
  assert.deepEqual(await resolveRemote('https://ex.org/a/Jeu.m3u', fetchText), [
    { url: 'https://ex.org/a/Jeu.m3u', rel: 'Jeu.m3u' },
    { url: 'https://ex.org/a/Disc%201.cue', rel: 'Disc 1.cue' },
  ]);
});

test('resolveRemote : s’arrête à maxFiles', async () => {
  const tracks = Array.from({ length: 10 }, (_, i) => `FILE "t${i}.bin" BINARY`).join('\n');
  const { fetchText } = fakeSite({ 'https://ex.org/a/Jeu.cue': tracks });
  const files = await resolveRemote('https://ex.org/a/Jeu.cue', fetchText, { maxFiles: 4 });
  assert.deepEqual(
    files.map((f) => f.rel),
    ['Jeu.cue', 't0.bin', 't1.bin', 't2.bin'],
  );
});

test('missingLocal : fichiers manquants, récursif à travers un .m3u', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-disc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'CD'));
  fs.writeFileSync(path.join(dir, 'Jeu.m3u'), 'CD/Disc 1.cue\nCD/Disc 2.cue\nDisc 3.cue');
  fs.writeFileSync(path.join(dir, 'CD', 'Disc 1.cue'), 'FILE "Disc 1 (Track 1).bin" BINARY\nFILE "Disc 1 (Track 2).bin" BINARY');
  fs.writeFileSync(path.join(dir, 'CD', 'Disc 1 (Track 1).bin'), '');
  fs.writeFileSync(path.join(dir, 'CD', 'Disc 2.cue'), 'FILE "Disc 2.bin" BINARY');
  fs.writeFileSync(path.join(dir, 'CD', 'Disc 2.bin'), '');
  assert.deepEqual(missingLocal(path.join(dir, 'Jeu.m3u')), ['CD/Disc 1 (Track 2).bin', 'Disc 3.cue']);
});

test('missingLocal : une adresse complète dans un .m3u local n’est pas un fichier manquant', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-disc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'Jeu.m3u'), 'https://ex.org/a/Disc 1.cue\nDisc 2.cue');
  assert.deepEqual(missingLocal(path.join(dir, 'Jeu.m3u')), ['Disc 2.cue']);
});

test('missingLocal : index complet, ou fichier introuvable → liste vide', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-disc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'Jeu.cue'), 'FILE "Jeu.bin" BINARY');
  fs.writeFileSync(path.join(dir, 'Jeu.bin'), '');
  assert.deepEqual(missingLocal(path.join(dir, 'Jeu.cue')), []);
  assert.deepEqual(missingLocal(path.join(dir, 'absent.cue')), []);
});
