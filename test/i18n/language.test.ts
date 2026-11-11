// Langue de l'interface (P1-28) : réglage ui.language (normalisation, auto), service du processus principal.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalLanguage, matchLanguage, normalizeLanguageSetting, resolveLanguage } from '@mire/shared/i18n';
import type { Config } from '@mire/shared';
import { DEFAULT_CONFIG, normalizeConfig } from '../../src/main/config/index.ts';
import { createLanguageService } from '../../src/main/i18n/index.ts';

const AVAILABLE = ['fr', 'en'];

describe('ui.language : auto', () => {
  it('choisit l’anglais sur un système anglais', () => {
    assert.equal(resolveLanguage('auto', ['en-US'], AVAILABLE), 'en');
    assert.equal(resolveLanguage('auto', ['en-GB', 'fr-FR'], AVAILABLE), 'en');
  });

  it('choisit le français sur un système français', () => {
    assert.equal(resolveLanguage('auto', ['fr-FR'], AVAILABLE), 'fr');
    assert.equal(resolveLanguage('auto', ['fr-CA', 'en-US'], AVAILABLE), 'fr');
  });

  it('choisit l’anglais sur un système dans une autre langue', () => {
    assert.equal(resolveLanguage('auto', ['de-DE'], AVAILABLE), 'en');
    assert.equal(resolveLanguage('auto', ['ja'], AVAILABLE), 'en');
    assert.equal(resolveLanguage('auto', [], AVAILABLE), 'en');
  });

  it('parcourt les langues préférées dans l’ordre', () => {
    assert.equal(resolveLanguage('auto', ['de-DE', 'fr-BE', 'en-US'], AVAILABLE), 'fr');
  });
});

describe('ui.language : langue fixée', () => {
  it('une langue disponible est retenue telle quelle, région comprise', () => {
    assert.equal(resolveLanguage('fr', ['en-US'], AVAILABLE), 'fr');
    assert.equal(resolveLanguage('en-GB', ['fr-FR'], AVAILABLE), 'en');
  });

  it('une langue indisponible est ramenée à l’anglais', () => {
    assert.equal(resolveLanguage('de', ['fr-FR'], AVAILABLE), 'en');
  });

  it('variante régionale disponible (pack de langue)', () => {
    assert.equal(matchLanguage(['pt'], ['fr', 'en', 'pt-BR']), 'pt-BR');
    assert.equal(matchLanguage(['pt-PT'], ['fr', 'en', 'pt-BR']), 'pt-BR');
  });
});

describe('ui.language : normalisation', () => {
  it('auto, ou un code BCP 47 canonique ; le reste devient auto', () => {
    assert.equal(normalizeLanguageSetting('auto'), 'auto');
    assert.equal(normalizeLanguageSetting(' AUTO '), 'auto');
    assert.equal(normalizeLanguageSetting('en_us'), 'en-US');
    assert.equal(normalizeLanguageSetting('FR'), 'fr');
    assert.equal(normalizeLanguageSetting('pas une langue !'), 'auto');
    assert.equal(normalizeLanguageSetting(''), 'auto');
    assert.equal(normalizeLanguageSetting(42), 'auto');
    assert.equal(normalizeLanguageSetting(undefined), 'auto');
    assert.equal(canonicalLanguage('zh-hant-tw'), 'zh-Hant-TW');
  });

  it('auto par défaut, et par le service de configuration pour une configuration qui ne l’a pas encore', () => {
    assert.equal(DEFAULT_CONFIG.ui.language, 'auto');
    assert.equal(normalizeConfig({}).ui.language, 'auto');
    assert.equal(normalizeConfig({ version: 6, ui: { theme: 'minuit' } }).ui.language, 'auto');
    assert.equal(normalizeConfig({ ui: { language: 'en_GB' } }).ui.language, 'en-GB');
    assert.equal(normalizeConfig({ ui: { language: ['fr'] } }).ui.language, 'auto');
  });
});

describe('createLanguageService', () => {
  // Service de configuration réduit : get, replace et abonnés.
  function fakeConfig(language: string) {
    let current = normalizeConfig({ ui: { language } });
    const listeners = new Set<(next: Config, previous: Config) => void>();
    return {
      get: () => current,
      onChange(listener: (next: Config, previous: Config) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set(next: string) {
        const previous = current;
        current = normalizeConfig({ ui: { language: next } });
        for (const l of listeners) l(current, previous);
      },
    };
  }

  it('suit la langue du système en auto, et rend les catalogues à consulter', () => {
    const service = createLanguageService({ config: fakeConfig('auto'), systemLanguages: () => ['fr-FR'] });
    assert.equal(service.language(), 'fr');
    assert.equal(service.t('common.cancel'), 'Annuler');
    const snap = service.snapshot();
    assert.equal(snap.setting, 'auto');
    assert.equal(snap.language, 'fr');
    assert.deepEqual(Object.keys(snap.catalogs), ['fr', 'en']);
    assert.deepEqual(snap.available, [
      { code: 'fr', name: 'Français' },
      { code: 'en', name: 'English' },
    ]);
  });

  it('anglais : le français reste en dernier repli', () => {
    const service = createLanguageService({ config: fakeConfig('en'), systemLanguages: () => ['fr-FR'] });
    assert.equal(service.t('common.cancel'), 'Cancel');
    assert.deepEqual(Object.keys(service.snapshot().catalogs), ['en', 'fr']);
  });

  it('prévient d’un changement de langue, une seule fois, et pas quand la langue retenue ne change pas', () => {
    const config = fakeConfig('auto');
    const service = createLanguageService({ config, systemLanguages: () => ['fr-FR'] });
    const seen: string[] = [];
    service.onChange((info) => seen.push(info.language));
    assert.equal(service.language(), 'fr');
    config.set('fr');
    config.set('en');
    assert.equal(service.language(), 'en');
    assert.equal(service.t('common.close'), 'Close');
    assert.deepEqual(seen, ['en']);
  });

  it('ne lit les langues du système qu’à la première demande', () => {
    let reads = 0;
    const service = createLanguageService({ config: fakeConfig('auto'), systemLanguages: () => (reads++, ['en-US']) });
    assert.equal(reads, 0);
    assert.equal(service.language(), 'en');
    assert.equal(reads, 1);
  });

  it('en développement, une clé absente est signalée et la clé affichée', () => {
    const logs: string[] = [];
    const dev = createLanguageService({ config: fakeConfig('fr'), systemLanguages: () => [], dev: true, log: (m) => logs.push(m) });
    assert.equal(dev.t('inconnue.cle'), 'inconnue.cle');
    assert.deepEqual(logs, ['Texte absent des catalogues : inconnue.cle (fr)']);
    const prod = createLanguageService({ config: fakeConfig('fr'), systemLanguages: () => [], log: (m) => logs.push(m) });
    assert.equal(prod.t('inconnue.cle'), 'inconnue.cle');
    assert.equal(logs.length, 1);
  });
});
