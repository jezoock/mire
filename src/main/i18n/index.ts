/**
 * Langue de l'interface côté processus principal : suit le réglage `ui.language` (et, en `auto`, les langues
 * du système), tient le moteur de traduction de cette langue et prévient quand elle change (bascule à chaud).
 */
import { BUILTIN_CATALOGS, DEFAULT_FALLBACK, createI18n, resolveLanguage, type Catalog, type I18n, type Vars } from '@mire/shared/i18n';
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
}

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

  const resolve = (cfg: Config) => resolveLanguage(cfg.ui.language, systemLanguages(), available);
  const build = (language: string) => createI18n({ locale: language, catalogs: { ...catalogs }, fallback: [...DEFAULT_FALLBACK], onMissing });
  const current = () => (engine ??= build(resolve(config.get())));

  function snapshot(): LanguageSnapshot {
    const i18n = current();
    return {
      setting: config.get().ui.language,
      language: i18n.locale,
      available: available.map((code) => ({ code, name: catalogs[code].meta.name })),
      catalogs: Object.fromEntries(i18n.chain.map((code) => [code, catalogs[code]])),
    };
  }

  config.onChange((next) => {
    if (!engine) return;
    const language = resolve(next);
    if (language === engine.locale) return;
    engine = build(language);
    const snap = snapshot();
    for (const listener of listeners) {
      try {
        listener(snap);
      } catch (err) {
        log(`Abonné à la langue en échec : ${(err as Error).message}`);
      }
    }
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
  };
}
