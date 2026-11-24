/**
 * Parcours des pages d'index d'un serveur web (Apache, nginx, NAS…), sans sortir du dossier de départ. Il servait la
 * bibliothèque jusqu'à P5-12 (devenue le plugin `mire.source.http`) ; il sert encore aux sources en ligne d'une console
 * (`games/roms/list.ts`, jusqu'à P5-14b).
 */
import { safeDecode } from '@mire/shared';
import * as http from './http.ts';
import { t } from '../i18n/current.ts';

// Raison affichée quand la première page d'index ne se charge pas.
function crawlError(err: { kind?: string; status?: number; message: string }): string {
  if (err.kind === 'timeout') return t('library.errors.crawlTimeout');
  if (err.kind === 'unreachable') return t('library.errors.crawlUnreachable');
  if (err.kind === 'status') return t('library.errors.crawlStatus', { status: String(err.status) });
  return err.message;
}

export type CrawlVisitor = (dirUrl: string, dirName: string, files: URL[]) => void | Promise<void>;

/** Parcourt les pages d'index sans sortir du dossier de départ ; `onDir` reçoit les fichiers de chaque page. */
export async function crawlHttp(startUrl: string, onDir: CrawlVisitor, maxDirs = 400): Promise<void> {
  const base = new URL(startUrl.endsWith('/') ? startUrl : `${startUrl}/`);
  const queue = [base.href];
  const seen = new Set<string>();
  let first = true;
  while (queue.length && seen.size < maxDirs) {
    const dirUrl = queue.shift() as string;
    if (seen.has(dirUrl)) continue;
    seen.add(dirUrl);
    let html: string;
    try {
      html = await http.getText(dirUrl, { timeout: 15000 });
    } catch (err) {
      if (first) throw new Error(t('library.errors.addressUnavailable', { reason: crawlError(err as Error) }));
      continue;
    }
    first = false;
    const files: URL[] = [];
    const dirPath = new URL(dirUrl).pathname;
    for (const m of html.matchAll(/href\s*=\s*(?:"([^"#?]+)"|'([^'#?]+)')/gi)) {
      let u: URL;
      try {
        u = new URL(m[1] || m[2], dirUrl);
      } catch {
        continue;
      }
      if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) continue;
      if (u.pathname.endsWith('/')) {
        if (u.pathname.length > dirPath.length) queue.push(u.href);
        continue;
      }
      files.push(u);
    }
    const parts = dirPath.split('/').filter(Boolean);
    await onDir(dirUrl, safeDecode(parts[parts.length - 1] || base.hostname), files);
  }
}
