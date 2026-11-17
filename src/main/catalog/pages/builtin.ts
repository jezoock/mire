/**
 * Les sept pages prêtes à l'emploi (architecture cible, « Pages, regroupements et listes »), en données intégrées.
 * Elles deviendront un plugin inclus (P5-03). L'utilisateur peut les modifier ou les supprimer (`pages.json`).
 */
import type { PageDefinition } from '@mire/shared';

export const BUILTIN_PAGES: readonly PageDefinition[] = [
  {
    id: 'movies',
    name: { key: 'pages.movies' },
    icon: 'movie',
    require: ['video', 'movie'],
    groupBy: ['genres'],
    sort: [{ by: 'title' }, { by: 'year' }],
    display: 'posters',
    menu: { pinned: true, order: 1 },
  },
  {
    id: 'series',
    name: { key: 'pages.series' },
    icon: 'tv',
    require: ['video', 'series'],
    groupBy: ['series', 'season'],
    sort: [{ by: 'episode' }],
    display: 'posters',
    menu: { pinned: true, order: 2 },
  },
  {
    id: 'music',
    name: { key: 'pages.music' },
    icon: 'music',
    require: ['audio'],
    groupBy: ['artist', 'album'],
    sort: [{ by: 'track' }],
    display: 'list',
    menu: { pinned: true, order: 3 },
  },
  {
    id: 'images',
    name: { key: 'pages.images' },
    icon: 'image',
    require: ['image'],
    groupBy: ['folder'],
    display: 'thumbnails',
    menu: { pinned: true, order: 4 },
  },
  {
    id: 'streaming',
    name: { key: 'pages.streaming' },
    icon: 'stream',
    require: ['stream'],
    groupBy: ['category'],
    display: 'thumbnails',
    menu: { pinned: true, order: 5 },
  },
  {
    id: 'tv',
    name: { key: 'pages.tv' },
    icon: 'antenna',
    require: ['tv'],
    sort: [{ by: 'channel' }],
    display: 'list',
    menu: { pinned: true, order: 6 },
  },
  {
    id: 'games',
    name: { key: 'pages.games' },
    icon: 'game',
    require: ['game'],
    groupBy: ['system'],
    display: 'posters',
    menu: { pinned: true, order: 7 },
  },
];
