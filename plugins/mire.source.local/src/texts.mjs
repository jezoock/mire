// Messages du plugin montrés par Mire. Ce sont ceux de la section `source` de i18n/fr.json et i18n/en.json (un test
// vérifie qu'ils sont identiques) : l'hôte isolé ne lit pas les catalogues, le code les embarque.

const TEXTS = {
  fr: {
    folderNotFound: 'Dossier introuvable : {path}',
  },
  en: {
    folderNotFound: 'Folder not found: {path}',
  },
};

export const TEXT_CATALOGS = TEXTS;

/** Traduction d'après la langue de l'interface (`fr`, `fr-BE`… → français ; sinon anglais). */
export function translator(locale) {
  const lang = /^fr\b/i.test(String(locale || '')) ? 'fr' : 'en';
  return (key, vars = {}) => TEXTS[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
