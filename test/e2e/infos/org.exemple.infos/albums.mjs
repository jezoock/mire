// Plugin d'essai du test de fumée (P5-16) : un fournisseur d'infos d'albums qui ne trouve jamais rien, sans réseau. Il
// donne un second fournisseur à la liste des réglages depuis que MusicBrainz et Steam sont des plugins à installer.
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
