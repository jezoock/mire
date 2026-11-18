/**
 * Worker d'un plugin de l'hôte isolé : reçoit son port une fois, puis le runtime répond par lui.
 *
 * Liste de retrait (ADR 0002), appliquée avant tout code de plugin, à revérifier à chaque montée d'Electron
 * (`spikes/hote-isole/main.mjs`) :
 * - `WebTransport` (QUIC), que ni la session, ni le proxy, ni `--disable-quic` n'arrêtent ;
 * - `Worker` et `SharedWorker`, qui ouvriraient un contexte neuf où tout reviendrait ;
 * - ce que les Workers d'un même hôte partagent, parce qu'ils ont la même origine (`mire-plugin://host`) : canal
 *   `BroadcastChannel`, `indexedDB`, `caches`, verrous (`navigator.locks`), `navigator.storage`. Sans eux, deux
 *   plugins d'un même hôte ne peuvent pas se parler en dehors du processus principal.
 */
import { adaptPort } from '../channel.ts';
import { startRuntime } from '../runtime.ts';

const scope = self as unknown as Record<string, unknown>;

/** Retire `name` de l'objet et de sa chaîne de prototypes (les accesseurs vivent sur les prototypes). */
function remove(target: object | null, name: string): void {
  for (let o = target; o; o = Object.getPrototypeOf(o)) {
    if (Object.hasOwn(o, name)) delete (o as Record<string, unknown>)[name];
  }
}

for (const name of ['WebTransport', 'Worker', 'SharedWorker', 'BroadcastChannel', 'indexedDB', 'caches']) remove(scope, name);
for (const name of ['locks', 'storage', 'storageBuckets']) remove(scope.navigator as object, name);

self.onmessage = (e: MessageEvent) => {
  if (e.data !== 'mire-host:port' || !e.ports[0]) return;
  self.onmessage = null;
  startRuntime(adaptPort(e.ports[0]), (url) => import(url));
};
