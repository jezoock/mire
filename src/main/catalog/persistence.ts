/**
 * Persistance du catalogue : un fichier JSON par emplacement de source dans `userData/catalog/sources/`, écrit par
 * le stockage JSON (écriture atomique, différée : ces fichiers peuvent être gros).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Element, ElementSourceRef } from '@mire/shared';
import type { SourceFile } from './types.ts';

export const SOURCE_FILE_VERSION = 1;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** Identifiant interne d'un emplacement de source (plugin et emplacement). */
export const sourceId = (ref: ElementSourceRef): string => JSON.stringify([ref.plugin, ref.instance]);

/**
 * Nom du fichier d'un emplacement : lisible (plugin et emplacement simplifiés), et rendu unique par une empreinte,
 * car un emplacement peut contenir des caractères interdits dans un nom de fichier (chemin, adresse).
 */
export function sourceFileName(ref: ElementSourceRef): string {
  const hash = crypto.createHash('sha1').update(sourceId(ref)).digest('hex').slice(0, 10);
  return `${[slug(ref.plugin), slug(ref.instance)].filter(Boolean).join('--')}-${hash}.json`;
}

/** Fichiers d'emplacements présents dans le dossier (aucun si le dossier n'existe pas encore). */
export function listSourceFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => path.join(dir, f));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function isSourceRef(v: unknown): v is ElementSourceRef {
  return isObject(v) && isString(v.plugin) && !!v.plugin && isString(v.instance);
}

/** Élément lu sur le disque : les champs indispensables doivent être là (un fichier peut avoir été modifié à la main). */
export function isElement(v: unknown): v is Element {
  return (
    isObject(v) &&
    isString(v.key) &&
    !!v.key &&
    isString(v.name) &&
    isObject(v.open) &&
    isString(v.open.kind) &&
    Array.isArray(v.tags) &&
    v.tags.every(isString) &&
    isObject(v.infos) &&
    isObject(v.images) &&
    typeof v.added === 'number'
  );
}

/**
 * Contenu d'un fichier d'emplacement, vérifié : `null` si ce n'est pas un fichier d'emplacement de cette version.
 * Les éléments mal formés sont écartés ; la source de chaque élément est celle du fichier.
 */
export function readSourceFile(raw: unknown): SourceFile | null {
  if (!isObject(raw) || raw.version !== SOURCE_FILE_VERSION || !isSourceRef(raw.source) || !Array.isArray(raw.elements)) return null;
  const source = { plugin: raw.source.plugin, instance: raw.source.instance };
  const elements = raw.elements.filter(isElement).map((e) => ({ ...e, source }));
  return { version: SOURCE_FILE_VERSION, source, scanned: typeof raw.scanned === 'number' ? raw.scanned : 0, elements };
}
