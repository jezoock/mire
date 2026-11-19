/**
 * Mode secours, côté page (P4-10, D-16) : sans DOM. Le délai de chargement d'un thème, le choix du repli quand un thème
 * ne se charge pas, et le choix entre deux demandes d'ouvrir l'explorateur.
 */
import { isRescueFailure } from '@mire/shared';
import type { RescueReason, RescueRequest } from '@mire/shared';

/** Délai de chargement d'un thème (sa palette), au-delà duquel l'explorateur prend le relais. */
export const THEME_TIMEOUT = 8000;
/** Temps d'affichage sans souci après lequel les plantages précédents ne comptent plus (processus principal). */
export const THEME_STABLE = 20000;

/** Chargement d'un thème, tel que le signale le moteur de thèmes (`ThemeLoad`). */
export interface ThemeLoadEvent {
  theme: string;
  state: 'loading' | 'ready' | 'failed' | 'missing';
}

/** Repli pour un chargement de thème : l'explorateur et la raison, ou `null` si tout va bien. */
export function fallbackFor(load: ThemeLoadEvent): RescueRequest | null {
  if (load.state === 'missing') return { reason: 'missing', theme: load.theme };
  if (load.state === 'failed') return { reason: 'failed', theme: load.theme };
  return null;
}

/**
 * Entre deux demandes, celle à montrer : un problème (plantage, thème cassé) l'emporte sur une demande de la personne,
 * pour que son message ne soit pas perdu ; à égalité, la plus récente.
 */
export function pickRequest(current: RescueRequest | null, next: RescueRequest | null): RescueRequest | null {
  if (!next) return current;
  if (!current) return next;
  return isRescueFailure(current.reason) && !isRescueFailure(next.reason) ? current : next;
}

/** Clé du message de chaque raison dans les catalogues. */
export const rescueMessageKey = (reason: RescueReason): string => `rescue.reasons.${reason}`;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface ThemeWatchOptions {
  /** Le thème ne s'affichera pas : l'explorateur prend le relais. */
  onFail(request: RescueRequest): void;
  /** Le thème s'est affiché et l'est resté `stable` ms. */
  onStable(theme: string): void;
  timeout?: number;
  stable?: number;
  timers?: Timers;
}

/**
 * Surveille les chargements de thème : un thème introuvable ou qui échoue donne tout de suite le repli ; un thème qui
 * reste en chargement plus de `timeout` ms aussi (raison `timeout`). Un thème affiché `stable` ms est signalé.
 */
export function createThemeWatch({ onFail, onStable, timeout = THEME_TIMEOUT, stable = THEME_STABLE, timers = realTimers }: ThemeWatchOptions) {
  let loading: string | null = null;
  let timer: unknown = null;

  function stop() {
    if (timer !== null) timers.clear(timer);
    timer = null;
  }

  return {
    /** Un événement du moteur de thèmes. */
    load(event: ThemeLoadEvent) {
      const fallback = fallbackFor(event);
      if (fallback) {
        if (event.state === 'failed' && loading !== event.theme) return;
        stop();
        loading = null;
        onFail(fallback);
        return;
      }
      if (event.state === 'loading') {
        stop();
        loading = event.theme;
        timer = timers.set(() => {
          timer = null;
          loading = null;
          onFail({ reason: 'timeout', theme: event.theme });
        }, timeout);
        return;
      }
      // Prêt : seulement le thème attendu (une demande remplacée n'a pas de suite).
      if (loading !== event.theme) return;
      stop();
      loading = null;
      timer = timers.set(() => {
        timer = null;
        onStable(event.theme);
      }, stable);
    },
    /** Thème en cours de chargement, ou `null`. */
    loading: () => loading,
  };
}

export type ThemeWatch = ReturnType<typeof createThemeWatch>;
