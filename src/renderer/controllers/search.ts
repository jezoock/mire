import { pluginFieldKey } from '@mire/ui/utils';
import { searchUrlFor } from '../domain/index.ts';
import { siteName, watchTargets } from '../search/model.ts';
import { Controller } from './base.ts';
import { openCatalogElement } from './page.ts';
import type { Data } from './types.ts';

/**
 * `mire-search` : Recherche (P4-13) : recherches récentes, résultats du catalogue (ouverts dans leur page), titres de
 * « Où regarder », sites où chercher.
 */
export class SearchController extends Controller {
  /** Relance une recherche récente. */
  async useRecentQuery({ query }: { query: string }): Promise<void> {
    if (query && this.ctx.ui.getQueries().includes(query)) await this.ctx.ui.search.setQuery(query);
  }

  /** Efface les recherches récentes. */
  clearQueries(): void {
    const { S, api, toast, t, ui } = this.ctx;
    S.usage.queries = [];
    api.usageClearQueries();
    toast(t('search.recent.cleared'));
    void ui.search.refresh();
  }

  #remember(): void {
    this.ctx.ui.rememberQuery(this.ctx.ui.search.query());
  }

  /**
   * Ouvre un résultat du catalogue dans sa page : la page de son groupe s'affiche, puis l'élément s'ouvre comme elle
   * l'ouvrirait (lecture, lancement, site). Un élément hors des pages s'ouvre sans quitter la Recherche.
   */
  async openResult({ key }: { key: string }): Promise<void> {
    const { ui } = this.ctx;
    this.#remember();
    const page = ui.search.pageOf(key);
    if (page) ui.open(page, { path: [], focus: 'content' });
    await openCatalogElement(this.ctx, key);
  }

  /** Ouvre la page d'un groupe de résultats. */
  openPage({ page }: { page: string }): boolean {
    this.#remember();
    return this.ctx.ui.open(String(page), { path: [], focus: 'content' });
  }

  /** Ouvre un film ou une série de « Où regarder », désigné par sa clé (`movie-603`), sur un site qui le propose. */
  openWatch({ key }: { key: string }): void {
    const { S, ui, toast, t } = this.ctx;
    const r = ui.search.watchResult(key);
    if (!r) return;
    this.#remember();
    const sites = ((S.config as Data | null)?.web ?? []) as never[];
    const target = watchTargets(r, sites, t);
    const [first, second] = target.sites;
    if (!first) {
      toast(target.message, { duration: 7000 });
      return;
    }
    ui.openWeb(first.id, searchUrlFor(first, r.title) || undefined);
    if (second)
      setTimeout(
        () =>
          toast(t('search.watch.alsoOn', { name: siteName(second) }), {
            action: t('search.watch.openOn', { name: siteName(second) }),
            onAction: () => ui.openWeb(second.id, searchUrlFor(second, r.title) || undefined),
          }),
        2600,
      );
  }

  /** Ouvre les réglages du plugin « Où regarder », sur le réglage qui manque (sa clé). */
  async addKey(): Promise<void> {
    const missing = this.ctx.ui.search.watchSetup();
    if (!missing) return;
    this.ctx.ui.go('settings', { focus: 'content' });
    await this.ctx.ui.settings.focus(pluginFieldKey(missing.plugin, missing.setup));
  }

  /** Cherche la recherche en cours sur un site de streaming. */
  searchSite({ id }: { id: string }): void {
    const { S, ui, toast, t } = this.ctx;
    this.#remember();
    const w = ((S.config as Data).web as Data[]).find((x) => x.id === id);
    if (!w) return;
    const url = searchUrlFor(w as never, ui.search.query());
    if (!url) setTimeout(() => toast(t('search.sites.howToLearn', { name: String(w.name) }), { duration: 10000 }), 2600);
    ui.openWeb(String(w.id), url || undefined);
  }
}
