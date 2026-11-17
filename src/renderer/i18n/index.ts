/**
 * Traduction de l'interface (P4-04, docs/i18n.md) : catalogues demandés au processus principal au démarrage
 * (`api.i18nGet()`), moteur de `@mire/shared/i18n`, `t()` et langue courante pour les contrôleurs et les composants.
 * Suit les changements de langue (`api.onLanguageChange`) et tient à jour l'attribut `lang` du document.
 * Les composants `mire-*` n'en dépendent pas : leurs textes arrivent en attributs, tirés des catalogues par la page,
 * et ils lisent la langue sur le document (`lang`), comme le veut docs/adr/0001-dot-stash.md.
 */
import { createI18n, lookup } from '@mire/shared/i18n';
import type { I18n, Vars } from '@mire/shared/i18n';
import type { LanguageInfo } from '@mire/shared/ipc';

/** Ce que le service demande au client API (`api/`). */
export interface LanguageSource {
  i18nGet(): Promise<LanguageInfo | { ok: false; error?: string }>;
  onLanguageChange(callback: (info: LanguageInfo) => void): unknown;
}

export interface UiI18n {
  /** Charge les catalogues de la langue retenue et s'abonne aux changements. */
  start(source: LanguageSource): Promise<void>;
  /** Attend la fin du démarrage (catalogues reçus, ou refusés : la clé tient alors lieu de texte). */
  ready(): Promise<void>;
  /** Texte d'une clé dans la langue courante ; la clé elle-même tant que les catalogues ne sont pas reçus. */
  t(key: string, vars?: Vars): string;
  /** Nœud brut d'une clé (texte ou formes d'un pluriel), dans la langue courante puis le repli. */
  raw(key: string): unknown;
  /** Langue courante (code BCP 47) ; chaîne vide avant le démarrage. */
  readonly language: string;
  /** Moteur de la langue courante (formats compris), ou `null` avant le démarrage. */
  readonly engine: I18n | null;
  /** Prévient à chaque changement de langue ; rend la fonction de désabonnement. */
  onChange(listener: (language: string) => void): () => void;
}

/** Document dont le service tient à jour l'attribut `lang` (le document de la page, ou un double dans les tests). */
export interface LangDocument {
  documentElement: { lang: string };
}

export function createUiI18n(doc: LangDocument | null = typeof document === 'undefined' ? null : document): UiI18n {
  let engine: I18n | null = null;
  let info: LanguageInfo | null = null;
  const listeners = new Set<(language: string) => void>();
  let started: Promise<void> = Promise.resolve();

  function apply(next: LanguageInfo | { ok: false; error?: string }): void {
    // Catalogues indisponibles : on garde ceux qu'on a (ou les clés), l'interface reste utilisable.
    if (!next || 'ok' in next) return;
    info = next;
    engine = createI18n({ locale: next.language, catalogs: next.catalogs });
    if (doc) doc.documentElement.lang = next.language;
    for (const listener of listeners) listener(next.language);
  }

  return {
    start(source) {
      source.onLanguageChange(apply);
      started = source.i18nGet().then(apply, () => {});
      return started;
    },
    ready: () => started,
    t: (key, vars) => (engine ? engine.t(key, vars) : key),
    raw(key) {
      if (!engine || !info) return undefined;
      for (const code of engine.chain) {
        const node = lookup(info.catalogs[code]!.messages, key);
        if (node !== undefined) return node;
      }
      return undefined;
    },
    get language() {
      return engine?.locale ?? '';
    },
    get engine() {
      return engine;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Service de l'interface, partagé par les contrôleurs et les composants. */
export const i18n: UiI18n = createUiI18n();

export const t = (key: string, vars?: Vars): string => i18n.t(key, vars);
