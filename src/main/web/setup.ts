/**
 * Assemblage des vues web intégrées pour la racine de composition : Widevine, gestionnaire des vues, puis, au
 * démarrage, le bloqueur de publicités et la connexion Google (extensions, dans l'ordre où elles voient passer les
 * requêtes) branchés sur la session `persist:web`. Le premier site ouvert attend Widevine, puis le bloqueur.
 */
import type { Config } from '@mire/shared';
import type { ConfigService } from '../config/service.ts';
import { createAdblock, type Adblock } from './adblock.ts';
import { createDrm, type Components } from './drm.ts';
import { createWebExtensions, type WebExtensions } from './extensions.ts';
import { createGoogleSignin, type GoogleSigninDeps } from './google-signin.ts';
import { createWebManager } from './manager.ts';
import { setupWebSession, type WebSessionDeps } from './session.ts';
import type { WebManagerDeps } from './types.ts';

export interface WebLayerDeps extends Pick<
  WebManagerDeps,
  'window' | 'createView' | 'defaultRomSites' | 'guessSystem' | 'downloads' | 'openInBrowser' | 'toUi'
> {
  config: Pick<ConfigService, 'get' | 'update' | 'replace'>;
  /** API `components` de castLabs Electron (absente d'Electron standard). */
  components?: Components | null;
  /** Dossier de données (moteur du bloqueur). */
  dataDir: string;
  /** Session des vues web (`session.fromPartition(WEB_PARTITION)`). */
  session: () => WebSessionDeps['session'];
  ipcMain: WebSessionDeps['ipcMain'];
  preloadPath: string;
  google: GoogleSigninDeps;
  /** Délais d'attente de Widevine et du bloqueur avant le premier site (tests). */
  drmTimeoutMs?: number;
  adblockTimeoutMs?: number;
}

export function createWebLayer(deps: WebLayerDeps) {
  const drm = createDrm({
    components: deps.components,
    timeoutMs: deps.drmTimeoutMs,
    onError: (err) => console.error('Widevine :', (err as Error)?.message || err),
  });
  let extensions: WebExtensions | null = null;
  let adblock: Adblock | null = null;
  let adblockReady: Promise<unknown> = Promise.resolve(false);

  const { window, createView, config, defaultRomSites, guessSystem, downloads, openInBrowser, toUi } = deps;
  const web = createWebManager({
    ...{ window, createView, config, defaultRomSites, guessSystem, downloads, openInBrowser, toUi },
    extensions: () => extensions,
    whenReady: async () => {
      await drm.whenReady();
      await adblockReady;
    },
  });

  /** Branche les extensions sur la session, lance Widevine et le bloqueur. */
  function start() {
    const blocker = createAdblock({
      dataDir: deps.dataDir,
      getConfig: deps.config.get,
      saveConfig: (c: Config) => deps.config.replace(c),
      onCount: web.onBlockedCount,
    });
    adblock = blocker;
    extensions = createWebExtensions([blocker, createGoogleSignin(deps.google)]);
    setupWebSession({
      session: deps.session(),
      ipcMain: deps.ipcMain,
      preloadPath: deps.preloadPath,
      onDownload: web.onDownload,
      takeMagnet: web.takeMagnet,
      extensions,
    });
    drm.start();
    // Le premier site ouvert attend le bloqueur (dix secondes au plus) pour ne pas laisser passer de pubs.
    // Désactivé, le bloqueur ne charge rien et ne télécharge aucune liste.
    adblockReady = Promise.race([
      blocker.start().catch((err) => {
        console.error('Bloqueur :', err.message);
        return false;
      }),
      new Promise((resolve) => {
        setTimeout(() => resolve(false), deps.adblockTimeoutMs ?? 10000);
      }),
    ]);
    return blocker;
  }

  return {
    web,
    drm,
    /** Le bloqueur, une fois `start()` appelé. */
    adblock: () => adblock,
    start,
  };
}

export type WebLayer = ReturnType<typeof createWebLayer>;
