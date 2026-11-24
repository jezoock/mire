// Scénario de caractérisation commun : quelques éléments types (ROM, marque-page de jeu),
// récupérés une première fois par l'ancien scraper (src/main/scraper.js, avant P1-16) pour produire
// test/fixtures/scrape/golden.json, puis par le moteur pour vérifier que les fiches sont les mêmes. Films et séries
// (TMDB) : plugin mire.tmdb depuis P5-15 ; albums (MusicBrainz) et jeux PC (Steam) : plugins mire.musicbrainz et
// mire.steam depuis P5-16. Ces plugins sont testés dans mire-addons ; leurs entrées ont quitté le scénario.

export const config = {
  search: {},
  games: [],
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

/** Récupérations à la demande (`one`), faites après `run`. */
export const ones = [
  { kind: 'rom', item: { path: '/r/smw.sfc', name: 'smw', displayName: 'smw', emu: 'snes' }, override: { pick: { id: 'Super Mario World (USA)' } } },
  { kind: 'rom', item: { path: 'https://exemple.fr/Super Mario World (Europe).zip', name: 'Super Mario World (Europe)', emu: 'snes' }, key: 'b:marque-page-1' },
  { kind: 'rom', item: { path: '/r/x.xyz', name: 'x', emu: 'inconnue' } },
];

/** Recherches de fiches (`candidates`). */
export const searches = [
  { kind: 'video', item: { name: 'Film' }, query: '  ' },
  { kind: 'rom', item: { emu: 'snes' }, query: 'super mario world' },
  { kind: 'rom', item: { emu: 'inconnue' }, query: 'x' },
  { kind: 'livre', item: {}, query: 'x' },
];
