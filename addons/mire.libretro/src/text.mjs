// Comparaison de noms de jeux. Repris de Mire (`@mire/shared`, `text.ts`) : un plugin de code n'importe rien du cœur.

/** Minuscules sans accents (« Été » → « ete »). */
export const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Clé de comparaison de titres : « Tom & Jerry ! » → « tom and jerry ». */
export const titleKey = (s) =>
  fold(s)
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Retire les mentions entre parenthèses ou crochets : « Tetris (Europe) [!] » → « Tetris ». */
export const stripTags = (s) =>
  String(s)
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .trim();

/** Coefficient de Dice sur les paires de lettres : 1 pour deux textes identiques, 0 sans paire commune. */
export function bigramDice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) || 0;
    if (n > 0) {
      grams.set(g, n - 1);
      hits += 1;
    }
  }
  return (2 * hits) / (a.length + b.length - 2);
}
