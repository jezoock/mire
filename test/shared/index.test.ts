// Vérifie que @mire/shared se charge depuis un test TypeScript et expose ses utilitaires.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '@mire/shared';

describe('@mire/shared', () => {
  it('expose les utilitaires de texte, d’adresse et d’identifiant, les formats, les systèmes et les palettes', () => {
    const exported: string[] = Object.keys(shared).sort();
    assert.deepEqual(exported, [
      'ART_RE',
      'AUTO_PALETTES',
      'COVER_RE',
      'DEFAULT_PALETTE',
      'DISC_INDEX_EXT',
      'EXT',
      'FANART_RE',
      'GAME_FILE_RE',
      'GENERIC_DIR',
      'KIND',
      'MEDIA_KINDS',
      'MIME',
      'NATIVE',
      'PALETTE_AUTO',
      'PALETTE_OPTIONAL_TOKENS',
      'PALETTE_TOKENS',
      'SYSTEMS',
      'bigramDice',
      'cleanRomName',
      'cleanTitle',
      'fold',
      'guessSystem',
      'hostOf',
      'isHttpUrl',
      'isPaletteId',
      'isUrlTarget',
      'newId',
      'parseEpisode',
      'parsePaletteMeta',
      'rankByTitle',
      'resolvePalette',
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
