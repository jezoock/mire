/**
 * Hôte de plugins (P3-03) : point d'entrée pour la racine de composition. Les modules : découverte et vérification
 * (`discovery.ts`), état (`state.ts`), journal (`journal.ts`), registre des contributions (`registry.ts`), tags
 * automatiques (`taggers.ts`), canal (`channel.ts`) et runtime (`runtime.ts`) d'un plugin, hôte isolé (`host.ts`,
 * page et Worker dans `host/`), plugins sensibles (`in-process.ts`), protocole `mire-plugin://` (`protocol.ts`).
 */
import { MessageChannelMain } from 'electron';
import { createIsolatedHost } from './host.ts';
import { fileBase, startInProcess } from './in-process.ts';
import { PLUGIN_SCHEME } from './protocol.ts';
import type { RunnerEvents, Runners } from './service.ts';

export { createPluginService, type PluginInfo, type PluginService } from './service.ts';
export { createPluginState } from './state.ts';
export { createJournal } from './journal.ts';
export { PLUGIN_SCHEME_PRIVILEGES } from './protocol.ts';

/**
 * Runners d'Electron : un hôte isolé pour les plugins installés (un par dépôt tiers viendra avec P3-08), démarré à la
 * première demande et arrêté quand il n'a plus de plugin ; le processus principal pour les plugins inclus `privileged`.
 */
export function electronRunners(hostDir: string): (events: RunnerEvents) => Runners {
  return (events) => {
    const host = createIsolatedHost({
      group: 'installed',
      hostDir,
      onGone: (reason, plugins) => events.hostGone(plugins, reason),
      onWorkerError: (id, message) => events.workerError(id, message),
    });
    return {
      async isolated(p, endpoint, timeout) {
        const channel = await host.start(p.id, p.dir, endpoint, timeout);
        return { channel, stop: () => host.stop(p.id) };
      },
      async inProcess(_p, endpoint, timeout) {
        return startInProcess(endpoint, timeout, () => new MessageChannelMain());
      },
      base: (p) => (p.manifest.level === 'privileged' ? fileBase(p.dir) : `${PLUGIN_SCHEME}://${p.id}/`),
      shutdown: () => host.shutdown(),
    };
  };
}
