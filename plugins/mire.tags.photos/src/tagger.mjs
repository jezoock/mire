/**
 * Tags automatiques des photos (contribution `taggers`, id `photos`) : repris du cœur de Mire
 * (`src/main/catalog/tags/taggers.ts`, avant P5-09). Info `folder` : le groupe de dossier (« Vacances » ; « Ma série,
 * Saison 1 » quand le dossier seul ne dit rien). Seulement d'après les noms : les fichiers ne sont pas lus.
 */
import { fileOf, folderOf } from './element.mjs';

/** Dossier sans intérêt seul (« Saison 1 », « Partie 2 »…) : on lui ajoute le nom du dossier parent. */
const GENERIC_DIR = /^(saison|season|s\d{1,2}|disc|disque|cd|dvd|partie|part|volume|vol)\b/i;

/** « Vacances », ou « Mariage, Partie 2 » (repris de `folderText` de `@mire/shared`). */
export function folderText(folder, dir) {
  const parts = String(dir || '')
    .split(/[\\/]/)
    .filter(Boolean);
  const parent = GENERIC_DIR.test(folder || '') && parts.length >= 2 ? parts[parts.length - 2] : '';
  return parent ? `${parent}, ${folder}` : folder;
}

/** Infos d'un élément, ou `null` (pas une image, ou pas de dossier). */
export function compute(e) {
  const file = fileOf(e, 'image');
  if (!file) return null;
  const folder = folderText(folderOf(e, file.dir), file.dir);
  return folder ? { infos: { folder } } : null;
}

export default function createTagger() {
  return { id: 'photos', compute };
}
