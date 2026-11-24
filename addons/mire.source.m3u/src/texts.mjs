// Messages du plugin montrés par Mire : ceux de la section `source` de i18n/fr.json et i18n/en.json (un test vérifie
// qu'ils sont identiques), sauf `source.name` que Mire lit lui-même (nom de la sorte de source dans l'explorateur).
// L'hôte isolé ne lit pas les catalogues : le code les embarque.

const TEXTS = {
  fr: {
    unavailable: 'liste de lecture introuvable ou illisible',
  },
  en: {
    unavailable: 'playlist missing or unreadable',
  },
};

export const TEXT_CATALOGS = TEXTS;

/** Traduction d'après la langue de l'interface (`fr`, `fr-BE`… → français ; sinon anglais). */
export function translator(locale) {
  const lang = /^fr\b/i.test(String(locale || '')) ? 'fr' : 'en';
  return (key, vars = {}) => TEXTS[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
