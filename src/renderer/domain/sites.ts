/** Sites (de jeux, de streaming) et arguments de programme saisis dans des champs texte. */

/** Site décrit par un nom, une adresse et éventuellement une adresse de recherche (`{q}` : la recherche). */
export interface Site {
  name: string;
  url: string;
  search?: string;
}

const isHttp = (x: string): boolean => /^https?:\/\//i.test(x);

/** Sites en texte, un par ligne : « Nom | https://… | https://…?q={q} ». */
export const sitesToText = (list: Site[] | null | undefined): string =>
  (list || []).map((x) => [x.name, x.url, x.search].filter(Boolean).join(' | ')).join('\n');

/**
 * Lit les sites saisis, un par ligne, champs séparés par « | » dans n'importe quel ordre : l'adresse avec `{q}`
 * est celle de recherche, l'autre l'adresse du site ; sans nom, le site prend le nom de son serveur.
 * Les lignes sans adresse de site sont ignorées.
 */
export function parseSites(text: unknown): Site[] {
  return String(text || '')
    .split('\n')
    .map((line) => line.split('|').map((x) => x.trim()))
    .filter((p) => p.some(Boolean))
    .map((p) => {
      const url = p.find((x) => isHttp(x) && !x.includes('{q}')) || '';
      const search = p.find((x) => isHttp(x) && x.includes('{q}')) || '';
      const name = p.find((x) => x && !isHttp(x)) || (url ? new URL(url).hostname : '');
      return { name, url, search };
    })
    .filter((x) => x.url);
}

/** Adresse de recherche d'un site pour `q` ; chaîne vide si le site n'en a pas. */
export const searchUrlFor = (w: { search?: string | null }, q: string): string => (w.search ? w.search.split('{q}').join(encodeURIComponent(q)) : '');

/** Arguments d'un programme en texte ; ceux qui contiennent un espace sont mis entre guillemets. */
export const joinArgs = (args: string[] | null | undefined): string => (args || []).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');

/** Lit des arguments saisis : séparés par des espaces, un texte entre guillemets forme un seul argument. */
export const parseArgs = (txt: unknown): string[] => [...String(txt).matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] != null ? m[1] : m[2]));
