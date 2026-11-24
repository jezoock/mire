/**
 * Tags automatiques de la musique (contribution `taggers`, id `music`) : repris du cœur de Mire
 * (`src/main/catalog/tags/taggers.ts`, avant P5-09). Infos `album` (dossier « Artiste - Album », ou dossier de
 * l'album, le parent d'un « CD 2 »), `artist` (dossier « Artiste - Album »), `track` (numéro en tête du nom) et
 * `title` (nom sans ce numéro). Seulement d'après les noms : les fichiers ne sont pas lus.
 */
import { fileOf, folderOf } from './element.mjs';
import { albumName, cleanTrack, splitAlbumFolder, trackNumber } from './folders.mjs';

/** Infos d'un élément, ou `null` (pas un fichier audio). */
export function compute(e) {
  const file = fileOf(e, 'audio');
  if (!file) return null;
  const folder = folderOf(e, file.dir);
  const split = splitAlbumFolder(folder);
  const infos = { title: cleanTrack(e.name) };
  if (split) Object.assign(infos, split);
  else {
    const album = albumName(folder, file.dir);
    if (album) infos.album = album;
  }
  const n = trackNumber(e.name);
  if (n !== null) infos.track = n;
  return { infos };
}

export default function createTagger() {
  return { id: 'music', compute };
}
