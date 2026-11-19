/**
 * Gérer ses fichiers depuis l'explorateur (P4-09), sans DOM : sélection de plusieurs éléments, et textes qui disent
 * exactement ce qui sera fait (renommer, déplacer, mettre à la corbeille, tags, listes). Les opérations elles-mêmes
 * passent par le service de fichiers du processus principal (P2-10), qui refait tous les contrôles.
 */
import type { FolderLevel, SourceSummary, TagSummary } from '@mire/shared';

type Translate = (key: string, vars?: Record<string, string | number>) => string;
type Plural = (key: string, count: number) => string;

/** Éléments choisis (par leur clé, dans l'ordre du choix) et point de départ d'une plage (Maj + clic). */
export interface Picks {
  keys: string[];
  anchor: string | null;
}

export const NO_PICKS: Picks = { keys: [], anchor: null };

/** Choisit ou retire un élément ; il devient le point de départ d'une plage. */
export function togglePick(p: Picks, key: string): Picks {
  const keys = p.keys.includes(key) ? p.keys.filter((k) => k !== key) : [...p.keys, key];
  return { keys, anchor: key };
}

/**
 * Choisit tous les éléments entre le point de départ et `key`, dans l'ordre de la colonne (`order`). Sans point de
 * départ dans cette colonne, choisit seulement `key`. Le point de départ ne change pas (comme un explorateur de fichiers).
 */
export function rangePick(p: Picks, order: readonly string[], key: string): Picks {
  const to = order.indexOf(key);
  const from = p.anchor ? order.indexOf(p.anchor) : -1;
  if (to < 0) return p;
  if (from < 0) return togglePick(p, key);
  const span = order.slice(Math.min(from, to), Math.max(from, to) + 1);
  return { keys: [...p.keys, ...span.filter((k) => !p.keys.includes(k))], anchor: p.anchor };
}

/** Garde les éléments choisis encore affichés (colonne fermée, élément disparu). */
export function prunePicks(p: Picks, shown: ReadonlySet<string>): Picks {
  const keys = p.keys.filter((k) => shown.has(k));
  if (keys.length === p.keys.length && (!p.anchor || shown.has(p.anchor))) return p;
  return { keys, anchor: p.anchor && shown.has(p.anchor) ? p.anchor : null };
}

/** Séparateur d'un chemin : `\` pour un chemin Windows (`C:\…`), `/` sinon. */
const sepOf = (p: string) => (/^[a-zA-Z]:\\/.test(p) || (p.includes('\\') && !p.includes('/')) ? '\\' : '/');

/** Nom du fichier ou du dossier (`/bib/Films/a.mkv` → `a.mkv`). */
export function baseName(p: string): string {
  const s = p.replace(/[\\/]+$/, '');
  return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1);
}

/** Dossier qui contient le fichier (`/bib/Films/a.mkv` → `/bib/Films`). */
export function dirName(p: string): string {
  const s = p.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i <= 0 ? s.slice(0, i + 1) || s : s.slice(0, i);
}

/** Dossier sous un dossier autorisé (`place`, chemin absolu) à partir de son chemin relatif (`Films/Action`). */
export function joinPath(place: string, rel: string): string {
  if (!rel) return place;
  const sep = sepOf(place);
  return `${place.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`;
}

/** Mêmes chemins (casse comprise, sauf pour un chemin Windows), sans séparateur final. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const s = p.replace(/[\\/]+$/, '').replace(/\\/g, '/');
    return sepOf(p) === '\\' ? s.toLowerCase() : s;
  };
  return norm(a) === norm(b);
}

/** Remplace les `{variables}` d'un texte (les formes au pluriel ne remplacent que `{count}`). */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (all, k: string) => (Object.hasOwn(vars, k) ? String(vars[k]) : all));
}

/** Noms entre guillemets, les trois premiers, puis « et N autres ». */
export function quoteNames(names: readonly string[], t: Translate, plural: Plural, shown = 3): string {
  const quoted = names.slice(0, shown).map((n) => t('explorer.files.quoted', { name: n }));
  const rest = names.length - shown;
  const list = quoted.join(t('explorer.files.separator'));
  return rest > 0 ? fill(plural('explorer.files.andMore', rest), { names: list }) : list;
}

/**
 * Nouveau nom d'un renommage : vide, avec `/`, `\` ou un caractère nul, `.` ou `..` sont refusés ici (le processus
 * principal applique en plus les règles de Windows). Rend le nom nettoyé des espaces autour, ou la raison du refus.
 */
export function checkNewName(name: unknown, current: string, t: Translate): { ok: true; name: string } | { ok: false; error: string } {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n || n === '.' || n === '..' || /[\\/\0]/.test(n)) return { ok: false, error: t('files.errors.name') };
  if (n === current) return { ok: false, error: t('explorer.rename.same') };
  return { ok: true, name: n };
}

/** Texte de la confirmation d'un renommage : l'ancien nom, le nouveau, et le dossier qui ne change pas. */
export function renameText(path: string, name: string, t: Translate): string {
  return t('explorer.rename.confirm', { from: baseName(path), to: name, folder: dirName(path) });
}

/** Texte de la confirmation d'un déplacement : le nom, le dossier de départ et celui d'arrivée. */
export function moveText(path: string, folder: string, t: Translate): string {
  return t('explorer.move.confirm', { name: baseName(path), from: dirName(path), to: folder });
}

/** Texte de la confirmation d'une mise à la corbeille : le nom du fichier, ou combien et lesquels. */
export function removeText(paths: readonly string[], t: Translate, plural: Plural): string {
  const names = quoteNames(paths.map(baseName), t, plural);
  return fill(plural('explorer.remove.confirm', paths.length), { names });
}

/** Dossier où déplacer un fichier : son chemin absolu (envoyé au processus principal, qui le contrôle) et son nom. */
export interface Destination {
  path: string;
  label: string;
}

export interface DestinationSources {
  sources(): Promise<{ folders: SourceSummary[] } | null>;
  folder(source: string, path: string, cursor: string | null): Promise<FolderLevel | null>;
}

/**
 * Dossiers où déplacer un fichier : les dossiers autorisés, puis leurs sous-dossiers connus du catalogue (en largeur,
 * `depth` niveaux, au plus `limit` dossiers). Le libellé suit le chemin (`Vidéos / Films / Action`). Seuls les
 * dossiers autorisés sont proposés : le processus principal refuserait tout autre dossier.
 */
export async function destinations(src: DestinationSources, { depth = 4, limit = 300 } = {}): Promise<Destination[]> {
  const roots = (await src.sources())?.folders ?? [];
  const out: Destination[] = [];
  let queue = roots.map((r) => ({ id: r.id, place: r.place, rel: '', label: baseName(r.place) || r.place }));
  for (let level = 0; level <= depth && queue.length && out.length < limit; level++) {
    const next: typeof queue = [];
    for (const d of queue) {
      if (out.length >= limit) break;
      out.push({ path: joinPath(d.place, d.rel), label: d.label });
      if (level === depth) continue;
      const lvl = await src.folder(d.id, d.rel, null);
      for (const f of lvl?.folders ?? []) next.push({ id: d.id, place: d.place, rel: f.path, label: `${d.label} / ${f.name}` });
    }
    queue = next;
  }
  return out;
}

/**
 * Tags proposés à une sélection : pour ajouter, tous les tags connus ; pour retirer, ceux qu'au moins un élément
 * choisi porte. Triés par nom.
 */
export function tagChoices(mode: 'add' | 'remove', known: readonly TagSummary[], carried: readonly (readonly string[])[]): TagSummary[] {
  const present = new Set(carried.flat());
  const list = mode === 'add' ? [...known] : known.filter((x) => present.has(x.id));
  return list.sort((a, b) => a.name.localeCompare(b.name));
}
