/**
 * Extensions des vues web : ce qui s'ajoute aux pages ouvertes dans Mire (bloqueur de publicités, identité de la
 * connexion Google, plus tard des addons). Chaque extension peut agir sur les requêtes réseau, fournir un script
 * exécuté avant le code des pages, annuler une navigation et compter ce qu'elle bloque.
 *
 * Electron n'accepte qu'un écouteur par événement `webRequest` et par session : l'hôte installe un seul écouteur
 * par événement et y appelle les extensions dans l'ordre de la liste. Pour une même requête, la première
 * annulation (ou redirection) l'emporte ; les en-têtes modifiés par une extension sont transmis à la suivante.
 */
import type { ExtensionSession, RequestDetails, RequestResponse, WebExtension, WebRequestEvent, WebRequestHandler } from '@mire/plugin-sdk';

// Interfaces publiées dans le SDK des plugins (contribution `webExtensions`).
export type { ExtensionSession, RequestDetails, RequestResponse, WebExtension, WebRequestEvent, WebRequestHandlers } from '@mire/plugin-sdk';

type Handler = WebRequestHandler;

export const WEB_REQUEST_EVENTS: readonly WebRequestEvent[] = ['onBeforeRequest', 'onBeforeSendHeaders', 'onHeadersReceived'];

type Listener = (details: any, callback: (response: RequestResponse) => void) => void;

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
