/** Adresse de lecture d'un média : les fichiers locaux passent par media:// ; les sources web sont lues directement. */
export const mediaUrl = (p: string): string => (/^https?:\/\//i.test(p) ? p : `media://local/?p=${encodeURIComponent(p)}`);
