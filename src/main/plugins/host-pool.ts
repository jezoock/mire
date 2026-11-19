/**
 * Hôtes isolés par groupe (architecture cible, « L'hôte isolé » ; P3-08) : un hôte pour les plugins inclus, du dépôt
 * officiel ou installés à la main, et un par dépôt tiers. Chaque hôte a sa page, son processus et sa session en
 * mémoire : un plugin tiers ne peut pas gêner les plugins des autres dépôts (plantage, mémoire, stockage du navigateur).
 *
 * Sans Electron : la fabrique d'hôte est fournie (`host.ts` dans Mire, un faux dans les tests).
 */
import type { Channel } from './channel.ts';
import type { PluginEndpoint } from './host.ts';
import { OFFICIAL_REPOSITORY_ID } from './discovery.ts';

/** Groupe de l'hôte des plugins inclus, officiels ou installés à la main. */
export const MAIN_GROUP = 'installed';

/** Ce que le groupe utilise d'un hôte isolé (`createIsolatedHost`). */
export interface PooledHost {
  start(pluginId: string, dir: string, endpoint: PluginEndpoint, timeout: number): Promise<Channel>;
  stop(pluginId: string): void;
  shutdown(): void;
  plugins(): string[];
}

/** Groupe d'un plugin d'après le dépôt noté par Mire (`origin.json`) : `repo-<…>` pour un dépôt tiers. */
export function hostGroup(p: { origin: 'bundled' | 'installed'; repository: string | null }): string {
  if (p.origin === 'bundled' || !p.repository || p.repository === OFFICIAL_REPOSITORY_ID) return MAIN_GROUP;
  return `repo-${p.repository.replace(/^repo-/, '')}`;
}

export function createHostPool(create: (group: string) => PooledHost) {
  const hosts = new Map<string, PooledHost>();
  /** Groupe de chaque plugin démarré, pour l'arrêter dans le bon hôte. */
  const groupOf = new Map<string, string>();

  return {
    async start(
      p: { id: string; dir: string; origin: 'bundled' | 'installed'; repository: string | null },
      endpoint: PluginEndpoint,
      timeout: number,
    ): Promise<Channel> {
      const group = hostGroup(p);
      let host = hosts.get(group);
      if (!host) hosts.set(group, (host = create(group)));
      groupOf.set(p.id, group);
      return host.start(p.id, p.dir, endpoint, timeout);
    },

    stop(pluginId: string): void {
      const group = groupOf.get(pluginId);
      groupOf.delete(pluginId);
      if (group) hosts.get(group)?.stop(pluginId);
    },

    shutdown(): void {
      for (const h of hosts.values()) h.shutdown();
      groupOf.clear();
    },

    /** Groupes et leurs plugins démarrés (mesures, tests). */
    groups: (): Record<string, string[]> => Object.fromEntries([...hosts].map(([g, h]) => [g, h.plugins()])),
  };
}
