/**
 * Éditeurs des regroupements (P4-22) : un album, une série, désignés par leur chemin dans une page. Leurs infos, tags
 * et images valent pour tous leurs éléments : chaque modification est posée sur chaque élément, en une seule écriture
 * (`batch`). Changer le nom change l'info qui sert à regrouper (`album`, `series`).
 */
import type { CatalogGroup, Element, ElementImages, GroupEdit, GroupFacts, InfoScalar, InfoValue, PagePath } from '@mire/shared';
import type { Pages } from './pages/index.ts';
import { IMAGE_FIELDS, type TagEngine } from './tags/engine.ts';

export interface GroupDeps {
  pages: Pick<Pages, 'group'>;
  tags: Pick<TagEngine, 'element' | 'setInfos' | 'setTags' | 'clearImages' | 'setImage' | 'reset' | 'batch'>;
}

const isScalar = (v: unknown): v is InfoScalar => (typeof v === 'string' && !!v.trim()) || typeof v === 'number' || typeof v === 'boolean';

/** Le regroupement et tous ses éléments, ou `null`. */
export function groupOf({ pages, tags }: GroupDeps, pageId: unknown, path: unknown): CatalogGroup | null {
  const g = pages.group(pageId, path);
  if (!g) return null;
  const elements = g.keys.map((k) => tags.element(k)).filter((e): e is Element => !!e);
  return { page: g.page, path: g.path, info: g.info, value: g.path[g.path.length - 1], elements };
}

/**
 * Nouvelle valeur de l'info d'un élément renommée : dans une liste (genres), la valeur du regroupement est remplacée
 * et les autres gardées ; sinon la valeur est remplacée.
 */
export function renamedInfo(current: InfoValue | undefined, from: InfoScalar | null, to: InfoScalar): InfoValue {
  if (!Array.isArray(current)) return to;
  const list = current.map((v) => (v === from ? to : v));
  if (from === null || !current.some((v) => v === from)) list.push(to);
  return [...new Set(list.map(String))];
}

/** Valeur du regroupement après un renommage, telle que le catalogue l'a gardée (ramenée au type de l'info). */
function valueAfter(el: Element | null, info: string, to: InfoScalar, before: InfoScalar | null): InfoScalar | null {
  const v = el?.infos[info];
  if (Array.isArray(v)) return v.find((x) => String(x) === String(to).trim()) ?? before;
  return v === undefined ? before : (v as InfoScalar);
}

/** Applique une modification à tous les éléments ; rend le regroupement à son nouveau chemin (`null` s'il a disparu). */
export function editGroup(deps: GroupDeps, pageId: unknown, path: unknown, edit: unknown): CatalogGroup | null {
  const g = deps.pages.group(pageId, path);
  if (!g || !edit || typeof edit !== 'object') return null;
  const e = edit as GroupEdit;
  const from = g.path[g.path.length - 1];
  const infos = e.infos && typeof e.infos === 'object' ? Object.fromEntries(Object.entries(e.infos).filter(([id]) => id !== g.info)) : null;
  const rename = isScalar(e.rename) ? e.rename : null;
  deps.tags.batch(() => {
    for (const key of g.keys) {
      // Le nom lu avant les autres modifications : le moteur ne recalcule l'élément qu'à la fin.
      const current = deps.tags.element(key)?.infos[g.info];
      if (e.reset === true) deps.tags.reset(key);
      if (infos && Object.keys(infos).length) deps.tags.setInfos(key, infos);
      if (e.tags && typeof e.tags === 'object') deps.tags.setTags(key, e.tags);
      if (Array.isArray(e.clearImages)) deps.tags.clearImages(key, e.clearImages);
      if (rename !== null) deps.tags.setInfos(key, { [g.info]: renamedInfo(current, from, rename) });
    }
  });
  const next: PagePath = [...g.path];
  if (rename !== null) next[next.length - 1] = valueAfter(deps.tags.element(g.keys[0]), g.info, rename, from);
  return groupOf(deps, g.page, next);
}

/** Pose une image (fichier déjà copié dans les données de Mire) sur tous les éléments. */
export function setGroupImages(deps: GroupDeps, pageId: unknown, path: unknown, images: Partial<Record<keyof ElementImages, string>>): CatalogGroup | null {
  const g = deps.pages.group(pageId, path);
  if (!g) return null;
  const set = Object.entries(images).filter(([f, file]) => IMAGE_FIELDS.includes(f) && typeof file === 'string' && file) as [keyof ElementImages, string][];
  deps.tags.batch(() => {
    for (const key of g.keys) for (const [f, file] of set) deps.tags.setImage(key, f, file);
  });
  return groupOf(deps, g.page, g.path);
}

/** Infos texte d'une fiche trouvée en ligne, proposées dans l'éditeur. */
export function groupFacts(f: Record<string, unknown>): GroupFacts {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const out: GroupFacts = { title: text(f.title) ?? '' };
  for (const k of ['year', 'genre', 'overview', 'artist'] as const) {
    const v = text(f[k]);
    if (v) out[k] = v;
  }
  return out;
}
