/**
 * Tags selon le type de fichier : `.mkv` → `video`, `.mp3` → `audio`, `.jpg` → `image`, d'après les formats reconnus
 * (`EXT` de `@mire/shared`). Les règles modifiées sont gardées dans la configuration (`catalog.fileTags`), qui
 * ne contient que les extensions changées : la configuration d'une installation existante ne change pas.
 */
import { EXT, MEDIA_KINDS, type CatalogSettings, type Element, type InfoValue } from '@mire/shared';
import { userTagId } from './registry.ts';

/** Extension (`.mkv`) → tags posés. */
export type FileTagRules = ReadonlyMap<string, readonly string[]>;

/** Règles par défaut, tirées des formats reconnus. */
export function defaultFileTagRules(): Map<string, readonly string[]> {
  const rules = new Map<string, readonly string[]>();
  for (const kind of MEDIA_KINDS) for (const ext of EXT[kind]) rules.set(ext, [kind]);
  return rules;
}

/** Extension écrite à la main (« MKV », « .mkv ») → `.mkv` ; `null` si elle n'en est pas une. */
export function normalizeExtension(ext: unknown): string | null {
  if (typeof ext !== 'string') return null;
  const e = ext.trim().toLowerCase().replace(/^\.?/, '.');
  return /^\.[a-z0-9]{1,16}$/.test(e) ? e : null;
}

/**
 * Section `catalog` de la configuration, corrigée : extensions normalisées, tags simplifiés, doublons retirés.
 * Ce qui ne s'y lit pas est écarté.
 */
export function normalizeCatalogSettings(raw: unknown): CatalogSettings {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: CatalogSettings = { ...src };
  const fileTags = src.fileTags;
  if (fileTags === undefined) return out;
  const rules: Record<string, string[]> = {};
  if (fileTags && typeof fileTags === 'object' && !Array.isArray(fileTags)) {
    for (const [ext, tags] of Object.entries(fileTags)) {
      const e = normalizeExtension(ext);
      if (!e || !Array.isArray(tags)) continue;
      rules[e] = [...new Set(tags.map(userTagId).filter(Boolean))];
    }
  }
  out.fileTags = rules;
  return out;
}

/** Règles effectives : celles par défaut, remplacées extension par extension par celles de la configuration. */
export function fileTagRules(settings: CatalogSettings | undefined): FileTagRules {
  const rules = defaultFileTagRules();
  for (const [ext, tags] of Object.entries(normalizeCatalogSettings(settings).fileTags ?? {})) rules.set(ext, tags);
  return rules;
}

/** Extension d'un chemin ou d'une adresse (`.mkv`), en minuscules ; chaîne vide s'il n'y en a pas. */
export function extensionOf(target: string): string {
  let p = target;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    try {
      p = decodeURIComponent(new URL(p).pathname);
    } catch {
      return '';
    }
  }
  const m = /\.([^./\\]{1,16})$/.exec(p);
  return m ? `.${m[1].toLowerCase()}` : '';
}

const MEDIA = new Set<string>(MEDIA_KINDS);

/**
 * Tags et infos du type de fichier d'un élément (fichier ou flux). Une entrée sans extension reconnue (flux d'une
 * liste M3U) prend le type de média que sa source a déclaré (info `mediaType`).
 */
export function fileLayer(element: Readonly<Element>, rules: FileTagRules): { tags: readonly string[]; infos: Record<string, InfoValue> } {
  const { open } = element;
  const target = open.kind === 'file' ? open.path : open.kind === 'stream' ? open.url : '';
  const ext = target ? extensionOf(target) : '';
  const tags = (ext && rules.get(ext)) || [];
  const mediaType = element.infos.mediaType;
  const fallback = !tags.length && typeof mediaType === 'string' && MEDIA.has(mediaType) && !rules.has(ext) ? [mediaType] : [];
  return { tags: fallback.length ? fallback : tags, infos: ext ? { extension: ext.slice(1) } : {} };
}
