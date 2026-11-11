/**
 * Vues web intégrées (sites de streaming, sites de jeux, marque-pages, portails TV) : gestionnaire des vues,
 * entrées, session, extensions, identité, raccourcis, recherche mémorisée et Widevine.
 */
export { createWebManager, downloadContextOf, roundRect, windowOpenAction, WEB_PREFERENCES, type WebManager } from './manager.ts';
export { BUILTIN_RESOLVERS, consoleName, consoleSites, createEntryRegistry, romEntryFor, type EntryRegistry } from './entries.ts';
export { BEFORE_PAGE_CHANNEL, isPermissionAllowed, setupWebSession, WEB_PARTITION, WEB_PERMISSIONS, type WebSessionDeps } from './session.ts';
export {
  beforePageScriptOf,
  composeWebRequest,
  createWebExtensions,
  WEB_REQUEST_EVENTS,
  type ExtensionSession,
  type RequestDetails,
  type RequestResponse,
  type WebExtension,
  type WebExtensions,
  type WebRequestEvent,
  type WebRequestHandlers,
} from './extensions.ts';
export { createGoogleSignin, isSigninPage, signinUserAgent, SIGNIN_HOSTS, userAgentScript, type GoogleSigninDeps } from './google-signin.ts';
export { chromeLikeUserAgent, nativeUserAgent } from './user-agent.ts';
export { padInputEvents, PAD_KEYS, shortcutAction, type ShortcutAction } from './shortcuts.ts';
export { searchTemplate, withSearchTemplate, type LearnResult } from './learn-search.ts';
export { createDrm, type Drm, type DrmStatus } from './drm.ts';
export type * from './types.ts';
