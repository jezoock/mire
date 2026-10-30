'use strict';

// Couleurs des vues web qui ne sont pas des sites enregistrés.
const ROM_COLOR = '#6E88F7';
const BOOKMARK_COLOR = '#9B6CF7';
const TV_COLOR = '#E23B3B';

// Entrée « Ajouter des jeux » d'une console : sites fournis par l'appelant (ils dépendent du scraper).
function romEntry(config, i, sites, siteIndex = 0) {
  if (!sites || !sites.length) return null;
  const name = i === 'pc' ? 'Jeux PC' : config.emulators?.[i]?.name;
  if (name == null) return null;
  const si = Math.max(0, Math.min(Number(siteIndex) || 0, sites.length - 1));
  return {
    id: `rom:${i}`,
    name: `Jeux : ${name}`,
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
function resolveWebEntry(id, config, opts = {}) {
  const s = String(id);
  if (s.startsWith('rom:')) {
    const raw = s.slice(4);
    const i = raw === 'pc' ? 'pc' : Number(raw);
    const entry = romEntry(config, i, opts.romSites ? opts.romSites(i) : [], opts.site);
    return entry ? { entry } : { error: 'Aucun site configuré pour cette console. Ajoutez-en dans « Modifier la console ».' };
  }
  if (s.startsWith('bm:')) {
    const bm = (config.bookmarks || []).find((b) => `bm:${b.id}` === s);
    if (!bm) return { error: 'Marque-page introuvable.' };
    return { entry: { id: s, name: bm.title || bm.site, url: bm.url, mode: 'integrated', color: BOOKMARK_COLOR, search: '' } };
  }
  if (s.startsWith('tv:')) {
    const svc = (config.tv?.services || []).find((t) => `tv:${t.id}` === s);
    if (!svc) return { error: 'Ce service de télévision n’existe plus dans la configuration.' };
    if (svc.kind !== 'web' || !svc.url) return { error: `${svc.name} n’est pas un portail web : ses chaînes s’affichent dans la page Télévision.` };
    return { entry: { id: s, name: svc.name, url: svc.url, mode: 'integrated', color: TV_COLOR, search: '' } };
  }
  const entry = (config.web || []).find((w) => w.id === s);
  return entry ? { entry } : { error: 'Ce site n’existe plus dans la configuration.' };
}

module.exports = { romEntry, resolveWebEntry, ROM_COLOR, BOOKMARK_COLOR, TV_COLOR };
