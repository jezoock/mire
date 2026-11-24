// Dossiers de cet ordinateur : reprise des tests du fournisseur « local » du cœur de Mire (test/library/local.test.ts
// et test/library/element-sources.test.ts, avant P5-11c) : affiches, fanart, illustrations écartées, dossiers cachés,
// profondeur, sous-titres, clés `local:<chemin>` ; contrat attendu par le cœur (P5-11a).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import createSource, { MAX_DEPTH, MAX_ITEMS } from '../src/source.mjs';
import { elementsOf, fileKey, isWindowsPath } from '../src/folder.mjs';
import { TEXT_CATALOGS } from '../src/texts.mjs';
import { fakeContext, tree } from './helpers.mjs';

const read = (rel) => JSON.parse(readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8'));
const manifest = read('mire-plugin.json');

const deep = Array.from({ length: 17 }, (_, i) => `n${i + 1}`);
const lib = tree([
  'Films/Amélie (2001).mkv',
  'Films/Amélie (2001).jpg',
  'Films/Amélie (2001)-fanart.jpg',
  'Films/Amélie (2001).fr.srt',
  'Films/Amélie (2001).vtt',
  'Films/Autre.srt',
  'Films/Sans affiche (1999).mp4',
  'Films/poster.jpg',
  'Films/fanart.jpg',
  'Films/Photo de tournage.png',
  'Films/notes.txt',
  'Films/.cachée.mkv',
  'Films/.cache/Caché.mkv',
  'Films/$RECYCLE.BIN/Supprimé.mkv',
  'Musique/Album/01 - Début.mp3',
  'Musique/Album/cover.jpg',
  'Images/Vacances/Plage.png',
  'Images/Vacances/folder.jpg',
  'Images/Vacances/Plage-thumb.png',
  `Profond/${deep.slice(0, 16).join('/')}/Niveau 16.mkv`,
  `Profond/${deep.join('/')}/Niveau 17.mkv`,
]);
after(lib.remove);

const at = (rel, kinds) => ({ location: path.join(lib.root, rel), path: path.join(lib.root, rel), network: false, kinds });
const p = (rel) => path.join(lib.root, rel);

async function scan(rel, kinds) {
  const { ctx } = fakeContext({ granted: [lib.root] });
  return createSource(ctx).scan(at(rel, kinds));
}
const byName = (elements) => new Map(elements.map((e) => [e.name, e]));

describe('manifeste et contrat', () => {
  it('niveau code, permission `folders` seule, une source `src-local`', () => {
    assert.equal(manifest.id, 'mire.source.local');
    assert.equal(manifest.version, '1.0.0');
    assert.equal(manifest.level, 'code');
    assert.deepEqual(manifest.permissions, { folders: true });
    assert.deepEqual(manifest.contributes, { sources: [{ id: 'src-local', main: 'src/source.mjs' }] });
  });

  it('la fabrique rend la contribution déclarée, avec le tag de source du cœur', () => {
    const s = createSource(fakeContext().ctx);
    assert.equal(s.id, manifest.contributes.sources[0].id);
    assert.deepEqual(s.tags, ['local']);
  });

  it('textes embarqués : ceux des catalogues', () => {
    for (const lang of ['fr', 'en']) assert.deepEqual(TEXT_CATALOGS[lang], read(`i18n/${lang}.json`).messages.source);
  });

  it('handles : un dossier seulement, ni partage réseau ni adresse', () => {
    const s = createSource(fakeContext().ctx);
    assert.equal(s.handles({ location: '/films', path: '/films', network: false, kinds: ['video'] }), true);
    assert.equal(s.handles({ location: 'D:\\Films', path: 'D:\\Films', network: false, kinds: ['video'] }), true);
    assert.equal(s.handles({ location: 'smb://nas/films', path: '/Volumes/films', network: true, kinds: ['video'] }), false);
    assert.equal(s.handles({ location: 'https://nas/films/', url: 'https://nas/films/', network: false, kinds: ['video'] }), false);
    assert.equal(s.handles(null), false);
  });

  it('walk : dossiers cachés écartés, profondeur et nombre de fichiers bornés comme le cœur', async () => {
    const { ctx, walks } = fakeContext({ granted: [lib.root] });
    await createSource(ctx).scan(at('Films', ['video']));
    assert.equal(walks.length, 1);
    const o = walks[0].options;
    assert.deepEqual([o.skipHidden, o.depth, o.limit], [true, MAX_DEPTH, MAX_ITEMS]);
    assert.equal(MAX_ITEMS, 150000);
    for (const e of ['mkv', 'mp3', 'jpg', 'srt', 'vtt']) assert.ok(o.extensions.includes(e), e);
  });
});

describe('éléments d’un dossier', () => {
  it('vidéos : affiche et fanart du même nom, sinon ceux du dossier ; illustrations et cachés écartés', async () => {
    const m = byName(await scan('Films', ['video', 'image']));
    assert.deepEqual([...m.keys()].sort(), ['Amélie (2001)', 'Photo de tournage', 'Sans affiche (1999)']);
    const amelie = m.get('Amélie (2001)');
    // Ordre de lecture du disque : les sous-titres sont comparés triés.
    amelie.infos.subtitles.sort();
    assert.deepEqual(amelie, {
      key: `local:${p('Films/Amélie (2001).mkv')}`,
      name: 'Amélie (2001)',
      open: { kind: 'file', path: p('Films/Amélie (2001).mkv') },
      tags: ['local'],
      infos: { folder: 'Films', subtitles: [p('Films/Amélie (2001).fr.srt'), p('Films/Amélie (2001).vtt')].sort() },
      images: { poster: p('Films/Amélie (2001).jpg'), background: p('Films/Amélie (2001)-fanart.jpg') },
    });
    const other = m.get('Sans affiche (1999)');
    assert.deepEqual(other.images, { poster: p('Films/poster.jpg'), background: p('Films/fanart.jpg') });
    assert.deepEqual(other.infos, { folder: 'Films' });
    assert.deepEqual(m.get('Photo de tournage').images, {});
  });

  it('musique et images : pochette de dossier, illustrations écartées', async () => {
    const m = byName([...(await scan('Musique', ['audio'])), ...(await scan('Images', ['image']))]);
    assert.deepEqual([...m.keys()].sort(), ['01 - Début', 'Plage', 'Plage-thumb']);
    assert.deepEqual(m.get('01 - Début').images, { poster: p('Musique/Album/cover.jpg') });
    assert.deepEqual(m.get('01 - Début').infos, { folder: 'Album' });
  });

  it('seulement les types demandés', async () => {
    assert.deepEqual(await scan('Musique', ['video']), []);
  });

  it('profondeur : 16 niveaux sous la source au plus', async () => {
    assert.deepEqual(
      (await scan('Profond', ['video'])).map((e) => e.name),
      ['Niveau 16'],
    );
  });

  it('dossier introuvable : erreur affichable, dans la langue de l’interface', async () => {
    await assert.rejects(scan('Absent', ['video']), { message: `Dossier introuvable : ${p('Absent')}` });
    const { ctx } = fakeContext({ granted: [lib.root], locale: 'en' });
    await assert.rejects(createSource(ctx).scan(at('Absent', ['video'])), { message: `Folder not found: ${p('Absent')}` });
  });

  it('nombre maximal d’éléments', () => {
    const files = ['/f/a.mkv', '/f/b.mkv', '/f/c.mkv'];
    assert.equal(elementsOf('/f', files, ['video'], 2).length, 2);
  });
});

describe('clés : celles du cœur (`local:<chemin normalisé>`)', () => {
  it('chemin POSIX gardé tel quel', () => {
    assert.equal(fileKey('/home/moi/Films/A.mkv'), 'local:/home/moi/Films/A.mkv');
  });

  it('chemin Windows : barres obliques et minuscules, comme `normalizePath` du cœur', () => {
    assert.equal(isWindowsPath('D:\\Films'), true);
    assert.equal(isWindowsPath('/home/moi'), false);
    const [e] = elementsOf('D:\\Films', ['D:\\Films\\Série\\Épisode 1.MKV'], ['video']);
    assert.equal(e.key, 'local:d:/films/série/épisode 1.mkv');
    assert.equal(e.name, 'Épisode 1');
    assert.deepEqual(e.infos, { folder: 'Série' });
    assert.deepEqual(e.open, { kind: 'file', path: 'D:\\Films\\Série\\Épisode 1.MKV' });
  });

  it('racine d’un disque Windows : pas de nom de dossier', () => {
    const [e] = elementsOf('E:\\', ['E:\\Film.mkv'], ['video']);
    assert.deepEqual(e.infos, {});
    assert.equal(e.key, 'local:e:/film.mkv');
  });
});
