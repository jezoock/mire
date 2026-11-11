/**
 * Session des vues web (`persist:web`) : permissions accordées aux pages, téléchargements et liens magnet, identité
 * de la connexion Google et script d'avant-page. Les objets Electron sont injectés.
 */
import { signinUserAgent } from './user-agent.ts';

export const WEB_PARTITION = 'persist:web';

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

type Contents = { getURL(): string; isDestroyed(): boolean };

export interface WebSessionDeps {
  session: {
    on(event: 'will-download', listener: (event: unknown, item: unknown, wc: any) => void): unknown;
    setPermissionRequestHandler(handler: (wc: any, permission: string, callback: (ok: boolean) => void, details?: any) => void): void;
    webRequest: { onBeforeSendHeaders(listener: (details: any, callback: (r: { requestHeaders: Record<string, string> }) => void) => void): void };
    registerPreloadScript(script: { type: 'frame'; filePath: string }): unknown;
  };
  ipcMain: { on(channel: string, listener: (event: any, ...args: any[]) => void): unknown };
  /** webContents d'après son identifiant (`webContents.fromId`). */
  contentsFromId: (id: number) => Contents | null | undefined;
  /** Identité d'origine d'Electron (connexion Google). */
  nativeUserAgent: string;
  preloadPath: string;
  onDownload: (event: unknown, item: unknown, wc: unknown) => void;
  /** Lien magnet : pris par le gestionnaire de téléchargements (true) ou non. */
  takeMagnet: (url: string, wc: unknown) => boolean;
  /** Scripts correcteurs du bloqueur pour une page. */
  scriptletsFor: (url: string) => string;
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

  // Connexion Google : identité Electron d'origine pour la page de connexion et tout ce qu'elle charge.
  // (Le bloqueur de pubs utilise onBeforeRequest et onHeadersReceived ; cet événement-ci reste libre.)
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const ua = signinUserAgent(pageOfRequest(details, deps.contentsFromId), deps.nativeUserAgent);
    if (ua) details.requestHeaders['User-Agent'] = ua;
    callback({ requestHeaders: details.requestHeaders });
  });
  // Et la même identité pour ce que voit la page en JavaScript (navigator.userAgent).
  ses.registerPreloadScript({ type: 'frame', filePath: deps.preloadPath });
  // Scripts correcteurs du bloqueur, demandés par web-preload.js au tout début de chaque page.
  deps.ipcMain.on('mire:scriptlets', (event, url) => {
    event.returnValue = deps.scriptletsFor(String(url || ''));
  });
  deps.ipcMain.on('mire:signin-ua', (event) => {
    const page = event.sender && !event.sender.isDestroyed() ? event.sender.getURL() : '';
    event.returnValue = signinUserAgent(page, deps.nativeUserAgent);
  });
}

// Page d'où part une requête : elle-même pour un document principal, sinon la page de la vue qui la charge.
function pageOfRequest(details: { resourceType?: string; url: string; webContentsId?: number }, fromId: WebSessionDeps['contentsFromId']) {
  if (details.resourceType === 'mainFrame') return details.url;
  const wc = details.webContentsId ? fromId(details.webContentsId) : null;
  return wc && !wc.isDestroyed() ? wc.getURL() : '';
}
