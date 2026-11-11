/**
 * Vues web intégrées (sites de streaming, sites de jeux, marque-pages, portails TV) : gestionnaire des vues,
 * entrées, session, identité, raccourcis, recherche mémorisée et Widevine.
 */
export { createWebManager, downloadContextOf, roundRect, windowOpenAction, WEB_PREFERENCES, type WebManager } from './manager.ts';
export { BUILTIN_RESOLVERS, consoleName, consoleSites, createEntryRegistry, romEntryFor, type EntryRegistry } from './entries.ts';
export { isPermissionAllowed, setupWebSession, WEB_PARTITION, WEB_PERMISSIONS, type WebSessionDeps } from './session.ts';
export { chromeLikeUserAgent, isSigninPage, nativeUserAgent, signinUserAgent, SIGNIN_HOSTS } from './user-agent.ts';
export { padInputEvents, PAD_KEYS, shortcutAction, type ShortcutAction } from './shortcuts.ts';
export { searchTemplate, withSearchTemplate, type LearnResult } from './learn-search.ts';
export { createDrm, type Drm, type DrmStatus } from './drm.ts';
export type * from './types.ts';
