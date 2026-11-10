// Identifiants aléatoires. Web Crypto plutôt que node:crypto : le module servira aussi au renderer (P1-23).
import { crypto } from './web-api.ts';

/** Identifiant aléatoire en hexadécimal, de `bytes` octets (5 par défaut, soit 10 caractères). */
export function newId(bytes = 5): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}
