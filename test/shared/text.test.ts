// Utilitaires de texte de @mire/shared (cas repris des tests de caractérisation P0-02 et P0-03).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fold,
  slug,
  safeFileName,
  cleanTitle,
  GENERIC_DIR,
  titleKey,
  bigramDice,
  rankByTitle,
  stripTags,
  cleanRomName,
  parseEpisode,
  similarity,
} from '@mire/shared';

describe('fold', () => {
  it('minuscules sans accents, espaces conservés', () => {
    assert.equal(fold('  Ça Égale  '), '  ca egale  ');
    assert.equal(fold('  Ça Égale  ').trim(), 'ca egale');
    assert.equal(fold('Pokémon'), 'pokemon');
  });

  it('valeur absente → texte vide', () => {
    assert.equal(fold(undefined), '');
    assert.equal(fold(null), '');
  });
});

describe('slug', () => {
  it('minuscules, sans accents, tirets', () => {
    assert.equal(slug('  Ma Vidéothèque — Été 2024 ! '), 'ma-videotheque-ete-2024');
    assert.equal(slug('Super Nintendo'), 'super-nintendo');
  });

  it('valeur absente ou sans lettre → texte vide', () => {
    assert.equal(slug(null), '');
    assert.equal(slug('— !'), '');
  });
});

describe('safeFileName', () => {
  it('remplace les caractères interdits par Windows et les caractères de contrôle', () => {
    assert.equal(safeFileName('Film: le retour?.mkv'), 'Film_ le retour_.mkv');
    assert.equal(safeFileName('a<b>c"d/e\\f|g*h'), 'a_b_c_d_e_f_g_h');
    assert.equal(safeFileName('ligne\nsuivante\u0000'), 'ligne_suivante_');
  });

  it('longueur limitée à 200 et nom par défaut', () => {
    assert.equal(safeFileName('x'.repeat(250)).length, 200);
    assert.equal(safeFileName(''), 'fichier');
    assert.equal(safeFileName(null), 'fichier');
  });

  it('options : sans limite de longueur, sans nom par défaut', () => {
    const keep = { max: Infinity, fallback: '' };
    assert.equal(safeFileName('x'.repeat(250), keep).length, 250);
    assert.equal(safeFileName('', keep), '');
    assert.equal(safeFileName('Jeu: édition?', keep), 'Jeu_ édition_');
  });
});

describe('cleanTitle', () => {
  it('retire crochets, séparateurs et étiquettes techniques', () => {
    assert.equal(cleanTitle('[Team] Mon_Film.MULTi.1080p.x265'), 'Mon Film');
    assert.equal(cleanTitle('Un  titre   espacé'), 'Un titre espacé');
    assert.equal(cleanTitle('Le.Fabuleux.Destin.2001.1080p'), 'Le Fabuleux Destin 2001');
  });

  it('cas limites (vide, parenthèses vides, tiret final)', () => {
    assert.equal(cleanTitle(''), '');
    assert.equal(cleanTitle('Titre ( )'), 'Titre');
    assert.equal(cleanTitle('Titre -'), 'Titre');
  });
});

it('GENERIC_DIR : dossiers sans intérêt pour nommer une série', () => {
  for (const d of ['Saison 1', 'Season 02', 'S01', 'Disc 2', 'CD 1', 'Volume 3']) assert.equal(GENERIC_DIR.test(d), true, d);
  for (const d of ['Le Bureau des légendes', 'Discovery', 'Partiel', 'CD1']) assert.equal(GENERIC_DIR.test(d), false, d);
});

it('titleKey : accents, « & » et ponctuation', () => {
  assert.equal(titleKey('Tom & Jerry !'), 'tom and jerry');
  assert.equal(titleKey('  Pokémon: Rouge  '), 'pokemon rouge');
  assert.equal(titleKey(undefined), '');
});

describe('bigramDice', () => {
  it('identiques, sans paire commune, trop courts', () => {
    assert.equal(bigramDice('tetris', 'tetris'), 1);
    assert.equal(bigramDice('abc', 'xyz'), 0);
    assert.equal(bigramDice('a', 'ab'), 0);
    assert.equal(bigramDice('', ''), 1);
  });

  it('ressemblance partielle, paires répétées comptées une fois chacune', () => {
    assert.equal(bigramDice('night', 'nacht'), 0.25);
    assert.equal(bigramDice('aaaa', 'aa'), 0.5);
  });
});

describe('rankByTitle', () => {
  it('« Replaced » donne REPLACED avant « The Farmer Was Replaced »', () => {
    const list = [{ t: 'The Farmer Was Replaced' }, { t: 'REPLACED' }, { t: 'Replaced Deluxe' }, { t: 'Autre' }];
    const ranked = rankByTitle(list, 'Replaced', (x) => x.t).map((x) => x.t);
    assert.deepEqual(ranked, ['REPLACED', 'Replaced Deluxe', 'The Farmer Was Replaced', 'Autre']);
  });

  it('l’année départage les homonymes, l’ordre d’origine sinon', () => {
    const list = [
      { t: 'Dune', y: '1984-12-14' },
      { t: 'Dune', y: '2021-09-15' },
    ];
    const getTitle = (x: { t: string }) => x.t;
    const getYear = (x: { y: string }) => x.y;
    assert.deepEqual(
      rankByTitle(list, 'Dune', getTitle, getYear, 2021).map((x) => x.y),
      ['2021-09-15', '1984-12-14'],
    );
    assert.deepEqual(
      rankByTitle(list, 'Dune', getTitle).map((x) => x.y),
      ['1984-12-14', '2021-09-15'],
    );
  });

  it('liste vide', () => {
    assert.deepEqual(
      rankByTitle([], 'Replaced', (x) => x),
      [],
    );
  });
});

it('stripTags : retire les mentions entre parenthèses ou crochets', () => {
  assert.equal(stripTags('Super Mario World (Europe) (En,Fr) [!]'), 'Super Mario World');
  assert.equal(stripTags('Tetris [b1] (USA)'), 'Tetris');
  assert.equal(stripTags('(USA) [!]'), '');
  assert.equal(stripTags('  Zelda  '), 'Zelda');
});

it('cleanRomName', () => {
  assert.equal(cleanRomName('Super Mario World (Europe) (En,Fr) [!]'), 'Super Mario World');
  assert.equal(cleanRomName('Zelda_Link_To_The_Past'), 'Zelda Link To The Past');
  assert.equal(cleanRomName('_Zelda_ (USA)'), 'Zelda');
  assert.equal(cleanRomName('(Europe)'), '(Europe)');
});

describe('parseEpisode', () => {
  it('S01E03, S2 E114, 1x07', () => {
    assert.deepEqual(parseEpisode('Serie.S01E03.mkv'), { season: 1, episode: 3, index: 6 });
    assert.deepEqual(parseEpisode('serie s2 e114'), { season: 2, episode: 114, index: 6 });
    assert.deepEqual(parseEpisode('Serie 1x07'), { season: 1, episode: 7, index: 6 });
    assert.deepEqual(parseEpisode('S01E03'), { season: 1, episode: 3, index: 0 });
  });

  it('S01E03 l’emporte sur 1x03', () => {
    assert.deepEqual(parseEpisode('1x02 S03E04'), { season: 3, episode: 4, index: 5 });
  });

  it('sans mention d’épisode', () => {
    assert.deepEqual(parseEpisode('Film 1080p'), { season: null, episode: null, index: -1 });
    assert.deepEqual(parseEpisode('Film 1920x1080'), { season: null, episode: null, index: -1 });
  });
});

it('similarity', () => {
  assert.equal(similarity('The Witcher 3', 'the-witcher-3'), 1);
  assert.equal(similarity('Witcher3.exe', 'The Witcher 3'), 0);
  assert.equal(similarity('witcher3', 'The Witcher3 GOTY'), 0.8);
  assert.equal(similarity('Hadès', 'hades'), 1);
  assert.equal(similarity('', 'x'), 0);
  assert.equal(similarity('Doom', 'Quake'), 0);
});
