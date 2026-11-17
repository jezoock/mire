// Logique des composants d'éléments de @mire/ui (P4-05) : textes d'une carte, image, actions par clé, groupes et
// « Afficher plus », part rendue d'une grille virtualisée, fondu du fond.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKDROP_EMPTY,
  backdropLoaded,
  backdropRequest,
  cardImage,
  cardSubtitle,
  cardTexts,
  cardVariant,
  fillLabel,
  groupAction,
  gridGroups,
  gridView,
  infoText,
  keyAction,
  mediaUrl,
  progressOf,
  progressPercent,
  readJson,
  readList,
  readRecord,
  shownCount,
  visibleRange,
  withFocus,
  type CardElement,
} from '@mire/ui/utils';

const LABELS = { episode: 'S{season} · É{episode}', progress: 'Vu à {percent} %', unavailable: 'Indisponible' };
const el = (over: Partial<CardElement> = {}): CardElement => ({ key: 'local:/a.mkv', name: 'Friends', images: {}, infos: {}, tags: [], ...over });

describe('carte', () => {
  it('readJson et readList : objet tel quel, JSON lu, valeur illisible ou absente écartée', () => {
    assert.deepEqual(readJson({ a: 1 }), { a: 1 });
    assert.deepEqual(readJson('{"a":1}'), { a: 1 });
    assert.equal(readJson('{'), null);
    assert.equal(readJson(''), null);
    assert.equal(readJson(undefined), null);
    assert.deepEqual(readList('[1,2]'), [1, 2]);
    assert.deepEqual(readList('{"a":1}'), []);
    assert.deepEqual(readList(null), []);
    assert.deepEqual(readRecord('{"k":0.5}'), { k: 0.5 });
    assert.deepEqual(readRecord('[1]'), {});
    assert.deepEqual(readRecord(''), {});
  });

  it('cardVariant : variante reconnue, sinon l’affiche', () => {
    assert.equal(cardVariant('line'), 'line');
    assert.equal(cardVariant('thumbnail'), 'thumbnail');
    assert.equal(cardVariant('autre'), 'poster');
    assert.equal(cardVariant(undefined), 'poster');
  });

  it('fillLabel : remplace les variables connues, garde les autres', () => {
    assert.equal(fillLabel('S{season}E{episode} {x}', { season: 1, episode: 3 }), 'S1E3 {x}');
    assert.equal(fillLabel(undefined, {}), '');
  });

  it('cardImage : affiche ou fond selon la variante, par media:// pour un fichier local', () => {
    const both = { images: { poster: 'C:\\a b\\p.jpg', background: 'https://x.test/f.jpg' } };
    assert.equal(cardImage(both, 'poster'), mediaUrl('C:\\a b\\p.jpg'));
    assert.equal(cardImage(both, 'poster'), 'media://local/?p=C%3A%5Ca%20b%5Cp.jpg');
    assert.equal(cardImage(both, 'thumbnail'), 'https://x.test/f.jpg');
    assert.equal(cardImage({ images: { poster: '/p.jpg' } }, 'thumbnail'), mediaUrl('/p.jpg'));
    assert.equal(cardImage({ images: {} }, 'line'), '');
  });

  it('infoText : texte, nombre sans séparateur, liste jointe ; oui/non et absent vides', () => {
    assert.equal(infoText('Drame'), 'Drame');
    assert.equal(infoText(1994), '1994');
    assert.equal(infoText(['Drame', 'Comédie']), 'Drame, Comédie');
    assert.equal(infoText(true), '');
    assert.equal(infoText(undefined), '');
    assert.equal(infoText(Number.NaN), '');
  });

  it('cardSubtitle : info demandée, sinon épisode, année ou artiste', () => {
    assert.equal(cardSubtitle(el({ infos: { season: 1, episode: 3, year: 1994 } }), LABELS), 'S1 · É3');
    assert.equal(cardSubtitle(el({ infos: { season: 1, episode: 3, year: 1994 } }), {}), '1994', 'sans gabarit, pas d’épisode');
    assert.equal(cardSubtitle(el({ infos: { artist: 'Daft Punk' } }), LABELS), 'Daft Punk');
    assert.equal(cardSubtitle(el({ infos: { year: 1994, genres: ['Drame'] } }), LABELS, 'genres'), 'Drame');
    assert.equal(cardSubtitle(el(), LABELS), '');
  });

  it('jauge de reprise : seulement entre 0 et 1 exclus, pourcentage entre 1 et 99', () => {
    assert.equal(progressOf(0.4), 0.4);
    assert.equal(progressOf('0.25'), 0.25);
    for (const v of [0, 1, 1.5, -1, Number.NaN, null, undefined, 'x']) assert.equal(progressOf(v), null, String(v));
    assert.equal(progressPercent(0.004), 1);
    assert.equal(progressPercent(0.996), 99);
    assert.equal(progressPercent(0.426), 43);
  });

  it('cardTexts : badge de la page ou « Indisponible », nom lu par les lecteurs d’écran', () => {
    const t = cardTexts(el({ infos: { season: 2, episode: 5 } }), LABELS, { badge: 'Nouveau', progress: 0.5 });
    assert.deepEqual(t, { title: 'Friends', subtitle: 'S2 · É5', badge: 'Nouveau', progress: 0.5, label: 'Friends, S2 · É5, Nouveau, Vu à 50 %' });
    const gone = cardTexts(el({ unavailable: true }), LABELS);
    assert.equal(gone.badge, 'Indisponible');
    assert.equal(gone.label, 'Friends, Indisponible');
    assert.equal(cardTexts(el({ unavailable: true }), {}).badge, '');
  });

  it('actions : la clé de l’élément ou la valeur du regroupement, jamais un rang', () => {
    assert.equal(keyAction('open', 'local:/a "b".mkv'), 'open:[{"key":"local:/a \\"b\\".mkv"}]');
    assert.deepEqual(JSON.parse(keyAction('open', 'k').slice('open:'.length)), [{ key: 'k' }]);
    assert.equal(groupAction('openGroup', 'Friends'), 'openGroup:[{"value":"Friends"}]');
    assert.equal(groupAction('openGroup', null), 'openGroup:[{"value":null}]');
  });
});

describe('grille', () => {
  const list = (n: number, prefix = 'k') => Array.from({ length: n }, (_, i) => el({ key: `${prefix}${i}`, name: `${i}` }));

  it('gridGroups : les groupes, sinon un groupe sans titre, sinon rien', () => {
    const groups = [{ key: 'a', name: 'A', elements: list(2) }];
    assert.deepEqual(gridGroups(groups, list(5)), groups);
    assert.deepEqual(
      gridGroups([], list(1)).map((g) => [g.key, g.name, g.elements.length]),
      [['', undefined, 1]],
    );
    assert.deepEqual(gridGroups([], []), []);
    assert.deepEqual(gridGroups([{ key: 'x' } as never], []), [], 'groupe mal formé écarté');
  });

  it('shownCount : une page de plus par « Afficher plus », tout sans limite', () => {
    assert.equal(shownCount(50, 20, 1), 20);
    assert.equal(shownCount(50, 20, 2), 40);
    assert.equal(shownCount(50, 20, 3), 50);
    assert.equal(shownCount(50, 0, 1), 50);
    assert.equal(shownCount(5, 20, 0), 5);
  });

  it('gridView : éléments montrés et restants, par clé de groupe', () => {
    const view = gridView(
      [
        { key: 'a', elements: list(30, 'a') },
        { key: 'b', elements: list(10, 'b') },
      ],
      12,
      new Map([['a', 2]]),
    );
    assert.deepEqual(
      view.map((g) => [g.key, g.shown, g.remaining]),
      [
        ['a', 24, 6],
        ['b', 10, 0],
      ],
    );
  });

  it('visibleRange : lignes visibles et marge de deux lignes, lignes entières', () => {
    // 5 000 éléments, 8 colonnes, lignes de 300 px, fenêtre de 900 px.
    assert.deepEqual(visibleRange(5000, 8, 300, 0, 900), { start: 0, end: 40 });
    assert.deepEqual(visibleRange(5000, 8, 300, 3000, 3900), { start: 64, end: 120 });
    assert.deepEqual(visibleRange(5000, 8, 300, 1e9, 1e9 + 900), { start: 4992, end: 5000 }, 'au-delà de la fin : la dernière ligne');
    assert.deepEqual(visibleRange(5000, 8, 300, -2000, -1100), { start: 0, end: 8 }, 'grille sous la fenêtre : la première ligne');
    assert.deepEqual(visibleRange(10, 8, 300, 0, 900), { start: 0, end: 10 });
    assert.deepEqual(visibleRange(0, 8, 300, 0, 900), { start: 0, end: 0 });
  });

  it('withFocus : la ligne de la carte qui a le focus et deux lignes de marge restent rendues', () => {
    const visible = { start: 0, end: 48 }; // lignes 0 à 5, 8 colonnes
    assert.deepEqual(withFocus(visible, 50, 8, 5000), { start: 0, end: 72 }, 'focus en ligne 6 : lignes 7 et 8 en plus');
    assert.deepEqual(withFocus(visible, 20, 8, 5000), visible, 'focus déjà dans la part rendue');
    assert.deepEqual(withFocus({ start: 800, end: 848 }, 790, 8, 5000), { start: 768, end: 848 }, 'focus au-dessus');
    assert.deepEqual(withFocus(visible, 4999, 8, 5000), visible, 'focus trop loin : la page a défilé au stick');
    assert.deepEqual(withFocus({ start: 4960, end: 5000 }, 4999, 8, 5000), { start: 4960, end: 5000 }, 'pas au-delà de la fin');
    assert.deepEqual(withFocus(visible, -1, 8, 5000), visible, 'aucun focus');
  });

  it('visibleRange : sans mesure, une première tranche en lignes entières', () => {
    assert.deepEqual(visibleRange(5000, 7, 0, 0, 900), { start: 0, end: 63 });
    assert.deepEqual(visibleRange(20, 0, 0, 0, 900), { start: 0, end: 20 });
  });
});

describe('fond en fondu', () => {
  it('une image ne passe devant qu’une fois chargée, et seulement la dernière demandée', () => {
    let s = backdropRequest(BACKDROP_EMPTY, 'a');
    assert.deepEqual([s.layers, s.front], [['a', ''], -1]);
    s = backdropLoaded(s, 0, 'a');
    assert.equal(s.front, 0);
    s = backdropRequest(s, 'b');
    assert.deepEqual([s.layers, s.front], [['a', 'b'], 0]);
    // Une troisième demande arrive avant le chargement de b : b chargée ne passe pas devant.
    s = backdropRequest(s, 'c');
    assert.deepEqual([s.layers, s.front], [['a', 'c'], 0]);
    assert.equal(backdropLoaded(s, 1, 'b').front, 0);
    s = backdropLoaded(s, 1, 'c');
    assert.equal(s.front, 1);
  });

  it('la même image ne change rien ; une image déjà chargée derrière revient aussitôt ; aucune image efface', () => {
    let s = backdropLoaded(backdropRequest(BACKDROP_EMPTY, 'a'), 0, 'a');
    assert.equal(backdropRequest(s, 'a').front, 0);
    s = backdropLoaded(backdropRequest(s, 'b'), 1, 'b');
    s = backdropRequest(s, 'a');
    assert.deepEqual([s.layers, s.front], [['a', 'b'], 0]);
    assert.equal(backdropRequest(s, '').front, -1);
  });
});
