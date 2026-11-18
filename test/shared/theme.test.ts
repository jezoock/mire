// Thèmes sans code (P4-11) : schéma et lecture de theme.json, chemins qui restent dans le dossier du thème.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, THEME_SCHEMA, isThemePath, parseTheme, resolveTheme, themeAssetUrl, validateTheme } from '@mire/shared';

const VALID = {
  format: 1,
  id: 'essai',
  name: { key: 'themes.essai.name' },
  description: 'Un thème d’essai',
  palette: 'jour',
  fonts: { body: { family: 'Georgia, "Times New Roman", serif' }, heading: { file: 'fonts/titre.woff2', family: 'serif' } },
  images: { background: 'images/fond.svg' },
  sounds: { move: 'sons/deplacement.wav' },
  menu: { position: 'top' },
  home: { layout: 'rows' },
  page: { layout: 'rows', card: 'thumbnail', size: 'l', background: 'image' },
};

describe('validateTheme', () => {
  it('un thème complet est lu tel quel', () => {
    const r = validateTheme(VALID, 'essai');
    assert.ok(r.ok);
    assert.deepEqual(r.theme, VALID);
  });

  it('le minimum : format, identifiant et nom', () => {
    const r = validateTheme({ format: 1, id: 'mini', name: 'Mini' });
    assert.deepEqual(r, { ok: true, theme: { format: 1, id: 'mini', name: 'Mini' } });
  });

  it('chaque champ invalide est signalé par son chemin', () => {
    const r = validateTheme({
      format: 2,
      id: 'Pas Bon',
      name: '',
      palette: '../ecran',
      fonts: { body: { family: 'x; } body { color: red' }, titre: {} },
      menu: { position: 'centre' },
      home: { layout: 'carrousel' },
      page: { layout: 'grid', card: 'géante', size: 'xl', background: 'video', autre: 1 },
      inconnu: true,
    });
    assert.equal(r.ok, false);
    assert.deepEqual(
      [...(r as { errors: string[] }).errors].sort(),
      [
        'format',
        'fonts.body.family',
        'fonts.titre',
        'home.layout',
        'id',
        'inconnu',
        'menu.position',
        'name',
        'page.autre',
        'page.background',
        'page.card',
        'page.size',
        'palette',
      ].sort(),
    );
  });

  it('identifiant différent du dossier, fond « image » sans image : refusés', () => {
    assert.deepEqual(validateTheme(VALID, 'autre'), { ok: false, errors: ['id'] });
    const { images: _images, ...sansImage } = VALID;
    assert.deepEqual(validateTheme(sansImage), { ok: false, errors: ['page.background'] });
  });

  it('un chemin qui sort du dossier du thème est refusé', () => {
    const bad = [
      '../fond.svg',
      'images/../../fond.svg',
      '/etc/fond.svg',
      'C:/fond.svg',
      'C:\\fond.svg',
      'https://exemple.fr/fond.svg',
      'media://local/?p=fond.svg',
      './fond.svg',
      'images//fond.svg',
      '',
    ];
    for (const p of bad) {
      const r = validateTheme({ ...VALID, images: { background: p } });
      assert.deepEqual(r, { ok: false, errors: ['images.background'] }, p);
    }
    assert.deepEqual(validateTheme({ ...VALID, fonts: { body: { file: '../police.woff2' } } }), { ok: false, errors: ['fonts.body.file'] });
    assert.deepEqual(validateTheme({ ...VALID, sounds: { back: '/sons/retour.wav' } }), { ok: false, errors: ['sounds.back'] });
  });

  it('le genre du fichier doit correspondre à son rôle', () => {
    assert.deepEqual(validateTheme({ ...VALID, images: { background: 'images/fond.woff2' } }), { ok: false, errors: ['images.background'] });
    assert.deepEqual(validateTheme({ ...VALID, sounds: { move: 'sons/move.js' } }), { ok: false, errors: ['sounds.move'] });
  });

  it('pas un objet, ou JSON invalide : erreur à la racine', () => {
    for (const v of [null, 'thème', [], 3]) assert.deepEqual(validateTheme(v), { ok: false, errors: [''] });
    assert.deepEqual(parseTheme('{ pas du json'), { ok: false, errors: [''] });
    assert.ok(parseTheme(JSON.stringify(VALID), 'essai').ok);
  });
});

describe('chemins et adresses des fichiers', () => {
  it('isThemePath', () => {
    assert.ok(isThemePath('fonts/a-b_c.1.woff2', 'font'));
    assert.ok(isThemePath('fond.SVG', 'image'));
    assert.equal(isThemePath('fonts/..', 'font'), false);
    assert.equal(isThemePath('a'.repeat(201) + '.png', 'image'), false);
  });

  it('themeAssetUrl : adresse sous le dossier, vide si le chemin en sort', () => {
    assert.equal(themeAssetUrl('themes/essai/', 'images/fond.svg', 'image'), 'themes/essai/images/fond.svg');
    assert.equal(themeAssetUrl('themes/essai', '../mire/fond.svg', 'image'), '');
    assert.equal(themeAssetUrl('themes/essai', undefined, 'image'), '');
  });
});

describe('schéma et réglage', () => {
  it('le schéma décrit les champs lus', () => {
    assert.deepEqual(Object.keys(THEME_SCHEMA.properties).sort(), [
      'description',
      'fonts',
      'format',
      'home',
      'id',
      'images',
      'menu',
      'name',
      'page',
      'palette',
      'sounds',
    ]);
    assert.deepEqual(THEME_SCHEMA.required, ['format', 'id', 'name']);
    const pattern = new RegExp(THEME_SCHEMA.properties.images.properties.background.pattern);
    assert.ok(pattern.test('images/fond.svg'));
    assert.equal(pattern.test('../fond.svg'), false);
    assert.equal(pattern.test('images/./fond.svg'), false);
  });

  it('resolveTheme : un thème connu, sinon le thème par défaut', () => {
    assert.equal(resolveTheme('essai', ['mire', 'essai']), 'essai');
    for (const s of [undefined, '', 'inconnu', '../mire', 3]) assert.equal(resolveTheme(s, ['mire', 'essai']), DEFAULT_THEME);
  });
});
