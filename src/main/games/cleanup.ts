/** Nettoyage des jeux : vérifie que chaque jeu existe encore (fichier local présent, adresse en ligne joignable). */
import fs from 'node:fs';
import type { Game } from '@mire/shared';
import type { CleanupReport } from '@mire/shared/ipc';
import * as http from '../net/http.ts';
import { consoleLocations } from './roms/list.ts';
import type { GamesDeps } from './types.ts';

export interface CleanupDeps extends Pick<GamesDeps, 'config'> {
  /** Vérification d'une adresse (requête HEAD) ; injectable pour les tests. */
  head?: (url: string) => Promise<{ ok: boolean }>;
}

const defaultHead = (url: string) => http.head(url, { timeout: 6000 });

export async function cleanupGames({ config: service, head = defaultHead }: CleanupDeps, online?: boolean) {
  const config = service.get();
  const result: CleanupReport = { missingLocal: [], missingRemote: [], removedManual: 0, checked: 0 };
  const nextGames: Game[] = [];
  for (const g of config.games) {
    result.checked++;
    if (/^[a-z]+:\/\//i.test(g.path) || fs.existsSync(g.path)) nextGames.push(g);
    else {
      result.removedManual++;
      result.missingLocal.push(g.name as string);
    }
  }
  if (online) {
    for (const emu of config.emulators) {
      for (const p of consoleLocations(emu).filter((x) => x.remote)) {
        try {
          const res = await head(p.location);
          if (!res.ok) result.missingRemote.push(`${emu.name} : ${p.location}`);
        } catch {
          result.missingRemote.push(`${emu.name} : ${p.location}`);
        }
        result.checked++;
      }
    }
  }
  if (result.removedManual) {
    result.config = service.update((c) => ({ ...c, games: nextGames }));
  }
  return { ok: true as const, ...result };
}
