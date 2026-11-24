// Tags automatiques des plugins inclus (P5-09 : `plugins/mire.tags.*`), appelés directement, sans hôte de plugins :
// ce que le moteur reçoit d'eux une fois leurs lots calculés. Pour les tests du cœur qui ont besoin de séries, de
// films ou d'albums (pages, recherche, listes, mesures) ; les tests des plugins eux-mêmes sont dans leur dossier.
import type { Element } from '@mire/shared';
import type { Contributor } from '../../src/main/catalog/tags/engine.ts';
import * as series from '../../plugins/mire.tags.series/src/tagger.mjs';
import * as movies from '../../plugins/mire.tags.movies/src/tagger.mjs';
import * as music from '../../plugins/mire.tags.music/src/tagger.mjs';
import * as consoles from '../../plugins/mire.tags.consoles/src/tagger.mjs';
import * as photos from '../../plugins/mire.tags.photos/src/tagger.mjs';

type Compute = (e: Readonly<Element>) => ReturnType<Contributor['compute']>;

/** Les cinq tags automatiques inclus, dans l'ordre des anciens tags automatiques internes. */
export const bundledTaggers = (): Contributor[] =>
  [series, movies, music, consoles, photos].map((m) => {
    const { id } = m.default();
    return { id, origin: 'tagger', compute: m.compute as Compute };
  });
