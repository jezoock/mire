/**
 * Assistant du premier lancement (P4-23), côté page : l'hôte `<mire-assistant>` et sa vue (`mire-assistant-view`),
 * remplis d'après le passage en cours (`model.ts`), changé par le contrôleur `mire-assistant`. L'interface historique
 * place l'hôte dans la vue des écrans (section `assistant`, sans cible du routeur) : au démarrage quand le processus
 * principal le demande (premier lancement), ou depuis les Réglages.
 */
import type { PluginsProgress } from '@mire/shared/ipc';
import type { Translate } from '../centre/model.ts';
import { assistantView, newSession, type Session } from './model.ts';

export * from './model.ts';

export interface AssistantOptions {
  t: Translate;
  /** Langue de l'interface (nombres). */
  language(): string;
  /** Affiche la section de l'assistant. */
  show(): void;
  /** Quitte l'assistant : vers l'accueil, ou vers l'onglet Plugins du Centre. */
  leave(to: 'home' | 'centre'): void;
  onLanguageChange(listener: () => void): unknown;
  /** L'assistant a été redessiné (focus à donner, ou à rendre au contenu). */
  onRendered(): void;
}

type ViewEl = HTMLElement & { view?: unknown };

/** Élément de l'étape qui reçoit le focus après un changement d'étape (premier choix, sinon bouton principal). */
export const STEP_FOCUS = '.mire-assistant-view .--focus';

export function createAssistant(opts: AssistantOptions, doc: Document = document) {
  const host = doc.createElement('mire-assistant');
  const view = doc.createElement('mire-assistant-view') as ViewEl;
  host.append(view);
  let session: Session = newSession();
  let pendingFocus = false;

  function refresh(focus = false) {
    if (focus) pendingFocus = true;
    view.view = assistantView(session, { t: opts.t, lang: opts.language() || 'en' });
  }

  view.addEventListener('mireAssistantRender', () => opts.onRendered());
  opts.onLanguageChange(() => refresh());

  return {
    host,
    session: () => session,
    refresh,
    open() {
      session = newSession();
      refresh(true);
      opts.show();
    },
    close(to: 'home' | 'centre') {
      session = newSession();
      opts.leave(to);
    },
    /** Avancement d'une installation (événement `plugins:progress`) pendant l'étape d'installation. */
    progress(p: PluginsProgress) {
      if (session.step !== 'install' || !session.results[p.id]) return;
      if (p.phase === 'done' || p.phase === 'error') delete session.progress[p.id];
      else session.progress[p.id] = p;
      refresh();
    },
    /** Faut-il focaliser l'élément de l'étape (une seule fois, après un changement d'étape) ? */
    takeFocus(): boolean {
      const f = pendingFocus;
      pendingFocus = false;
      return f;
    },
  };
}

export type Assistant = ReturnType<typeof createAssistant>;
