/**
 * Texte au pluriel, à la manière de dot-stash : les formes viennent d'un attribut (gabarits avec `{count}`), la
 * forme est choisie par `Intl.PluralRules` dans la langue du document.
 */
export type PluralLabels = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

/** Lit les formes passées en attribut (JSON) ; `null` si l'attribut est absent ou illisible. */
export function parsePluralLabels(value: string | undefined | null): PluralLabels | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { other?: unknown }).other === 'string') return parsed as PluralLabels;
  } catch {
    // Attribut mal formé : le composant affiche le nombre seul.
  }
  return null;
}

/** Forme de `labels` qui convient à `count` dans `lang`, `{count}` remplacé par le nombre formaté. */
export function pluralLabel(labels: PluralLabels, count: number, lang: string): string {
  const form = labels[new Intl.PluralRules(lang).select(count)] ?? labels.other;
  return form.replaceAll('{count}', new Intl.NumberFormat(lang).format(count));
}
