/* global fetch */
// Plugin d'essai du test de bout en bout : tag « date » et info « millesime » d'après l'année entre parenthèses.
export default async function annee(ctx) {
  // Le réseau est refusé à l'hôte isolé : la tentative doit échouer (le test lit le journal).
  try {
    await fetch('http://127.0.0.1:9/');
    ctx.log.warn('réseau permis');
  } catch {
    ctx.log.info('réseau refusé');
  }
  return {
    id: 'annee',
    compute(element) {
      const m = /\((\d{4})\)/.exec(element.name);
      return m ? { tags: ['date', 'non-declare'], infos: { millesime: `millesime${m[1]}` } } : null;
    },
  };
}
