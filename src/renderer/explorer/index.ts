/**
 * Explorateur de la coquille (P4-08), côté page : l'hôte `<mire-explorer>` et sa vue (`mire-explorer-view`). Les
 * colonnes et l'aperçu viennent du modèle (`model.ts`). Une ligne qui reçoit le focus montre, après une courte pause, ce
 * qu'elle ouvre (comme le Finder) ; Entrée, le bouton A ou un clic l'ouvrent et y portent le focus (contrôleur
 * `mire-explorer`). B revient à la colonne précédente.
 */
import { createExplorerModel } from './model.ts';
import type { ExplorerSources, ExplorerState } from './model.ts';

export {
  createExplorerModel,
  elementPreview,
  folderNode,
  levelNode,
  locationOf,
  parseFolderNode,
  parseLevelNode,
  placeName,
  PREVIEW_INFOS,
  ROOT,
  SECTIONS,
  sourceLabel,
} from './model.ts';
export type { ExplorerModel, ExplorerSources, ExplorerState } from './model.ts';

/** Pause après l'arrivée du focus sur une ligne avant de montrer ce qu'elle ouvre (parcours rapide au clavier). */
export const FOLLOW_PAUSE = 90;

export interface ExplorerOptions extends ExplorerSources {
  onLanguageChange(listener: () => void): unknown;
  onPagesChange(listener: () => void): unknown;
  /** L'explorateur est-il affiché ? (il ne relit le catalogue qu'à l'écran) */
  shown(): boolean;
  /** La vue est rendue (le focus, s'il s'est perdu, revient au contenu). */
  onRendered(): void;
}

export interface Explorer {
  readonly host: HTMLElement;
  /** Textes, et colonnes si le catalogue ou la langue ont changé depuis la dernière lecture. */
  refresh(): Promise<void>;
  /** Ouvre une branche ; `focus` : le focus va à la première ligne de la colonne ouverte. */
  open(node: string, opts?: { focus?: boolean }): Promise<boolean>;
  /** Montre l'aperçu d'un élément ; `focus` : le focus va à sa première action. */
  show(key: string, opts?: { focus?: boolean }): Promise<boolean>;
  more(node: string): Promise<boolean>;
  /** B : le focus revient à la ligne choisie de la colonne précédente ; faux depuis la première colonne. */
  back(): boolean;
  /** Clé de l'élément de la ligne qui a le focus, ou de l'aperçu ; `null` sinon. */
  selectedKey(): string | null;
  /** Donne le focus à la première colonne (ligne choisie, sinon la première). */
  focusFirst(): void;
}

type ViewEl = HTMLElement & Record<string, unknown>;

export function createExplorer(opts: ExplorerOptions, doc: Document = document): Explorer {
  const host = doc.createElement('mire-explorer');
  const view = doc.createElement('mire-explorer-view') as ViewEl;
  host.append(view);
  let follow: ReturnType<typeof setTimeout> | undefined;
  let started = false;

  const model = createExplorerModel(opts, (s: ExplorerState) => Object.assign(view, { columns: s.columns, preview: s.preview }));

  function labels() {
    const { t } = opts;
    return {
      columns: t('explorer.columns'),
      preview: t('explorer.preview.label'),
      empty: t('explorer.empty'),
      infos: t('explorer.preview.infos'),
      tags: t('explorer.preview.tags'),
      noTags: t('explorer.preview.noTags'),
      source: t('explorer.preview.source'),
      location: t('explorer.preview.location'),
      play: t('explorer.actions.play'),
      edit: t('explorer.actions.edit'),
      editTags: t('explorer.actions.tags'),
      addToList: t('explorer.actions.addToList'),
      unavailable: t('explorer.unavailable'),
    };
  }

  const columnEls = () => [...view.querySelectorAll<HTMLElement>('.mire-explorer-view__column')];

  /** Donne le focus dès que l'élément cherché est rendu (la vue se rend une image plus tard). */
  function focusWhenReady(find: () => HTMLElement | null | undefined) {
    const tryFocus = (left: number) => {
      const el = find();
      if (el && el.classList.contains('hydrated')) el.focus();
      else if (left > 0) requestAnimationFrame(() => tryFocus(left - 1));
    };
    tryFocus(60);
  }

  const rowOf = (col: Element | undefined, sel: string) =>
    col?.querySelector<HTMLElement>(`.mire-explorer-view__row.--selected`) ?? col?.querySelector<HTMLElement>(sel);

  view.addEventListener('mireExplorerFocus', (e) => {
    clearTimeout(follow);
    const { node, key } = (e as CustomEvent<{ node?: string; key?: string }>).detail;
    follow = setTimeout(() => void (node ? model.open(node) : key ? model.show(key) : null), FOLLOW_PAUSE);
  });
  view.addEventListener('mireExplorerRender', () => {
    // Colonne ajoutée : elle est amenée en vue.
    const box = view.querySelector('.mire-explorer-view__columns');
    if (box) box.scrollLeft = box.scrollWidth;
    opts.onRendered();
  });

  // Colonnes à relire à la prochaine apparition de l'écran (catalogue changé pendant qu'il était caché).
  let stale = true;

  /** Textes, puis colonnes si le catalogue a changé depuis la dernière lecture (appelé à chaque rendu de l'écran). */
  async function refresh() {
    view.labels = labels();
    if (!stale) return;
    stale = false;
    if (!started) {
      started = true;
      model.reset();
    }
    await model.refresh();
  }

  opts.onLanguageChange(() => {
    stale = true;
    if (opts.shown()) void refresh();
  });
  opts.onPagesChange(() => {
    stale = true;
    if (opts.shown()) void refresh();
  });

  return {
    host,
    refresh,
    async open(node, { focus = false } = {}) {
      clearTimeout(follow);
      const ok = await model.open(node);
      const index = model.state().columns.findIndex((c) => c.node === node);
      if (ok && focus) focusWhenReady(() => columnEls()[index]?.querySelector<HTMLElement>('.mire-explorer-view__row, .mire-explorer-view__more'));
      return ok;
    },
    async show(key, { focus = false } = {}) {
      clearTimeout(follow);
      const ok = await model.show(key);
      if (ok && focus) focusWhenReady(() => view.querySelector<HTMLElement>('.mire-explorer-view__preview .mire-explorer-view__action'));
      return ok;
    },
    more: (node) => model.more(node),
    back() {
      const a = doc.activeElement;
      const col = a?.closest('.mire-explorer-view__column');
      const cols = columnEls();
      const i = col ? cols.indexOf(col as HTMLElement) : -1;
      if (i <= 0) return false;
      const prev = rowOf(cols[i - 1], '.mire-explorer-view__row');
      prev?.focus();
      return !!prev;
    },
    selectedKey() {
      const a = doc.activeElement as HTMLElement | null;
      const row = a?.closest<HTMLElement>('.mire-explorer-view__row[data-key]');
      if (row && !row.hasAttribute('data-unavailable')) return row.dataset.key ?? null;
      return a?.closest('.mire-explorer-view__preview') ? (model.state().preview?.key ?? null) : null;
    },
    focusFirst() {
      focusWhenReady(() => rowOf(columnEls()[0], '.mire-explorer-view__row'));
    },
  };
}
