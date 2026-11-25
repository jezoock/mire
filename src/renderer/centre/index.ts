/**
 * Centre (P4-18), côté page : l'hôte `<mire-centre>` et sa vue (`mire-centre-view`), remplis d'après les
 * téléchargements, le catalogue de la boutique et l'avancement des installations, rédigés par les catalogues
 * (`model.ts`). L'interface historique place l'hôte dans la vue des écrans quand le Centre est affiché (section
 * `downloads`) ; il garde son contenu entre deux affichages.
 *
 * Mises à jour fines : quand un téléchargement avance sans changer d'état, seule sa ligne (`mire-download-row`)
 * reçoit la nouvelle ligne ; la vue n'est pas redessinée.
 */
import type { CentreLabels, CentreTab, ConsoleCard, DownloadRow, DownloadRowLabels } from '@mire/ui/utils';
import { centreTab } from '@mire/ui/utils';
import { appsView, downloadGroups, downloadRow, downloadsHint } from './model.ts';
import type { AppsState, Translate, Writer } from './model.ts';
import { pluginsView, reposView } from './plugins.ts';
import type { PluginsState } from './plugins.ts';

export * from './model.ts';
export * from './plugins.ts';

export interface CentreOptions {
  t: Translate;
  /** Langue de l'interface (nombres). */
  language(): string;
  /** Téléchargements connus (copie locale de la liste du processus principal). */
  downloads(): readonly Record<string, any>[];
  /** Client torrent choisi (`mire` ou `system`) : aide sous l'ajout d'un lien. */
  torrentClient(): unknown;
  /** Catalogue de la boutique, ou `null` tant qu'il n'est pas lu (`loadCatalog` le lit). */
  catalog(): any;
  loadCatalog(): Promise<void>;
  apps(): AppsState;
  /** Cartes de l'onglet des consoles (P4-17, `src/renderer/games/`). */
  consoles?(): ConsoleCard[];
  /** Plugins et dépôts (P4-19) : `null` tant que les listes ne sont pas lues (`loadPlugins` les lit, sans réseau). */
  plugins?(): PluginsState | null;
  loadPlugins?(): Promise<void>;
  onLanguageChange(listener: () => void): unknown;
  /** Le Centre a été redessiné (focus à rendre au contenu s'il s'est perdu). */
  onRendered(): void;
}

export interface Centre {
  /** Hôte du Centre, à placer dans la vue des écrans. */
  readonly host: HTMLElement;
  tab(): CentreTab;
  showTab(tab: unknown): void;
  /** Relit tout ce qu'affiche le Centre. */
  refresh(): void;
  /** Un téléchargement a avancé sans changer d'état : seule sa ligne change. Faux si la ligne n'est pas affichée. */
  updateDownload(item: Record<string, any>): boolean;
  /** Élément à focaliser après le prochain rendu (sélecteur dans la vue), demandé par une action. */
  focusAfterRender(selector: string): void;
  /** Le sélecteur demandé, une seule fois (la page le focalise après le rendu). */
  takeFocus(): string | null;
}

type ViewEl = HTMLElement & { running?: DownloadRow[]; others?: DownloadRow[]; [prop: string]: unknown };

const LABEL_KEYS: Record<keyof CentreLabels, string> = {
  tabs: 'tabs.label',
  tabDownloads: 'tabs.downloads',
  tabApps: 'tabs.apps',
  tabConsoles: 'tabs.consoles',
  tabPlugins: 'tabs.plugins',
  tabRepos: 'tabs.repos',
  pluginsIntro: 'plugins.intro',
  pluginsRefresh: 'plugins.refresh',
  pluginsLoading: 'plugins.loading',
  updates: 'plugins.updates',
  installed: 'plugins.installed',
  available: 'plugins.available',
  noInstalled: 'plugins.noInstalled',
  noAvailable: 'plugins.noAvailable',
  back: 'plugins.actions.back',
  sheetLabel: 'plugins.sheet.label',
  sheetPermissions: 'plugins.sheet.permissions',
  noPermissions: 'plugins.sheet.noPermissions',
  sheetContributes: 'plugins.sheet.contributes',
  noContributes: 'plugins.sheet.noContributes',
  sheetDependencies: 'plugins.sheet.dependencies',
  noDependencies: 'plugins.sheet.noDependencies',
  reposIntro: 'repos.intro',
  reposAdd: 'repos.addButton',
  reposRefresh: 'repos.refresh',
  reposIndex: 'repos.index',
  reposFingerprint: 'repos.fingerprint',
  reposRemove: 'repos.remove',
  reposNone: 'repos.none',
  reposLoading: 'repos.loading',
  continuity: 'plugins.continuity.title',
  continuityHelp: 'plugins.continuity.help',
  consolesHelp: 'consoles.help',
  newConsole: 'consoles.new',
  noConsoles: 'consoles.none',
  editConsole: 'consoles.edit',
  chooseEmulator: 'consoles.emulator',
  openSites: 'consoles.sites',
  removeConsole: 'consoles.remove',
  onlineGames: 'consoles.online',
  cleanupGames: 'consoles.cleanup',
  cleanupHelp: 'consoles.cleanupHelp',
  fromApps: 'consoles.fromApps',
  add: 'downloads.add',
  torrent: 'downloads.torrent',
  hint: '',
  running: 'downloads.running',
  others: 'downloads.others',
  noneRunning: 'downloads.noneRunning',
  noneOthers: 'downloads.noneOthers',
  clear: 'downloads.clear',
  loading: 'apps.loading',
  root: 'apps.root',
  changeRoot: 'apps.changeRoot',
  unavailable: 'apps.unavailable',
  emulators: 'apps.emulators',
  emulatorsHelp: 'apps.emulatorsHelp',
  systemAdded: 'apps.systemAdded',
  biosTitle: 'apps.bios.title',
  biosAdd: 'apps.bios.add',
  biosOpen: 'apps.bios.open',
  games: 'apps.games',
  gamesHelp: 'apps.gamesHelp',
  gamesNone: 'apps.gamesNone',
  download: 'apps.download',
  own: 'apps.own',
  ownHelp: 'apps.ownHelp',
  import: 'apps.import',
  noConsole: 'apps.noConsole',
};
const ROW_KEYS: (keyof DownloadRowLabels)[] = ['pause', 'resume', 'retry', 'cancel', 'remove', 'reveal', 'start'];

/** Textes du Centre, tirés des catalogues. */
export function centreLabels(t: Translate, torrentClient: unknown): CentreLabels {
  const labels = Object.fromEntries(Object.entries(LABEL_KEYS).map(([k, key]) => [k, key ? t(`centre.${key}`) : ''])) as CentreLabels;
  labels.hint = downloadsHint(torrentClient, t);
  return labels;
}

export const rowLabels = (t: Translate): DownloadRowLabels => Object.fromEntries(ROW_KEYS.map((k) => [k, t(`centre.downloads.actions.${k}`)]));

export function createCentre(opts: CentreOptions, doc: Document = document): Centre {
  const host = doc.createElement('mire-centre');
  const view = doc.createElement('mire-centre-view') as ViewEl;
  host.append(view);
  let tab: CentreTab = 'downloads';
  let loadingPlugins = false;
  let pendingFocus: string | null = null;
  const writer = (): Writer => ({ t: opts.t, lang: opts.language() || 'fr' });

  function refresh() {
    const w = writer();
    const catalog = opts.catalog();
    if (tab === 'apps' && !catalog) void opts.loadCatalog().then(() => tab === 'apps' && refresh());
    const plugins = opts.plugins?.() ?? null;
    if ((tab === 'plugins' || tab === 'repos') && !plugins && opts.loadPlugins && !loadingPlugins) {
      loadingPlugins = true;
      void opts.loadPlugins().finally(() => (loadingPlugins = false));
    }
    Object.assign(view, {
      tab,
      labels: centreLabels(w.t, opts.torrentClient()),
      rowLabels: rowLabels(w.t),
      ...downloadGroups(opts.downloads(), w),
      apps: appsView(catalog, opts.apps(), w),
      consoles: opts.consoles?.() ?? [],
      plugins: pluginsView(plugins, w),
      repos: reposView(plugins?.repos ?? null, w),
    });
  }

  function updateDownload(item: Record<string, any>): boolean {
    const el = view.querySelector<HTMLElement & { row: DownloadRow }>(`mire-download-row[data-key="${CSS.escape(String(item.id))}"]`);
    if (!el) return false;
    const row = downloadRow(item, writer());
    // La liste gardée par la vue suit, sans la remplacer : la vue n'est pas redessinée.
    for (const list of [view.running, view.others]) {
      const i = list?.findIndex((r) => r.id === row.id) ?? -1;
      if (list && i >= 0) list[i] = row;
    }
    el.row = row;
    return true;
  }

  view.addEventListener('mireCentreRender', () => opts.onRendered());
  opts.onLanguageChange(() => refresh());

  return {
    host,
    tab: () => tab,
    showTab(next) {
      tab = centreTab(next);
      refresh();
    },
    refresh,
    updateDownload,
    focusAfterRender(selector) {
      pendingFocus = selector;
    },
    takeFocus() {
      const sel = pendingFocus;
      pendingFocus = null;
      return sel;
    },
  };
}
