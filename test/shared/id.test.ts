// Identifiants aléatoires de @mire/shared.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '@mire/shared';

it('newId : 10 caractères hexadécimaux, différents à chaque appel', () => {
  const a = newId();
  assert.match(a, /^[0-9a-f]{10}$/);
  assert.notEqual(a, newId());
});

it('newId(6) : 12 caractères hexadécimaux (téléchargements)', () => {
  assert.match(newId(6), /^[0-9a-f]{12}$/);
});
