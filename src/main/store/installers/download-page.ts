/** Émulateur publié sur une page de téléchargement (Dolphin) : le lien est cherché dans le HTML de la page. */
import * as http from '../../net/http.ts';
import type { ResolvedSource } from './files.ts';

/** Premier lien du HTML qui correspond au motif ; la version est le dossier qui suit `releases/`. */
export function findDownloadLink(html: string, pattern: RegExp): ResolvedSource | null {
  const m = pattern.exec(html);
  if (!m) return null;
  const url = m[0];
  return { url, name: url.split('/').pop() || '', version: (/releases\/([^/]+)\//.exec(url) || [])[1] || '' };
}

export async function resolveFromPage(page: string, pattern: RegExp, name: string, site: string): Promise<ResolvedSource> {
  const html = await http.getText(page, { timeout: 20000 });
  const found = findDownloadLink(html, pattern);
  if (!found) throw new Error(`La page de téléchargement de ${name} a changé. Installez-le depuis ${site}.`);
  return found;
}
