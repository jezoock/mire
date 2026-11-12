/**
 * « Mémoriser la recherche » : l'utilisateur cherche le mot « mire » sur le site, Mire relève l'adresse obtenue et
 * y remplace « mire » par {q} (fonctions pures).
 */
import type { Config, LinkSite } from '@mire/shared';
import type { WebEntry } from './types.ts';
import { t } from '../i18n/current.ts';

export type LearnResult = { ok: true; template: string } | { ok: false; error: string };

/** Modèle de recherche tiré de l'adresse d'une page de résultats pour « mire ». */
export function searchTemplate(url: string): LearnResult {
  let origin = '';
  try {
    origin = new URL(url).origin;
  } catch {
    return { ok: false, error: t('web.errors.unreadableUrl') };
  }
  const rest = url.slice(origin.length);
  const idx = rest.toLowerCase().indexOf('mire');
  if (idx < 0) {
    return { ok: false, error: t('web.errors.searchMireFirst') };
  }
  return { ok: true, template: origin + rest.slice(0, idx) + '{q}' + rest.slice(idx + 4) };
}

/**
 * Configuration avec le modèle enregistré : sur le site choisi de la console pour les sites de jeux (`sites` : la
 * liste actuelle de la console), sinon sur le site enregistré.
 */
export function withSearchTemplate(config: Config, entry: WebEntry, template: string, sites: LinkSite[] = []): Config {
  if (entry.romConsole != null) {
    const i = entry.romConsole;
    const next = sites.map((x, n) => (n === entry.romSite ? { ...x, search: template } : x));
    if (i === 'pc') return { ...config, pcSites: next };
    return { ...config, emulators: config.emulators.map((e) => (e.id === i ? { ...e, romSites: next } : e)) };
  }
  return { ...config, web: config.web.map((e) => (e.id === entry.id ? { ...e, search: template } : e)) };
}
