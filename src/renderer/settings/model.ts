/**
 * Écran Réglages (P4-20), sans DOM : les panneaux rédigés d'après le schéma des réglages (P1-26) et la configuration,
 * puis un panneau par plugin qui déclare des réglages (son manifeste), avec leurs textes tirés des catalogues.
 */
import { SETTINGS_SCHEMA, valueAtPath } from '@mire/shared/settings/schema';
import type { SettingsBlock, SettingsField, SettingsSchema } from '@mire/shared/settings/schema';
import type { PluginMetadataProvider, PluginSettingsInfo } from '@mire/shared/ipc';
import { AUTO_PALETTES, DEFAULT_PALETTE } from '@mire/shared';
import type { ListSummary, PageOverview, TagOverview } from '@mire/shared';
import { pagesGroup } from './pages.ts';
import { fileRulesGroup, listsGroup, listsOrder, tagsGroup } from './tags.ts';
import { pluginFieldKey } from '@mire/ui/utils';
import type {
  OrderListView,
  PageThemeView,
  PaletteView,
  SettingsActionView,
  SettingsEntryGroup,
  SettingsEntryView,
  SettingsFieldView,
  SettingsLabels,
  SettingsOptionView,
  SettingsPanelView,
} from '@mire/ui/utils';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Fournisseurs d'infos du cœur (`METADATA_PROVIDERS` du processus principal) : aucun depuis P5-16. */
export const METADATA_PROVIDERS: readonly string[] = [];

/** « Automatique » et palettes du cœur (P4-02) ; noms : `palettes.<id>`. Celles des plugins suivent (P5-02). */
export const PALETTES = ['auto', 'ecran', 'contraste'] as const;

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
  /** Palettes des plugins actifs (P5-02) : identifiant et clé de leur nom dans les catalogues. */
  pluginPalettes?: readonly { id: string; name: string }[];
  /** Fournisseurs d'infos des plugins actifs : ils rejoignent l'ordre des fournisseurs. */
  providers?: readonly PluginMetadataProvider[];
  /** État des sources après la dernière analyse (par identifiant de source), et analyse en cours. */
  sourceStatus?: Readonly<Record<string, SourceStatus>>;
  gameSourceStatus?: Readonly<Record<string, SourceStatus>>;
  scanning?: boolean;
  /** Informations rédigées : état du bloqueur, de la lecture protégée ; chemin du fichier de configuration. */
  adblockStatus?: string;
  drmStatus?: string;
  configPath?: string;
  /** Pages, avec leur origine et leur nombre d'éléments (`pages.overview`, P4-21) ; absent tant qu'elles manquent. */
  pages?: readonly PageOverview[];
  /** Tags avec leur apparence et qui les pose (`tags.overview`), listes, et noms des plugins par identifiant (P4-21). */
  tags?: readonly TagOverview[];
  lists?: readonly ListSummary[];
  pluginNames?: Readonly<Record<string, string>>;
}

/** État d'une source après l'analyse : nombre de fichiers trouvés, ou l'erreur. */
export interface SourceStatus {
  ok: boolean;
  count?: number;
  error?: string;
  /** Emplacement vide sans erreur : la raison (aucun plugin actif ne le lit). */
  note?: string;
}

/** Natures des sources, dans l'ordre de l'écran ; `game` : dossiers de jeux PC (`gameSources`). */
export const SOURCE_KINDS = ['video', 'audio', 'image', 'game'] as const;

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

/**
 * Ordre des fournisseurs d'infos : ceux de la configuration, puis les autres, ceux du cœur d'abord (comme
 * `metadataOrder`) ; `extra` : identifiants des fournisseurs des plugins actifs.
 */
export function providerOrder(config: unknown, extra: readonly string[] = []): string[] {
  const known = [...METADATA_PROVIDERS, ...extra];
  const chosen = valueAtPath(config, 'catalog.metadataProviders');
  const list = Array.isArray(chosen) ? chosen.filter((x): x is string => known.includes(x)) : [];
  return [...new Set([...list, ...known])];
}

/** Nom affiché d'un fournisseur : ceux du cœur ont le leur, ceux d'un plugin le nom du plugin. */
function providerLabel(id: string, src: PanelSources): string {
  const { t } = src;
  const p = src.providers?.find((x) => x.id === id);
  const same = (src.providers ?? []).filter((x) => x.plugin === p?.plugin).length > 1;
  return t('settingsView.providers.plugin', { name: p ? (same ? `${p.name} · ${id.split('/').pop()}` : p.name) : id });
}

const asList = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);

/** Nature d'un emplacement de source : dossier, partage réseau ou serveur web. */
export function locationType(location: string): 'folder' | 'network' | 'web' {
  if (/^https?:\/\//i.test(location)) return 'web';
  return /^(\\\\|\/\/|smb:)/i.test(location) ? 'network' : 'folder';
}

/** Sources d'une nature : une ligne par source, avec sa nature et son état après l'analyse. */
function sourceGroup(kind: (typeof SOURCE_KINDS)[number], src: PanelSources): SettingsEntryGroup {
  const { t } = src;
  const list =
    kind === 'game' ? asList(valueAtPath(src.config, 'gameSources')) : asList(valueAtPath(src.config, 'library.sources')).filter((x) => x.kind === kind);
  const status = (kind === 'game' ? src.gameSourceStatus : src.sourceStatus) ?? {};
  const entries = list.map((x): SettingsEntryView => {
    const location = asText(x.location);
    const st = status[asText(x.id)];
    const state = !st
      ? src.scanning
        ? t('settingsView.sources.scanning')
        : ''
      : st.ok
        ? st.note || t(`settingsView.sources.count.${kind}`, { count: st.count ?? 0 })
        : st.error || '';
    const type = t(`settingsView.sources.type.${locationType(location)}`);
    return { id: asText(x.id), label: location, sub: state ? `${type} · ${state}` : type, ...(st && !st.ok ? { error: true } : {}) };
  });
  return {
    key: `sources:${kind}`,
    label: t(`settingsView.sources.kinds.${kind}`),
    entries,
    empty: t('settingsView.sources.none'),
    remove: true,
    buttons: [
      { label: t('settingsView.sources.addFolder'), action: 'addSourceFolder' },
      { label: t('settingsView.sources.addAddress'), action: 'addSourceAddress', ghost: true },
    ],
  };
}

/** Services de télévision : un choix parmi eux, la détection de la box ; l'adresse d'une playlist active. */
function tvFields(base: Pick<SettingsFieldView, 'key' | 'label' | 'help'>, src: PanelSources): SettingsFieldView[] {
  const { t } = src;
  const active = asText(valueAtPath(src.config, 'tv.active'));
  const services = asList(valueAtPath(src.config, 'tv.services'));
  const entries = services.map((x) => ({
    id: asText(x.id),
    label: asText(x.name) || asText(x.id),
    sub: t(x.kind === 'web' ? 'settingsView.tv.web' : 'settingsView.tv.playlist'),
    current: x.id === active,
  }));
  const current = services.find((x) => x.id === active);
  const group: SettingsEntryGroup = {
    key: 'tv',
    label: base.label,
    entries,
    empty: t('settingsView.tv.none'),
    choose: true,
    buttons: [
      { label: t('settingsView.tv.detect'), action: 'detectTvBox' },
      ...(current ? [{ label: t('settingsView.tv.reload'), action: 'reloadTv' as const, ghost: true }] : []),
    ],
  };
  const fields: SettingsFieldView[] = [{ ...base, kind: 'entries', groups: [group] }];
  if (current?.kind === 'playlist') {
    fields.push({
      key: 'tv.playlist',
      kind: 'text',
      label: t('settingsView.tv.url', { name: asText(current.name) || asText(current.id) }),
      value: asText(current.url),
    });
  }
  return fields;
}

/** Sites de streaming : la liste, et un site à ajouter (nom, adresse). */
function webGroup(src: PanelSources): SettingsEntryGroup {
  const { t } = src;
  return {
    key: 'web',
    entries: asList(valueAtPath(src.config, 'web')).map((x) => ({ id: asText(x.id), label: asText(x.name) || asText(x.url), sub: asText(x.url) })),
    empty: t('settingsView.web.none'),
    remove: true,
    inputs: [
      { id: 'name', label: t('settingsView.web.name'), placeholder: t('settingsView.web.namePlaceholder') },
      { id: 'url', label: t('settingsView.web.url'), placeholder: t('settingsView.web.urlPlaceholder') },
    ],
    buttons: [{ label: t('settingsView.add'), action: 'addEntry' }],
  };
}

/** Jeux PC ajoutés à la main (désignés par leur chemin). */
function pcGamesGroup(src: PanelSources): SettingsEntryGroup {
  const { t } = src;
  return {
    key: 'games',
    entries: asList(valueAtPath(src.config, 'games')).map((x) => {
      const path = asText(x.path);
      return { id: path, label: asText(x.name) || path.split(/[\\/]/).pop() || path, sub: path };
    }),
    empty: t('settingsView.pcGames.none'),
    remove: true,
    buttons: [{ label: t('settingsView.pcGames.add'), action: 'addPcGame' }],
  };
}

/** Sites pour télécharger des jeux PC : nom, adresse, adresse de recherche avec {q}. */
function pcSitesGroup(src: PanelSources): SettingsEntryGroup {
  const { t } = src;
  return {
    key: 'pcSites',
    entries: asList(valueAtPath(src.config, 'pcSites')).map((x) => ({
      id: asText(x.url) || asText(x.name),
      label: asText(x.name) || asText(x.url),
      sub: [asText(x.url), asText(x.search)].filter(Boolean).join(' · '),
    })),
    empty: t('settingsView.pcSites.none'),
    remove: true,
    inputs: [
      { id: 'name', label: t('settingsView.pcSites.name') },
      { id: 'url', label: t('settingsView.pcSites.url'), placeholder: 'https://…' },
      { id: 'search', label: t('settingsView.pcSites.search'), placeholder: 'https://…?q={q}' },
    ],
    buttons: [{ label: t('settingsView.add'), action: 'addEntry' }],
  };
}

/** Champs d'un bloc personnalisé (le service de télévision en donne deux : le choix, puis l'adresse de la playlist). */
function customFields(field: Extract<SettingsField, { type: 'custom' }>, block: SettingsBlock, src: PanelSources): SettingsFieldView[] {
  const { t } = src;
  const base = { key: `${block.id}.${field.id}`, label: t(field.label), ...(field.help ? { help: t(field.help) } : {}) };
  if (field.component === 'themes') {
    const theme = asText(valueAtPath(src.config, 'ui.theme')) || 'ecran';
    const extra = (src.pluginPalettes ?? []).filter((p) => !(PALETTES as readonly string[]).includes(p.id));
    // Aperçu d'« Automatique » : sa palette claire si un plugin l'apporte, sinon la palette par défaut.
    const light = extra.some((p) => p.id === AUTO_PALETTES.light) ? AUTO_PALETTES.light : DEFAULT_PALETTE;
    const palettes: PaletteView[] = [
      ...PALETTES.map((id) => ({
        id,
        name: t(id === 'auto' ? 'settingsView.palettes.auto' : `palettes.${id}`),
        preview: id === 'auto' ? [AUTO_PALETTES.dark, light] : [id],
      })),
      ...extra.map((p) => ({ id: p.id, name: t(p.name), preview: [p.id] })),
    ].map((p) => ({ ...p, current: p.id === theme }));
    const pageThemes = src.pageThemes.map((th) => ({ ...th, current: th.id === src.currentPageTheme }));
    return [{ ...base, kind: 'themes', palettes, pageThemes }];
  }
  if (field.component === 'ordered-list' && field.paths[0] === 'ui.home.rows') {
    return [{ ...base, kind: 'order', lists: src.homeLists.map((l) => ({ ...l, toggle: true })) }];
  }
  switch (field.component) {
    case 'ordered-list': {
      const extra = (src.providers ?? []).map((p) => p.id);
      const items = providerOrder(src.config, extra).map((id) => ({ id, label: providerLabel(id, src), color: 'var(--muted)', on: true }));
      return [{ ...base, kind: 'order', lists: [{ kind: 'providers', label: t(field.label), items, toggle: false }] }];
    }
    case 'sources':
      return [{ ...base, kind: 'entries', groups: SOURCE_KINDS.map((k) => sourceGroup(k, src)) }];
    case 'tv-services':
      return tvFields(base, src);
    case 'web-sites':
      return [{ ...base, kind: 'entries', groups: [{ ...webGroup(src), label: base.label }] }];
    case 'pc-games':
      return [{ ...base, kind: 'entries', groups: [{ ...pcGamesGroup(src), label: base.label }] }];
    case 'link-sites':
      return [{ ...base, kind: 'entries', help: t('settingsView.pcSites.help'), groups: [{ ...pcSitesGroup(src), label: base.label }] }];
    case 'store':
      return [
        {
          ...base,
          key: 'store.romsRoot',
          kind: 'path',
          pick: 'folder',
          help: t('settingsView.store.help'),
          placeholder: t('settingsView.store.placeholder'),
          value: asText(valueAtPath(src.config, 'store.romsRoot')),
        },
      ];
    case 'consoles':
      // Les consoles se créent et se modifient dans l'onglet « Consoles » du Centre (P4-17) : un lien y mène.
      return [{ ...base, kind: 'link', help: t('settingsView.consoles.help'), link: { tab: 'consoles', label: t('settingsView.consoles.open') } }];
    default:
      return [];
  }
}

/** Champ du schéma tel que la vue l'affiche, avec sa valeur dans la configuration. */
export function fieldView(field: SettingsField, block: SettingsBlock, src: PanelSources): SettingsFieldView {
  return fieldViews(field, block, src)[0] as SettingsFieldView;
}

/** Champs que la vue affiche pour un champ du schéma : un seul, sauf pour certains blocs personnalisés. */
export function fieldViews(field: SettingsField, block: SettingsBlock, src: PanelSources): SettingsFieldView[] {
  if (field.type === 'custom') return customFields(field, block, src);
  return [simpleField(field, src)];
}

function simpleField(field: Exclude<SettingsField, { type: 'custom' }>, src: PanelSources): SettingsFieldView {
  const { t } = src;
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
      // Choix marqués `buttons` dans le schéma : en boutons (`ds-toggle-group`), quelle que soit la langue.
      return {
        ...view,
        kind: field.buttons ? 'segmented' : 'choice',
        value: typeof raw === 'string' ? raw : field.default,
        options: choiceOptions(field, src),
      };
    case 'path':
      return { ...view, value: asText(raw), pick: field.pick };
    default:
      return { ...view, value: asText(raw) };
  }
}

/** Informations et boutons d'action propres à un bloc (ce ne sont pas des réglages). */
function blockExtras(block: SettingsBlock, src: PanelSources): Pick<SettingsPanelView, 'notes' | 'actions'> {
  const { t } = src;
  const a = (key: string, action: SettingsActionView['action'], ghost?: boolean): SettingsActionView => ({
    label: t(`settingsView.actions.${key}`),
    action,
    ...(ghost ? { ghost } : {}),
  });
  switch (block.id) {
    case 'sources':
      return { actions: [a('rescan', 'rescan', true)] };
    case 'scrape':
      return { actions: [a('scrapeAll', 'scrapeAll'), a('scrapeClear', 'clearScrape', true)] };
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
    fields: block.fields.flatMap((f) => fieldViews(f, block, src)),
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

/** Panneau « Tags » (P4-21) : les tags, puis les règles par type de fichier. */
function tagsPanel(src: PanelSources): SettingsPanelView {
  const { t } = src;
  const tags = src.tags ?? [];
  return {
    id: 'tags',
    title: t('settingsView.tags.title'),
    help: t('settingsView.tags.help'),
    fields: [
      { key: 'tags', kind: 'entries', label: t('settingsView.tags.title'), groups: [tagsGroup(tags, src.pluginNames ?? {}, t)] },
      {
        key: 'fileTags',
        kind: 'entries',
        label: t('settingsView.tags.rules.label'),
        help: t('settingsView.tags.rules.help'),
        groups: [fileRulesGroup(src.config, tags, t)],
      },
    ],
  };
}

/** Panneau « Listes » (P4-21) : leur ordre (à partir de deux listes), puis chacune avec Modifier et Retirer. */
function listsPanel(src: PanelSources): SettingsPanelView {
  const { t } = src;
  const lists = src.lists ?? [];
  const fields: SettingsFieldView[] = [];
  if (lists.length > 1) fields.push({ key: 'lists.order', kind: 'order', label: t('settingsView.lists.order'), lists: [listsOrder(lists, t)] });
  fields.push({ key: 'lists', kind: 'entries', label: t('settingsView.lists.title'), groups: [listsGroup(lists, t)] });
  return { id: 'lists', title: t('settingsView.lists.title'), help: t('settingsView.lists.help'), fields };
}

/** Tous les panneaux : le schéma, la lecture protégée, l'éditeur JSON, la configuration, puis les plugins. */
export function settingsPanels(src: PanelSources): SettingsPanelView[] {
  const { t } = src;
  return [
    ...schemaPanels(src),
    {
      id: 'pages',
      title: t('settingsView.pages.title'),
      help: t('settingsView.pages.help'),
      fields: [{ key: 'pages', kind: 'entries', label: t('settingsView.pages.title'), groups: [pagesGroup(src.pages ?? [], t)] }],
    },
    tagsPanel(src),
    listsPanel(src),
    { id: 'drm', title: t('settingsView.drm.title'), fields: [], notes: [src.drmStatus || t('settingsView.checking')] },
    { id: 'advanced', title: t('settingsView.advanced.title'), help: t('settingsView.advanced.help'), fields: [], json: advancedJson(src.config) },
    {
      id: 'assistant',
      title: t('settingsView.assistant.title'),
      help: t('settingsView.assistant.help'),
      fields: [],
      actions: [{ label: t('settingsView.assistant.run'), action: 'runAssistant' }],
    },
    {
      id: 'config',
      title: t('settingsView.config.title'),
      help: t('settingsView.config.help'),
      fields: [],
      notes: src.configPath ? [src.configPath] : [],
      actions: [
        { label: t('settingsView.actions.export'), action: 'exportConfig' },
        { label: t('settingsView.actions.importReplace'), action: 'importConfig', mode: 'replace' },
        { label: t('settingsView.actions.importMerge'), action: 'importConfig', mode: 'merge', ghost: true },
        { label: t('settingsView.actions.reveal'), action: 'revealConfig', ghost: true },
      ],
    },
    ...pluginPanels(src.plugins, t),
  ];
}

/** État du bloqueur (`adblockStatus`), tel que l'écran l'affiche. */
export interface AdblockState {
  updating?: boolean;
  ready?: boolean;
  loaded?: number;
  updated?: number | string | null;
  failed?: string[];
}

/** Texte de l'état du bloqueur ; `date` met en forme le jour de la dernière mise à jour. */
export function adblockStatusText(st: AdblockState | null | undefined, t: Translate, date: (d: Date) => string): string {
  if (!st) return t('settingsView.checking');
  let text: string;
  if (st.updating) text = t('settingsView.adblock.updating');
  else if (st.ready) {
    const count = st.loaded ?? 0;
    text = st.updated ? t('settingsView.adblock.loadedOn', { count, date: date(new Date(st.updated)) }) : t('settingsView.adblock.loaded', { count });
  } else text = t('settingsView.adblock.notLoaded');
  if (st.failed?.length) text += ` ${t('settingsView.adblock.failed', { lists: st.failed.map((u) => u.split('/').pop()).join(', ') })}`;
  return text;
}

/** État de la lecture protégée (`drmStatus`), tel que l'écran l'affiche. */
export function drmStatusText(d: { ecs?: boolean; widevine?: { version?: string } | null; platform?: string } | null | undefined, t: Translate): string {
  if (!d) return t('settingsView.checking');
  if (!d.ecs) return t('settingsView.drm.noWidevine');
  if (!d.widevine?.version) return t('settingsView.drm.pending');
  const text = t('settingsView.drm.installed', { version: d.widevine.version });
  return d.platform === 'linux' ? text : `${text} ${t('settingsView.drm.sign')}`;
}

/** Textes de la vue (`SettingsLabels`). */
export function settingsLabels(t: Translate): SettingsLabels {
  const k = (key: string) => t(`settingsView.${key}`);
  const sortable = ['instructions', 'grabbed', 'moved', 'dropped', 'cancelled', 'moveBefore', 'moveAfter'];
  return {
    browse: k('browse'),
    add: k('add'),
    remove: k('remove'),
    edit: k('edit'),
    restore: k('restore'),
    empty: k('empty'),
    secretSet: k('secretSet'),
    current: k('current'),
    save: k('save'),
    show: k('show'),
    hide: k('hide'),
    hidden: k('hidden'),
    sortable: JSON.stringify(Object.fromEntries(sortable.map((s) => [s, k(`sortable.${s}`)]))),
  };
}
