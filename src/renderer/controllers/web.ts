import { Controller } from './base.ts';
import type { Data } from './types.ts';

/** `mire-web` : vue web intégrée (sites de streaming, portails de télévision, sites de jeux, marque-pages). */
export class WebController extends Controller {
  /** Ouvre un site de streaming (`id`), sur une adresse facultative. */
  open({ id, url }: { id: string; url?: string }): void {
    this.ctx.ui.openWeb(id, url);
  }

  /** Ouvre le portail web d'un service de télévision. */
  openPortal({ id }: { id: string }): void {
    this.ctx.ui.openTvWeb({ id });
  }

  openBookmark({ id }: { id: string }): void {
    this.ctx.ui.openBookmark(id);
  }

  /** Navigation dans le site affiché : `back`, `forward`, `reload`, `home`, `mire`. */
  navigate({ id }: { id: string }): void {
    this.ctx.api.webNav(id as never);
  }

  close(): void {
    this.ctx.api.webClose(this.ctx.S.webActive as never);
  }

  bookmarkPage(): void {
    this.ctx.ui.bookmarkCurrentPage();
  }

  bookmarkGame(): void {
    this.ctx.ui.bookmarkCurrentGame();
  }

  /** Mémorise la recherche du site affiché, pour le proposer dans Rechercher. */
  learnSearch(): void {
    this.ctx.ui.learnSearch();
  }

  /** Active ou désactive le bloqueur de publicités sur le site affiché (la page se recharge). */
  async toggleAdblock(): Promise<void> {
    const { S, api, ui, toast } = this.ctx;
    const r = (await api.adblockToggleSite()) as Data | null;
    if (!r) return;
    S.config = ((await api.getConfig()) as Data).config;
    S.adblock = r;
    const id = S.webActive as string;
    if (S.webStates[id]) S.webStates[id] = { ...(S.webStates[id] as Data), adOn: r.adOn, blocked: 0 };
    ui.refreshWebBar();
    toast(this.ctx.t(r.adOn ? 'webView.adblockOn' : 'webView.adblockOff'));
  }

  /** Montre ou cache la vue web selon l'écran (après un lecteur, un changement de menu…). */
  sync(): void {
    this.ctx.ui.syncWeb();
  }

  /** Donne le clavier et la manette au site affiché. */
  focusSite(): void {
    this.ctx.api.webFocus();
  }

  /** Passe le focus du site à Mire, ou l'inverse (manette). */
  toggleFocus({ toSite }: { toSite: boolean }): void {
    if (toSite) this.ctx.api.webFocus();
    else this.ctx.api.webNav('mire' as never);
  }

  /** Envoie une touche au site affiché (manette). */
  sendKey({ key }: { key: string }): void {
    this.ctx.api.webKey(key as never);
  }
}
