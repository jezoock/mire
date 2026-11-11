/** Détection de la box : repère le service de télé en place en joignant brièvement chaque box sur le réseau local. */
import type { TvService } from '@mire/shared';
import type { TvHttp } from './types.ts';

/** Identifiant du premier service dont la box répond, ou chaîne vide. */
export async function detectTvService(services: readonly TvService[], http: Pick<TvHttp, 'request'>, timeout = 1500): Promise<string> {
  for (const svc of services) {
    if (!svc.detect) continue;
    try {
      await http.request(svc.detect, { timeout });
      return svc.id; // la box a répondu : ce service est disponible
    } catch {
      /* box absente, on essaie la suivante */
    }
  }
  return '';
}
