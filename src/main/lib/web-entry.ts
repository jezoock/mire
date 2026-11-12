import type { Config, LinkSite } from '@mire/shared';
import type { EntryResult, ResolveOptions, WebEntry } from '../web/types.ts';
import { t } from '../i18n/current.ts';

// Couleurs des vues web qui ne sont pas des sites enregistrés.
export const ROM_COLOR = '#6E88F7';
export const BOOKMARK_COLOR = '#9B6CF7';
export const TV_COLOR = '#E23B3B';

/** Ce que la résolution lit de la configuration (les tests passent une configuration partielle). */
export type WebEntryConfig = Partial<Pick<Config, 'emulators' | 'bookmarks' | 'web'>> & {
  tv?: { services?: Config['tv']['services'] };
};

// Entrée « Ajouter des jeux » d'une console (son identifiant, ou « pc ») : sites fournis par l'appelant
// (ils dépendent du scraper).
export function romEntry(config: WebEntryConfig, i: string, sites: readonly LinkSite[] | null | undefined, siteIndex: unknown = 0): WebEntry | null {
  if (!sites || !sites.length) return null;
  const name = i === 'pc' ? t('games.pcGames') : (config.emulators || []).find((e) => e.id === i)?.name;
  if (name == null) return null;
  const si = Math.max(0, Math.min(Number(siteIndex) || 0, sites.length - 1));
  return {
    id: `rom:${i}`,
    name: t('web.romSites', { console: name }),
    url: sites[si].url,
    search: sites[si].search || '',
    color: ROM_COLOR,
    mode: 'integrated',
    romConsole: i,
    romSite: si,
  };
}

// Identifiant de vue web → entrée à afficher : { entry } ou { error }.
// opts.romSites(i) donne les sites d'une console, opts.site le site choisi.
export function resolveWebEntry(id: unknown, config: WebEntryConfig, opts: ResolveOptions = {}): EntryResult {
  const s = String(id);
  if (s.startsWith('rom:')) {
    const i = s.slice(4);
    const entry = romEntry(config, i, opts.romSites ? opts.romSites(i) : [], opts.site);
    return entry ? { entry } : { error: t('web.errors.noRomSite') };
  }
  if (s.startsWith('bm:')) {
    const bm = (config.bookmarks || []).find((b) => `bm:${b.id}` === s);
    if (!bm) return { error: t('web.errors.bookmarkNotFound') };
    return { entry: { id: s, name: bm.title || bm.site, url: bm.url, mode: 'integrated', color: BOOKMARK_COLOR, search: '' } };
  }
  if (s.startsWith('tv:')) {
    const svc = (config.tv?.services || []).find((x) => `tv:${x.id}` === s);
    if (!svc) return { error: t('web.errors.tvServiceGone') };
    if (svc.kind !== 'web' || !svc.url) return { error: t('web.errors.tvNotWeb', { service: String(svc.name) }) };
    return { entry: { id: s, name: svc.name, url: svc.url, mode: 'integrated', color: TV_COLOR, search: '' } };
  }
  const entry = (config.web || []).find((w) => w.id === s);
  return entry ? { entry } : { error: t('web.errors.siteGone') };
}
