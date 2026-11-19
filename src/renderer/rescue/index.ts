/**
 * Mode secours, côté page (P4-10, D-16) : l'hôte `<mire-rescue>` et son bandeau (`mire-rescue-view`), placés au-dessus
 * de l'explorateur. Une demande (option ou touche au démarrage, raccourci, combinaison de la manette, thème cassé,
 * plantages) ouvre l'explorateur et montre sa raison, avec le choix d'un autre thème. Les demandes reçues avant la fin
 * du démarrage attendent `start` : le premier écran est alors l'explorateur.
 */
import { isRescueFailure, isRescueReason } from '@mire/shared';
import type { RescueRequest } from '@mire/shared';
import { pickRequest, rescueMessageKey } from './model.ts';

export { createThemeWatch, fallbackFor, pickRequest, rescueMessageKey, THEME_STABLE, THEME_TIMEOUT } from './model.ts';
export type { ThemeLoadEvent, ThemeWatch, Timers } from './model.ts';

export interface RescueTheme {
  id: string;
  name: string;
  current: boolean;
}

export interface RescueOptions {
  t(key: string, vars?: Record<string, unknown>): string;
  /** Thèmes proposés (le choisi marqué). */
  themes(): RescueTheme[];
  /** Nom affiché d'un thème d'après son identifiant (un thème introuvable garde son identifiant). */
  themeName(id: string): string;
  /** Ouvre l'explorateur, le focus au contenu. */
  openExplorer(): void;
  onLanguageChange(listener: () => void): unknown;
}

export interface Rescue {
  readonly host: HTMLElement;
  /** Demande d'ouvrir l'explorateur en mode secours. */
  request(req: RescueRequest | null): void;
  /** Fin du démarrage, avec la demande du processus principal (option, touche, plantages) : l'écouter enfin. */
  start(fromMain: RescueRequest | null): void;
  /** Demande affichée, ou `null`. */
  current(): RescueRequest | null;
  /** On quitte l'explorateur : le bandeau disparaît. */
  leave(): void;
  /** Textes et thèmes redessinés (thème choisi, langue). */
  refresh(): void;
}

type ViewEl = HTMLElement & Record<string, unknown>;

/** Une demande lisible (le processus principal peut répondre par une erreur), ou `null`. */
const valid = (req: unknown): RescueRequest | null => {
  const r = req as RescueRequest | null;
  return r && typeof r === 'object' && isRescueReason(r.reason) ? { reason: r.reason, ...(typeof r.theme === 'string' ? { theme: r.theme } : {}) } : null;
};

export function createRescue(opts: RescueOptions, doc: Document = document): Rescue {
  const host = doc.createElement('mire-rescue');
  const view = doc.createElement('mire-rescue-view') as ViewEl;
  host.append(view);
  let started = false;
  let waiting: RescueRequest | null = null;
  let shown: RescueRequest | null = null;

  function render() {
    const { t } = opts;
    const message = shown ? t(rescueMessageKey(shown.reason), { theme: shown.theme ? opts.themeName(shown.theme) : '' }) : '';
    Object.assign(view, {
      message,
      failure: !!shown && isRescueFailure(shown.reason),
      themes: shown ? opts.themes() : [],
      labels: { title: t('rescue.title'), themes: t('rescue.themes'), home: t('rescue.home') },
    });
  }

  function show(req: RescueRequest) {
    shown = req;
    render();
    opts.openExplorer();
  }

  opts.onLanguageChange(() => render());

  return {
    host,
    request(raw) {
      const req = valid(raw);
      if (!req) return;
      if (!started) waiting = pickRequest(waiting, req);
      else show(pickRequest(shown, req) ?? req);
    },
    start(fromMain) {
      started = true;
      const req = pickRequest(valid(fromMain), waiting);
      waiting = null;
      if (req) show(req);
    },
    current: () => shown,
    leave() {
      if (!shown) return;
      shown = null;
      render();
    },
    refresh: render,
  };
}
