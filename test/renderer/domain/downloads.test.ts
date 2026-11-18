// États des téléchargements (P1-23) ; la ligne d'infos est rédigée par le Centre depuis P4-18 (test/renderer/centre.test.ts).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DL_ACTIVE } from '../../../src/renderer/domain/downloads.ts';

describe('domain/downloads', () => {
  it('états actifs', () => {
    assert.deepEqual([...DL_ACTIVE], ['waiting', 'downloading', 'extracting']);
  });
});
