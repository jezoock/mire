/**
 * Langue de l'interface côté processus principal : suit le réglage `ui.language` (et, en `auto`, les langues
 * du système), tient le moteur de traduction de cette langue et prévient quand elle change (bascule à chaud).
 */
import { BUILTIN_CATALOGS, DEFAULT_FALLBACK, createI18n, resolveLanguage, type Catalog, type I18n, type Messages, type Vars } from '@mire/shared/i18n';
import type { Config } from '@mire/shared';
import type { LanguageInfo } from '@mire/shared/ipc';

/** Ce que l'interface reçoit (contrat IPC `i18nGet`, événement `onLanguageChange`). */
export type LanguageSnapshot = LanguageInfo;

export type LanguageListener = (snapshot: LanguageSnapshot) => void;

export interface LanguageServiceOptions {
  config: { get(): Config; onChange(listener: (next: Config, previous: Config) => void): () => void };
  /** Langues préférées du système, la première d'abord (`app.getPreferredSystemLanguages()`). */
  systemLanguages: () => readonly string[];
  catalogs?: Readonly<Record<string, Catalog>>;
  /** Développement : une clé absente est signalée dans la console. */
  dev?: boolean;
  log?: (message: string) => void;
}

export interface LanguageService {
  /** Langue retenue. */
  language(): string;
  /** Texte d'une clé dans la langue retenue (repli compris). */
  t(key: string, vars?: Vars): string;
  /** Moteur de la langue retenue (formats, tri). */
  i18n(): I18n;
  snapshot(): LanguageSnapshot;
  /** Abonnement aux changements de langue ; rend la fonction de désabonnement. */
  onChange(listener: LanguageListener): () => void;
  /**
   * Textes d'un plugin actif (P3-03), par langue de Mire, rangés sous `pluginTexts.<clé>` ; `null` les retire. Les
   * abonnés reçoivent les catalogues à jour.
   */
  setPluginTexts(key: string, texts: Readonly<Record<string, Messages>> | null): void;
}

/** Racine des textes des plugins dans les catalogues. */
export const PLUGIN_TEXTS = 'pluginTexts';

export function createLanguageService({
  config,
  systemLanguages,
  catalogs = BUILTIN_CATALOGS,
  dev = false,
  log = (m) => console.warn(m),
}: LanguageServiceOptions): LanguageService {
  const available = Object.keys(catalogs);
  const listeners = new Set<LanguageListener>();
  const onMissing = dev ? (key: string, locale: string) => log(`Texte absent des catalogues : ${key} (${locale})`) : undefined;
  // Calculée à la première demande : les langues du système ne se lisent qu'une fois l'application prête.
  let engine: I18n | null = null;

  // Textes des plugins actifs : clé → messages par langue. Sans plugin, les catalogues sont ceux d'origine.
  const pluginTexts = new Map<string, Readonly<Record<string, Messages>>>();
  let merged: Readonly<Record<string, Catalog>> = catalogs;
  const mergeCatalogs = (): Readonly<Record<string, Catalog>> => {
    if (!pluginTexts.size) return catalogs;
    return Object.fromEntries(
      available.map((code) => {
        const texts: Messages = {};
        for (const [key, perLang] of pluginTexts) if (perLang[code]) texts[key] = perLang[code];
        return [code, { ...catalogs[code], messages: { ...catalogs[code].messages, [PLUGIN_TEXTS]: texts } }];
      }),
    );
  };

  const resolve = (cfg: Config) => resolveLanguage(cfg.ui.language, systemLanguages(), available);
  const build = (language: string) => createI18n({ locale: language, catalogs: { ...merged }, fallback: [...DEFAULT_FALLBACK], onMissing });
  const current = () => (engine ??= build(resolve(config.get())));

  function snapshot(): LanguageSnapshot {
    const i18n = current();
    return {
      setting: config.get().ui.language,
      language: i18n.locale,
      available: available.map((code) => ({ code, name: catalogs[code].meta.name })),
      catalogs: Object.fromEntries(i18n.chain.map((code) => [code, merged[code]])),
    };
  }

  function notify(): void {
    const snap = snapshot();
    for (const listener of listeners) {
      try {
        listener(snap);
      } catch (err) {
        log(`Abonné à la langue en échec : ${(err as Error).message}`);
      }
    }
  }

  config.onChange((next) => {
    if (!engine) return;
    const language = resolve(next);
    if (language === engine.locale) return;
    engine = build(language);
    notify();
  });

  return {
    language: () => current().locale,
    t: (key, vars) => current().t(key, vars),
    i18n: current,
    snapshot,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setPluginTexts(key, texts) {
      if (texts) pluginTexts.set(key, texts);
      else if (!pluginTexts.delete(key)) return;
      merged = mergeCatalogs();
      if (!engine) return;
      engine = build(engine.locale);
      notify();
    },
  };
}

export { builtinTranslator, currentLanguage, t, useLanguage, type Translator } from './current.ts';
export { metadataLanguage, steamLocale } from './metadata.ts';
