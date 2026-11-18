/**
 * Hôte de plugins (P3-03) : point d'entrée pour la racine de composition. Les modules : découverte et vérification
 * (`discovery.ts`), état (`state.ts`), journal (`journal.ts`), registre des contributions (`registry.ts`), tags
 * automatiques (`taggers.ts`), canal (`channel.ts`) et runtime (`runtime.ts`) d'un plugin, hôte isolé (`host.ts`,
 * page et Worker dans `host/`), plugins sensibles (`in-process.ts`), protocole `mire-plugin://` (`protocol.ts`).
 */
import { MessageChannelMain, type BrowserWindow, type Dialog, type SafeStorage } from 'electron';
import { createIsolatedHost } from './host.ts';
import { fileBase, startInProcess } from './in-process.ts';
import { PLUGIN_SCHEME } from './protocol.ts';
import { createPluginStorage, pluginDataDir, type PluginStorage } from './plugin-storage.ts';
import type { RunnerEvents, Runners } from './service.ts';
import type { SecretBox } from './settings.ts';

export { createPluginService, type PluginInfo, type PluginService } from './service.ts';
export { createPluginState } from './state.ts';
export { createJournal } from './journal.ts';
export { PLUGIN_SCHEME_PRIVILEGES } from './protocol.ts';
export { createContextHandler } from './context.ts';
export { createPluginSettings } from './settings.ts';
export { createPluginBridges } from './bridges.ts';

/** Stockage des plugins (`userData/plugin-data/<id>/`), ouvert à la première demande de chacun. */
export function pluginStorages(root: string) {
  const open = new Map<string, PluginStorage>();
  return {
    of(id: string): PluginStorage {
      let s = open.get(id);
      if (!s) open.set(id, (s = createPluginStorage(pluginDataDir(root, id))));
      return s;
    },
    flush: () => Promise.all([...open.values()].map((s) => s.flush())).then(() => {}),
  };
}

/** Secrets des réglages des plugins : `safeStorage` (trousseau du système) quand il est disponible. */
export function safeStorageBox(safeStorage: SafeStorage): SecretBox {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
  };
}

/** Choix d'un dossier pour un plugin (`ctx.files.requestFolder`) : la boîte du système, titrée du nom du plugin. */
export function folderPicker(dialog: Dialog, window: () => BrowserWindow | null, texts: (id: string) => { title: string; button: string }) {
  return async (id: string, purpose: string): Promise<string | null> => {
    const { title, button } = texts(id);
    const options = { title, buttonLabel: button, message: purpose, properties: ['openDirectory' as const] };
    const win = window();
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  };
}

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
