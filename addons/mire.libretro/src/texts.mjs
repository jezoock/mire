// Messages et genres du plugin montrés par Mire. Ce sont ceux de la section `libretro` de i18n/fr.json et
// i18n/en.json (un test vérifie qu’ils sont identiques) : l’hôte isolé ne lit pas les catalogues, le code les embarque.

const TEXTS = {
  fr: {
    unknownSystemConfig: 'Système de la console inconnu : ajoutez « system » dans sa configuration.',
    unknownSystem: 'Système de la console inconnu : indiquez-le avec « Modifier la console ».',
    coversUnavailable: 'La liste des jaquettes de ce système est indisponible pour le moment.',
    genres: {
      platform: 'Plateformes',
      action: 'Action',
      sports: 'Sport',
      rolePlaying: 'Jeu de rôle',
      adventure: 'Aventure',
      strategy: 'Stratégie',
      racing: 'Course',
      puzzle: 'Réflexion',
      shooter: 'Tir',
      shootEmUp: 'Shoot’em up',
      board: 'Jeu de plateau',
      beatEmUp: 'Beat’em up',
      fighting: 'Combat',
      simulation: 'Simulation',
      compilation: 'Compilation',
      gambling: 'Casino',
      educational: 'Éducatif',
      pinball: 'Flipper',
      card: 'Cartes',
      sportsWithAnimals: 'Sport',
      huntingAndFishing: 'Chasse et pêche',
      casualGame: 'Jeu familial',
      various: 'Divers',
      quiz: 'Quiz',
      lightgunShooter: 'Tir au pistolet',
      musicDancing: 'Musique et danse',
      thinking: 'Réflexion',
      adult: 'Adulte',
    },
  },
  en: {
    unknownSystemConfig: 'Unknown console system: add "system" to its configuration.',
    unknownSystem: 'Unknown console system: set it with "Edit console".',
    coversUnavailable: "The cover list for this system isn't available right now.",
    genres: {
      platform: 'Platform',
      action: 'Action',
      sports: 'Sports',
      rolePlaying: 'Role-Playing (RPG)',
      adventure: 'Adventure',
      strategy: 'Strategy',
      racing: 'Racing',
      puzzle: 'Puzzle',
      shooter: 'Shooter',
      shootEmUp: "Shoot'em Up",
      board: 'Board',
      beatEmUp: "Beat'em Up",
      fighting: 'Fighting',
      simulation: 'Simulation',
      compilation: 'Compilation',
      gambling: 'Gambling',
      educational: 'Educational',
      pinball: 'Pinball',
      card: 'Card',
      sportsWithAnimals: 'Sports with Animals',
      huntingAndFishing: 'Hunting and Fishing',
      casualGame: 'Casual Game',
      various: 'Various',
      quiz: 'Quiz',
      lightgunShooter: 'Lightgun Shooter',
      musicDancing: 'Music / Dancing',
      thinking: 'Thinking',
      adult: 'Adult',
    },
  },
};

export const TEXT_CATALOGS = TEXTS;

/** Traduction d’après la langue de l’interface (`fr`, `fr-BE`… → français ; sinon anglais) ; `genre` : genre traduit. */
export function translator(locale) {
  const texts = TEXTS[/^fr\b/i.test(String(locale || '')) ? 'fr' : 'en'];
  const t = (key) => texts[key];
  t.genre = (id) => texts.genres[id];
  return t;
}
