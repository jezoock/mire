/**
 * Extensions des vues web : ce qui s'ajoute aux pages ouvertes dans Mire (bloqueur de publicités, identité de la
 * connexion Google, plus tard des addons). Chaque extension peut agir sur les requêtes réseau, fournir un script
 * exécuté avant le code des pages, annuler une navigation et compter ce qu'elle bloque.
 *
 * Electron n'accepte qu'un écouteur par événement `webRequest` et par session : l'hôte installe un seul écouteur
 * par événement et y appelle les extensions dans l'ordre de la liste. Pour une même requête, la première
 * annulation (ou redirection) l'emporte ; les en-têtes modifiés par une extension sont transmis à la suivante.
 */

type Headers = Record<string, string>;
type ResponseHeaders = Record<string, string[]>;

/** Détails d'une requête, tels que les donne Electron (sous-ensemble utilisé). */
export interface RequestDetails {
  id?: number;
  url: string;
  method?: string;
  resourceType?: string;
  referrer?: string;
  webContentsId?: number;
  requestHeaders?: Headers;
  responseHeaders?: ResponseHeaders;
  statusLine?: string;
  [key: string]: unknown;
}

/** Réponse d'une extension pour une requête (la même forme que les réponses de `webRequest`). */
export interface RequestResponse {
  cancel?: boolean;
  redirectURL?: string;
  requestHeaders?: Headers;
  responseHeaders?: ResponseHeaders;
  statusLine?: string;
}

type Handler = (details: RequestDetails) => RequestResponse | void | Promise<RequestResponse | void>;

export interface WebRequestHandlers {
  onBeforeRequest?: Handler;
  onBeforeSendHeaders?: Handler;
  onHeadersReceived?: Handler;
}

export type WebRequestEvent = keyof WebRequestHandlers;
export const WEB_REQUEST_EVENTS: readonly WebRequestEvent[] = ['onBeforeRequest', 'onBeforeSendHeaders', 'onHeadersReceived'];

type Listener = (details: any, callback: (response: RequestResponse) => void) => void;

/** Session Electron (sous-ensemble utilisé par l'hôte). */
export interface ExtensionSession {
  webRequest: Record<WebRequestEvent, (listener: Listener | null) => void>;
  [key: string]: any;
}

export interface WebExtension {
  id: string;
  /** Branchement sur la session des vues web (scripts de page propres, canaux…). */
  attach(session: ExtensionSession): void;
  detach(): void;
  webRequest?: WebRequestHandlers;
  /**
   * Script à exécuter dans la page avant son propre code ('' : rien). `url` : adresse du cadre ; `topUrl` : celle de
   * la page qui le contient (la même pour le cadre principal).
   */
  beforePageScript?(url: string, topUrl: string): string;
  /** Navigation de `from` vers `url` à annuler (true) : redirection publicitaire, par exemple. */
  guardNavigation?(url: string, from: string): boolean;
  /** État de l'extension (réglages). */
  status?(): unknown;
  /** Nombre d'éléments bloqués dans une page (identifiant de webContents). */
  blockedCount?(webContentsId: number): number;
  /** Nouvelle page dans la vue : le compteur repart de zéro. */
  resetPage?(webContentsId: number): void;
  /** L'extension agit-elle sur cette page (bouclier de la barre du site) ? */
  activeOn?(url: string): boolean;
}

// Appelle les extensions une à une ; une extension en erreur est ignorée (la requête ne doit jamais rester bloquée).
async function run(handlers: Handler[], event: WebRequestEvent, details: RequestDetails): Promise<RequestResponse> {
  let requestHeaders = details.requestHeaders;
  let responseHeaders = details.responseHeaders;
  let statusLine: string | undefined;
  let changedRequest = false;
  let changedResponse = false;
  for (const handler of handlers) {
    let r: RequestResponse | void;
    try {
      r = await handler({ ...details, requestHeaders, responseHeaders });
    } catch (err) {
      console.error(`Extension web (${event}) :`, (err as Error)?.message || err);
      continue;
    }
    if (!r) continue;
    if (r.cancel) return { cancel: true };
    if (r.redirectURL) return { redirectURL: r.redirectURL };
    if (r.requestHeaders) {
      requestHeaders = r.requestHeaders;
      changedRequest = true;
    }
    if (r.responseHeaders) {
      responseHeaders = r.responseHeaders;
      changedResponse = true;
    }
    if (r.statusLine) statusLine = r.statusLine;
  }
  const out: RequestResponse = {};
  if (event === 'onBeforeSendHeaders' && changedRequest) out.requestHeaders = requestHeaders;
  if (event === 'onHeadersReceived' && changedResponse) out.responseHeaders = responseHeaders;
  if (event === 'onHeadersReceived' && statusLine) out.statusLine = statusLine;
  return out;
}

/** Écouteur unique d'un événement `webRequest`, qui appelle les extensions dans l'ordre (null : aucune ne l'utilise). */
export function composeWebRequest(extensions: readonly WebExtension[], event: WebRequestEvent): Listener | null {
  const handlers = extensions.map((e) => e.webRequest?.[event]).filter((h): h is Handler => typeof h === 'function');
  if (!handlers.length) return null;
  return (details, callback) => {
    run(handlers, event, details).then(callback, () => callback({}));
  };
}

/** Scripts d'avant-page des extensions, réunis en un seul ; chacun dans son bloc, l'échec de l'un n'arrête pas les autres. */
export function beforePageScriptOf(extensions: readonly WebExtension[], url: string, topUrl: string = url): string {
  const parts: string[] = [];
  for (const e of extensions) {
    let code = '';
    try {
      code = e.beforePageScript?.(url, topUrl) || '';
    } catch {
      code = '';
    }
    if (code) parts.push(`try {\n${code}\n} catch (e) {}`);
  }
  return parts.join('\n');
}

export function createWebExtensions(list: readonly WebExtension[]) {
  const extensions = [...list];
  let session: ExtensionSession | null = null;

  function attach(ses: ExtensionSession) {
    session = ses;
    for (const event of WEB_REQUEST_EVENTS) {
      const listener = composeWebRequest(extensions, event);
      if (listener) ses.webRequest[event](listener);
    }
    for (const e of extensions) e.attach(ses);
  }

  function detach() {
    for (const e of [...extensions].reverse()) e.detach();
    if (session) for (const event of WEB_REQUEST_EVENTS) if (composeWebRequest(extensions, event)) session.webRequest[event](null);
    session = null;
  }

  return {
    extensions: extensions as readonly WebExtension[],
    get: (id: string) => extensions.find((e) => e.id === id) || null,
    attach,
    detach,
    beforePageScript: (url: string, topUrl?: string) => beforePageScriptOf(extensions, url, topUrl),
    /** Une extension annule-t-elle cette navigation ? */
    guardNavigation: (url: string, from: string) => extensions.some((e) => !!e.guardNavigation?.(url, from)),
    blockedCount: (webContentsId: number) => extensions.reduce((n, e) => n + (e.blockedCount?.(webContentsId) || 0), 0),
    resetPage(webContentsId: number) {
      for (const e of extensions) e.resetPage?.(webContentsId);
    },
    activeOn: (url: string) => extensions.some((e) => !!e.activeOn?.(url)),
    statuses: () => Object.fromEntries(extensions.filter((e) => e.status).map((e) => [e.id, e.status!()])),
  };
}

export type WebExtensions = ReturnType<typeof createWebExtensions>;
