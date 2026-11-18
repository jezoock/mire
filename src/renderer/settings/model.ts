/**
 * Écran Réglages (P4-20), sans DOM : les panneaux rédigés d'après le schéma des réglages (P1-26) et la configuration,
 * puis un panneau par plugin qui déclare des réglages (son manifeste), avec leurs textes tirés des catalogues.
 */
import { SETTINGS_SCHEMA, valueAtPath } from '@mire/shared/settings/schema';
import type { SettingsBlock, SettingsField, SettingsSchema } from '@mire/shared/settings/schema';
import type { PluginSettingsInfo } from '@mire/shared/ipc';
import { pluginFieldKey } from '@mire/ui/utils';
import type {
  OrderListView,
  PageLinkView,
  PageThemeView,
  PaletteView,
  SettingsActionView,
  SettingsFieldView,
  SettingsOptionView,
  SettingsPanelView,
} from '@mire/ui/utils';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Fournisseurs d'infos du cœur, dans l'ordre par défaut (`METADATA_PROVIDERS` du processus principal). */
export const METADATA_PROVIDERS = ['tmdb', 'musicbrainz', 'libretro', 'steam'] as const;

/** Palettes du cœur et « Automatique » (P4-02) ; noms : `palettes.<id>`. */
export const PALETTES = ['auto', 'ecran', 'jour', 'minuit', 'velours', 'contraste'] as const;

/** Ce que les panneaux affichent, hors configuration : textes, langues, listes de l'accueil, informations. */
export interface PanelSources {
  t: Translate;
  config: unknown;
  /** Langues disponibles, sous leur propre nom. */
  languages: readonly { code: string; name: string }[];
  /** Sites de streaming (`web`), pour la page de démarrage. */
  sites: readonly { id: string; name?: string }[];
  /** Thèmes des pages, textes déjà tirés. */
  pageThemes: readonly Omit<PageThemeView, 'current'>[];
  currentPageTheme: string;
  /** Listes ordonnables de l'accueil (`rows`, `bars`, `sites`), lignes déjà rédigées (`homeOptions`). */
  homeLists: readonly Omit<OrderListView, 'toggle'>[];
  plugins: readonly PluginSettingsInfo[];
  /** Informations rédigées : état du bloqueur, de la lecture protégée ; chemin du fichier de configuration. */
  adblockStatus?: string;
  drmStatus?: string;
  configPath?: string;
}

/** Réglages des blocs propres à une page : ils se font dans les réglages de la page (un onglet), en attendant leurs blocs. */
const PAGE_LINKS: Readonly<Record<string, ReadonlyArray<readonly [page: string, tab: string, view: string]>>> = {
  sources: [
    ['movies', 'sources', 'videos'],
    ['music', 'sources', 'music'],
    ['images', 'sources', 'images'],
    ['games', 'pc', 'games'],
  ],
  'tv-services': [['tv', 'tv', 'tv']],
  'web-sites': [['streaming', 'sites', 'streaming']],
  consoles: [['games', 'consoles', 'games']],
  store: [['games', 'consoles', 'games']],
  'pc-games': [['games', 'pc', 'games']],
  'link-sites': [['games', 'pc', 'games']],
};

const asText = (v: unknown): string => (typeof v === 'string' ? v : '');

function choiceOptions(field: Extract<SettingsField, { type: 'choice' }>, src: PanelSources): SettingsOptionView[] {
  const { t } = src;
  const base = field.options.map((o) => ({ value: o.value, label: t(o.label) }));
  if (field.optionsFrom === 'languages') return [...base, ...src.languages.map((l) => ({ value: l.code, label: l.name }))];
  if (field.optionsFrom === 'web-sites') {
    const group = t('settingsView.start.sites');
    return [...base, ...src.sites.map((w) => ({ value: `web:${w.id}`, label: w.name || w.id, group }))];
  }
  return base;
}

/** Ordre des fournisseurs d'infos : ceux de la configuration, puis les autres (comme `metadataOrder`). */
export function providerOrder(config: unknown): string[] {
  const chosen = valueAtPath(config, 'catalog.metadataProviders');
  const list = Array.isArray(chosen) ? chosen.filter((x): x is string => (METADATA_PROVIDERS as readonly string[]).includes(x)) : [];
  return [...new Set([...list, ...METADATA_PROVIDERS])];
}

function customField(field: Extract<SettingsField, { type: 'custom' }>, block: SettingsBlock, src: PanelSources): SettingsFieldView {
  const { t } = src;
  const base = { key: `${block.id}.${field.id}`, label: t(field.label), ...(field.help ? { help: t(field.help) } : {}) };
  if (field.component === 'themes') {
    const theme = asText(valueAtPath(src.config, 'ui.theme')) || 'ecran';
    const palettes: PaletteView[] = PALETTES.map((id) => ({
      id,
      name: t(id === 'auto' ? 'settingsView.palettes.auto' : `palettes.${id}`),
      preview: id === 'auto' ? ['ecran', 'jour'] : [id],
      current: id === theme,
    }));
    const pageThemes = src.pageThemes.map((th) => ({ ...th, current: th.id === src.currentPageTheme }));
    return { ...base, kind: 'themes', palettes, pageThemes };
  }
  if (field.component === 'ordered-list' && field.paths[0] === 'ui.home.rows') {
    return { ...base, kind: 'order', lists: src.homeLists.map((l) => ({ ...l, toggle: true })) };
  }
  if (field.component === 'ordered-list') {
    const items = providerOrder(src.config).map((id) => ({ id, label: t(`settingsView.providers.${id}`), color: 'var(--muted)', on: true }));
    return { ...base, kind: 'order', lists: [{ kind: 'providers', label: t(field.label), items, toggle: false }] };
  }
  const links: PageLinkView[] = (PAGE_LINKS[field.component] ?? []).map(([page, tab, view]) => ({
    page,
    tab,
    label: t('settingsView.openPage', { name: t(`shell.views.${view}`) }),
  }));
  return { ...base, kind: 'page', links };
}

/** Champ du schéma tel que la vue l'affiche, avec sa valeur dans la configuration. */
export function fieldView(field: SettingsField, block: SettingsBlock, src: PanelSources): SettingsFieldView {
  const { t } = src;
  if (field.type === 'custom') return customField(field, block, src);
  const raw = valueAtPath(src.config, field.path);
  const view: SettingsFieldView = {
    key: field.path,
    kind: field.type,
    label: t(field.label),
    ...(field.help ? { help: t(field.help) } : {}),
    ...('placeholder' in field && field.placeholder ? { placeholder: t(field.placeholder) } : {}),
  };
  switch (field.type) {
    case 'toggle':
      return { ...view, value: typeof raw === 'boolean' ? raw : field.default };
    case 'list':
      return { ...view, value: Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [] };
    case 'choice':
      return { ...view, value: typeof raw === 'string' ? raw : field.default, options: choiceOptions(field, src) };
    case 'path':
      return { ...view, value: asText(raw), pick: field.pick };
    default:
      return { ...view, value: asText(raw) };
  }
}

/** Informations et boutons d'action propres à un bloc (ce ne sont pas des réglages). */
function blockExtras(block: SettingsBlock, src: PanelSources): Pick<SettingsPanelView, 'notes' | 'actions'> {
  const { t } = src;
  const a = (key: string, action: string, args?: Record<string, unknown>, ghost?: boolean): SettingsActionView => ({
    label: t(`settingsView.actions.${key}`),
    action,
    ...(args ? { args } : {}),
    ...(ghost ? { ghost } : {}),
  });
  switch (block.id) {
    case 'sources':
      return { actions: [a('rescan', 'rescan', undefined, true)] };
    case 'scrape':
      return { actions: [a('scrapeAll', 'scrapeAll'), a('scrapeClear', 'clearScrape', undefined, true)] };
    case 'adblock':
      return { notes: src.adblockStatus ? [src.adblockStatus] : [], actions: [a('adblockUpdate', 'updateFilterLists')] };
    default:
      return {};
  }
}

/** Panneaux du schéma : un par bloc, ses champs dans l'ordre. */
export function schemaPanels(src: PanelSources, schema: SettingsSchema = SETTINGS_SCHEMA): SettingsPanelView[] {
  const { t } = src;
  return schema.map((block) => ({
    id: block.id,
    title: t(block.title),
    ...(block.help ? { help: t(block.help) } : {}),
    fields: block.fields.map((f) => fieldView(f, block, src)),
    ...blockExtras(block, src),
  }));
}

/** Texte d'un plugin (`pluginTexts.<id>.…` des catalogues), ou `null` s'il n'en a pas. */
function pluginText(t: Translate, plugin: string, key: string): string | null {
  const full = `pluginTexts.${plugin.replaceAll('.', '_')}.${key}`;
  const text = t(full);
  return text && text !== full ? text : null;
}

/** Panneaux des plugins : un par plugin qui déclare des réglages, générés depuis son manifeste. */
export function pluginPanels(plugins: readonly PluginSettingsInfo[], t: Translate): SettingsPanelView[] {
  return plugins.map((p) => ({
    id: `plugin:${p.id}`,
    title: p.name,
    help: t('settingsView.plugin.help'),
    fields: p.settings.map((s): SettingsFieldView => {
      const text = (part: string) => pluginText(t, p.id, `settings.${s.key}.${part}`);
      const value = p.values[s.key];
      const help = text('help');
      const placeholder = text('placeholder');
      const view: SettingsFieldView = {
        key: pluginFieldKey(p.id, s.key),
        kind: s.type,
        label: text('label') ?? s.key,
        ...(help ? { help } : {}),
        ...(placeholder ? { placeholder } : {}),
      };
      switch (s.type) {
        case 'toggle':
          return { ...view, value: value === true };
        case 'list':
          return { ...view, value: Array.isArray(value) ? value : [] };
        case 'choice':
          return { ...view, value: asText(value), options: (s.options ?? []).map((o) => ({ value: o, label: text(`options.${o}`) ?? o })) };
        case 'secret':
          return { ...view, value: '', secretSet: p.secrets.includes(s.key) };
        case 'path':
          return { ...view, value: asText(value), pick: 'folder' };
        default:
          return { ...view, value: value === undefined ? '' : String(value) };
      }
    }),
  }));
}

/** Texte de l'éditeur JSON « Sites, jeux et consoles ». */
export function advancedJson(config: unknown): string {
  const c = (config ?? {}) as Record<string, unknown>;
  return JSON.stringify({ web: c.web, games: c.games, emulators: c.emulators }, null, 2);
}

/** Tous les panneaux : le schéma, la lecture protégée, l'éditeur JSON, la configuration, puis les plugins. */
export function settingsPanels(src: PanelSources): SettingsPanelView[] {
  const { t } = src;
  return [
    ...schemaPanels(src),
    { id: 'drm', title: t('settingsView.drm.title'), fields: [], notes: [src.drmStatus || t('settingsView.checking')] },
    { id: 'advanced', title: t('settingsView.advanced.title'), help: t('settingsView.advanced.help'), fields: [], json: advancedJson(src.config) },
    {
      id: 'config',
      title: t('settingsView.config.title'),
      help: t('settingsView.config.help'),
      fields: [],
      notes: src.configPath ? [src.configPath] : [],
      actions: [
        { label: t('settingsView.actions.export'), action: 'exportConfig' },
        { label: t('settingsView.actions.importReplace'), action: 'importConfig', args: { mode: 'replace' } },
        { label: t('settingsView.actions.importMerge'), action: 'importConfig', args: { mode: 'merge' }, ghost: true },
        { label: t('settingsView.actions.reveal'), action: 'revealConfig', ghost: true },
      ],
    },
    ...pluginPanels(src.plugins, t),
  ];
}
