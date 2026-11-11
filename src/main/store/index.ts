/**
 * Boutique de Mire : installe des émulateurs depuis leurs sources officielles,
 * télécharge des jeux homebrew distribués librement par leurs auteurs,
 * et range vos propres copies de jeux dans le bon dossier.
 *
 * Aucun jeu du commerce n'est proposé : pour ceux-là, utilisez vos propres copies (« Importer »).
 * Le catalogue (`catalog/`) ne contient que des données ; les installateurs (`installers/`) sont le code.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJsonStore } from '../storage/json-store.ts';
import { dataPaths } from '../storage/paths.ts';
import { biosDir as locateBios } from './bios.ts';
import { BIOS_HINTS, EMULATORS, FREE_GAMES, RETROARCH_SYSTEMS, type StorePlatform } from './catalog/index.ts';
import { registerConsoles, removeConsoles } from './consoles.ts';
import { download, type InstallContext } from './installers/files.ts';
import { installRetroArch } from './installers/retroarch.ts';
import { installStandalone } from './installers/standalone.ts';

export { EMULATORS, FREE_GAMES, RETROARCH_SYSTEMS } from './catalog/index.ts';
export { githubLatest } from './installers/github-release.ts';

const PLATFORM: StorePlatform = process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : 'other';

export interface StoreOptions {
  dataDir: string;
  defaultRomsRoot: string;
  getConfig: () => any;
  saveConfig: (cfg: any) => unknown;
  onProgress: (p: Record<string, unknown>) => void;
  /** Décompression (service d'archives). */
  extract: (archive: string, dest: string) => Promise<void>;
  /** Dossiers de l'utilisateur, pour trouver les BIOS. */
  paths?: { home?: string; documents?: string; appData?: string };
}

export function createStore({ dataDir, defaultRomsRoot, getConfig, saveConfig, onProgress, extract, paths = {} }: StoreOptions) {
  const dataFiles = dataPaths(dataDir);
  const emuRoot = dataFiles.emulatorsDir;
  const tmpRoot = path.join(os.tmpdir(), 'mire-store');
  // Fichier absent ou illisible : rien d'installé.
  const metaStore = createJsonStore<Record<string, any>>(dataFiles.emulatorsInstalled, { defaults: {}, space: 2 });
  const meta = metaStore.load();
  const saveMeta = async () => metaStore.save();
  const busy = new Set<string>();

  const romsRoot = (): string => getConfig().store?.romsRoot || defaultRomsRoot;

  function progress(id: string, phase: string, extra: Record<string, unknown> = {}) {
    onProgress({ id, phase, ...extra });
  }

  const ctx: InstallContext = {
    platform: PLATFORM === 'win32' ? 'win32' : 'linux',
    emuRoot,
    tmpRoot,
    meta,
    extract,
    progress,
    registerConsoles: (emu, systems, exePath, argsFor) => registerConsoles({ getConfig, saveConfig, romsRoot }, emu, systems, exePath, argsFor),
  };

  async function install(id: string, systemIds: string[] = []) {
    const emu = EMULATORS.find((e) => e.id === id);
    if (!emu) return { ok: false, error: 'Émulateur inconnu.' };
    if (PLATFORM === 'other')
      return { ok: false, error: 'La boutique installe les émulateurs sous Windows et Linux. Sur ce système, installez-les depuis leur site.' };
    if (busy.has(id)) return { ok: false, error: 'Installation déjà en cours.' };
    busy.add(id);
    try {
      if (emu.retroarch) {
        if (!systemIds.length) throw new Error('Choisissez au moins une console.');
        await installRetroArch(ctx, emu, systemIds);
      } else {
        await installStandalone(ctx, emu);
      }
      await saveMeta();
      progress(id, 'done');
      return { ok: true, config: getConfig() };
    } catch (err) {
      const message = (err as Error).message;
      progress(id, 'error', { message });
      return { ok: false, error: message };
    } finally {
      busy.delete(id);
    }
  }

  async function uninstall(id: string) {
    const cfg = getConfig();
    saveConfig({ ...cfg, emulators: removeConsoles(cfg.emulators, id) });
    await fsp.rm(path.join(emuRoot, id), { recursive: true, force: true }).catch(() => {});
    delete meta[id];
    await saveMeta();
    return { ok: true, config: getConfig() };
  }

  /* ---------- BIOS : dossier où chaque émulateur les cherche ---------- */

  function biosDir(id: string): string | null {
    return locateBios(id, { platform: PLATFORM, emuRoot, exe: meta[id]?.exe, paths });
  }

  function biosInfo(id: string) {
    const dir = biosDir(id);
    if (!dir || !BIOS_HINTS[id]) return null;
    let files: string[] = [];
    try {
      files = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort()
        .slice(0, 30);
    } catch {
      /* dossier pas encore créé */
    }
    return { dir, hint: BIOS_HINTS[id], files };
  }

  // Copie les fichiers choisis dans le dossier des BIOS de l'émulateur.
  async function addBios(id: string, files: string[]) {
    const dir = biosDir(id);
    if (!dir) return { ok: false, error: 'Cet émulateur n’utilise pas de BIOS.' };
    await fsp.mkdir(dir, { recursive: true });
    const copied: string[] = [];
    for (const f of files || []) {
      await fsp.copyFile(f, path.join(dir, path.basename(f)));
      copied.push(path.basename(f));
    }
    return { ok: true, copied, bios: biosInfo(id) };
  }

  // Console de la boutique qui accueille les jeux d'un système (`<émulateur>:<système>`).
  const consoleFor = (system: string) => getConfig().emulators.find((e: any) => String(e.store || '').endsWith(`:${system}`));

  function catalog() {
    const cfg = getConfig();
    const installedStore = new Set(cfg.emulators.map((e: any) => e.store).filter(Boolean));
    return {
      platform: PLATFORM,
      romsRoot: romsRoot(),
      emulators: EMULATORS.map((e) => {
        const m = meta[e.id];
        return {
          id: e.id,
          name: e.name,
          desc: e.desc,
          site: e.site,
          retroarch: !!e.retroarch,
          available: PLATFORM !== 'other' && (!!e.retroarch || !!e.source?.[PLATFORM]),
          installed: !!m,
          version: m?.version || '',
          busy: busy.has(e.id),
          bios: m ? biosInfo(e.id) : null,
          systems: e.systems.map((s) => ({ id: s.id, name: s.name, installed: installedStore.has(`${e.id}:${s.id}`) })),
        };
      }),
      games: FREE_GAMES.map((g) => {
        const target = consoleFor(g.system);
        const sys = RETROARCH_SYSTEMS.find((s) => s.id === g.system);
        const installed = target ? fs.existsSync(path.join(target.romsDir, g.file)) : false;
        return { ...g, systemName: sys ? sys.name : g.system, ready: !!target, installed };
      }),
    };
  }

  async function getGame(id: string) {
    const g = FREE_GAMES.find((x) => x.id === id);
    if (!g) return { ok: false, error: 'Jeu inconnu.' };
    const target = consoleFor(g.system);
    if (!target) return { ok: false, error: 'Installez d’abord la console correspondante.' };
    const pid = `game:${id}`;
    progress(pid, 'download', { label: g.name });
    try {
      await download(g.url, path.join(target.romsDir, g.file), (received, total) => progress(pid, 'download', { label: g.name, received, total }));
      progress(pid, 'done');
      return { ok: true };
    } catch (err) {
      const message = (err as Error).message;
      progress(pid, 'error', { message });
      return { ok: false, error: message };
    }
  }

  // Copie vos propres fichiers de jeux dans le dossier d'une console.
  async function importFiles(consoleId: string, files: string[]) {
    const emu = getConfig().emulators.find((e: any) => e.id === consoleId);
    if (!emu || !emu.romsDir) return { ok: false, error: 'Console inconnue ou sans dossier de jeux.' };
    await fsp.mkdir(emu.romsDir, { recursive: true });
    let n = 0;
    for (const f of files || []) {
      try {
        await fsp.copyFile(f, path.join(emu.romsDir, path.basename(f)));
        n += 1;
      } catch {
        /* fichier illisible */
      }
    }
    return { ok: true, count: n, console: emu.name };
  }

  return { catalog, install, uninstall, getGame, importFiles, romsRoot, emuRoot, biosDir, biosInfo, addBios };
}
