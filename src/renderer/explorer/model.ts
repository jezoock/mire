/**
 * Explorateur (P4-08), sans DOM : les colonnes et l'aperçu. La première colonne propose Pages, Listes, Tags, Sources et
 * Dossiers ; chaque choix ouvre la colonne suivante (pages, listes ou tags, puis les regroupements d'un niveau, puis ses
 * éléments ; ou sources et dossiers autorisés, puis leurs sous-dossiers et leurs éléments), et un élément ouvre l'aperçu.
 * Les niveaux viennent de `catalog.page` par tranches : une page, une liste (`list:<id>`) ou un tag (`tag:<id>`) ; les
 * dossiers de `catalog.folder`, désignés par leur source et un chemin relatif. Les données arrivent par
 * `ExplorerSources` ; l'affichage est rédigé ici, avec les catalogues.
 */
import { listPageId, tagPageId } from '@mire/shared';
import type {
  CatalogSources,
  Element as CatalogElement,
  FolderLevel,
  InfoValue,
  ListSummary,
  PageDefinition,
  PageLevel,
  PagePath,
  TagSummary,
} from '@mire/shared';
import { mediaUrl } from '@mire/ui/utils';
import type { ExplorerColumn, ExplorerPreview, ExplorerRow } from '@mire/ui/utils';
import { groupFormatter, pageName } from '../pages/model.ts';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Première colonne, et les branches qu'elle propose. */
export const ROOT = 'root';
export const SECTIONS = ['pages', 'lists', 'tags', 'sources', 'folders'] as const;
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

/** Nœud d'un dossier : `folder:` puis `[source, chemin relatif]` en JSON (`''` : la source elle-même). */
export const folderNode = (source: string, path: string): string => `folder:${JSON.stringify([source, path])}`;

/** Source et chemin d'un nœud de dossier ; `null` pour un autre nœud. */
export function parseFolderNode(node: string): { source: string; path: string } | null {
  if (!node.startsWith('folder:')) return null;
  try {
    const [source, path] = JSON.parse(node.slice('folder:'.length)) as [unknown, unknown];
    return typeof source === 'string' && typeof path === 'string' ? { source, path } : null;
  } catch {
    return null;
  }
}

/** Sources qui ont un nom dans les catalogues (`explorer.sourceKinds`) ; les autres (plugins) gardent leur identifiant. */
export const SOURCE_KINDS = [
  'src-local',
  'src-smb',
  'src-http',
  'src-m3u',
  'tv-m3u',
  'tv-web',
  'jeux-roms',
  'jeux-pc',
  'jeux-pc-manuel',
  'jeux-marque',
  'web-perso',
  'web-bm',
] as const;

/**
 * Nom court d'un emplacement : son dernier dossier (`/bib/Films` → `Films`, `https://nas/films/` → `films`), ou l'hôte
 * d'une adresse sans chemin. Le chemin complet se lit dans l'aperçu (emplacement d'un élément).
 */
export function placeName(place: string): string {
  const s = place.replace(/[\\/]+$/, '');
  return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1) || place;
}

/** Nom d'une source : sa sorte, puis où elle se trouve (sauf pour une source tirée de la configuration). */
export function sourceLabel(plugin: string, place: string, t: Translate): string {
  const kind = (SOURCE_KINDS as readonly string[]).includes(plugin) ? t(`explorer.sourceKinds.${plugin}`) : plugin;
  // `console|chemin` (consoles) : seul le chemin se montre.
  const where = place.slice(place.lastIndexOf('|') + 1);
  return where && where !== 'config' ? t('explorer.sourceLabel', { kind, place: placeName(where) }) : kind;
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
  /** Sources du catalogue et dossiers autorisés. */
  sources(): Promise<CatalogSources | null>;
  folder(source: string, path: string, cursor: string | null): Promise<FolderLevel | null>;
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
  // Ouverture en cours : une seconde demande du même nœud la rejoint au lieu de la dépasser.
  let opening: { node: string; id: number; done: Promise<boolean> } | null = null;
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
    return elementRows(lvl.elements);
  }

  const elementRows = (els: readonly (CatalogElement & { unavailable?: true })[]): ExplorerRow[] =>
    els.map((e) => ({ id: e.key, key: e.key, label: e.name, ...(e.unavailable ? { unavailable: true } : {}) }));

  function folderRows(lvl: FolderLevel): ExplorerRow[] {
    const folders = lvl.folders.map((f) => {
      const node = folderNode(lvl.source, f.path);
      return { id: node, node, label: f.name, count: f.count };
    });
    return [...folders, ...elementRows(lvl.elements)];
  }

  /** Colonne ouverte par une branche (première tranche) ; `null` si elle n'existe plus. */
  async function load(node: string, heading: string): Promise<Column | null> {
    if (node === ROOT) return rootColumn();
    if (isSection(node)) return column(node, heading, await sectionRows(node));
    const r = await slice(node, null);
    return r ? column(node, heading, r.rows, r.total, r.next) : null;
  }

  /** Une tranche d'un niveau de page ou d'un dossier ; `null` s'il n'existe pas (ou plus). */
  async function slice(node: string, cursor: string | null): Promise<{ rows: ExplorerRow[]; total: number; next: string | null } | null> {
    const lvl = parseLevelNode(node);
    if (lvl) {
      const r = await src.level(lvl.pageId, lvl.path, cursor);
      return r && { rows: levelRows(r), total: r.total, next: r.next };
    }
    const dir = parseFolderNode(node);
    if (!dir) return null;
    const r = await src.folder(dir.source, dir.path, cursor);
    return r && { rows: folderRows(r), total: r.total, next: r.next };
  }

  /** Tranche suivante d'une colonne (sans la placer) ; `null` s'il n'y en a pas. */
  async function nextSlice(col: Column): Promise<Column | null> {
    if (!col.next) return null;
    const r = await slice(col.node, col.next);
    return r ? { ...column(col.node, col.heading, [...col.rows, ...r.rows], r.total, r.next), selected: col.selected } : null;
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
    if (section === 'sources' || section === 'folders') {
      const all = await src.sources();
      // Une source sans élément n'est pas proposée (comme un tag vide) ; un dossier autorisé l'est toujours.
      return (all?.[section] ?? [])
        .filter((x) => section === 'folders' || x.count > 0)
        .map((x) => {
          const node = folderNode(x.id, '');
          return { id: node, node, label: x.plugin ? sourceLabel(x.plugin, x.place, t) : placeName(x.place), count: x.count };
        });
    }
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
    open(node) {
      // Déjà ouverte (focus puis clic sur la même ligne) : rien à relire.
      const at = columns.findIndex((c) => c.selected === node);
      if (at >= 0 && columns[at + 1]?.node === node) return Promise.resolve(true);
      // Déjà demandée (A, puis la pause du focus sur la même ligne) : la même demande, qui n'est pas dépassée.
      if (opening?.node === node && opening.id === seq) return opening.done;
      const hit = choose((r) => r.node === node);
      if (!hit) return Promise.resolve(false);
      const id = ++seq;
      emit();
      const done = load(node, hit.row.label).then((next) => {
        if (id !== seq || !next) return false;
        columns = [...columns, next];
        emit();
        return true;
      });
      opening = { node, id, done };
      return done;
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
    source: sourceLabel(plugin, instance, t),
    location: locationOf(el),
    playable: !el.unavailable,
  };
}
