/** Couleurs des cartons de remplacement et des pastilles. */

// Couleurs des cartons de remplacement : les barres de la mire, sauf le blanc.
export const BARS = ['yellow', 'cyan', 'green', 'magenta', 'red', 'blue'] as const;
export type Bar = (typeof BARS)[number];

/** Barre attribuée à un texte : toujours la même pour un même texte. */
export function barFor(s: unknown): Bar {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + (ch.codePointAt(0) as number)) >>> 0;
  return BARS[h % BARS.length] as Bar;
}

/** Lettre affichée quand il n'y a pas d'affiche : « E03 » pour un épisode, sinon l'initiale. */
export function monogram(label: string | null | undefined): string {
  const ep = /S\d{1,2}\s*E(\d{1,3})/i.exec(label as string);
  if (ep) return `E${ep[1]}`;
  const m = /[\p{L}\p{N}]/u.exec(label || '');
  return m ? m[0].toUpperCase() : '?';
}

/** Texte lisible sur un fond de couleur `#rrggbb` : sombre sur un fond clair, blanc sinon. */
export function onColor(hex: string | null | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#ffffff';
  const n = Number.parseInt(m[1] as string, 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#171A18' : '#ffffff';
}

/** Couleur choisie par l'utilisateur si elle est valide (`#rgb` à `#rrggbbaa`), sinon le gris par défaut. */
export const safeColor = (c: string | null | undefined): string => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? (c as string) : '#59625B');
