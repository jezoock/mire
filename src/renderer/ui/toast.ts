/** Message bref en bas de l'écran, avec un bouton d'action facultatif. */
import { $, esc } from '../core/dom.ts';

export interface ToastOptions {
  /** Libellé du bouton d'action. */
  action?: string;
  onAction?: () => void;
  /** Durée d'affichage en millisecondes (au moins 7 s quand il y a un bouton). */
  duration?: number;
}

const toastEl = $('#toast') as HTMLElement;
let toastTimer: ReturnType<typeof setTimeout> | 0 = 0;

export function toast(message: string, { action, onAction, duration = 3800 }: ToastOptions = {}): void {
  toastEl.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="toast-btn" type="button">${esc(action)}</button>` : ''}`;
  if (action) {
    (toastEl.querySelector('button') as HTMLButtonElement).onclick = () => {
      hideToast();
      onAction?.();
    };
  }
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? Math.max(duration, 7000) : duration);
}

export function hideToast(): void {
  toastEl.classList.remove('show');
}
