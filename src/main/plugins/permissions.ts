/**
 * Permissions d'un plugin (architecture cible, « Sécurité ») : ce que son manifeste déclare, appliqué dans le
 * processus principal d'après le plugin auquel le port est attribué (ADR 0002). Rien n'est supposé : une permission
 * sensible (réseau local, programmes, vues web, suppression) n'est accordée qu'au niveau `privileged`, même si le
 * manifeste a échappé à la vérification.
 *
 * Hôtes : `api.exemple.org` désigne cet hôte seul ; `*.exemple.org` ses sous-domaines (`a.exemple.org`,
 * `b.a.exemple.org`), pas `exemple.org` lui-même, qu'il faut déclarer à part (règle confirmée de P3-01).
 */
import net from 'node:net';
import type { PermissionName, PluginLevel, PluginManifest } from '@mire/plugin-sdk';
import { PRIVILEGED_PERMISSIONS } from '../../../packages/plugin-sdk/src/manifest.ts';

/** Permissions effectives d'un plugin. */
export interface Granted {
  level: PluginLevel;
  hosts: readonly string[];
  folders: boolean;
  localNetwork: boolean;
  launch: boolean;
  webViews: boolean;
  deleteFiles: boolean;
}

const isSensitive = (name: PermissionName) => (PRIVILEGED_PERMISSIONS as readonly string[]).includes(name);

/** Ce qu'un plugin a vraiment : rien pour `data`, pas de permission sensible hors `privileged`. */
export function grantedPermissions(m: Pick<PluginManifest, 'level' | 'permissions'>): Granted {
  const p = (m.level === 'data' ? {} : (m.permissions ?? {})) as Record<string, unknown>;
  const flag = (name: PermissionName) => p[name] === true && (!isSensitive(name) || m.level === 'privileged');
  const hosts = Array.isArray(p.hosts) ? p.hosts.filter((h): h is string => typeof h === 'string').map((h) => h.toLowerCase()) : [];
  return {
    level: m.level,
    hosts: Object.freeze(hosts),
    folders: flag('folders'),
    localNetwork: flag('localNetwork'),
    launch: flag('launch'),
    webViews: flag('webViews'),
    deleteFiles: flag('deleteFiles'),
  };
}

/** Vrai si `hostname` est déclaré dans `hosts` (exact, ou sous-domaine d'une entrée `*.`). */
export function hostDeclared(hosts: readonly string[], hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return hosts.some((d) => (d.startsWith('*.') ? h.endsWith(d.slice(1)) && h.length > d.length - 1 : h === d));
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/** Vrai si l'hôte désigne la machine ou le réseau local : nom local, adresse privée, de bouclage ou de lien. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home.arpa') || !h.includes('.')) {
    return !net.isIPv6(h) || isLocalV6(h);
  }
  if (net.isIPv4(h)) return PRIVATE_V4.some((r) => r.test(h));
  if (net.isIPv6(h)) return isLocalV6(h);
  return false;
}

function isLocalV6(h: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (mapped) return isLocalHost(mapped[1]);
  return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
}

/**
 * Peut-on joindre cette adresse ? `null` si oui, sinon la raison (diagnostic technique, en anglais comme ceux du
 * canal). Seuls `http:` et `https:` ; une adresse IP ou un nom local demande `localNetwork` (code sensible) ; tout
 * autre hôte doit être déclaré.
 */
export function urlRefusal(g: Granted, url: URL): string | null {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return `Only http and https addresses are allowed (${url.protocol}).`;
  if (url.username || url.password) return 'Addresses with a user name or password are not allowed.';
  const host = url.hostname;
  if (isLocalHost(host)) return g.localNetwork ? null : `${host}: the local network needs the "localNetwork" permission (privileged plugins only).`;
  if (net.isIP(host.replace(/^\[|\]$/g, ''))) return `${host}: IP addresses are not allowed, declare a host name.`;
  return hostDeclared(g.hosts, host) ? null : `${host} is not declared in permissions.hosts.`;
}
