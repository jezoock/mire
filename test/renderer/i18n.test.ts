// Service de traduction de l'interface (P4-04) : catalogues reçus du processus principal, changement de langue,
// attribut lang du document.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createUiI18n } from '../../src/renderer/i18n/index.ts';
import type { LanguageSource } from '../../src/renderer/i18n/index.ts';
import type { LanguageInfo } from '@mire/shared/ipc';
import type { Catalog } from '@mire/shared/i18n';

const catalog = (code: string, messages: Catalog['messages']): Catalog => ({ meta: { code, name: code, app: '1.0.0' }, messages });
const FR = catalog('fr', { app: { hello: 'Bonjour {name}', files: { one: '{count} fichier', other: '{count} fichiers' } } });
const EN = catalog('en', { app: { hello: 'Hello {name}', files: { one: '{count} file', other: '{count} files' } } });
const info = (language: string): LanguageInfo => ({
  setting: language,
  language,
  available: [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'Français' },
  ],
  catalogs: language === 'fr' ? { fr: FR, en: EN } : { en: EN, fr: FR },
});

function fakeSource(first: LanguageInfo | { ok: false; error: string }) {
  let listener: ((i: LanguageInfo) => void) | null = null;
  const source: LanguageSource = {
    i18nGet: async () => first,
    onLanguageChange: (cb) => {
      listener = cb;
      return () => {};
    },
  };
  return { source, change: (i: LanguageInfo) => listener?.(i) };
}

it('avant le démarrage, une clé tient lieu de texte', () => {
  const i18n = createUiI18n(null);
  assert.equal(i18n.t('app.hello'), 'app.hello');
  assert.equal(i18n.language, '');
  assert.equal(i18n.engine, null);
});

it('utilise les catalogues reçus et met la langue sur le document', async () => {
  const doc = { documentElement: { lang: 'fr' } };
  const { source } = fakeSource(info('en'));
  const i18n = createUiI18n(doc);
  await i18n.start(source);
  assert.equal(i18n.language, 'en');
  assert.equal(doc.documentElement.lang, 'en');
  assert.equal(i18n.t('app.hello', { name: 'Ada' }), 'Hello Ada');
  assert.equal(i18n.t('app.files', { count: 1234 }), '1,234 files');
  assert.deepEqual(i18n.raw('app.files'), { one: '{count} file', other: '{count} files' });
  await i18n.ready();
});

it('suit les changements de langue, à chaud', async () => {
  const doc = { documentElement: { lang: 'fr' } };
  const { source, change } = fakeSource(info('en'));
  const i18n = createUiI18n(doc);
  const seen: string[] = [];
  const stop = i18n.onChange((lang) => seen.push(lang));
  await i18n.start(source);
  change(info('fr'));
  assert.equal(doc.documentElement.lang, 'fr');
  assert.equal(i18n.t('app.files', { count: 1 }), '1 fichier');
  stop();
  change(info('en'));
  assert.deepEqual(seen, ['en', 'fr']);
});

it('catalogues refusés : l’interface reste utilisable avec les clés, lang inchangé', async () => {
  const doc = { documentElement: { lang: 'fr' } };
  const { source } = fakeSource({ ok: false, error: 'panne' });
  const i18n = createUiI18n(doc);
  await i18n.start(source);
  assert.equal(i18n.t('app.hello'), 'app.hello');
  assert.equal(doc.documentElement.lang, 'fr');
});
