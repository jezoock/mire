// Plugin d'essai du test de fumée (P5-16) : un fournisseur d'infos d'albums qui ne trouve jamais rien, sans réseau.
// Les fournisseurs d'infos sont tous des plugins à installer : sans lui, la liste des réglages serait vide.
export default function albums() {
  return {
    id: 'albums',
    kinds: ['album'],
    group: 'music',
    concurrency: 1,
    key: (album) => `a:${album?.dir ?? ''}`,
    collect: () => [],
    scrape: async () => null,
    byId: async () => undefined,
    candidates: async () => [],
  };
}
