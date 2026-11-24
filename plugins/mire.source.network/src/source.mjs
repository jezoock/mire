/**
 * Partages réseau (contribution `sources`, id `src-smb`) : reprise du fournisseur « network » du cœur de Mire (avant
 * P5-11d).
 *
 * Un partage est lu comme un dossier monté par le système : `\\NAS\Films` sous Windows, `smb://nas/films` que le cœur
 * traduit en chemin (`\\nas\films` sous Windows, `/Volumes/films` sous macOS, dossier gvfs sous Linux). Le plugin ne
 * parle pas au réseau lui-même : il n'a pas besoin de la permission « Réseau local », seulement de `folders`.
 *
 * Contrat du cœur (`src/main/plugins/bridges.ts`, P5-11a) : les emplacements restent dans la configuration de Mire ;
 * le cœur propose chacun à `handles`, et un partage accepté est accordé au plugin tant qu'il reste dans la
 * bibliothèque. Les fichiers sont lus par `ctx.files.walk` (parcours fait par le cœur, sans suivre les liens, chemins
 * seuls), puis le cœur revérifie chaque fichier et chaque image sur son chemin réel. Le message d'un partage absent
 * montré dans la bibliothèque est calculé par le cœur ; celui-ci va au journal.
 *
 * Seuls les partages sont pris ici : les dossiers de cet ordinateur vont au plugin `mire.source.local`, les adresses
 * aux autres sources.
 */
import { EXT, SUBTITLE_EXTS } from './formats.mjs';
import { elementsOf } from './folder.mjs';
import { translator } from './texts.mjs';

/** Profondeur maximale des dossiers parcourus sous la racine d'un emplacement (comme le cœur). */
export const MAX_DEPTH = 16;
/** Nombre maximal d'éléments d'une analyse, et de fichiers rendus par `walk` (bornes du cœur). */
export const MAX_ITEMS = 150000;

// Extensions lues : tous les médias (les images servent d'affiches même pour une source de vidéos) et les sous-titres.
const EXTENSIONS = [...EXT.video, ...EXT.audio, ...EXT.image, ...SUBTITLE_EXTS].map((e) => e.slice(1));

/** Types de fichiers lus ici ; un autre (`game` : dossiers de jeux PC, P5-13) va à d'autres sources. */
const MEDIA_KINDS = ['video', 'audio', 'image'];
const mediaKinds = (location) => (Array.isArray(location.kinds) ? location.kinds.filter((k) => MEDIA_KINDS.includes(k)) : []);

const isShare = (location) =>
  !!location && typeof location.path === 'string' && location.path !== '' && location.network === true && mediaKinds(location).length > 0;

export default function createSource(ctx) {
  const t = translator(ctx.locale);
  return {
    id: 'src-smb',
    tags: ['network'],
    handles: (location) => isShare(location),
    instance: (location) => location.path,
    async scan(location) {
      if (!isShare(location)) return [];
      if (!(await ctx.files.exists(location.path))) throw new Error(t('shareUnavailable', { path: location.location }));
      const files = await ctx.files.walk(location.path, { extensions: EXTENSIONS, depth: MAX_DEPTH, limit: MAX_ITEMS, skipHidden: true, details: false });
      return elementsOf(
        location.path,
        files.map((f) => f.path),
        mediaKinds(location),
        MAX_ITEMS,
      );
    },
  };
}
