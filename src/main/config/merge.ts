/** Import « compléter » : ajoute au présent ce qui vient du fichier, sans doublon ni perte de l'existant. */
import type { Config } from '@mire/shared';
import { isObjectLike, type Loose } from './normalize/common.ts';

export function mergeConfig(current: Config, incoming: unknown): Config {
  const out = structuredClone(current);
  const inc: Loose = isObjectLike(incoming) ? incoming : {};
  const byKey = <T>(arr: T[] | undefined, key: (x: T) => unknown) => new Set((arr || []).map(key));
  // Sites de streaming (par id).
  if (Array.isArray(inc.web)) {
    const have = byKey(out.web, (w) => w.id);
    for (const w of inc.web) if (w && w.id && !have.has(w.id)) out.web.push(w);
  }
  // Consoles et jeux PC (par chemin), sources de la bibliothèque et dossiers de jeux (par emplacement).
  if (Array.isArray(inc.emulators)) {
    const have = byKey(out.emulators, (e) => e.path);
    for (const e of inc.emulators) if (e && e.path && !have.has(e.path)) out.emulators.push(e);
  }
  if (Array.isArray(inc.games)) {
    const have = byKey(out.games, (g) => g.path);
    for (const g of inc.games) if (g && g.path && !have.has(g.path)) out.games.push(g);
  }
  if (inc.library && Array.isArray(inc.library.sources)) {
    const have = byKey(out.library.sources, (x) => `${x.kind}:${x.location}`);
    for (const x of inc.library.sources) if (x && x.location && !have.has(`${x.kind}:${x.location}`)) out.library.sources.push(x);
  }
  if (Array.isArray(inc.gameSources)) {
    const have = byKey(out.gameSources, (x) => x.location);
    for (const x of inc.gameSources) if (x && x.location && !have.has(x.location)) out.gameSources.push(x);
  }
  if (inc.tv && Array.isArray(inc.tv.services)) {
    const have = byKey(out.tv.services, (t) => t.id);
    for (const t of inc.tv.services) if (t && t.id && !have.has(t.id)) out.tv.services.push(t);
  }
  return out;
}
