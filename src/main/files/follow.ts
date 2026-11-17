/**
 * Le catalogue suit les fichiers renommés, déplacés ou supprimés (P2-10). Ce qui est rangé par clé d'élément passe
 * sous la nouvelle clé : modifications faites à la main (`overrides.json`), infos en ligne (`metadata.json`), listes
 * (`lists.json`), positions de reprise et « Reprendre » (`usage.json`, P2-12). Après une suppression, seuls les
 * éléments quittent le catalogue : le reste est gardé (une vidéo remise de la corbeille retrouve sa position). Les
 * éléments disparus quittent le catalogue tout de suite ; ceux qui arrivent sous leur nouveau chemin y entrent à
 * l'analyse suivante (`rescan`). Une liste garde un élément supprimé, marqué indisponible (P2-08).
 */
import type { ElementKey } from '@mire/shared';
import type { Catalog } from '../catalog/index.ts';
import { movedKey } from '../catalog/keys.ts';
import type { FilesFollow } from './service.ts';

export interface CatalogFollowDeps {
  catalog: Pick<Catalog, 'keys' | 'forget'>;
  overrides?: { movePath(from: string, to: string): unknown };
  metadata?: { movePath(from: string, to: string): unknown };
  lists?: { movePath(from: string, to: string): unknown };
  usage?: { movePath(from: string, to: string): unknown };
  /** Nouvelle analyse, pour que les éléments déplacés reviennent sous leur nouvelle clé. */
  rescan?: () => void;
  platform?: NodeJS.Platform;
}

export function catalogFollow({ catalog, overrides, metadata, lists, usage, rescan, platform = process.platform }: CatalogFollowDeps): FilesFollow {
  // Éléments du catalogue dont le chemin est `target` ou se trouve dessous.
  const under = (target: string): ElementKey[] => catalog.keys().filter((k) => movedKey(k, target, target, platform) !== null);
  return {
    moved(from, to) {
      const gone = under(from);
      overrides?.movePath(from, to);
      metadata?.movePath(from, to);
      lists?.movePath(from, to);
      usage?.movePath(from, to);
      catalog.forget(gone);
      rescan?.();
    },
    removed(target) {
      catalog.forget(under(target));
    },
  };
}
