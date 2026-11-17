/**
 * Version 9 : les sections deviennent des pages (P2-11, « Reprise des installations existantes » de
 * docs/architecture-cible.md).
 *
 * - Sections → pages : les pages prêtes à l'emploi (`catalog/pages/builtin.ts`) reprennent les sections telles que
 *   la v8 les montrait : toutes épinglées, dans l'ordre du menu de la v8, qui n'était ni modifiable ni masquable.
 *   Rien n'est donc écrit dans `catalog/pages.json`, et les pages prêtes à l'emploi pourront encore évoluer (P5-03).
 * - Menu : sa position et son repli (`ui.menu`) ne bougent pas.
 * - Accueil : les barres de la mire, « Vos services » et « Reprendre » deviennent ses rangées (`ui.home.rows`).
 *   Les anciens réglages restent en place : l'interface historique les lit jusqu'à son retrait (P4-24).
 * Les réglages qui iront aux plugins ne bougent pas ici (P5-01). Les données d'usage (`usage.json`) sont rattachées
 * aux clés d'éléments par leur service (`src/main/usage/rules.ts`), hors de la configuration.
 */
import { formatTarget } from '@mire/shared';
import type { HomeRow } from '@mire/shared';
import { HOME_BARS } from '../defaults.ts';
import { isObjectLike, type Loose } from '../normalize/common.ts';
import type { Migration } from './types.ts';

/** Barre de la mire de la v8 → ce qu'elle ouvre en v9 : les Vidéos montraient les films et les séries. */
export const BAR_TARGETS: Readonly<Record<string, readonly string[]>> = {
  search: [formatTarget({ kind: 'screen', screen: 'search' })],
  videos: ['movies', 'series'],
  music: ['music'],
  images: ['images'],
  streaming: ['streaming'],
  tv: ['tv'],
  games: ['games'],
};

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);

/** Rangées de l'accueil d'après ses réglages de la v8, dans l'ordre où la v8 les affichait. */
export function homeRowsFromV8(home: Loose): HomeRow[] {
  const targets = [...new Set(strings(home.bars).flatMap((b) => BAR_TARGETS[b] ?? []))];
  const keys = [...new Set(strings(home.services).map((id) => `web:${id}`))];
  const rows: HomeRow[] = [];
  if (targets.length) rows.push({ kind: 'bars', targets });
  if (keys.length) rows.push({ kind: 'sites', keys });
  if (home.recent !== false) rows.push({ kind: 'recent' });
  return rows;
}

export const v9: Migration = {
  version: 9,
  up(raw) {
    // Sans accueil dans le fichier, la normalisation part des valeurs par défaut, comme la v8.
    if (!isObjectLike(raw.ui) || !isObjectLike(raw.ui.home) || Array.isArray(raw.ui.home.rows)) return;
    const home: Loose = { bars: HOME_BARS, ...raw.ui.home };
    // Comme la normalisation de la v8 : un service dont le site n'existe plus n'était pas affiché.
    if (Array.isArray(raw.web)) home.services = strings(home.services).filter((id) => raw.web.some((w: Loose) => w?.id === id));
    raw.ui.home.rows = homeRowsFromV8(home);
  },
};
