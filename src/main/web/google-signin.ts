/**
 * Extension « connexion Google » : sur la page de connexion (accounts.google.com), et pour tout ce qu'elle charge,
 * Mire donne l'identité d'origine d'Electron au lieu de l'identité « Chrome » (voir user-agent.ts).
 *
 * Google y refuse un navigateur intégré qui se présente comme Chrome (« Ce navigateur ou cette application ne sont
 * peut-être pas sécurisés ») et accepte celui qui donne sa vraie identité Electron. Les requêtes reçoivent cette
 * identité (en-tête User-Agent), et la page aussi en JavaScript (navigator.userAgent) : Google refuse la connexion
 * si les deux diffèrent.
 */
import { hostOf } from '@mire/shared';
import type { RequestDetails, WebExtension } from './extensions.ts';

export const SIGNIN_HOSTS: ReadonlySet<string> = new Set(['accounts.google.com']);

export const isSigninPage = (url: string): boolean => SIGNIN_HOSTS.has(hostOf(url));

/** Identité à imposer pour une page : l'identité d'Electron sur la page de connexion Google, sinon aucune (''). */
export const signinUserAgent = (pageUrl: string, nativeUa: string): string => (isSigninPage(pageUrl) ? nativeUa : '');

type Contents = { getURL(): string; isDestroyed(): boolean };
type ContentsFromId = (id: number) => Contents | null | undefined;

/** Script de page : navigator.userAgent (et appVersion) alignés sur l'identité envoyée dans les requêtes. */
export function userAgentScript(ua: string): string {
  const value = JSON.stringify(ua);
  const appVersion = JSON.stringify(ua.replace(/^Mozilla\//, ''));
  return [
    `Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => ${value}, configurable: true });`,
    `Object.defineProperty(Navigator.prototype, 'appVersion', { get: () => ${appVersion}, configurable: true });`,
  ].join('\n');
}

// Page d'où part une requête : elle-même pour un document principal, sinon la page de la vue qui la charge.
function pageOfRequest(details: RequestDetails, fromId: ContentsFromId) {
  if (details.resourceType === 'mainFrame') return details.url;
  const wc = details.webContentsId ? fromId(details.webContentsId) : null;
  return wc && !wc.isDestroyed() ? wc.getURL() : '';
}

export interface GoogleSigninDeps {
  /** Identité d'origine d'Electron (sans le nom de Mire). */
  nativeUserAgent: string;
  /** webContents d'après son identifiant (`webContents.fromId`). */
  contentsFromId: ContentsFromId;
}

export function createGoogleSignin(deps: GoogleSigninDeps): WebExtension {
  return {
    id: 'google-signin',
    attach() {},
    detach() {},
    webRequest: {
      onBeforeSendHeaders(details) {
        const ua = signinUserAgent(pageOfRequest(details, deps.contentsFromId), deps.nativeUserAgent);
        return ua ? { requestHeaders: { ...details.requestHeaders, 'User-Agent': ua } } : undefined;
      },
    },
    // Le cadre et la page qui le contient doivent tous deux être la page de connexion : les cadres de Google dans
    // un autre site gardent l'identité « Chrome », comme leurs requêtes.
    beforePageScript(url, topUrl) {
      if (!isSigninPage(url)) return '';
      const ua = signinUserAgent(topUrl, deps.nativeUserAgent);
      return ua ? userAgentScript(ua) : '';
    },
  };
}
