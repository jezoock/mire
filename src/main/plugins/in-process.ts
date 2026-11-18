/**
 * Plugins de niveau `privileged` (code sensible) : dans le processus principal (D-07, D-18), derrière la même API par
 * messages que l'hôte isolé. Le runtime du plugin et le canal du cœur sont reliés par une paire de ports : le cœur ne
 * l'appelle que par requêtes, et le plugin n'a que son contexte. Ce n'est pas un isolement (le code a Node) : seuls
 * les plugins inclus avec Mire y ont droit, tant que la signature des dépôts n'existe pas (P3-07, P3-08).
 *
 * Désactiver un tel plugin coupe ses ports ; son code reste chargé jusqu'au redémarrage (Node ne décharge pas un
 * module).
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { adaptPort, createChannel, type Channel } from './channel.ts';
import type { PluginEndpoint } from './host.ts';
import { startRuntime } from './runtime.ts';

type PortPair = { port1: Parameters<typeof adaptPort>[0]; port2: Parameters<typeof adaptPort>[0] };

/** Démarre le runtime d'un plugin dans ce processus ; `ports` : `new MessageChannelMain()` (Electron) ou de Node (tests). */
export function startInProcess(endpoint: PluginEndpoint, timeout: number, ports: () => PortPair): { channel: Channel; stop(): void } {
  const { port1, port2 } = ports();
  const runtime = startRuntime(adaptPort(port2), (url) => import(url));
  const channel = createChannel(adaptPort(port1), { handle: endpoint.handle, onEvent: (n, d) => n !== 'ready' && endpoint.onEvent(n, d), timeout });
  return {
    channel,
    stop() {
      channel.close();
      runtime.close();
    },
  };
}

/** Adresse du dossier d'un plugin pour `import()` (terminée par `/`). */
export const fileBase = (dir: string): string => pathToFileURL(dir + path.sep).href;
