/**
 * Éléments retrouvés par ce qui les ouvre (chemin, adresse) : sert à rattacher les fiches de l'ancien `meta.json`,
 * rangées sous le chemin ou l'adresse du fichier, à leur élément. Table construite à la première question, refaite
 * après un changement du catalogue.
 */
import { fold } from '@mire/shared';
import type { Element, ElementKey, OpenKind } from '@mire/shared';
import type { Catalog } from './index.ts';

/** Chemin ou adresse qui ouvre l'élément. */
export function openTarget(e: Readonly<Element>): string {
  const { open } = e;
  return open.kind === 'stream' || open.kind === 'site' ? open.url : open.path;
}

/**
 * Cible d'un jeu PC d'après son nom simplifié : les anciennes clés `g:<nom>` désignaient un jeu PC par son nom, pas
 * par son programme. Le caractère nul la distingue de tout chemin ou adresse.
 */
export const pcNameTarget = (foldedName: string): string => `\0g:${foldedName}`;

/** Ce par quoi une ancienne fiche peut retrouver l'élément : ce qui l'ouvre, et le nom d'un programme (jeu PC). */
export function targetsOf(e: Readonly<Element>): string[] {
  const target = openTarget(e);
  return e.open.kind === 'program' ? [target, pcNameTarget(fold(e.name))] : [target];
}

export function createTargetFinder(catalog: Pick<Catalog, 'keys' | 'get' | 'onChange'>) {
  let table: Map<string, { key: ElementKey; kind: OpenKind }[]> | null = null;
  catalog.onChange(() => {
    table = null;
  });

  function build(): Map<string, { key: ElementKey; kind: OpenKind }[]> {
    const t = new Map<string, { key: ElementKey; kind: OpenKind }[]>();
    for (const key of catalog.keys()) {
      const e = catalog.get(key);
      if (!e) continue;
      for (const target of targetsOf(e)) {
        const list = t.get(target);
        if (list) list.push({ key, kind: e.open.kind });
        else t.set(target, [{ key, kind: e.open.kind }]);
      }
    }
    return t;
  }

  /** Clé de l'élément ouvert par ce chemin ou cette adresse, parmi ces façons de l'ouvrir ; `null` sinon. */
  return function find(target: string, kinds: readonly OpenKind[]): ElementKey | null {
    table ??= build();
    return table.get(target)?.find((x) => kinds.includes(x.kind))?.key ?? null;
  };
}
