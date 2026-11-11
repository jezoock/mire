/**
 * Session des vues web (`persist:web`) : permissions accordées aux pages, téléchargements et liens magnet, extensions
 * (bloqueur, connexion Google) et script d'avant-page. Les objets Electron sont injectés.
 */
import type { ExtensionSession } from './extensions.ts';

export const WEB_PARTITION = 'persist:web';

/** Canal synchrone par lequel web-preload.js demande le script d'avant-page de la page qui se charge. */
export const BEFORE_PAGE_CHANNEL = 'mire:before-page';

// Permissions accordées aux pages ; tout le reste est refusé. L'accès au stockage est accordé, comme dans Chrome,
// aux cadres de vérification qui le demandent.
export const WEB_PERMISSIONS: readonly string[] = [
  'fullscreen',
  'clipboard-sanitized-write',
  'mediaKeySystem',
  'protected-media-identifier',
  'storage-access',
  'top-level-storage-access',
];

export const isPermissionAllowed = (permission: string) => WEB_PERMISSIONS.includes(permission);

type Sender = { getURL(): string; isDestroyed(): boolean; session?: unknown };

export interface WebSessionDeps {
  session: ExtensionSession & {
    on(event: 'will-download', listener: (event: unknown, item: unknown, wc: any) => void): unknown;
    setPermissionRequestHandler(handler: (wc: any, permission: string, callback: (ok: boolean) => void, details?: any) => void): void;
    registerPreloadScript(script: { type: 'frame'; filePath: string }): unknown;
    storagePath?: string | null;
  };
  ipcMain: { on(channel: string, listener: (event: any, ...args: any[]) => void): unknown };
  preloadPath: string;
  onDownload: (event: unknown, item: unknown, wc: unknown) => void;
  /** Lien magnet : pris par le gestionnaire de téléchargements (true) ou non. */
  takeMagnet: (url: string, wc: unknown) => boolean;
  /** Extensions des vues web (src/main/web/extensions.ts). */
  extensions: {
    attach(session: ExtensionSession): void;
    beforePageScript(url: string, topUrl?: string): string;
  };
}

// La page qui demande son script est-elle une vue web ? Le canal est commun à tout le processus principal : la
// fenêtre de Mire, qui n'a pas ce preload, ne doit rien recevoir.
function isWebView(sender: Sender | null | undefined, ses: WebSessionDeps['session']) {
  if (!sender || sender.isDestroyed()) return false;
  const s = sender.session as { storagePath?: string | null } | undefined;
  if (!s) return false;
  return s === ses || (!!ses.storagePath && s.storagePath === ses.storagePath);
}

export function setupWebSession(deps: WebSessionDeps) {
  const ses = deps.session;
  // Pas de setUserAgent ici : l'identité vient de app.userAgentFallback, la même pour tous les cadres.
  ses.on('will-download', deps.onDownload);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission === 'openExternal' && deps.takeMagnet(details?.externalURL || '', wc)) {
      callback(false);
      return;
    }
    callback(isPermissionAllowed(permission));
  });

  // Script exécuté au tout début de chaque page (web-preload.js), avant le code du site.
  ses.registerPreloadScript({ type: 'frame', filePath: deps.preloadPath });
  // Extensions : un seul écouteur par événement réseau, qui les appelle dans l'ordre.
  deps.extensions.attach(ses);
  deps.ipcMain.on(BEFORE_PAGE_CHANNEL, (event, url) => {
    const sender = event.sender as Sender | undefined;
    if (!isWebView(sender, ses)) {
      event.returnValue = '';
      return;
    }
    const href = String(url || '');
    event.returnValue = deps.extensions.beforePageScript(href, sender!.getURL() || href);
  });
}
