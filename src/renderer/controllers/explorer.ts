import { Controller } from './base.ts';

/** `mire-explorer` : sources de la bibliothèque et des jeux, analyse des dossiers. */
export class ExplorerController extends Controller {
  /** Ajoute un dossier comme source (`kind` : `library` ou `game`). */
  addFolder({ kind }: { kind: string }): void {
    this.ctx.ui.addSourceFolder(kind);
  }

  /** Ajoute une adresse (partage réseau, serveur web, liste M3U) comme source. */
  addAddress({ kind }: { kind: string }): void {
    this.ctx.ui.askSourceAddress(kind);
  }

  removeSource({ kind, id }: { kind: string; id: string }): void {
    this.ctx.ui.removeSource(kind, id);
  }

  /** Analyse de nouveau toutes les sources. */
  rescan(): void {
    const { S, ui, toast } = this.ctx;
    S.scanned = false;
    ui.scan();
    toast('Analyse de la bibliothèque…', { duration: 2000 });
  }
}
