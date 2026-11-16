// Textes au pluriel des composants de @mire/ui (formes passées en attribut, Intl.PluralRules).
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePluralLabels, pluralLabel } from '@mire/ui/utils';

const CLICKS = { one: '{count} clic', other: '{count} clics' };

it('parsePluralLabels : lit les formes en JSON, refuse un attribut absent, illisible ou sans « other »', () => {
  assert.deepEqual(parsePluralLabels(JSON.stringify(CLICKS)), CLICKS);
  assert.equal(parsePluralLabels(''), null);
  assert.equal(parsePluralLabels(null), null);
  assert.equal(parsePluralLabels('{'), null);
  assert.equal(parsePluralLabels('{"one":"{count} clic"}'), null);
  assert.equal(parsePluralLabels('"texte"'), null);
});

it('pluralLabel : forme choisie selon la langue, nombre formaté', () => {
  assert.equal(pluralLabel(CLICKS, 0, 'fr'), '0 clic');
  assert.equal(pluralLabel(CLICKS, 1, 'fr'), '1 clic');
  assert.equal(pluralLabel(CLICKS, 2, 'fr'), '2 clics');
  assert.equal(pluralLabel({ one: '{count} click', other: '{count} clicks' }, 0, 'en'), '0 clicks');
  assert.equal(pluralLabel(CLICKS, 1500, 'fr'), '1 500 clics');
});

it('pluralLabel : sans la forme demandée, « other » sert de repli', () => {
  assert.equal(pluralLabel({ other: '{count} éléments' }, 1, 'fr'), '1 éléments');
});
