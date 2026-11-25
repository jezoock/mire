/**
 * Message bref en bas de l'écran (`#toast`, dans la coquille), avec un bouton d'action facultatif. Construit sans
 * `innerHTML` : le message et le libellé sont posés comme texte.
 */
import { $ } from '../core/dom.ts';

export interface ToastOptions {
  /** Libellé du bouton d'action. */
  action?: string;
  onAction?: () => void;
  /** Durée d'affichage en millisecondes (au moins 7 s quand il y a un bouton). */
  duration?: number;
}

let toastTimer: ReturnType<typeof setTimeout> | 0 = 0;

export function toast(message: string, { action, onAction, duration = 3800 }: ToastOptions = {}): void {
  const el = $('#toast') as HTMLElement | null;
  if (!el) return;
  const text = document.createElement('span');
  text.textContent = message;
  const parts: HTMLElement[] = [text];
  if (action) {
    const button = document.createElement('button');
    button.className = 'toast-btn';
    button.type = 'button';
    button.textContent = action;
    button.onclick = () => {
      hideToast();
      onAction?.();
    };
    parts.push(button);
  }
  el.replaceChildren(...parts);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? Math.max(duration, 7000) : duration);
}

export function hideToast(): void {
  ($('#toast') as HTMLElement | null)?.classList.remove('show');
}
