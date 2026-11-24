/**
 * Sous-titres posés à côté d'une vidéo (contribution `subtitles`, id `sidecar`) : fichiers `.srt` et `.vtt` du dossier
 * de la vidéo dont le nom commence par celui de la vidéo (`Film.fr.srt` pour `Film.mkv`). Reprise de la recherche
 * locale de `src/main/library/subtitles.ts` de Mire (avant P5-11b).
 *
 * Mire prête le dossier de la vidéo au plugin pendant l'appel (permission `folders`), puis lit et convertit lui-même
 * les fichiers trouvés : le plugin ne rend que leur chemin, leur langue et leur libellé.
 */

const EXTENSIONS = ['srt', 'vtt'];
/** Fichiers de sous-titres lus au plus dans un dossier. */
const LIMIT = 10000;

/** Dossier et nom d'un chemin, avec les séparateurs de Windows (`C:\Films\Film.mkv`) comme ceux des autres systèmes. */
export function splitPath(p) {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  const dir = p.slice(0, i);
  // Fichier à la racine (`/Film.mkv`, `C:\Film.mkv`) : le dossier garde son séparateur.
  return { dir: /[\\/]/.test(dir) ? dir : p.slice(0, i + 1), name: p.slice(i + 1) };
}

/** Nom sans sa dernière extension (`Film.fr.srt` → `Film.fr`). */
export function stemOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Langue et libellé d'après ce qui suit le nom de la vidéo (`fr`, `forced.fr` → langue vide). */
export function describe(rest) {
  const lang = (rest.split(/[._\s-]/)[0] || '').toLowerCase();
  return { lang: /^[a-z]{2,3}$/.test(lang) ? lang : '', label: rest };
}

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export default function createSubtitles(ctx) {
  return {
    id: 'sidecar',
    async find(videoPath) {
      if (typeof videoPath !== 'string' || !videoPath) return [];
      const { dir, name } = splitPath(videoPath);
      const base = stemOf(name).toLowerCase();
      let entries;
      try {
        entries = await ctx.files.walk(dir, { extensions: EXTENSIONS, depth: 0, limit: LIMIT });
      } catch {
        // Dossier illisible : pas de sous-titres.
        return [];
      }
      const found = [];
      for (const e of [...entries].sort(byPath)) {
        const file = splitPath(e.path).name;
        if (!EXTENSIONS.includes(file.slice(file.lastIndexOf('.') + 1).toLowerCase())) continue;
        const stem = stemOf(file);
        if (!stem.toLowerCase().startsWith(base)) continue;
        const rest = stem.slice(base.length).replace(/^[._\-\s]+/, '');
        found.push({ path: e.path, ...describe(rest) });
      }
      return found;
    },
  };
}
