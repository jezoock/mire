// Tag automatique factice : quelques expressions sur le nom, comme le ferait un vrai tag automatique.
// Chargé tel quel dans les deux prototypes (A : `mire-plugin://`, B : `file://` dans un utilityProcess).

const ANNEE = /\b(19\d{2}|20\d{2})\b/;
const HD = /\b(720p|1080p|2160p|4k)\b/i;

/** @type {import('@mire/plugin-sdk').ContributionFactory<'taggers'>} */
export default function creer() {
  return {
    id: 'essai-tags',
    compute(element) {
      const annee = ANNEE.exec(element.name);
      /** @type {import('@mire/plugin-sdk').TaggerResult} */
      const resultat = { tags: ['essai', HD.test(element.name) ? 'hd' : 'sd'] };
      if (annee) resultat.infos = { annee: Number(annee[1]) };
      return resultat;
    },
  };
}
