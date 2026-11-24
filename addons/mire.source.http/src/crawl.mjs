/**
 * Parcours des pages d'index d'un serveur web (reprise de `crawlHttp` du cœur de Mire, avant P5-12) : chaque page est
 * lue par `ctx.http`, ses liens gardés s'ils restent sous le dossier de départ (même origine, chemin en dessous) ; un
 * lien qui finit par `/` est un sous-dossier, les autres des fichiers.
 *
 * Mire n'accorde au plugin que l'adresse saisie par l'utilisateur (origine exacte, sous son chemin) : le parcours ne
 * demande rien d'autre.
 */

/** Pages d'index visitées au plus par emplacement (comme le cœur). */
export const MAX_PAGES = 400;
/** Délai d'une page (comme le cœur). */
export const PAGE_TIMEOUT = 15000;

/** Décodage d'un segment d'adresse, tel quel s'il est mal encodé. */
export function safeDecode(x) {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
}

const HREF = /href\s*=\s*(?:"([^"#?]+)"|'([^'#?]+)')/gi;

/** Liens d'une page d'index : sous-dossiers à visiter, fichiers de la page. */
export function linksOf(html, dirUrl, base) {
  const dirPath = new URL(dirUrl).pathname;
  const dirs = [];
  const files = [];
  for (const m of String(html).matchAll(HREF)) {
    let u;
    try {
      u = new URL(m[1] || m[2], dirUrl);
    } catch {
      continue;
    }
    if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) continue;
    if (u.pathname.endsWith('/')) {
      if (u.pathname.length > dirPath.length) dirs.push(u.href);
    } else files.push(u);
  }
  return { dirs, files };
}

/** Raison d'un échec de la première page (code de réponse, renvoi ailleurs, serveur injoignable). */
function reasonOf(err, t) {
  if (err?.status) return t('status', { status: String(err.status) });
  if (err?.code === 'refused') return t('elsewhere');
  return t('unreachable');
}

/**
 * Parcourt les pages sous `startUrl` ; `onDir(dirUrl, dirName, files)` reçoit les fichiers de chaque page. La première
 * page inaccessible lève une erreur au message affichable (la raison : Mire la montre dans l'état de la source, garde
 * l'analyse précédente et laisse le plugin actif) ; une page suivante inaccessible est passée.
 */
export async function crawl(http, startUrl, onDir, { t, maxPages = MAX_PAGES } = {}) {
  const base = new URL(startUrl.endsWith('/') ? startUrl : `${startUrl}/`);
  const queue = [base.href];
  const seen = new Set();
  let first = true;
  while (queue.length && seen.size < maxPages) {
    const dirUrl = queue.shift();
    if (seen.has(dirUrl)) continue;
    seen.add(dirUrl);
    let html;
    try {
      const res = await http.request(dirUrl, { timeout: PAGE_TIMEOUT });
      if (res.status < 200 || res.status > 299) throw Object.assign(new Error(`status ${res.status}`), { status: res.status });
      html = res.text;
    } catch (err) {
      if (first) throw new Error(reasonOf(err, t));
      continue;
    }
    first = false;
    const { dirs, files } = linksOf(html, dirUrl, base);
    queue.push(...dirs);
    const parts = new URL(dirUrl).pathname.split('/').filter(Boolean);
    await onDir(dirUrl, safeDecode(parts[parts.length - 1] || base.hostname), files);
  }
}
