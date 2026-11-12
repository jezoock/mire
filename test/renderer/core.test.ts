// Outils de l'interface déplacés de src/renderer/app.js vers src/renderer/core/ (P1-22) : mêmes résultats qu'avant.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, esc } from '../../src/renderer/core/dom.ts';
import { clamp, fmtBytes, fmtEta, fmtSize, fmtTime, plural } from '../../src/renderer/core/format.ts';
import { BARS, barFor, monogram, onColor, safeColor } from '../../src/renderer/core/colors.ts';
import { ICON } from '../../src/renderer/core/icons.ts';
import { mediaUrl } from '../../src/renderer/core/media.ts';

describe('core/dom', () => {
  it('esc échappe les caractères spéciaux du HTML', () => {
    assert.equal(esc(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
  });

  it('esc convertit en texte et vide null et undefined', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
    assert.equal(esc(0), '0');
    assert.equal(esc(false), 'false');
  });

  it('$ et $$ cherchent dans la racine donnée ; $$ renvoie un vrai tableau', () => {
    const calls: string[] = [];
    const root = {
      querySelector: (sel: string) => (calls.push(`one:${sel}`), sel === '#a' ? 'A' : null),
      querySelectorAll: (sel: string) => (calls.push(`all:${sel}`), new Set(['x', 'y'])),
    } as unknown as ParentNode;
    assert.equal($('#a', root), 'A');
    assert.equal($('#b', root), null);
    const all = $$('.t', root);
    assert.ok(Array.isArray(all));
    assert.deepEqual(all, ['x', 'y']);
    assert.deepEqual(calls, ['one:#a', 'one:#b', 'all:.t']);
  });
});

describe('core/format', () => {
  it('plural accorde avec le nombre', () => {
    assert.equal(plural(0, 'film'), '0 film');
    assert.equal(plural(1, 'film'), '1 film');
    assert.equal(plural(2, 'film'), '2 films');
    assert.equal(plural(3, 'jeu copié', 'jeux copiés'), '3 jeux copiés');
  });

  it('clamp borne la valeur', () => {
    assert.equal(clamp(5, 0, 1), 1);
    assert.equal(clamp(-5, 0, 1), 0);
    assert.equal(clamp(0.4, 0, 1), 0.4);
  });

  it('fmtTime : minutes et secondes, puis heures', () => {
    assert.equal(fmtTime(0), '0:00');
    assert.equal(fmtTime(7.9), '0:07');
    assert.equal(fmtTime(187), '3:07');
    assert.equal(fmtTime(3729), '1:02:09');
    assert.equal(fmtTime(-3), '0:00');
    assert.equal(fmtTime(Number.NaN), '0:00');
    assert.equal(fmtTime(Number.POSITIVE_INFINITY), '0:00');
  });

  it('fmtBytes : multiples de 1024, une décimale à partir du Mo', () => {
    assert.equal(fmtBytes(0), '0 o');
    assert.equal(fmtBytes(512), '512 o');
    assert.equal(fmtBytes(1536), '2 Ko');
    assert.equal(fmtBytes(1.5 * 1024 ** 2), '1,5 Mo');
    assert.equal(fmtBytes(3 * 1024 ** 3), '3 Go');
    assert.equal(fmtBytes(2.25 * 1024 ** 4), '2,3 To');
    // Au-delà, on reste en To (séparateur des milliers selon la langue).
    assert.equal(fmtBytes(5 * 1024 ** 5), `${(5 * 1024).toLocaleString('fr-FR')} To`);
  });

  it('fmtEta : moins d’une minute, minutes, puis heures', () => {
    assert.equal(fmtEta(0), '');
    assert.equal(fmtEta(Number.POSITIVE_INFINITY), '');
    assert.equal(fmtEta(20_000), 'moins d’une minute');
    assert.equal(fmtEta(12 * 60_000), '12 min');
    assert.equal(fmtEta(65 * 60_000), '1 h 05');
    assert.equal(fmtEta(150 * 60_000), '2 h 30');
  });

  it('fmtSize : multiples de 1000, vide si inconnue', () => {
    assert.equal(fmtSize(0), '');
    assert.equal(fmtSize(750e6), '750 Mo');
    assert.equal(fmtSize(1e9), '1000 Mo');
    assert.equal(fmtSize(2.44e9), '2,4 Go');
  });
});

describe('core/colors', () => {
  it('barFor est stable et choisit parmi les barres de la mire', () => {
    assert.equal(barFor('Alien'), barFor('Alien'));
    assert.equal(barFor(''), 'yellow');
    assert.equal(barFor('a'), BARS[97 % BARS.length]);
    for (const s of ['Alien', 'Brazil', 'Casablanca', '/films/Dune', 42]) assert.ok(BARS.includes(barFor(s)));
  });

  it('monogram : numéro d’épisode, sinon première lettre ou chiffre', () => {
    assert.equal(monogram('Série S01E03 - Titre'), 'E03');
    assert.equal(monogram('s2 e14'), 'E14');
    assert.equal(monogram('«  été »'), 'É');
    assert.equal(monogram('2001'), '2');
    assert.equal(monogram('— ?'), '?');
    assert.equal(monogram(''), '?');
    assert.equal(monogram(null), '?');
  });

  it('onColor : texte sombre sur fond clair, blanc sinon', () => {
    assert.equal(onColor('#ffffff'), '#171A18');
    assert.equal(onColor('ffee00'), '#171A18');
    assert.equal(onColor('#000000'), '#ffffff');
    assert.equal(onColor('#1E3A8A'), '#ffffff');
    assert.equal(onColor('#fff'), '#ffffff');
    assert.equal(onColor(null), '#ffffff');
  });

  it('safeColor garde une couleur hexadécimale valide, sinon le gris par défaut', () => {
    assert.equal(safeColor('#abc'), '#abc');
    assert.equal(safeColor('#AABBCCDD'), '#AABBCCDD');
    assert.equal(safeColor('red'), '#59625B');
    assert.equal(safeColor('#12'), '#59625B');
    assert.equal(safeColor('#123456;background:url(x)'), '#59625B');
    assert.equal(safeColor(undefined), '#59625B');
  });
});

describe('core/icons', () => {
  it('chaque icône est un SVG masqué des lecteurs d’écran', () => {
    assert.ok(Object.keys(ICON).length > 20);
    for (const [name, svg] of Object.entries(ICON)) {
      assert.match(svg, /^<svg viewBox="0 0 24 24" aria-hidden="true">.*<\/svg>$/, name);
    }
  });
});

describe('core/media', () => {
  it('mediaUrl : fichiers locaux par media://, adresses web telles quelles', () => {
    assert.equal(mediaUrl('C:\\Films\\Été & co.mkv'), 'media://local/?p=C%3A%5CFilms%5C%C3%89t%C3%A9%20%26%20co.mkv');
    assert.equal(mediaUrl('/home/moi/a b.mp3'), 'media://local/?p=%2Fhome%2Fmoi%2Fa%20b.mp3');
    assert.equal(mediaUrl('https://exemple.fr/v.mp4'), 'https://exemple.fr/v.mp4');
    assert.equal(mediaUrl('HTTP://exemple.fr/v.mp4'), 'HTTP://exemple.fr/v.mp4');
  });
});
