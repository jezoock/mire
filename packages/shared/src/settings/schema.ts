/**
 * Schéma des réglages : chaque réglage de Mire décrit une seule fois (bloc, type de champ, chemin dans la
 * configuration, valeur par défaut, libellé). Il servira au rendu des réglages de la phase 2 (P2-19) et aux
 * réglages fournis par les addons (P3-04). Le rendu actuel (`src/renderer/app.js`) ne s'en sert pas encore.
 * Explications : `docs/settings-schema.md`.
 */
import type { SettingsBlock, SettingsField, SettingsFieldType, SettingsSchema } from './types.ts';

export type * from './types.ts';

export const SETTINGS_FIELD_TYPES: readonly SettingsFieldType[] = ['text', 'secret', 'choice', 'toggle', 'path', 'list', 'custom'];

/** Composants des blocs personnalisés, connus de l'interface. */
export const SETTINGS_COMPONENTS = ['themes', 'ordered-list', 'sources', 'tv-services', 'web-sites', 'consoles', 'store', 'pc-games', 'link-sites'] as const;

export const SETTINGS_SCHEMA: SettingsSchema = [
  {
    id: 'appearance',
    title: 'Apparence',
    help: 'Le thème s’applique tout de suite.',
    fields: [
      { id: 'theme', type: 'custom', component: 'themes', paths: ['ui.theme'], label: 'Thème' },
      {
        id: 'menuPosition',
        type: 'choice',
        path: 'ui.menu.position',
        default: 'left',
        label: 'Menu principal',
        help: 'À gauche ou à droite, le menu est une barre latérale ; en haut ou en bas, c’est un carrousel qu’on fait défiler.',
        options: [
          { value: 'left', label: 'À gauche' },
          { value: 'right', label: 'À droite' },
          { value: 'top', label: 'En haut' },
          { value: 'bottom', label: 'En bas' },
        ],
      },
      {
        id: 'menuAutohide',
        type: 'toggle',
        path: 'ui.menu.autohide',
        default: false,
        label: 'Menu rétractable : il se cache et réapparaît quand on approche du bord ou qu’on y revient avec les flèches',
      },
    ],
  },
  {
    id: 'home',
    title: 'Page d’accueil',
    help: 'Les changements s’appliquent tout de suite. Les flèches changent l’ordre d’affichage.',
    fields: [
      {
        id: 'start',
        type: 'choice',
        path: 'ui.start',
        default: 'home',
        label: 'Au démarrage, ouvrir',
        options: [
          { value: 'home', label: 'Accueil' },
          { value: 'search', label: 'Rechercher' },
          { value: 'videos', label: 'Vidéos' },
          { value: 'music', label: 'Musique' },
          { value: 'images', label: 'Images' },
          { value: 'streaming', label: 'Streaming' },
          { value: 'tv', label: 'Télévision' },
          { value: 'games', label: 'Jeux' },
        ],
        // Puis « Directement sur un service » : un choix `web:<id>` par site de streaming.
        optionsFrom: 'web-sites',
      },
      { id: 'clock', type: 'toggle', path: 'ui.home.clock', default: true, label: 'Afficher l’heure et la date' },
      { id: 'recent', type: 'toggle', path: 'ui.home.recent', default: true, label: 'Afficher « Reprendre »' },
      { id: 'bars', type: 'custom', component: 'ordered-list', paths: ['ui.home.bars'], label: 'Barres de la mire' },
      {
        id: 'services',
        type: 'custom',
        component: 'ordered-list',
        paths: ['ui.home.services'],
        label: 'Services affichés sur l’accueil',
      },
    ],
  },
  {
    id: 'sources',
    title: 'Sources',
    help: 'Dossiers du disque, partages réseau (\\\\NAS\\Films, smb://nas/films) ou serveurs web. Les changements s’appliquent tout de suite.',
    fields: [
      {
        id: 'sources',
        type: 'custom',
        component: 'sources',
        paths: ['library.sources', 'gameSources'],
        label: 'Sources',
      },
    ],
  },
  {
    id: 'display',
    title: 'Affichage',
    fields: [
      { id: 'fullscreen', type: 'toggle', path: 'ui.fullscreen', default: false, label: 'Afficher Mire en plein écran' },
      {
        id: 'backdrop',
        type: 'toggle',
        path: 'ui.backdrop',
        default: true,
        label: 'Afficher le fond d’écran de l’élément sélectionné dans les listes',
      },
    ],
  },
  {
    id: 'programs',
    title: 'Programmes externes',
    fields: [
      {
        id: 'player',
        type: 'path',
        pick: 'program',
        path: 'externalPlayer.path',
        default: '',
        label: 'Lecteur externe',
        help: 'Sert pour la télévision et pour les fichiers que le lecteur intégré ne lit pas (AVI, WMV, pistes audio AC3 ou DTS…). Laissez vide pour détecter mpv ou VLC automatiquement.',
        placeholder: 'Détection automatique',
      },
      {
        id: 'browser',
        type: 'path',
        pick: 'program',
        path: 'browser.path',
        default: '',
        label: 'Navigateur de secours',
        help: 'Ne sert qu’aux sites dont le « mode » vaut "browser". Laissez vide pour utiliser Edge ou Chrome automatiquement.',
        placeholder: 'Détection automatique',
      },
    ],
  },
  {
    id: 'tv',
    title: 'Télévision',
    help: 'Au premier lancement, Mire reconnaît votre box sur le réseau. Vous pouvez aussi choisir le service à la main.',
    fields: [
      {
        id: 'service',
        type: 'custom',
        component: 'tv-services',
        paths: ['tv.active', 'tv.services'],
        label: 'Service de télévision',
      },
    ],
  },
  {
    id: 'search',
    title: 'Recherche dans les catalogues de streaming',
    help: 'Avec une clé gratuite de TMDB, Rechercher affiche les films et séries correspondants et indique sur quel service les regarder.',
    fields: [
      {
        id: 'tmdbToken',
        type: 'secret',
        path: 'search.tmdbToken',
        default: '',
        label: 'Clé ou jeton TMDB',
        placeholder: 'Facultatif',
      },
      {
        id: 'region',
        type: 'choice',
        path: 'search.region',
        default: 'FR',
        label: 'Pays des disponibilités',
        options: [
          { value: 'FR', label: 'France' },
          { value: 'BE', label: 'Belgique' },
          { value: 'CH', label: 'Suisse' },
          { value: 'LU', label: 'Luxembourg' },
          { value: 'CA', label: 'Canada' },
        ],
      },
    ],
  },
  {
    id: 'scrape',
    title: 'Infos et affiches',
    fields: [
      {
        id: 'auto',
        type: 'toggle',
        path: 'scrape.auto',
        default: true,
        label: 'Récupérer automatiquement après chaque analyse de la bibliothèque',
      },
    ],
  },
  {
    id: 'adblock',
    title: 'Bloqueur de publicités',
    help: 'Bloque les publicités, le pistage, les fenêtres surgissantes et les redirections vers des pages de pub dans les sites ouverts dans Mire.',
    fields: [
      { id: 'enabled', type: 'toggle', path: 'adblock.enabled', default: true, label: 'Bloquer les publicités dans les sites' },
      {
        id: 'allowlist',
        type: 'list',
        path: 'adblock.allowlist',
        default: [],
        label: 'Sites où le bloqueur est désactivé',
      },
      {
        id: 'customLists',
        type: 'list',
        path: 'adblock.customLists',
        default: [],
        label: 'Listes de filtres supplémentaires',
        placeholder: 'Adresse d’une liste au format Adblock Plus ou uBlock (https://…)',
      },
    ],
  },
  {
    id: 'streaming',
    title: 'Sites de streaming',
    fields: [{ id: 'sites', type: 'custom', component: 'web-sites', paths: ['web'], label: 'Sites' }],
  },
  {
    id: 'games',
    title: 'Jeux',
    fields: [
      { id: 'consoles', type: 'custom', component: 'consoles', paths: ['emulators'], label: 'Consoles' },
      { id: 'store', type: 'custom', component: 'store', paths: ['store.romsRoot'], label: 'Boutique' },
      { id: 'pcGames', type: 'custom', component: 'pc-games', paths: ['games'], label: 'Jeux PC ajoutés à la main' },
      {
        id: 'pcSites',
        type: 'custom',
        component: 'link-sites',
        paths: ['pcSites'],
        label: 'Sites pour télécharger des jeux PC',
      },
      {
        id: 'autoOnline',
        type: 'toggle',
        path: 'gamesOpts.autoOnline',
        default: false,
        label: 'Afficher d’emblée les jeux en ligne en ouvrant une console (sans cliquer sur « Afficher »)',
      },
    ],
  },
  {
    id: 'downloads',
    title: 'Téléchargements',
    fields: [
      {
        id: 'torrentClient',
        type: 'choice',
        path: 'downloads.torrentClient',
        default: 'mire',
        label: 'Client torrent',
        help: 'Avec un logiciel installé, Mire lui confie le lien ou le fichier : le téléchargement se suit alors dans ce logiciel.',
        options: [
          { value: 'mire', label: 'Intégré à Mire (progression suivie ici)' },
          { value: 'system', label: 'Logiciel installé sur l’ordinateur (qBittorrent, Transmission…)' },
        ],
      },
      {
        id: 'seed',
        type: 'toggle',
        path: 'downloads.seed',
        default: false,
        label: 'Continuer à partager un torrent une fois téléchargé (tant que Mire est ouvert)',
      },
      {
        id: 'dir',
        type: 'path',
        pick: 'folder',
        path: 'downloads.dir',
        default: '',
        label: 'Dossier des téléchargements',
        placeholder: 'Téléchargements/Mire',
      },
    ],
  },
];

/** Chemins de la configuration modifiés par un champ. */
export function fieldPaths(field: SettingsField): string[] {
  if (field.type !== 'custom') return [field.path];
  return Array.isArray(field.paths) ? field.paths : [];
}

/** Tous les chemins de la configuration du schéma, dans l'ordre (un doublon y apparaît deux fois). */
export function settingsPaths(schema: SettingsSchema = SETTINGS_SCHEMA): string[] {
  return schema.flatMap((block) => block.fields.flatMap(fieldPaths));
}

/**
 * Clé de catalogue d'un texte du schéma, pour la localisation (P1-28) :
 * `settings.<bloc>.title`, `settings.<bloc>.<champ>.label`, `settings.<bloc>.<champ>.options.<valeur>`…
 */
export function settingsTextKey(blockId: string, ...parts: string[]): string {
  return ['settings', blockId, ...parts].join('.');
}

/** Valeur de `obj` au chemin `a.b.c`, ou `undefined`. */
export function valueAtPath(obj: unknown, path: string): unknown {
  let o: unknown = obj;
  for (const key of path.split('.')) {
    if (o === null || typeof o !== 'object' || !Object.hasOwn(o, key)) return undefined;
    o = (o as Record<string, unknown>)[key];
  }
  return o;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const ID_RE = /^[a-z][A-Za-z0-9]*$/;
const PATH_RE = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/;

// Erreurs propres au type d'un champ (valeur par défaut, options, composant).
function fieldTypeErrors(f: SettingsField, where: string): string[] {
  const errors: string[] = [];
  switch (f.type) {
    case 'text':
    case 'secret':
      if (typeof f.default !== 'string') errors.push(`${where} : valeur par défaut non textuelle`);
      break;
    case 'path':
      if (typeof f.default !== 'string') errors.push(`${where} : valeur par défaut non textuelle`);
      if (f.pick !== 'program' && f.pick !== 'folder') errors.push(`${where} : « pick » inconnu`);
      break;
    case 'toggle':
      if (typeof f.default !== 'boolean') errors.push(`${where} : valeur par défaut non booléenne`);
      break;
    case 'list':
      if (!Array.isArray(f.default) || !f.default.every((x) => typeof x === 'string')) errors.push(`${where} : valeur par défaut non liste de textes`);
      break;
    case 'choice': {
      const values = (f.options || []).map((o) => o.value);
      if (!values.length || !f.options.every((o) => typeof o.value === 'string' && isText(o.label))) errors.push(`${where} : options invalides`);
      if (new Set(values).size !== values.length) errors.push(`${where} : option en double`);
      if (!values.includes(f.default)) errors.push(`${where} : valeur par défaut absente des options`);
      break;
    }
    case 'custom':
      if (!(SETTINGS_COMPONENTS as readonly string[]).includes(f.component)) errors.push(`${where} : composant inconnu « ${f.component} »`);
      if (!Array.isArray(f.paths)) errors.push(`${where} : « paths » doit être une liste`);
      break;
    default:
      errors.push(`${where} : type inconnu « ${(f as { type: unknown }).type} »`);
  }
  return errors;
}

function blockErrors(block: SettingsBlock): string[] {
  const errors: string[] = [];
  if (!ID_RE.test(block.id)) errors.push(`bloc « ${block.id} » : identifiant invalide`);
  if (!isText(block.title)) errors.push(`bloc « ${block.id} » : titre manquant`);
  const ids = new Set<string>();
  for (const f of block.fields) {
    const where = `${block.id}.${f.id}`;
    if (!ID_RE.test(f.id)) errors.push(`${where} : identifiant invalide`);
    if (ids.has(f.id)) errors.push(`${where} : identifiant en double`);
    ids.add(f.id);
    if (!isText(f.label)) errors.push(`${where} : libellé manquant`);
    for (const p of fieldPaths(f)) {
      if (!PATH_RE.test(p)) errors.push(`${where} : chemin invalide « ${p} »`);
    }
    errors.push(...fieldTypeErrors(f, where));
  }
  return errors;
}

/** Vérifie la forme d'un schéma (identifiants, types, valeurs par défaut, chemins uniques). Liste des erreurs. */
export function validateSettingsSchema(schema: SettingsSchema): string[] {
  const errors: string[] = [];
  const blockIds = new Set<string>();
  for (const block of schema) {
    if (blockIds.has(block.id)) errors.push(`bloc « ${block.id} » en double`);
    blockIds.add(block.id);
    errors.push(...blockErrors(block));
  }
  // Un chemin ne figure qu'une fois, et pas non plus à l'intérieur d'un autre (« tv » et « tv.active »).
  const paths = settingsPaths(schema);
  paths.forEach((p, i) => {
    const other = paths.find((q, j) => j !== i && (q === p || q.startsWith(`${p}.`)));
    if (other !== undefined && (other !== p || paths.indexOf(p) < i)) errors.push(`chemin en double : ${p}${other === p ? '' : ` (contient ${other})`}`);
  });
  return errors;
}
