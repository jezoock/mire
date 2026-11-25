/** Catalogue de la boutique : uniquement des données (émulateurs encore dans le cœur et leur lecture ; RetroArch, DuckStation et les jeux libres viennent des plugins, P5-19a et P5-07). */
export type * from './types.ts';
export { EMULATORS, BUILTIN_EMULATOR_DATA } from './emulators.ts';
export { readEmulatorData, type EmulatorIdentity } from './read.ts';
