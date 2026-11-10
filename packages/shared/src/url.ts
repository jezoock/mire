// Utilitaires d'adresses partagés.
import { URL } from './web-api.ts';

/** Nom d'hôte en minuscules, ou '' si l'adresse est invalide. */
export function hostOf(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Site d'une adresse (deux derniers niveaux du nom d'hôte) : « www.exemple.fr » → « exemple.fr ». */
export const siteOf = (u: string): string => hostOf(u).split('.').slice(-2).join('.');

/** decodeURIComponent qui rend le texte tel quel s'il est mal encodé. */
export function safeDecode(x: string): string {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
}

/** Adresse web (http:// ou https://). */
export const isHttpUrl = (s: unknown): boolean => /^https?:\/\//i.test(String(s));

/** Cible à ouvrir par son protocole (steam://, http://…) plutôt qu'un chemin de fichier (pas C:\). */
export const isUrlTarget = (t: unknown): boolean => /^[a-z][\w+.-]*:\/\//i.test(String(t));
