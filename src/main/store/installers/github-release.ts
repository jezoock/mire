/**
 * Dernière version d'un dépôt GitHub, sans l'API (limitée à 60 appels par heure) : la page `releases/latest`
 * redirige vers l'étiquette, puis la liste des fichiers vient de la page `expanded_assets`.
 */
import * as http from '../../net/http.ts';

export interface ReleaseAsset {
  name: string;
  url: string;
}

export interface Release {
  tag: string;
  assets: ReleaseAsset[];
}

/** Étiquette lue dans l'adresse de redirection de `releases/latest` ; null si aucune version publiée. */
export function tagFromLocation(location: string): string | null {
  const m = /\/releases\/tag\/([^/?#]+)/.exec(location);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Fichiers d'une version, lus dans le HTML de la page `expanded_assets`. */
export function parseReleaseAssets(html: string, repo: string): ReleaseAsset[] {
  const prefix = `/${repo}/releases/download/`;
  return [...html.matchAll(/href="([^"]+)"/g)]
    .map((x) => x[1])
    .filter((h) => h.startsWith(prefix))
    .map((h) => ({ name: decodeURIComponent(h.split('/').pop() || ''), url: `https://github.com${h}` }));
}

export async function githubLatest(repo: string): Promise<Release> {
  const res = await http.request(`https://github.com/${repo}/releases/latest`, { redirect: 'manual', timeout: 20000 });
  const tag = tagFromLocation(res.headers.get('location') || '');
  if (!tag) throw new Error(`Aucune version publiée pour ${repo}.`);
  const html = await http.getText(`https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`, { timeout: 20000 });
  return { tag, assets: parseReleaseAssets(html, repo) };
}
