/**
 * Dossiers de cet ordinateur (contribution `sources`, id `src-local`) : reprise du fournisseur « local » du cœur de
 * Mire (avant P5-11c).
 *
 * Contrat du cœur (`src/main/plugins/bridges.ts`, P5-11a) : les emplacements restent dans la configuration de Mire ;
 * le cœur propose chacun à `handles`, et un dossier accepté est accordé au plugin tant qu'il reste dans la
 * bibliothèque. Les fichiers sont lus par `ctx.files.walk` (parcours fait par le cœur, sans suivre les liens), puis
 * le cœur revérifie chaque fichier et chaque image sur son chemin réel.
 *
 * Seuls les dossiers sont pris ici : les partages réseau (`network`) restent au cœur, puis au plugin
 * `mire.source.network` (P5-11d), et les adresses aux autres sources.
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

const isFolder = (location) =>
  !!location && typeof location.path === 'string' && location.path !== '' && location.network !== true && mediaKinds(location).length > 0;

export default function createSource(ctx) {
  const t = translator(ctx.locale);
  return {
    id: 'src-local',
    tags: ['local'],
    handles: (location) => isFolder(location),
    instance: (location) => location.path,
    async scan(location) {
      if (!isFolder(location)) return [];
      if (!(await ctx.files.exists(location.path))) throw new Error(t('folderNotFound', { path: location.location }));
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
