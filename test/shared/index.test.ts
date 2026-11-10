// Vérifie que les tests en TypeScript s'exécutent (suppression de types de Node) et que @mire/shared se charge.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '@mire/shared';

describe('@mire/shared', () => {
  it('se charge depuis un test TypeScript', () => {
    const exported: string[] = Object.keys(shared);
    assert.deepEqual(exported, []);
  });
});
