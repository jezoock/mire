// Ce qu'un tag automatique lit d'un élément de Mire (forme `Element` du SDK). Repris de Mire
// (`src/main/catalog/tags/taggers.ts`, avant P5-09).

/** Dossier d'un fichier (chemin local ou adresse) : tout ce qui précède le dernier séparateur. */
const dirOf = (p) => p.replace(/[\\/]+[^\\/]*$/, '');

/** Fichier vidéo, audio ou image (pas un flux, un site ni un jeu) qui porte `tag` : chemin et dossier, sinon `null`. */
export function fileOf(e, tag) {
  if (e?.open?.kind !== 'file' || typeof e.open.path !== 'string' || !Array.isArray(e.tags) || !e.tags.includes(tag)) return null;
  return { path: e.open.path, dir: dirOf(e.open.path) };
}
