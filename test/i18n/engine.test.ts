// Moteur de traduction de @mire/shared/i18n (P1-28) : interpolation, pluriels, repli, clé absente, formats.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CATALOGS, createI18n, interpolate, isPluralMessage, lookup, type Catalog } from '@mire/shared/i18n';

const catalog = (code: string, messages: Catalog['messages']): Catalog => ({ meta: { code, name: code, app: '1.0.0' }, messages });

const CATALOGS: Record<string, Catalog> = {
  fr: catalog('fr', {
    library: {
      errors: { folderNotFound: 'Dossier introuvable : {path}' },
      files: { one: '{count} fichier', other: '{count} fichiers' },
    },
    onlyFr: 'Seulement en français',
    empty: '',
  }),
  en: catalog('en', {
    library: {
      errors: { folderNotFound: 'Folder not found: {path}' },
      files: { one: '{count} file', other: '{count} files' },
    },
    onlyEn: 'English only',
    empty: 'Not empty in English',
  }),
  de: catalog('de', { library: { errors: { folderNotFound: 'Ordner nicht gefunden: {path}' } } }),
};

// Les espaces insécables (fines ou non) d'Intl deviennent des espaces simples : les tests restent lisibles.
const plain = (s: string) => s.replace(/[  ]/g, ' ');

describe('createI18n : textes', () => {
  const fr = createI18n({ locale: 'fr', catalogs: CATALOGS });
  const en = createI18n({ locale: 'en', catalogs: CATALOGS });

  it('clés hiérarchiques et interpolation', () => {
    assert.equal(fr.t('library.errors.folderNotFound', { path: '/films' }), 'Dossier introuvable : /films');
    assert.equal(en.t('library.errors.folderNotFound', { path: '/films' }), 'Folder not found: /films');
  });

  it('une variable non fournie reste visible, une variable en trop est ignorée', () => {
    assert.equal(fr.t('library.errors.folderNotFound'), 'Dossier introuvable : {path}');
    assert.equal(fr.t('library.errors.folderNotFound', { path: 'x', autre: 'y' }), 'Dossier introuvable : x');
  });

  it('pluriels français : 0 et 1 au singulier, 2 au pluriel', () => {
    assert.deepEqual(
      [0, 1, 2].map((count) => fr.t('library.files', { count })),
      ['0 fichier', '1 fichier', '2 fichiers'],
    );
  });

  it('pluriels anglais : 1 au singulier, 0 et 2 au pluriel', () => {
    assert.deepEqual(
      [0, 1, 2].map((count) => en.t('library.files', { count })),
      ['0 files', '1 file', '2 files'],
    );
  });

  it('les nombres insérés suivent la langue', () => {
    assert.equal(plain(fr.t('library.files', { count: 1234 })), '1 234 fichiers');
    assert.equal(en.t('library.files', { count: 1234 }), '1,234 files');
  });

  it('repli : langue choisie → anglais → français', () => {
    const de = createI18n({ locale: 'de', catalogs: CATALOGS });
    assert.deepEqual(de.chain, ['de', 'en', 'fr']);
    assert.equal(de.t('library.errors.folderNotFound', { path: 'x' }), 'Ordner nicht gefunden: x');
    assert.equal(de.t('onlyEn'), 'English only');
    assert.equal(de.t('onlyFr'), 'Seulement en français');
    assert.deepEqual(fr.chain, ['fr', 'en']);
    assert.equal(fr.t('onlyEn'), 'English only');
  });

  it('un pluriel trouvé en repli suit les règles de la langue qui le fournit', () => {
    const de = createI18n({ locale: 'de', catalogs: CATALOGS });
    assert.equal(de.t('library.files', { count: 0 }), '0 files');
  });

  it('un texte vide compte comme absent : on passe à la langue suivante', () => {
    assert.equal(fr.t('empty'), 'Not empty in English');
  });

  it('langue sans catalogue : repli direct, formats de la langue demandée', () => {
    const it_ = createI18n({ locale: 'it', catalogs: CATALOGS });
    assert.deepEqual(it_.chain, ['en', 'fr']);
    assert.equal(it_.t('onlyEn'), 'English only');
  });

  it('repli personnalisé', () => {
    const i = createI18n({ locale: 'de', catalogs: CATALOGS, fallback: ['fr'] });
    assert.deepEqual(i.chain, ['de', 'fr']);
    assert.equal(i.t('onlyEn'), 'onlyEn');
  });

  it('clé absente : la clé elle-même, jamais un texte vide, signalée une seule fois', () => {
    const missing: string[] = [];
    const i = createI18n({ locale: 'fr', catalogs: CATALOGS, onMissing: (key, locale) => missing.push(`${key}@${locale}`) });
    assert.equal(i.t('library.errors.inconnue'), 'library.errors.inconnue');
    assert.equal(i.t('library.errors.inconnue'), 'library.errors.inconnue');
    // Une clé qui désigne un groupe de textes n'est pas un texte.
    assert.equal(i.t('library.errors'), 'library.errors');
    assert.deepEqual(missing, ['library.errors.inconnue@fr', 'library.errors@fr']);
    assert.equal(i.has('library.errors.folderNotFound'), true);
    assert.equal(i.has('library.errors'), false);
  });

  it('sans onMissing (production), une clé absente ne signale rien', () => {
    assert.equal(createI18n({ locale: 'fr', catalogs: CATALOGS }).t('absente'), 'absente');
  });
});

describe('createI18n : formats', () => {
  const fr = createI18n({ locale: 'fr', catalogs: CATALOGS });
  const en = createI18n({ locale: 'en', catalogs: CATALOGS });
  const date = new Date(2026, 10, 11, 15, 4);

  it('dates', () => {
    assert.equal(fr.formatDate(date), '11 novembre 2026');
    assert.equal(en.formatDate(date), 'November 11, 2026');
    assert.equal(fr.formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' }), 'mercredi 11 novembre');
  });

  it('heures', () => {
    assert.equal(fr.formatTime(date), '15:04');
    assert.equal(plain(en.formatTime(date)), '03:04 PM');
  });

  it('tailles, en base 1024', () => {
    assert.equal(plain(fr.formatSize(0)), '0 octet');
    assert.equal(plain(fr.formatSize(512)), '512 octets');
    assert.equal(plain(fr.formatSize(2048)), '2 ko');
    assert.equal(plain(fr.formatSize(1.5 * 1024 ** 2)), '1,5 Mo');
    assert.equal(plain(fr.formatSize(1.5 * 1024 ** 3)), '1,5 Go');
    assert.equal(plain(en.formatSize(0)), '0 bytes');
    assert.equal(plain(en.formatSize(1.5 * 1024 ** 3)), '1.5 GB');
    assert.equal(plain(en.formatSize(3 * 1024 ** 4)), '3 TB');
  });

  it('durées', () => {
    assert.equal(plain(fr.formatDuration(3900)), '1 h 5 min');
    assert.equal(plain(fr.formatDuration(65)), '1 min 5 s');
    assert.equal(plain(fr.formatDuration(7200)), '2 h');
    assert.equal(plain(fr.formatDuration(0)), '0 s');
    assert.equal(plain(en.formatDuration(3900)), '1 hr 5 min');
  });

  it('nombres', () => {
    assert.equal(plain(fr.formatNumber(1234.5)), '1 234,5');
    assert.equal(en.formatNumber(1234.5), '1,234.5');
  });

  it('tri : numérique, sans casse ni accents', () => {
    assert.deepEqual(['Épisode 10', 'episode 2', 'Zèbre', 'arbre'].sort(fr.compare), ['arbre', 'episode 2', 'Épisode 10', 'Zèbre']);
    assert.equal(fr.compare('été', 'Ete'), 0);
  });
});

describe('outils du moteur', () => {
  it('isPluralMessage : catégories seulement, other obligatoire', () => {
    assert.equal(isPluralMessage({ one: 'a', other: 'b' }), true);
    assert.equal(isPluralMessage({ one: 'a' }), false);
    assert.equal(isPluralMessage({ other: 'b', label: 'c' }), false);
    assert.equal(isPluralMessage('texte'), false);
  });

  it('lookup ne suit pas le prototype', () => {
    assert.equal(lookup({ a: { b: 'x' } }, 'a.b'), 'x');
    assert.equal(lookup({ a: { b: 'x' } }, 'a.toString'), undefined);
    assert.equal(lookup({}, '__proto__'), undefined);
  });

  it('interpolate sans variables rend le texte tel quel', () => {
    assert.equal(
      interpolate('{a}', undefined, (n) => String(n)),
      '{a}',
    );
  });

  it('catalogues intégrés : français et anglais, chacun avec ses métadonnées', () => {
    assert.deepEqual(Object.keys(BUILTIN_CATALOGS).sort(), ['en', 'fr']);
    assert.deepEqual(BUILTIN_CATALOGS.fr.meta, { code: 'fr', name: 'Français', app: '1.0.0' });
    assert.equal(BUILTIN_CATALOGS.en.meta.name, 'English');
  });
});
