// Infos en ligne factices : la recherche passe par `ctx.http`, relayé au processus principal, qui répond par une
// fiche inventée (le prototype n'ouvre aucune connexion). Montre l'aller et retour plugin → cœur → plugin.

/** @typedef {import('@mire/plugin-sdk').Element} Element */

/** @type {import('@mire/plugin-sdk').ContributionFactory<'metadata'>} */
export default function creer(ctx) {
  /** @param {Element} item */
  const recherche = async (item) => {
    const url = `https://api.exemple.org/films?q=${encodeURIComponent(item.name)}`;
    return /** @type {{ titre: string, annee: string, resume: string } | null} */ (await ctx.http.getJson(url));
  };
  return {
    id: 'essai-infos',
    kinds: ['video'],
    group: 'videos',
    concurrency: 4,
    key: (item) => item.key,
    collect: () => [],
    async scrape(item) {
      const fiche = await recherche(item);
      if (!fiche) return null;
      return { title: fiche.titre, year: fiche.annee, overview: fiche.resume, image: null, source: 'essai-infos' };
    },
    async candidates(query) {
      return [{ id: '1', title: query.query, year: '', sub: '', image: null }];
    },
    byId: async () => undefined,
  };
}
