// Messages et genres du plugin montrés par Mire. Ce sont ceux de la section `musicbrainz` de i18n/fr.json et
// i18n/en.json (un test vérifie qu’ils sont identiques) : l’hôte isolé ne lit pas les catalogues, le code les embarque.

const TEXTS = {
  fr: {
    unreachable: 'MusicBrainz est injoignable. Vérifiez la connexion Internet.',
    status: 'MusicBrainz a répondu avec le code {status}.',
    genres: {
      electronic: 'Électronique',
      hipHop: 'Hip-hop',
      classical: 'Classique',
      soundtrack: 'Bande originale',
      frenchHouse: 'French touch',
      house: 'House',
      pop: 'Pop',
      rock: 'Rock',
      jazz: 'Jazz',
      blues: 'Blues',
      metal: 'Metal',
      heavyMetal: 'Metal',
      folk: 'Folk',
      chansonFrancaise: 'Chanson française',
      chanson: 'Chanson française',
      reggae: 'Reggae',
      soul: 'Soul',
      funk: 'Funk',
      rnb: 'R&B',
      country: 'Country',
      punk: 'Punk',
      ambient: 'Ambient',
      techno: 'Techno',
      downtempo: 'Downtempo',
      tripHop: 'Trip-hop',
      alternativeRock: 'Rock alternatif',
      indieRock: 'Rock indé',
      indiePop: 'Pop indé',
      world: 'Musiques du monde',
      disco: 'Disco',
      rap: 'Rap',
    },
  },
  en: {
    unreachable: 'Can’t reach MusicBrainz. Check your internet connection.',
    status: 'MusicBrainz responded with code {status}.',
    genres: {
      electronic: 'Electronic',
      hipHop: 'Hip hop',
      classical: 'Classical',
      soundtrack: 'Soundtrack',
      frenchHouse: 'French house',
      house: 'House',
      pop: 'Pop',
      rock: 'Rock',
      jazz: 'Jazz',
      blues: 'Blues',
      metal: 'Metal',
      heavyMetal: 'Heavy metal',
      folk: 'Folk',
      chansonFrancaise: 'Chanson française',
      chanson: 'Chanson',
      reggae: 'Reggae',
      soul: 'Soul',
      funk: 'Funk',
      rnb: 'R&B',
      country: 'Country',
      punk: 'Punk',
      ambient: 'Ambient',
      techno: 'Techno',
      downtempo: 'Downtempo',
      tripHop: 'Trip hop',
      alternativeRock: 'Alternative rock',
      indieRock: 'Indie rock',
      indiePop: 'Indie pop',
      world: 'World',
      disco: 'Disco',
      rap: 'Rap',
    },
  },
};

export const TEXT_CATALOGS = TEXTS;

/** Langue des textes d’après celle de l’interface (`fr`, `fr-BE`… → français ; sinon anglais). */
export const textLanguage = (locale) => (/^fr\b/i.test(String(locale || '')) ? 'fr' : 'en');

/** Traduction d’après la langue de l’interface ; `genre` rend le genre traduit d’une clé de `genres`. */
export function translator(locale) {
  const texts = TEXTS[textLanguage(locale)];
  const t = (key, vars = {}) => texts[key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  t.genre = (id) => texts.genres[id];
  return t;
}
