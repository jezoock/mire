// Plugin d'essai du test de fumée (P5-16) : un fournisseur d'infos de jeux PC qui ne trouve jamais rien, sans réseau.
// Avec celui des albums, la liste des fournisseurs des réglages en a deux à réordonner.
export default function jeux() {
  return {
    id: 'jeux',
    kinds: ['pc'],
    group: 'games',
    concurrency: 1,
    key: (game) => `g:${game?.name ?? ''}`,
    collect: () => [],
    scrape: async () => null,
    byId: async () => undefined,
    candidates: async () => [],
  };
}
