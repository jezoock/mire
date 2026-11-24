// Scénario de caractérisation commun : quelques éléments types (film, épisode de série, album, ROM, jeu PC),
// récupérés une première fois par l'ancien scraper (src/main/scraper.js, avant P1-16) pour produire
// test/fixtures/scrape/golden.json, puis par le moteur pour vérifier que les fiches sont les mêmes. Films et séries
// (TMDB) : plugin mire.tmdb depuis P5-15, testé dans mire-addons ; leurs entrées ont quitté le scénario.

export const config = {
  search: { language: 'fr-FR' },
  games: [
    { name: 'Hades', path: 'C:/Jeux/Hades/Hades.exe' },
    { name: 'HADES', path: 'D:/Autre/Hades.exe' },
    { name: 'Portal 2', path: 'steam://rungameid/620' },
  ],
  emulators: [
    { id: 'snes', name: 'Snes9x', path: 'C:/Emu/snes9x.exe', extensions: ['.sfc'], sources: [] },
    { id: 'inconnue', name: 'Ma console', path: 'C:/Emu/truc.exe', extensions: ['.xyz'], sources: [] },
  ],
};

export const roms = [
  { path: '/r/Super Mario World (Europe).sfc', name: 'Super Mario World (Europe)', displayName: 'Super Mario World', dir: '/r', image: null, remote: false },
  { path: '/r/Jeu Introuvable.sfc', name: 'Jeu Introuvable', displayName: 'Jeu Introuvable', dir: '/r', image: null, remote: false },
];

export const listRoms = async (id: string) => (id === 'snes' ? { ok: true, roms, errors: [] } : { ok: false, error: 'non' });

export const albums = [
  { dir: '/m/Daft Punk - Discovery (2001)', folder: 'Daft Punk - Discovery (2001)' },
  { dir: '/m/Inconnu', folder: 'Inconnu' },
];

/** Récupérations à la demande (`one`), faites après `run`. */
export const ones = [
  {
    kind: 'album',
    item: { dir: '/m/Choix', folder: 'Choix' },
    override: { pick: { id: 'rg-discovery', title: 'Discovery', sub: 'Daft Punk, Album', year: '2001' } },
  },
  { kind: 'rom', item: { path: '/r/smw.sfc', name: 'smw', displayName: 'smw', emu: 'snes' }, override: { pick: { id: 'Super Mario World (USA)' } } },
  { kind: 'rom', item: { path: 'https://exemple.fr/Super Mario World (Europe).zip', name: 'Super Mario World (Europe)', emu: 'snes' }, key: 'b:marque-page-1' },
  { kind: 'rom', item: { path: '/r/x.xyz', name: 'x', emu: 'inconnue' } },
  { kind: 'pc', item: { name: 'Hades', path: 'https://exemple.fr/hades' }, key: 'b:marque-page-2' },
  { kind: 'pc', item: { name: 'Mon jeu', path: 'C:/Jeux/mon.exe' }, override: { pick: { id: '1145360', title: 'Hades' } } },
];

/** Recherches de fiches (`candidates`). */
export const searches = [
  { kind: 'video', item: { name: 'Film' }, query: '  ' },
  { kind: 'album', item: {}, query: 'Discovery', artist: 'Daft Punk' },
  { kind: 'pc', item: {}, query: 'Hades' },
  { kind: 'rom', item: { emu: 'snes' }, query: 'super mario world' },
  { kind: 'rom', item: { emu: 'inconnue' }, query: 'x' },
  { kind: 'livre', item: {}, query: 'x' },
];
