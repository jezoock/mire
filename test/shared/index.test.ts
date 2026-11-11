// Vérifie que @mire/shared se charge depuis un test TypeScript et expose ses utilitaires.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '@mire/shared';

describe('@mire/shared', () => {
  it('expose les utilitaires de texte, d’adresse et d’identifiant, les formats et les systèmes', () => {
    const exported: string[] = Object.keys(shared).sort();
    assert.deepEqual(exported, [
      'ART_RE',
      'COVER_RE',
      'DISC_INDEX_EXT',
      'EXT',
      'FANART_RE',
      'GAME_FILE_RE',
      'GENERIC_DIR',
      'KIND',
      'MEDIA_KINDS',
      'MIME',
      'NATIVE',
      'SYSTEMS',
      'bigramDice',
      'cleanRomName',
      'cleanTitle',
      'fold',
      'guessSystem',
      'hostOf',
      'isHttpUrl',
      'isUrlTarget',
      'newId',
      'parseEpisode',
      'rankByTitle',
      'safeDecode',
      'safeFileName',
      'similarity',
      'siteOf',
      'slug',
      'stripTags',
      'systemById',
      'titleKey',
    ]);
  });

  it('se charge depuis un module CommonJS du processus principal', () => {
    const { createRequire } = process.getBuiltinModule('node:module');
    const require = createRequire(import.meta.url);
    assert.equal(require('@mire/shared').slug, shared.slug);
  });
});
