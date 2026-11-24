// Comparaison de titres. Repris de Mire (`@mire/shared`, `text.ts`) : un plugin de code n'importe rien du cœur.

/** Minuscules sans accents (« Hadès » → « hades »). */
export const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Clé de comparaison de titres : « Tom & Jerry ! » → « tom and jerry ». */
const titleKey = (s) =>
  fold(s)
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Classe des résultats d'après leur titre : identique > commence par > contient, l'ordre d'origine départage. */
export function rankByTitle(list, query, getTitle) {
  const q = titleKey(query);
  return list
    .map((x, i) => {
      const t = titleKey(getTitle(x));
      const score = t === q ? 3 : t.startsWith(`${q} `) || q.startsWith(`${t} `) ? 1.5 : t.includes(q) ? 1 : 0;
      return { x, score, i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.x);
}

/** Description courte du magasin, sans balises HTML (Mire l'affiche comme du texte). */
export const strip = (h) =>
  String(h || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, '’')
    .replace(/\s+/g, ' ')
    .trim();
