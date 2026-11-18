import type { InfoScalar, PagePath } from '@mire/shared';
import { Controller, findBy } from './base.ts';
import { openCatalogElement } from './page.ts';
import type { Data } from './types.ts';

/** Clé d'une entrée de « Reprendre » : celle de l'élément, sinon son chemin (comme `recentKey`, `home/model.ts`). */
const recentKey = (it: Data): string => (typeof it.key === 'string' && it.key) || String(it.path);

/** `mire-home` : accueil (P4-12) : barres de la mire, rangées, sites épinglés, « Reprendre ». */
export class HomeController extends Controller {
  /**
   * Ouvre une cible de la coquille (barre de la mire, titre d'une rangée) : une page (`movies`) ou un écran du cœur
   * (`screen:search`), et un chemin dans ses regroupements. Faux si aucune vue ne l'affiche encore.
   */
  open({ target, path }: { target: string; path?: PagePath }): boolean {
    const focus = target === 'screen:search' ? 'keep' : 'content';
    return this.ctx.ui.open(String(target), { path: Array.isArray(path) ? path : [], focus });
  }

  /** Ouvre un regroupement d'une page montré sur l'accueil (Films › Drame), désigné par sa valeur. */
  openGroup({ target, value }: { target: string; value: InfoScalar | null }): boolean {
    return this.ctx.ui.open(String(target), { path: [value ?? null], focus: 'content' });
  }

  /** Ouvre, lit ou lance un élément d'une rangée, désigné par sa clé. */
  async openElement({ key }: { key: string }): Promise<void> {
    await openCatalogElement(this.ctx, key);
  }

  /** Ouvre un site épinglé, désigné par sa clé (`web:<id>`). */
  openSite({ key }: { key: string }): void {
    const id = String(key).replace(/^web:/, '');
    if (!this.ctx.S.config?.web?.some((w: Data) => w.id === id)) throw new Error(`Site introuvable : ${key}`);
    this.ctx.ui.openWeb(id);
  }

  /** Reprend un élément de « Reprendre », désigné par sa clé (celle de l'élément, sinon son chemin). */
  resume({ key }: { key: string }): void {
    const it = (this.ctx.S.recent as Data[]).find((x) => recentKey(x) === key);
    if (!it) throw new Error(`Introuvable dans « Reprendre » : ${key}`);
    this.ctx.ui.playRecent(it);
  }

  /** Reprend un élément de « Reprendre », désigné par son chemin. */
  playRecent({ path }: { path: string }): void {
    const it = findBy(this.ctx.S.recent, 'path', path);
    if (it) this.ctx.ui.playRecent(it);
  }

  /** Ajoute un élément lu en tête de « Reprendre » (appelé par les lecteurs). */
  addRecent(item: Data): void {
    this.ctx.ui.addRecent(item);
  }
}
