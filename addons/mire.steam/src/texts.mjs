// Messages du plugin montrés par Mire. Ce sont ceux de la section `steam` de i18n/fr.json et i18n/en.json (un test
// vérifie qu'ils sont identiques) : l'hôte isolé ne lit pas les catalogues, le code les embarque.

const TEXTS = {
  fr: {
    unreachable: 'Le magasin Steam est injoignable. Vérifiez la connexion Internet.',
    status: 'Le magasin Steam a répondu avec le code {status}.',
  },
  en: {
    unreachable: 'Can’t reach the Steam store. Check your internet connection.',
    status: 'The Steam store responded with code {status}.',
  },
};

export const TEXT_CATALOGS = TEXTS;

/** Traduction d'après la langue de l'interface (`fr`, `fr-BE`… → français ; sinon anglais). */
export function translator(locale) {
  const lang = /^fr\b/i.test(String(locale || '')) ? 'fr' : 'en';
  return (key, vars = {}) => TEXTS[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
