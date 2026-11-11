/**
 * Identité annoncée par les vues web (fonctions pures).
 *
 * Mire se présente comme Chrome, pour toute l'application et avant la création de la moindre page : un réglage par
 * session ne s'applique pas aux cadres d'un autre site (processus séparés). La case « Vérifiez que vous êtes
 * humain » de Cloudflare, servie par challenges.cloudflare.com, annonçait alors « Electron » pendant que la page
 * annonçait « Chrome », et Cloudflare refusait la vérification. Le détail de version est retiré, comme le fait
 * Chrome (Chrome/152.0.0.0).
 *
 * Exception : la page de connexion Google (accounts.google.com). Google y refuse un navigateur intégré qui se
 * présente comme Chrome (« Ce navigateur ou cette application ne sont peut-être pas sécurisés ») et accepte celui
 * qui donne sa vraie identité Electron. Sur cette seule page, et pour ce qu'elle charge, Mire envoie donc
 * l'identité d'origine d'Electron (sans le nom de Mire).
 */
import { hostOf } from '@mire/shared';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Identité « Chrome » : sans Electron ni le nom de l'application, version réduite à son numéro principal. */
export function chromeLikeUserAgent(ua: string, appName: string): string {
  return ua
    .replace(/\s*Electron\/\S+/i, '')
    .replace(new RegExp(`\\s*${escapeRe(appName)}\\/\\S+`, 'i'), '')
    .replace(/Chrome\/(\d+)\.[\d.]+/, 'Chrome/$1.0.0.0');
}

/** Identité d'origine d'Electron, sans le nom de l'application (qui y figure quand elle n'est pas « Electron »). */
export function nativeUserAgent(ua: string, appName: string): string {
  if (/^electron$/i.test(appName)) return ua;
  return ua.replace(new RegExp(`\\s*${escapeRe(appName)}\\/\\S+`, 'i'), '');
}

export const SIGNIN_HOSTS: ReadonlySet<string> = new Set(['accounts.google.com']);

export const isSigninPage = (url: string): boolean => SIGNIN_HOSTS.has(hostOf(url));

/** Identité à imposer pour une page : l'identité d'Electron sur la page de connexion Google, sinon aucune (''). */
export const signinUserAgent = (pageUrl: string, nativeUa: string): string => (isSigninPage(pageUrl) ? nativeUa : '');
