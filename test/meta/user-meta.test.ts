// Infos modifiées à la main (reprise de setMeta / pickMetaImage / loadMeta de l'ancien index.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

describe('createUserMeta', () => {
  const setup = (chosen: string | null = null) => {
    const dir = freshDir();
    const file = path.join(dir, 'meta', 'meta.json');
    const asked: string[] = [];
    const meta = createUserMeta({
      file,
      imgDir: path.join(dir, 'meta', 'img'),
      chooseImage: async (field) => {
        asked.push(field);
        return chosen;
      },
      now: () => 1700000000000,
    });
    meta.load();
    return { dir, file, meta, asked };
  };

  it('set : enregistre aussitôt, indenté (fichier modifiable à la main), et oublie un élément vidé', () => {
    const { file, meta } = setup();
    assert.deepEqual(meta.set('/films/Amélie.mkv', { title: 'Amélie', genre: 'Comédie' }), { title: 'Amélie', genre: 'Comédie' });
    assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ '/films/Amélie.mkv': { title: 'Amélie', genre: 'Comédie' } }, null, 2));
    assert.equal(meta.set('/films/Amélie.mkv', { title: '', genre: ' ' }), null);
    assert.deepEqual(meta.all(), {});
    assert.equal(meta.set('', { title: 'x' }), null);
    assert.equal(meta.set(42, { title: 'x' }), null);
  });

  it('load : relit le fichier ; all() rend l’objet que metaReset modifie avant save()', () => {
    const { file, meta } = setup();
    meta.set('a', { title: 'A' });
    meta.set('b', { title: 'B' });
    const again = createUserMeta({ file, imgDir: '', chooseImage: async () => null });
    again.load();
    assert.deepEqual(again.all(), { a: { title: 'A' }, b: { title: 'B' } });
    delete again.all().a;
    again.save();
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { b: { title: 'B' } });
  });

  it('pickImage : copie l’image choisie dans meta/img et la note', async () => {
    const src = path.join(freshDir(), 'Affiche.PNG');
    fs.writeFileSync(src, 'image');
    const { dir, meta, asked } = setup(src);
    const r = await meta.pickImage('/films/Alien.mkv', 'backdrop');
    assert.deepEqual(asked, ['backdrop']);
    const dest = String(r?.backdrop);
    assert.equal(path.dirname(dest), path.join(dir, 'meta', 'img'));
    assert.match(path.basename(dest), /^[0-9a-f]{40}\.png$/);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'image');
  });

  it('pickImage : champ inconnu ou boîte annulée → null', async () => {
    const { meta, asked } = setup(null);
    assert.equal(await meta.pickImage('k', 'overview'), null);
    assert.deepEqual(asked, []);
    assert.equal(await meta.pickImage('k', 'image'), null);
    assert.deepEqual(meta.all(), {});
  });
});
