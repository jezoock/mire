// Messages du plugin montrés par Mire : ceux de la section `source` de i18n/fr.json et i18n/en.json (un test vérifie
// qu'ils sont identiques), sauf `source.name` que Mire lit lui-même (nom de la sorte de source dans l'explorateur).
// L'hôte isolé ne lit pas les catalogues : le code les embarque.

const TEXTS = {
  fr: {
    shareUnavailable: 'Partage réseau inaccessible : {path}. Vérifiez que l’ordinateur du partage est allumé et que vous y êtes connecté.',
  },
  en: {
    shareUnavailable: "Network share unavailable: {path}. Check that the computer sharing it is on and that you're connected to it.",
  },
};

export const TEXT_CATALOGS = TEXTS;

/** Traduction d'après la langue de l'interface (`fr`, `fr-BE`… → français ; sinon anglais). */
export function translator(locale) {
  const lang = /^fr\b/i.test(String(locale || '')) ? 'fr' : 'en';
  return (key, vars = {}) => TEXTS[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
