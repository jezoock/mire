/**
 * Parcours par source et par dossier (explorateur, P4-08) : `catalog.sources` et `catalog.folder`.
 *
 * Deux sortes de racines : les emplacements de source du catalogue (colonne Sources) et les dossiers autorisés de la
 * gestion des fichiers (colonne Dossiers, `files/roots.ts`). Chacune reçoit un identifiant opaque (empreinte) : l'interface
 * désigne un dossier par cet identifiant et un chemin relatif, jamais par un chemin absolu.
 *
 * Les dossiers se déduisent des emplacements des éléments du catalogue, sans lire le disque : un dossier qui n'a aucun
 * élément n'existe pas. Le chemin relatif demandé est contrôlé deux fois : par sa forme (pas de `..`, de `.`, de
 * segment vide, de `\` ni de caractère nul), puis, pour un dossier de cet ordinateur, par le contrôle de chemin de la
 * gestion des fichiers (`checkFolder`, repris de P0-06 par P2-10) : le dossier doit rester dans la racine, avant comme
 * après résolution des liens symboliques. Un dossier absent du disque (disque débranché) reste parcourable : ses
 * éléments viennent du catalogue, et il n'y a pas de lien à suivre.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import type { CatalogSources, Element, ElementKey, ElementSourceRef, FolderEntry, FolderLevel, SourceSummary } from '@mire/shared';
import { isHttpUrl } from '@mire/shared';
import { checkFolder, type GuardFs } from '../files/guard.ts';
import { sourceId } from './persistence.ts';
import type { Catalog } from './index.ts';
import type { TagEngine } from './tags/engine.ts';

/** Taille d'une tranche (sous-dossiers et éléments), comme `catalog.page`. */
export const FOLDER_PAGE_SIZE = 100;
/** Longueur maximale d'un chemin relatif demandé. */
const MAX_PATH = 4096;

/** Base d'une racine : un dossier (de cet ordinateur ou d'un partage réseau), une adresse, ou rien (pas de dossiers). */
type Base = { type: 'path'; path: string; network: boolean } | { type: 'url'; url: string } | null;

interface Root {
  summary: Omit<SourceSummary, 'count'>;
  base: Base;
  keys(): ElementKey[];
}

/** Un dossier de l'arbre : ses sous-dossiers (nom → nombre d'éléments) et ses éléments directs. */
interface Node {
  folders: Map<string, number>;
  keys: ElementKey[];
  /** Calculé à la première demande : sous-dossiers puis éléments, triés par nom. */
  sorted?: { folders: FolderEntry[]; keys: ElementKey[] };
}

export interface FoldersOptions {
  catalog: Pick<Catalog, 'sources' | 'keysOf' | 'keys' | 'get'>;
  engine: Pick<TagEngine, 'element' | 'onChange'> & Partial<Pick<TagEngine, 'nameOf'>>;
  /** Dossiers autorisés (`managedRoots`). */
  roots: () => string[];
  platform?: NodeJS.Platform;
  /** Lecture du disque pour le contrôle des liens (injectable dans les tests). */
  fs: GuardFs;
}

const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const isNetworkPath = (p: string) => /^[\\/]{2}/.test(p);

/** Chemin ou adresse d'un élément (`null` s'il n'en a pas). */
function locationOf(e: Readonly<Element>): string | null {
  const o = e.open;
  return 'path' in o ? o.path : 'url' in o ? o.url : null;
}

/**
 * Forme d'un chemin relatif demandé par l'interface : segments séparés par `/`, aucun vide, ni `.` ni `..`, sans `\`
 * ni caractère nul (ni `:` sous Windows, qui désignerait un lecteur). Rend ses segments, ou `null`.
 */
export function relativeSegments(rel: unknown, platform: NodeJS.Platform): string[] | null {
  if (rel === '' || rel === undefined || rel === null) return [];
  if (typeof rel !== 'string' || rel.length > MAX_PATH) return null;
  const parts = rel.split('/');
  const bad = (s: string) => !s || s === '.' || s === '..' || /[\\\0]/.test(s) || (platform === 'win32' && s.includes(':'));
  return parts.some(bad) ? null : parts;
}

export function createFolders({ catalog, engine, roots, platform = process.platform, fs }: FoldersOptions) {
  const m = platform === 'win32' ? path.win32 : path.posix;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  // Arbres calculés, par identifiant de racine ; effacés à chaque changement du catalogue.
  const trees = new Map<string, Map<string, Node>>();
  const listeners = new Set<() => void>();

  /** Chemin sous une forme comparable : séparateurs `/`, sans séparateur final ; sans casse sous Windows. */
  const slashed = (p: string) => {
    const win = platform === 'win32';
    const quick = win ? p.replace(/\\/g, '/') : p;
    // Chemin déjà propre (cas courant : il vient d'une lecture de dossier) : pas de normalisation, coûteuse sur 20 000.
    if (!/\/\.{1,2}(\/|$)|\/\/|\/$/.test(win ? quick.slice(2) : quick)) return quick;
    const n = m.normalize(p).replace(/\\/g, '/');
    return n.length > 1 && n.endsWith('/') ? n.slice(0, -1) : n;
  };
  const cmpKey = (p: string) => (platform === 'win32' ? p.toLowerCase() : p);

  /** Base d'un emplacement de source : la dernière partie de son identifiant (`console|chemin` pour les consoles). */
  function baseOf(instance: string): Base {
    const loc = instance.slice(instance.lastIndexOf('|') + 1);
    if (isHttpUrl(loc)) return { type: 'url', url: loc.endsWith('/') ? loc : `${loc}/` };
    if (m.isAbsolute(loc) || isNetworkPath(loc)) return { type: 'path', path: slashed(loc), network: isNetworkPath(loc) };
    return null;
  }

  /** Segments du dossier d'un élément sous la base (sans le nom du fichier) ; `[]` hors de la base. */
  function dirSegments(base: Base, loc: string | null): string[] {
    if (!base || !loc) return [];
    if (base.type === 'url') {
      if (!loc.startsWith(base.url)) return [];
      const rest = loc.slice(base.url.length).split(/[?#]/)[0].split('/').slice(0, -1);
      return rest.map((s) => {
        try {
          const d = decodeURIComponent(s);
          return /[/\\\0]/.test(d) ? s : d;
        } catch {
          return s;
        }
      });
    }
    if (isHttpUrl(loc)) return [];
    const p = slashed(loc);
    const prefix = base.path.endsWith('/') ? base.path : `${base.path}/`;
    if (!cmpKey(p).startsWith(cmpKey(prefix))) return [];
    return p.slice(prefix.length).split('/').slice(0, -1);
  }

  function sourceRoot(ref: ElementSourceRef): Root {
    const base = baseOf(ref.instance);
    const place = base?.type === 'url' ? base.url : base ? base.path : ref.instance;
    return { summary: { id: `s${hash(sourceId(ref))}`, plugin: ref.plugin, place }, base, keys: () => catalog.keysOf(ref) };
  }

  function folderRoot(dir: string): Root {
    const base: Base = { type: 'path', path: slashed(dir), network: false };
    const prefix = cmpKey(base.path.endsWith('/') ? base.path : `${base.path}/`);
    const keys = () =>
      catalog.keys().filter((k) => {
        const e = catalog.get(k);
        const loc = e && locationOf(e);
        return !!loc && !isHttpUrl(loc) && cmpKey(slashed(loc)).startsWith(prefix);
      });
    return { summary: { id: `d${hash(cmpKey(base.path))}`, place: base.path }, base, keys };
  }

  function allRoots(): { sources: Root[]; folders: Root[] } {
    const sources = catalog.sources().map(sourceRoot);
    const seen = new Set<string>();
    const folders: Root[] = [];
    for (const r of roots()) {
      const root = folderRoot(r);
      if (!seen.has(root.summary.id)) folders.push(root);
      seen.add(root.summary.id);
    }
    return { sources, folders };
  }

  function treeOf(root: Root): Map<string, Node> {
    const known = trees.get(root.summary.id);
    if (known) return known;
    const tree = new Map<string, Node>();
    const node = (p: string) => {
      let n = tree.get(p);
      if (!n) tree.set(p, (n = { folders: new Map(), keys: [] }));
      return n;
    };
    node('');
    for (const key of root.keys()) {
      const e = catalog.get(key);
      if (!e) continue;
      const segs = dirSegments(root.base, locationOf(e));
      for (let i = 0; i < segs.length; i++) {
        const n = node(segs.slice(0, i).join('/'));
        n.folders.set(segs[i], (n.folders.get(segs[i]) ?? 0) + 1);
      }
      node(segs.join('/')).keys.push(key);
    }
    trees.set(root.summary.id, tree);
    return tree;
  }

  const nameOf = (key: ElementKey) => {
    const e = catalog.get(key);
    return e ? (engine.nameOf?.(e) ?? e.name) : '';
  };

  function sorted(n: Node, rel: string) {
    if (n.sorted) return n.sorted;
    const folders = [...n.folders]
      .map(([name, count]) => ({ name, path: rel ? `${rel}/${name}` : name, count }))
      .sort((a, b) => collator.compare(a.name, b.name));
    const names = new Map(n.keys.map((k) => [k, nameOf(k)]));
    const keys = [...n.keys].sort((a, b) => collator.compare(names.get(a) ?? '', names.get(b) ?? '') || (a < b ? -1 : 1));
    return (n.sorted = { folders, keys });
  }

  /** Le dossier reste-t-il dans sa racine ? Contrôle de chemin de la gestion des fichiers, pour un dossier local. */
  async function stays(base: Base, segs: string[]): Promise<boolean> {
    if (!base || base.type !== 'path' || base.network || !segs.length) return true;
    const r = await checkFolder(m.join(base.path, ...segs), [base.path], { platform, fs });
    return r.ok || r.code === 'missing';
  }

  engine.onChange(() => {
    trees.clear();
    for (const l of listeners) l();
  });

  /** Nombre d'éléments d'une racine (l'arbre d'une source n'est pas calculé pour cela). */
  const count = (root: Root) => {
    if (root.summary.plugin) return root.keys().length;
    let total = 0;
    for (const n of treeOf(root).values()) total += n.keys.length;
    return total;
  };

  return {
    /** Sources du catalogue et dossiers autorisés (`catalog.sources`), avec leur nombre d'éléments. */
    sources(): CatalogSources {
      const { sources, folders } = allRoots();
      const summary = (r: Root): SourceSummary => ({ ...r.summary, count: count(r) });
      const byPlace = (a: SourceSummary, b: SourceSummary) => collator.compare(a.place, b.place);
      return { sources: sources.map(summary).sort(byPlace), folders: folders.map(summary) };
    },

    /**
     * Un dossier d'une source ou d'un dossier autorisé (`catalog.folder`), par tranches : sous-dossiers, puis éléments.
     * `null` si la racine est inconnue, si le chemin est refusé (forme, ou lien qui sort de la racine) ou s'il ne
     * désigne aucun dossier du catalogue.
     */
    async folder(id: unknown, rel: unknown = '', cursor: unknown = null): Promise<FolderLevel | null> {
      if (typeof id !== 'string') return null;
      const { sources, folders } = allRoots();
      const root = [...sources, ...folders].find((r) => r.summary.id === id);
      const segs = relativeSegments(rel, platform);
      if (!root || !segs) return null;
      const relPath = segs.join('/');
      const n = treeOf(root).get(relPath);
      if (!n || !(await stays(root.base, segs))) return null;
      const { folders: subs, keys } = sorted(n, relPath);
      const from = typeof cursor === 'string' && /^\d+$/.test(cursor) ? Number(cursor) : 0;
      const total = subs.length + keys.length;
      const to = from + FOLDER_PAGE_SIZE;
      const elements = keys
        .slice(Math.max(0, from - subs.length), Math.max(0, to - subs.length))
        .map((k) => engine.element(k))
        .filter((e): e is NonNullable<typeof e> => !!e);
      return { source: id, path: relPath, total, next: to < total ? String(to) : null, folders: subs.slice(from, to), elements };
    },

    /** Racines ou contenu changés (catalogue, tags, noms) : à relire. */
    changed(): void {
      trees.clear();
      for (const l of listeners) l();
    },

    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type Folders = ReturnType<typeof createFolders>;
