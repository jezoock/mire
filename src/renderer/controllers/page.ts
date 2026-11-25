import type { ControllerContext, Data } from './types.ts';
import { Controller } from './base.ts';
import type { Element as CatalogElement, InfoScalar, PagePath } from '@mire/shared';
import { isGameBookmarkKey, isGameKey } from '../games/model.ts';
import { callAction } from './registry.ts';

/**
 * `mire-page` : la vue de page (P4-11) : regroupements, chemin, tranches, ouverture d'un élément du catalogue par sa
 * clé, « Tout lire » ; sites de jeux d'une console (menu des sites ouverts) ; touche Suppr sur une carte de jeu.
 */
export class PageController extends Controller {
  /** Sites de téléchargement d'une console (ou `pc`), sur un site et une adresse facultatifs. */
  openRomSites({ consoleId, site, url }: { consoleId: unknown; site?: number; url?: string }): void {
    this.ctx.ui.openRomBrowser(consoleId, site === undefined && url === undefined ? undefined : { site, url });
  }

  /**
   * Supprime le jeu sélectionné (touche Suppr) : même confirmation et même suppression que « Supprimer » de la boîte
   * du jeu (P4-29) ; faux si la sélection n'est pas une carte de jeu.
   */
  deleteSelection(): boolean {
    const key = this.ctx.ui.selectedKey?.();
    if (!isGameKey(key)) return false;
    void callAction('mire-games', 'deleteGame', { key });
    return true;
  }

  // ---------- Vue de page (P4-11) ----------

  /** Ouvre un regroupement du niveau affiché (Friends, Saison 1, « Autres » : `null`), désigné par sa valeur. */
  openGroup({ value }: { value: InfoScalar | null }): boolean {
    return this.ctx.ui.openPageGroup(value);
  }

  /** Revient à une étape du chemin parcouru (`[]` : la page elle-même). */
  openPath({ path }: { path: PagePath }): boolean {
    return this.ctx.ui.openPagePath(Array.isArray(path) ? path : []);
  }

  /** Tranche suivante du niveau affiché. */
  async loadMore(): Promise<void> {
    await this.ctx.ui.loadMorePage();
  }

  /**
   * « Tout lire » (P4-29) : lit à la suite les fichiers affichés (les morceaux d'un album), désignés par leur clé, dans
   * l'ordre de la page ; rend le nombre de fichiers lus.
   */
  async playAll({ keys }: { keys: string[] }): Promise<number> {
    const { S, api, ui } = this.ctx;
    const els = (await Promise.all((Array.isArray(keys) ? keys : []).map((k) => api.catalogElement(String(k))))) as (CatalogElement | null)[];
    const files = els.flatMap((el) => (el?.open.kind === 'file' ? [{ el, path: el.open.path }] : []));
    // Fichiers que la bibliothèque n'a pas encore lus : décrits par le processus principal (lisibles par Mire ou non).
    const known = new Set([...S.videos, ...S.tracks, ...S.images].map((x) => x.path));
    const missing = files.filter((f) => !known.has(f.path) && !/^https?:/i.test(f.path)).map((f) => f.path);
    const fresh = new Map(missing.length ? ((await api.fromPaths(missing)) as Data[]).map((x) => [x.path, x]) : []);
    const items = files.map((f) => fresh.get(f.path) ?? mediaItemOf(S, f.el, f.path));
    if (items.length) ui.playQueue(items, 0);
    return items.length;
  }

  /** Ouvre, lit ou lance un élément du catalogue, désigné par sa clé, selon sa façon de s'ouvrir. */
  async openElement({ key }: { key: string }): Promise<void> {
    await openCatalogElement(this.ctx, key);
  }
}

/**
 * Ouvre, lit ou lance un élément du catalogue selon sa façon de s'ouvrir (`open`) : fichier, site, jeu de console,
 * programme ou flux. Partagé par la vue de page et l'accueil (P4-12).
 */
export async function openCatalogElement(ctx: ControllerContext, key: string): Promise<void> {
  const { S, api, ui } = ctx;
  const el = (await api.catalogElement(key)) as CatalogElement | null;
  if (!el) throw new Error(`Élément introuvable : ${key}`);
  const o = el.open;
  // Jeux (P4-17) : un jeu de console ou un jeu PC se lance par sa clé (P5-13 : le processus principal vérifie le
  // programme) ; un marque-page « à télécharger » ouvre sa boîte (télécharger, retirer).
  if (o.kind === 'game' || o.kind === 'program') {
    await callAction('mire-games', 'launch', { key });
    return;
  }
  if (isGameBookmarkKey(key)) {
    await callAction('mire-games', 'bookmark', { key });
    return;
  }
  if (o.kind === 'file') ui.playInContext(mediaItemOf(S, el, o.path));
  else if (o.kind === 'site') {
    if (!o.site) throw new Error(`Site sans service : ${key}`);
    // Portail d'un service de télévision (`tv:<service>`) : sa vue web, résolue par le processus principal.
    if (o.site.startsWith('tv:')) ui.openTvWeb({ id: o.site.slice(3) });
    else ui.openWeb(o.site, o.url);
  } else if (el.tags.includes('tv')) ui.playChannel({ key, name: el.name });
  // Autre flux (entrée d'une liste M3U de la bibliothèque) : son adresse vient du catalogue.
  else ui.openExternal({ path: o.url, name: el.name });
}

/** Élément de l'interface historique pour un fichier du catalogue (sa liste de lecture vient de son dossier). */
function mediaItemOf(S: ControllerContext['S'], el: CatalogElement, path: string): Data {
  const known = [...S.videos, ...S.tracks, ...S.images].find((x) => x.path === path);
  if (known) return known as Data;
  const kind = el.tags.includes('video') ? 'video' : el.tags.includes('audio') ? 'audio' : 'image';
  return { path, name: el.name, kind };
}
