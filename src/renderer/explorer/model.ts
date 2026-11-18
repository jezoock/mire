/**
 * Explorateur (P4-08), sans DOM : les colonnes et l'aperçu. La première colonne propose Pages, Listes et Tags ; chaque
 * choix ouvre la colonne suivante (pages, listes ou tags, puis les regroupements d'un niveau, puis ses éléments), et un
 * élément ouvre l'aperçu. Les niveaux viennent de `catalog.page` par tranches : une page, une liste (`list:<id>`) ou un
 * tag (`tag:<id>`). Les données arrivent par `ExplorerSources` ; l'affichage est rédigé ici, avec les catalogues.
 */
import { listPageId, tagPageId } from '@mire/shared';
import type { Element as CatalogElement, InfoValue, ListSummary, PageDefinition, PageLevel, PagePath, TagSummary } from '@mire/shared';
import { mediaUrl } from '@mire/ui/utils';
import type { ExplorerColumn, ExplorerPreview, ExplorerRow } from '@mire/ui/utils';
import { groupFormatter, pageName } from '../pages/model.ts';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Première colonne, et les branches qu'elle propose. */
export const ROOT = 'root';
export const SECTIONS = ['pages', 'lists', 'tags'] as const;
export type Section = (typeof SECTIONS)[number];
const isSection = (node: string): node is Section => (SECTIONS as readonly string[]).includes(node);

/** Infos montrées dans l'aperçu, dans cet ordre (celles qui ont un nom dans les catalogues, `catalog.infos`). */
export const PREVIEW_INFOS = [
  'year',
  'genres',
  'series',
  'season',
  'episode',
  'artist',
  'album',
  'track',
  'system',
  'category',
  'channel',
  'overview',
] as const;

/** Nœud d'un niveau de `catalog.page` : `level:` puis `[pageId, chemin]` en JSON. */
export const levelNode = (pageId: string, path: PagePath): string => `level:${JSON.stringify([pageId, path])}`;

/** Page et chemin d'un nœud de niveau ; `null` pour un autre nœud. */
export function parseLevelNode(node: string): { pageId: string; path: PagePath } | null {
  if (!node.startsWith('level:')) return null;
  try {
    const [pageId, path] = JSON.parse(node.slice('level:'.length)) as [unknown, unknown];
    return typeof pageId === 'string' && Array.isArray(path) ? { pageId, path: path as PagePath } : null;
  } catch {
    return null;
  }
}

/** Ce dont l'explorateur a besoin : textes et données du catalogue. */
export interface ExplorerSources {
  t: Translate;
  /** Texte au pluriel d'après un nombre (`elements.grid.more`). */
  plural(key: string, count: number): string;
  pages(): readonly PageDefinition[];
  lists(): Promise<ListSummary[] | null>;
  tags(): Promise<TagSummary[] | null>;
  level(pageId: string, path: PagePath, cursor: string | null): Promise<PageLevel | null>;
  element(key: string): Promise<CatalogElement | null>;
}

export interface ExplorerState {
  columns: ExplorerColumn[];
  preview: ExplorerPreview | null;
}

/** Colonne avec de quoi charger sa tranche suivante. */
interface Column extends ExplorerColumn {
  next: string | null;
}

const view = ({ next: _next, ...c }: Column): ExplorerColumn => c;

export interface ExplorerModel {
  state(): ExplorerState;
  /** Revient à la première colonne seule. */
  reset(): void;
  /** Ouvre une branche (sa ligne est choisie, la colonne suivante la montre) ; faux si elle n'est pas affichée. */
  open(node: string): Promise<boolean>;
  /** Montre l'aperçu d'un élément affiché ; faux s'il ne l'est pas ou s'il a disparu. */
  show(key: string): Promise<boolean>;
  /** Tranche suivante d'une colonne. */
  more(node: string): Promise<boolean>;
  /** Relit toutes les colonnes et l'aperçu (catalogue changé, langue) ; garde les choix qui existent encore. */
  refresh(): Promise<void>;
}

export function createExplorerModel(src: ExplorerSources, onUpdate: (state: ExplorerState) => void): ExplorerModel {
  const { t } = src;
  let columns: Column[] = [];
  let preview: ExplorerPreview | null = null;
  // Une demande plus récente l'emporte : la réponse d'une demande dépassée est ignorée.
  let seq = 0;
  const formatGroup = groupFormatter(t);

  const state = (): ExplorerState => ({ columns: columns.map(view), preview });
  const emit = () => onUpdate(state());

  const column = (node: string, heading: string, rows: ExplorerRow[], total = rows.length, next: string | null = null): Column => ({
    node,
    heading,
    rows,
    total,
    remaining: Math.max(0, total - rows.length),
    more: total > rows.length ? src.plural('elements.grid.more', total - rows.length) : '',
    selected: null,
    next,
  });

  const rootColumn = () =>
    column(
      ROOT,
      t('explorer.heading'),
      SECTIONS.map((s) => ({ id: s, node: s, label: t(`explorer.sections.${s}`) })),
    );

  function levelRows(lvl: PageLevel): ExplorerRow[] {
    if (lvl.kind === 'groups')
      return lvl.groups.map((g) => {
        const node = levelNode(lvl.page, [...lvl.path, g.value]);
        return { id: node, node, label: formatGroup(lvl.info, g.value) ?? g.name, count: g.count };
      });
    return lvl.elements.map((e) => ({ id: e.key, key: e.key, label: e.name, ...(e.unavailable ? { unavailable: true } : {}) }));
  }

  /** Colonne ouverte par une branche (première tranche) ; `null` si elle n'existe plus. */
  async function load(node: string, heading: string): Promise<Column | null> {
    if (node === ROOT) return rootColumn();
    if (isSection(node)) return column(node, heading, await sectionRows(node));
    const lvl = parseLevelNode(node);
    if (!lvl) return null;
    const r = await src.level(lvl.pageId, lvl.path, null);
    return r ? column(node, heading, levelRows(r), r.total, r.next) : null;
  }

  /** Tranche suivante d'une colonne de niveau (sans la placer) ; `null` s'il n'y en a pas. */
  async function nextSlice(col: Column): Promise<Column | null> {
    const lvl = parseLevelNode(col.node);
    if (!col.next || !lvl) return null;
    const r = await src.level(lvl.pageId, lvl.path, col.next);
    return r ? { ...column(col.node, col.heading, [...col.rows, ...levelRows(r)], r.total, r.next), selected: col.selected } : null;
  }

  async function sectionRows(section: Section): Promise<ExplorerRow[]> {
    if (section === 'pages')
      return src.pages().map((p) => {
        const node = levelNode(p.id, []);
        return { id: node, node, label: pageName(p, t) };
      });
    if (section === 'lists')
      return ((await src.lists()) ?? []).map((l) => {
        const node = levelNode(listPageId(l.id), []);
        return { id: node, node, label: typeof l.name === 'string' ? l.name : t(l.name.key), count: l.count };
      });
    const tags = ((await src.tags()) ?? []).filter((x) => x.count > 0);
    return tags
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((x) => {
        const node = levelNode(tagPageId(x.id), []);
        return { id: node, node, label: x.name, count: x.count };
      });
  }

  async function previewOf(key: string): Promise<ExplorerPreview | null> {
    const [el, tags] = await Promise.all([src.element(key), src.tags()]);
    return el ? elementPreview(el, tags ?? [], t) : null;
  }

  /** Colonne qui montre la ligne `match`, choisie ; les colonnes après elle et l'aperçu sont retirés. */
  function choose(match: (r: ExplorerRow) => boolean): { index: number; row: ExplorerRow } | null {
    const index = columns.findIndex((c) => c.rows.some(match));
    if (index < 0) return null;
    const col = columns[index] as Column;
    const row = col.rows.find(match) as ExplorerRow;
    columns = [...columns.slice(0, index), { ...col, selected: row.id }];
    preview = null;
    return { index, row };
  }

  return {
    state,
    reset() {
      seq++;
      columns = [rootColumn()];
      preview = null;
      emit();
    },
    async open(node) {
      // Déjà ouverte (focus puis clic sur la même ligne) : rien à relire.
      const at = columns.findIndex((c) => c.selected === node);
      if (at >= 0 && columns[at + 1]?.node === node) return true;
      const hit = choose((r) => r.node === node);
      if (!hit) return false;
      const id = ++seq;
      emit();
      const next = await load(node, hit.row.label);
      if (id !== seq || !next) return false;
      columns = [...columns, next];
      emit();
      return true;
    },
    async show(key) {
      if (preview?.key === key) return true;
      const hit = choose((r) => r.key === key && !r.unavailable);
      if (!hit) return false;
      const id = ++seq;
      emit();
      const p = await previewOf(key);
      if (id !== seq || !p) return false;
      preview = p;
      emit();
      return true;
    },
    async more(node) {
      const index = columns.findIndex((c) => c.node === node);
      const col = columns[index];
      if (!col) return false;
      const grown = await nextSlice(col);
      // La colonne a pu changer pendant la demande (autre choix, relecture) : la tranche n'est plus la bonne.
      if (!grown || columns[index] !== col) return false;
      columns = columns.map((c, i) => (i === index ? grown : c));
      emit();
      return true;
    },
    async refresh() {
      const id = ++seq;
      const old = columns.length ? columns : [rootColumn()];
      const oldPreview = preview;
      const next: Column[] = [];
      for (const [i, c] of old.entries()) {
        let fresh = await load(c.node, c.heading);
        // Autant de tranches que déjà chargées : la ligne choisie peut être plus loin que la première.
        while (fresh && fresh.rows.length < c.rows.length && fresh.next) fresh = await nextSlice(fresh);
        if (id !== seq) return;
        if (!fresh) break;
        const sel = c.selected && fresh.rows.some((r) => r.id === c.selected) ? c.selected : null;
        next.push({ ...fresh, selected: sel });
        // Le choix a disparu : les colonnes qui en dépendaient aussi.
        if (sel !== c.selected || (i + 1 < old.length && old[i + 1]?.node !== sel)) break;
      }
      const last = next[next.length - 1];
      const keepPreview = !!oldPreview && last?.selected === oldPreview.key;
      const p = keepPreview ? await previewOf(oldPreview.key) : null;
      if (id !== seq) return;
      columns = next;
      preview = p;
      if (!p && last?.selected && last.rows.some((r) => r.id === last.selected && r.key)) columns[columns.length - 1] = { ...last, selected: null };
      emit();
    },
  };
}

/** Valeur d'une info en texte. */
const infoText = (v: InfoValue): string => (Array.isArray(v) ? v.join(', ') : String(v));

/** Emplacement d'un élément : chemin du fichier, du jeu ou du programme, adresse d'un site ou d'un flux. */
export function locationOf(el: CatalogElement): string {
  const o = el.open;
  return o.kind === 'site' || o.kind === 'stream' ? o.url : o.path;
}

/** Aperçu d'un élément, rédigé avec les catalogues. */
export function elementPreview(el: CatalogElement & { unavailable?: true }, known: readonly TagSummary[], t: Translate): ExplorerPreview {
  const names = new Map(known.map((x) => [x.id, x.name]));
  const facts = PREVIEW_INFOS.filter((k) => el.infos[k] !== undefined && infoText(el.infos[k] as InfoValue) !== '').map((k) => ({
    label: t(`catalog.infos.${k}`),
    value: k === 'season' ? t('pageView.season', { value: String(el.infos[k]) }) : infoText(el.infos[k] as InfoValue),
  }));
  const isImageFile = el.open.kind === 'file' && el.tags.includes('image');
  const image = el.images.poster || el.images.background || (isImageFile ? locationOf(el) : '');
  const { plugin, instance } = el.source;
  return {
    key: el.key,
    name: el.name,
    image: image ? mediaUrl(image) : '',
    facts,
    tags: el.tags.map((id) => names.get(id) ?? id),
    source: instance && instance !== 'config' ? `${plugin} · ${instance}` : plugin,
    location: locationOf(el),
    playable: !el.unavailable,
  };
}
