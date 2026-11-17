// Infos modifiées à la main (reprise de setMeta / pickMetaImage / loadMeta de l'ancien index.js). Depuis P2-04, une
// façade sur `catalog/overrides.json` : mêmes clés et mêmes champs pour l'interface historique.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createUserMeta, patchMeta } from '../../src/main/meta/user-meta.ts';

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mire-meta-'));

describe('patchMeta', () => {
  it('ne prend que les champs connus, retire les espaces, efface les valeurs vides', () => {
    assert.deepEqual(patchMeta({ title: 'Alien', genre: 'SF' }, { title: '  Aliens ', genre: '', year: 1986, couleur: 'rouge' }), {
      title: 'Aliens',
      year: 1986,
    });
    assert.deepEqual(patchMeta({ title: 'Alien' }, { title: null }), null);
    assert.deepEqual(patchMeta(undefined, null), null);
    assert.deepEqual(patchMeta(undefined, { overview: 'Résumé', artist: 'X', image: '/i.png', backdrop: '/f.png' }), {
      overview: 'Résumé',
      artist: 'X',
      image: '/i.png',
      backdrop: '/f.png',
    });
  });
});

describe('createUserMeta (façade sur overrides.json)', () => {
  const setup = (chosen: string | null = null) => {
    const dir = freshDir();
    const file = path.join(dir, 'catalog', 'overrides.json');
    const asked: string[] = [];
    const overrides = createOverrides({ file, platform: 'linux' });
    overrides.load();
    const meta = createUserMeta({
      overrides,
      imgDir: path.join(dir, 'meta', 'img'),
      chooseImage: async (field) => {
        asked.push(field);
        return chosen;
      },
      now: () => 1700000000000,
    });
    return { dir, file, meta, asked, overrides };
  };

  it('set : enregistre aussitôt sous la clé de l’élément, et oublie un élément vidé', () => {
    const { file, meta } = setup();
    assert.deepEqual(meta.set('v:/films/Amélie.mkv', { title: 'Amélie', genre: 'Comédie' }), { title: 'Amélie', genre: 'Comédie' });
    assert.deepEqual(meta.all(), { 'v:/films/Amélie.mkv': { title: 'Amélie', genre: 'Comédie' } });
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(saved.elements['local:/films/Amélie.mkv'], { infos: { title: 'Amélie', genres: ['Comédie'] }, legacy: 'v:/films/Amélie.mkv' });
    assert.equal(meta.set('v:/films/Amélie.mkv', { title: '', genre: ' ' }), null);
    assert.deepEqual(meta.all(), {});
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).elements, {});
    assert.equal(meta.set('', { title: 'x' }), null);
    assert.equal(meta.set(42, { title: 'x' }), null);
  });

  it('set complète la fiche ; reset l’efface ; une nouvelle façade relit les mêmes fiches', () => {
    const { file, meta } = setup();
    meta.set('a:/musique/Daft Punk', { title: 'Discovery' });
    meta.set('a:/musique/Daft Punk', { artist: 'Daft Punk', year: '2001' });
    meta.set('v:/films/b.mkv', { title: 'B' });
    assert.deepEqual(meta.all(), { 'v:/films/b.mkv': { title: 'B' }, 'a:/musique/Daft Punk': { title: 'Discovery', artist: 'Daft Punk', year: '2001' } });
    assert.equal(meta.reset('v:/films/b.mkv'), true);
    const overrides = createOverrides({ file, platform: 'linux' });
    overrides.load();
    const again = createUserMeta({ overrides, imgDir: '', chooseImage: async () => null });
    assert.deepEqual(again.all(), { 'a:/musique/Daft Punk': { title: 'Discovery', artist: 'Daft Punk', year: '2001' } });
    // all() est une copie : la modifier ne change rien.
    delete again.all()['a:/musique/Daft Punk'];
    assert.equal(Object.keys(again.all()).length, 1);
  });

  it('reset garde les tags modifiés à la main', () => {
    const { meta, overrides } = setup();
    meta.set('v:/films/c.mkv', { title: 'C' });
    overrides.setTags('local:/films/c.mkv', { vus: true });
    meta.reset('v:/films/c.mkv');
    assert.deepEqual(meta.all(), {});
    assert.deepEqual(overrides.get('local:/films/c.mkv')?.tags, { vus: true });
  });

  it('pickImage : copie l’image choisie dans meta/img et la note', async () => {
    const src = path.join(freshDir(), 'Affiche.PNG');
    fs.writeFileSync(src, 'image');
    const { dir, meta, asked, overrides } = setup(src);
    const r = await meta.pickImage('v:/films/Alien.mkv', 'backdrop');
    assert.deepEqual(asked, ['backdrop']);
    const dest = String(r?.backdrop);
    assert.equal(path.dirname(dest), path.join(dir, 'meta', 'img'));
    assert.match(path.basename(dest), /^[0-9a-f]{40}\.png$/);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'image');
    assert.deepEqual(overrides.get('local:/films/Alien.mkv')?.images, { background: dest });
  });

  it('pickImage : champ inconnu ou boîte annulée → null', async () => {
    const { meta, asked } = setup(null);
    assert.equal(await meta.pickImage('k', 'overview'), null);
    assert.deepEqual(asked, []);
    assert.equal(await meta.pickImage('k', 'image'), null);
    assert.deepEqual(meta.all(), {});
  });
});
