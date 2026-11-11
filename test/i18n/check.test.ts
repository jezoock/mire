// Vérification des catalogues (npm run i18n:check, P1-28) : clés, variables, textes vides, métadonnées.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUILTIN_CATALOGS, checkCatalogs, flattenMessages, variablesOf, type Catalog } from '@mire/shared/i18n';

const ROOT = path.join(import.meta.dirname, '..', '..');
const catalog = (code: string, messages: Catalog['messages']): Catalog => ({ meta: { code, name: code, app: '1.0.0' }, messages });

const FR = catalog('fr', {
  a: { b: 'Bonjour {nom}' },
  files: { one: '{count} fichier', other: '{count} fichiers' },
});

describe('checkCatalogs', () => {
  it('les catalogues intégrés sont complets', () => {
    assert.deepEqual(checkCatalogs({ ...BUILTIN_CATALOGS }, 'fr'), []);
  });

  it('catalogues identiques en forme : aucun problème', () => {
    const en = catalog('en', { a: { b: 'Hello {nom}' }, files: { one: '{count} file', other: '{count} files' } });
    assert.deepEqual(checkCatalogs({ fr: FR, en }, 'fr'), []);
  });

  it('clé manquante en anglais, clé en trop', () => {
    const en = catalog('en', { files: { one: '{count} file', other: '{count} files' }, extra: 'More' });
    assert.deepEqual(checkCatalogs({ fr: FR, en }, 'fr'), ['en : clé manquante a.b', 'en : clé en trop extra (absente en fr)']);
  });

  it('variables différentes', () => {
    const en = catalog('en', { a: { b: 'Hello {name}' }, files: { one: 'one file', other: '{count} files' } });
    assert.deepEqual(checkCatalogs({ fr: FR, en }, 'fr'), ['en : a.b a les variables [name] au lieu de [nom]']);
  });

  it('texte vide, pluriel au lieu de texte, valeur qui n’est pas un texte', () => {
    const en = catalog('en', { a: { b: { one: '{nom}', other: '{nom}' } }, files: { one: '', other: '{count} files' }, n: 3 as unknown as string });
    assert.deepEqual(checkCatalogs({ fr: FR, en }, 'fr'), [
      "en : n n'est ni un texte ni un pluriel",
      'en : files est vide',
      'en : a.b doit être un texte, comme en fr',
    ]);
  });

  it('métadonnées absentes ou incohérentes', () => {
    const en = { meta: { code: 'fr', name: '' }, messages: FR.messages } as unknown as Catalog;
    assert.deepEqual(checkCatalogs({ fr: FR, en }, 'fr'), [
      'en : métadonnée « name » absente ou vide',
      'en : métadonnée « app » absente ou vide',
      'en : meta.code vaut « fr »',
    ]);
  });

  it('catalogue de référence absent', () => {
    assert.deepEqual(checkCatalogs({ en: FR }, 'fr'), ['catalogue de référence « fr » absent']);
  });

  it('flattenMessages et variablesOf', () => {
    assert.deepEqual([...flattenMessages(FR.messages).leaves.keys()], ['a.b', 'files']);
    assert.deepEqual(variablesOf({ one: '{count} {x}', other: '{count} {y}' }), ['count', 'x', 'y']);
  });
});

describe('npm run i18n:check', () => {
  const run = (dir?: string) => {
    try {
      const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'i18n-check.mjs'), ...(dir ? [dir] : [])], { encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out };
    } catch (err) {
      const e = err as { status: number; stderr: string };
      return { code: e.status, out: e.stderr };
    }
  };

  it('passe sur les catalogues du dépôt', () => {
    assert.equal(run().code, 0);
  });

  it('échoue si une clé manque en anglais', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-i18n-'));
    try {
      const en = structuredClone(BUILTIN_CATALOGS.en) as Catalog;
      delete (en.messages.common as Record<string, unknown>).cancel;
      fs.writeFileSync(path.join(dir, 'fr.json'), JSON.stringify(BUILTIN_CATALOGS.fr));
      fs.writeFileSync(path.join(dir, 'en.json'), JSON.stringify(en));
      const { code, out } = run(dir);
      assert.equal(code, 1);
      assert.match(out, /en : clé manquante common\.cancel/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
