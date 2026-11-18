// Plugin d'essai du test de bout en bout (P3-04) : code limité qui lit le dossier que l'utilisateur lui a accordé
// (réglage « dossier »), se voit refuser un hôte non déclaré et un fichier hors du dossier, reçoit son réglage secret
// et range un compteur dans son stockage. Le journal dit ce qui a été permis ou refusé (jamais la valeur du secret).
const codeOf = (err) => err?.code ?? 'aucun';

export default async function fichiers(ctx) {
  ctx.log.info(`secret ${ctx.settings.get('cle') === 'CLE-E2E' ? 'reçu' : 'absent'}`);
  return {
    id: 'fichiers',
    async scan() {
      const dir = ctx.settings.get('dossier');
      const files = await ctx.files.walk(dir, { extensions: ['mkv', 'txt'] });
      const note = await ctx.files.readText(files.find((f) => f.path.endsWith('.txt')).path);
      ctx.log.info(`lu : ${note.trim()}`);
      await ctx.files.readText(`${dir}/../hors.txt`).then(
        () => ctx.log.warn('hors du dossier permis'),
        (err) => ctx.log.info(`hors du dossier : ${codeOf(err)}`),
      );
      await ctx.http.getText('https://evil.example.net/').then(
        () => ctx.log.warn('hôte non déclaré permis'),
        (err) => ctx.log.info(`hôte non déclaré : ${codeOf(err)}`),
      );
      await ctx.http.getText('https://api.exemple.invalid/').then(
        () => ctx.log.info('hôte déclaré : réponse'),
        (err) => ctx.log.info(`hôte déclaré : ${codeOf(err)}`),
      );
      const scans = ((await ctx.storage.get('scans')) ?? 0) + 1;
      await ctx.storage.set('scans', scans);
      return files
        .filter((f) => f.path.endsWith('.mkv'))
        .map((f) => ({
          key: f.path,
          name: `dossierplugin ${f.path.split(/[\\/]/).pop()}`,
          open: { kind: 'file', path: f.path },
          tags: [],
          infos: {},
          images: {},
        }));
    },
  };
}
