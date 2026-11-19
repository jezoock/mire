/**
 * Schéma des réglages : chaque réglage de Mire décrit une seule fois (bloc, type de champ, chemin dans la
 * configuration, valeur par défaut). Les textes sont des clés de catalogue tirées des identifiants (`settingsTextKey`).
 * L'écran Réglages (P4-20, `src/renderer/settings/`) est rendu d'après lui.
 * Explications : `docs/settings-schema.md`.
 */
import type { SettingsBlock, SettingsField, SettingsFieldType, SettingsSchema, SettingsText } from './types.ts';

export type * from './types.ts';

export const SETTINGS_FIELD_TYPES: readonly SettingsFieldType[] = ['text', 'secret', 'choice', 'toggle', 'path', 'list', 'custom'];

/** Composants des blocs personnalisés, connus de l'interface. */
export const SETTINGS_COMPONENTS = ['themes', 'ordered-list', 'sources', 'tv-services', 'web-sites', 'consoles', 'store', 'pc-games', 'link-sites'] as const;

/**
 * Champ du schéma avant ses textes : `help` et `placeholder` disent seulement qu'il en a un, `options` ne donne que
 * les valeurs. `keyed` y met les clés de catalogue tirées des identifiants.
 */
interface RawField {
  id: string;
  type: SettingsFieldType;
  path?: string;
  default?: unknown;
  help?: true;
  placeholder?: true;
  options?: readonly string[];
  optionsFrom?: string;
  pick?: 'program' | 'folder';
  component?: string;
  paths?: string[];
  optional?: boolean;
}

interface RawBlock {
  id: string;
  help?: true;
  fields: RawField[];
}

/** Segment de clé d'une option : sa valeur, ou `empty` pour la valeur vide (« comme l'interface »). */
export const optionKey = (value: string): string => value || 'empty';

/** Schéma avec ses clés de catalogue (`settings.<bloc>.title`, `settings.<bloc>.<champ>.label`…). */
function keyed(blocks: readonly RawBlock[]): SettingsSchema {
  return blocks.map((b) => ({
    id: b.id,
    title: settingsTextKey(b.id, 'title'),
    ...(b.help ? { help: settingsTextKey(b.id, 'help') } : {}),
    fields: b.fields.map((f) => {
      const { help, placeholder, options, ...rest } = f;
      const key = (...parts: string[]) => settingsTextKey(b.id, f.id, ...parts);
      return {
        ...rest,
        label: key('label'),
        ...(help ? { help: key('help') } : {}),
        ...(placeholder ? { placeholder: key('placeholder') } : {}),
        ...(options ? { options: options.map((value) => ({ value, label: key('options', optionKey(value)) })) } : {}),
      } as SettingsField;
    }),
  }));
}

export const SETTINGS_SCHEMA: SettingsSchema = keyed([
  {
    id: 'appearance',
    help: true,
    fields: [
      { id: 'theme', type: 'custom', component: 'themes', paths: ['ui.theme', 'ui.pageTheme'] },
      { id: 'menuPosition', type: 'choice', path: 'ui.menu.position', default: 'left', help: true, options: ['left', 'right', 'top', 'bottom'] },
      { id: 'menuAutohide', type: 'toggle', path: 'ui.menu.autohide', default: false },
    ],
  },
  {
    id: 'language',
    fields: [
      // Puis les langues disponibles (catalogues de Mire et packs de langue), sous leur propre nom.
      { id: 'interface', type: 'choice', path: 'ui.language', default: 'auto', options: ['auto'], optionsFrom: 'languages' },
      { id: 'metadata', type: 'choice', path: 'search.language', default: '', help: true, options: ['', 'fr-FR', 'en-US'] },
    ],
  },
  {
    id: 'home',
    help: true,
    fields: [
      // Puis « Directement sur un service » : un choix `web:<id>` par site de streaming.
      {
        id: 'start',
        type: 'choice',
        path: 'ui.start',
        default: 'home',
        options: ['home', 'search', 'videos', 'music', 'images', 'streaming', 'tv', 'games'],
        optionsFrom: 'web-sites',
      },
      { id: 'clock', type: 'toggle', path: 'ui.home.clock', default: true },
      // Trois listes ordonnables : les rangées, les barres de la mire et les sites épinglés (P4-12).
      { id: 'rows', type: 'custom', component: 'ordered-list', paths: ['ui.home.rows'] },
    ],
  },
  {
    id: 'sources',
    help: true,
    fields: [{ id: 'sources', type: 'custom', component: 'sources', paths: ['library.sources', 'gameSources'] }],
  },
  {
    id: 'display',
    fields: [
      { id: 'fullscreen', type: 'toggle', path: 'ui.fullscreen', default: false },
      { id: 'backdrop', type: 'toggle', path: 'ui.backdrop', default: true },
    ],
  },
  {
    id: 'programs',
    fields: [
      { id: 'player', type: 'path', pick: 'program', path: 'externalPlayer.path', default: '', help: true, placeholder: true },
      { id: 'browser', type: 'path', pick: 'program', path: 'browser.path', default: '', help: true, placeholder: true },
    ],
  },
  {
    id: 'tv',
    help: true,
    fields: [{ id: 'service', type: 'custom', component: 'tv-services', paths: ['tv.active', 'tv.services'] }],
  },
  {
    id: 'search',
    help: true,
    fields: [
      { id: 'tmdbToken', type: 'secret', path: 'search.tmdbToken', default: '', help: true, placeholder: true },
      { id: 'region', type: 'choice', path: 'search.region', default: 'FR', options: ['FR', 'BE', 'CH', 'LU', 'CA'] },
    ],
  },
  {
    id: 'scrape',
    help: true,
    fields: [
      { id: 'auto', type: 'toggle', path: 'scrape.auto', default: true },
      // Ordre des fournisseurs d'infos : absent de la configuration tant qu'on ne l'a pas changé.
      { id: 'providers', type: 'custom', component: 'ordered-list', paths: ['catalog.metadataProviders'], optional: true, help: true },
    ],
  },
  {
    id: 'adblock',
    help: true,
    fields: [
      { id: 'enabled', type: 'toggle', path: 'adblock.enabled', default: true },
      { id: 'allowlist', type: 'list', path: 'adblock.allowlist', default: [], placeholder: true },
      { id: 'customLists', type: 'list', path: 'adblock.customLists', default: [], placeholder: true },
    ],
  },
  {
    id: 'streaming',
    fields: [{ id: 'sites', type: 'custom', component: 'web-sites', paths: ['web'] }],
  },
  {
    id: 'games',
    fields: [
      { id: 'consoles', type: 'custom', component: 'consoles', paths: ['emulators'] },
      { id: 'store', type: 'custom', component: 'store', paths: ['store.romsRoot'] },
      { id: 'pcGames', type: 'custom', component: 'pc-games', paths: ['games'] },
      { id: 'pcSites', type: 'custom', component: 'link-sites', paths: ['pcSites'] },
      { id: 'autoOnline', type: 'toggle', path: 'gamesOpts.autoOnline', default: false },
    ],
  },
  {
    id: 'downloads',
    fields: [
      { id: 'torrentClient', type: 'choice', path: 'downloads.torrentClient', default: 'mire', help: true, options: ['mire', 'system'] },
      { id: 'seed', type: 'toggle', path: 'downloads.seed', default: false },
      { id: 'dir', type: 'path', pick: 'folder', path: 'downloads.dir', default: '', placeholder: true },
    ],
  },
]);

/** Toutes les clés de catalogue du schéma (titres, libellés, aides, textes d'exemple, options). */
export function settingsTextKeys(schema: SettingsSchema = SETTINGS_SCHEMA): string[] {
  return schema.flatMap((b) => [
    b.title,
    ...(b.help ? [b.help] : []),
    ...b.fields.flatMap((f) => [
      f.label,
      ...(f.help ? [f.help] : []),
      ...('placeholder' in f && f.placeholder ? [f.placeholder] : []),
      ...(f.type === 'choice' ? f.options.map((o) => o.label) : []),
    ]),
  ]);
}

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
export function settingsTextKey(blockId: string, ...parts: string[]): SettingsText {
  return ['settings', blockId, ...parts].join('.') as SettingsText;
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

const isKey = (v: unknown): boolean => typeof v === 'string' && /^settings(\.[A-Za-z0-9_-]+)+$/.test(v);
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
      if (!values.length || !f.options.every((o) => typeof o.value === 'string' && isKey(o.label))) errors.push(`${where} : options invalides`);
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
  if (!isKey(block.title)) errors.push(`bloc « ${block.id} » : titre manquant`);
  const ids = new Set<string>();
  for (const f of block.fields) {
    const where = `${block.id}.${f.id}`;
    if (!ID_RE.test(f.id)) errors.push(`${where} : identifiant invalide`);
    if (ids.has(f.id)) errors.push(`${where} : identifiant en double`);
    ids.add(f.id);
    if (!isKey(f.label)) errors.push(`${where} : libellé manquant`);
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
