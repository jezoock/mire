/**
 * Centre (P4-18), côté page : l'hôte `<mire-centre>` et sa vue (`mire-centre-view`), remplis d'après les
 * téléchargements, le catalogue de la boutique et l'avancement des installations, rédigés par les catalogues
 * (`model.ts`). L'interface historique place l'hôte dans la vue des écrans quand le Centre est affiché (section
 * `downloads`) ; il garde son contenu entre deux affichages.
 *
 * Mises à jour fines : quand un téléchargement avance sans changer d'état, seule sa ligne (`mire-download-row`)
 * reçoit la nouvelle ligne ; la vue n'est pas redessinée.
 */
import type { CentreLabels, CentreTab, DownloadRow, DownloadRowLabels } from '@mire/ui/utils';
import { centreTab } from '@mire/ui/utils';
import { appsView, downloadGroups, downloadRow, downloadsHint } from './model.ts';
import type { AppsState, Translate, Writer } from './model.ts';

export * from './model.ts';

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
}

type ViewEl = HTMLElement & { running?: DownloadRow[]; others?: DownloadRow[]; [prop: string]: unknown };

const LABEL_KEYS: Record<keyof CentreLabels, string> = {
  tabs: 'tabs.label',
  tabDownloads: 'tabs.downloads',
  tabApps: 'tabs.apps',
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
  const writer = (): Writer => ({ t: opts.t, lang: opts.language() || 'fr' });

  function refresh() {
    const w = writer();
    const catalog = opts.catalog();
    if (tab === 'apps' && !catalog) void opts.loadCatalog().then(() => tab === 'apps' && refresh());
    Object.assign(view, {
      tab,
      labels: centreLabels(w.t, opts.torrentClient()),
      rowLabels: rowLabels(w.t),
      ...downloadGroups(opts.downloads(), w),
      apps: appsView(catalog, opts.apps(), w),
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
  };
}
