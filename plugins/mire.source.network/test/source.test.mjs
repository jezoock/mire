// Partages réseau : reprise des tests du fournisseur « network » du cœur de Mire (test/library/local.test.ts et
// test/library/element-sources.test.ts, avant P5-11d) sur un dossier temporaire présenté comme un partage : affiches,
// fanart, illustrations écartées, dossiers cachés, profondeur, sous-titres, clés `local:<chemin>` (chemins Windows
// `\\NAS\…` compris) ; contrat attendu par le cœur (P5-11a).
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

// Partage monté (macOS : `smb://nas/partage` → `/Volumes/partage`) : l'emplacement écrit par l'utilisateur et le
// chemin où le système le montre.
const at = (rel, kinds) => ({ location: `smb://nas/partage/${rel}`, path: path.join(lib.root, rel), network: true, kinds });
const p = (rel) => path.join(lib.root, rel);

async function scan(rel, kinds) {
  const { ctx } = fakeContext({ granted: [lib.root] });
  return createSource(ctx).scan(at(rel, kinds));
}
const byName = (elements) => new Map(elements.map((e) => [e.name, e]));

describe('manifeste et contrat', () => {
  it('niveau code, permission `folders` seule (pas « Réseau local »), une source `src-smb`', () => {
    assert.equal(manifest.id, 'mire.source.network');
    assert.equal(manifest.version, '1.0.0');
    assert.equal(manifest.level, 'code');
    assert.deepEqual(manifest.permissions, { folders: true });
    assert.deepEqual(manifest.contributes, { sources: [{ id: 'src-smb', main: 'src/source.mjs' }] });
  });

  it('la fabrique rend la contribution déclarée, avec le tag de source du cœur', () => {
    const s = createSource(fakeContext().ctx);
    assert.equal(s.id, manifest.contributes.sources[0].id);
    assert.deepEqual(s.tags, ['network']);
  });

  it('textes embarqués : ceux des catalogues ; nom de la sorte de source pour l’explorateur de Mire (`source.name`)', () => {
    for (const lang of ['fr', 'en']) {
      const { name, ...embedded } = read(`i18n/${lang}.json`).messages.source;
      assert.deepEqual(TEXT_CATALOGS[lang], embedded);
      assert.equal(name, { fr: 'Partage réseau', en: 'Network share' }[lang]);
    }
  });

  it('handles : un partage réseau seulement, ni dossier de cet ordinateur ni adresse', () => {
    const s = createSource(fakeContext().ctx);
    assert.equal(s.handles({ location: '\\\\NAS\\Films', path: '\\\\NAS\\Films', network: true, kinds: ['video'] }), true);
    assert.equal(s.handles({ location: 'smb://nas/films', path: '/Volumes/films', network: true, kinds: ['video'] }), true);
    assert.equal(
      s.handles({ location: 'smb://nas/films', path: '/run/user/1000/gvfs/smb-share:server=nas,share=films', network: true, kinds: ['audio'] }),
      true,
    );
    assert.equal(s.handles({ location: '/films', path: '/films', network: false, kinds: ['video'] }), false);
    assert.equal(s.handles({ location: 'D:\\Films', path: 'D:\\Films', network: false, kinds: ['video'] }), false);
    assert.equal(s.handles({ location: 'https://nas/films/', url: 'https://nas/films/', network: false, kinds: ['video'] }), false);
    assert.equal(s.handles({ location: 'https://nas/films/', url: 'https://nas/films/', network: true, kinds: ['video'] }), false);
    assert.equal(s.handles(null), false);
  });

  it('handles : seulement des vidéos, de la musique ou des images (pas un dossier de jeux PC, `game`)', async () => {
    const s = createSource(fakeContext().ctx);
    const share = (kinds) => ({ location: '\\\\NAS\\Jeux', path: '\\\\NAS\\Jeux', network: true, kinds });
    assert.equal(s.handles(share(['game'])), false);
    assert.equal(s.handles(share([])), false);
    assert.equal(s.handles(share(['game', 'audio'])), true);
    assert.deepEqual(
      (await scan('Musique', ['game', 'audio'])).map((e) => e.name),
      ['01 - Début'],
    );
  });

  it('walk : chemins seuls (sans taille ni date), dossiers cachés écartés, profondeur et nombre bornés comme le cœur', async () => {
    const { ctx, walks } = fakeContext({ granted: [lib.root] });
    await createSource(ctx).scan(at('Films', ['video']));
    assert.equal(walks.length, 1);
    const o = walks[0].options;
    assert.deepEqual([o.details, o.skipHidden, o.depth, o.limit], [false, true, MAX_DEPTH, MAX_ITEMS]);
    assert.equal(MAX_ITEMS, 150000);
    for (const e of ['mkv', 'mp3', 'jpg', 'srt', 'vtt']) assert.ok(o.extensions.includes(e), e);
  });
});

describe('éléments d’un partage', () => {
  it('vidéos : affiche et fanart du même nom, sinon ceux du dossier ; illustrations et cachés écartés', async () => {
    const m = byName(await scan('Films', ['video', 'image']));
    assert.deepEqual([...m.keys()].sort(), ['Amélie (2001)', 'Photo de tournage', 'Sans affiche (1999)']);
    const amelie = m.get('Amélie (2001)');
    amelie.infos.subtitles.sort();
    assert.deepEqual(amelie, {
      key: `local:${p('Films/Amélie (2001).mkv')}`,
      name: 'Amélie (2001)',
      open: { kind: 'file', path: p('Films/Amélie (2001).mkv') },
      tags: ['network'],
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

  it('profondeur : 16 niveaux sous le partage au plus', async () => {
    assert.deepEqual(
      (await scan('Profond', ['video'])).map((e) => e.name),
      ['Niveau 16'],
    );
  });

  it('partage absent : erreur pour le journal, dans la langue de l’interface, sans parcours', async () => {
    const { ctx, walks } = fakeContext({ granted: [lib.root] });
    await assert.rejects(createSource(ctx).scan(at('Absent', ['video'])), {
      message: 'Partage réseau inaccessible : smb://nas/partage/Absent. Vérifiez que l’ordinateur du partage est allumé et que vous y êtes connecté.',
    });
    assert.equal(walks.length, 0);
    const en = fakeContext({ granted: [lib.root], locale: 'en' }).ctx;
    await assert.rejects(createSource(en).scan(at('Absent', ['video'])), { message: /^Network share unavailable: smb:\/\/nas\/partage\/Absent\./ });
  });

  it('nombre maximal d’éléments', () => {
    const files = ['/f/a.mkv', '/f/b.mkv', '/f/c.mkv'];
    assert.equal(elementsOf('/f', files, ['video'], 2).length, 2);
  });
});

describe('clés : celles du cœur (`local:<chemin normalisé>`)', () => {
  it('partage monté sous macOS ou Linux : chemin gardé tel quel', () => {
    assert.equal(fileKey('/Volumes/Films/A.mkv'), 'local:/Volumes/Films/A.mkv');
    const gvfs = '/run/user/1000/gvfs/smb-share:server=nas,share=films';
    assert.equal(isWindowsPath(gvfs), false);
    const [e] = elementsOf(gvfs, [`${gvfs}/Série/Épisode 1.mkv`], ['video']);
    assert.equal(e.key, `local:${gvfs}/Série/Épisode 1.mkv`);
    assert.deepEqual(e.infos, { folder: 'Série' });
  });

  it('partage Windows (`\\\\NAS\\Films`) : barres obliques et minuscules, comme `normalizePath` du cœur', () => {
    assert.equal(isWindowsPath('\\\\NAS\\Films'), true);
    const [e] = elementsOf('\\\\NAS\\Films', ['\\\\NAS\\Films\\Série\\Épisode 1.MKV'], ['video']);
    assert.equal(e.key, 'local://nas/films/série/épisode 1.mkv');
    assert.equal(e.name, 'Épisode 1');
    assert.deepEqual(e.infos, { folder: 'Série' });
    assert.deepEqual(e.open, { kind: 'file', path: '\\\\NAS\\Films\\Série\\Épisode 1.MKV' });
    assert.deepEqual(e.tags, ['network']);
  });

  it('racine du partage Windows : son nom de partage comme dossier', () => {
    const [e] = elementsOf('\\\\NAS\\Films', ['\\\\NAS\\Films\\Film.mkv'], ['video']);
    assert.deepEqual(e.infos, { folder: 'Films' });
    assert.equal(e.key, 'local://nas/films/film.mkv');
  });
});
