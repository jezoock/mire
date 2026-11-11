/**
 * Jeux PC trouvés dans les dossiers de jeux : un jeu par raccourci ou exécutable posé dans le dossier, ou par
 * sous-dossier (on y choisit le bon exécutable, en écartant les utilitaires : désinstalleur, redistribuables…).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { similarity } from '@mire/shared';
import type { GameSource } from '@mire/shared';
import { walkDirs } from '../../fs/walk.ts';
import { locationError, resolveLocation } from '../../library/location.ts';
import type { GameSourceProvider, PcGame, SourceStatus } from '../types.ts';

/** Utilitaires livrés avec les jeux, jamais proposés comme jeu. */
export const JUNK_EXE =
  /unins|setup|install|crash|report|redist|vcredist|vc_redist|dxsetup|directx|dotnet|update|patch|helper|prereq|easyanticheat|battleye|cleanup|config|launcherhelper|cefprocess|webhelper|unitycrash/i;

/** Sous-dossiers d'un jeu qui ne contiennent pas son exécutable. */
const SKIP_DIRS = /^(redist|_commonredist|directx|support|tools|engine)$/i;

/** Fichiers qui lancent un jeu, selon le système. */
export function gameFileExtensions(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'win32') return ['.exe', '.lnk', '.url', '.bat'];
  if (platform === 'darwin') return ['.app'];
  return ['.desktop', '.sh', '.appimage', '.x86_64'];
}

const SHORTCUTS = ['.lnk', '.url', '.desktop'];

/**
 * Exécutable principal d'un dossier de jeu (trois niveaux au plus) : nom proche de celui du dossier d'abord, puis
 * le plus gros, puis le moins profond. Les raccourcis et les utilitaires sont écartés.
 */
export async function bestExecutable(dir: string, folderName: string, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  const exts = gameFileExtensions(platform);
  const found: Array<{ full: string; score: number }> = [];
  await walkDirs(
    dir,
    async (d, entries, level) => {
      for (const e of entries) {
        if (e.isDirectory()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!exts.includes(ext) || SHORTCUTS.includes(ext) || JUNK_EXE.test(e.name)) continue;
        const full = path.join(d, e.name);
        let size = 0;
        try {
          size = (await fsp.stat(full)).size;
        } catch {
          /* taille inconnue */
        }
        found.push({ full, score: similarity(path.basename(e.name, ext), folderName) * 1e12 + size - level * 1e6 });
      }
    },
    { maxDepth: 2, skipDir: (name) => SKIP_DIRS.test(name) },
  );
  found.sort((a, b) => b.score - a.score);
  return found[0]?.full || null;
}

/** Fournisseur des dossiers locaux et partages réseau. */
export function localPcProvider(platform: NodeJS.Platform = process.platform): GameSourceProvider {
  const exts = gameFileExtensions(platform);
  return {
    id: 'local',
    canHandle: (loc) => loc.type === 'path',
    async scan(loc, source) {
      if (loc.type !== 'path') return [];
      const entries = await fsp.readdir(loc.path, { withFileTypes: true });
      const games: PcGame[] = [];
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(loc.path, e.name);
        const ext = path.extname(e.name).toLowerCase();
        if (platform === 'darwin' && ext === '.app') {
          games.push({ name: path.basename(e.name, ext), path: full, source: source.id });
          continue;
        }
        if (e.isFile() && exts.includes(ext) && !JUNK_EXE.test(e.name)) {
          games.push({ name: path.basename(e.name, ext).replace(/[._]+/g, ' ').trim(), path: full, source: source.id });
        } else if (e.isDirectory()) {
          const exe = await bestExecutable(full, e.name, platform);
          if (exe) games.push({ name: e.name, path: exe, source: source.id });
        }
      }
      return games;
    },
  };
}

/** Analyse de tous les dossiers de jeux PC : jeux triés par nom, et état de chaque dossier. */
export async function scanGameSources(
  sources: GameSource[],
  providers: GameSourceProvider[] = [localPcProvider()],
): Promise<{ games: PcGame[]; status: Record<string, SourceStatus> }> {
  const games: PcGame[] = [];
  const status: Record<string, SourceStatus> = {};
  for (const src of sources) {
    const loc = resolveLocation(src.location);
    const provider = providers.find((p) => p.canHandle(loc));
    if (!provider) {
      status[src.id] = { ok: false, error: 'Les jeux PC doivent se trouver sur un disque ou un partage réseau.', count: 0 };
      continue;
    }
    try {
      const found = await provider.scan(loc, src);
      games.push(...found);
      status[src.id] = { ok: true, error: null, count: found.length };
    } catch {
      status[src.id] = { ok: false, error: locationError(src.location, loc as { network?: boolean }), count: 0 };
    }
  }
  games.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));
  return { games, status };
}
