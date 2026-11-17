// Aides de focus de dot-stash : le module n'est pas exporté par l'entrée du paquet, mais son chemin l'est
// (`dot-stash/dist/*`) ; ses types sont publiés à part, dans `dist/types/`.
declare module 'dot-stash/dist/collection/utils/focus.js' {
  export * from 'dot-stash/dist/types/utils/focus.js';
}
