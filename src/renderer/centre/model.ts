/**
 * Centre (P4-18), côté page et sans DOM : les lignes des téléchargements, les cartes des apps (émulateurs, jeux libres,
 * rappels de BIOS) et les annonces, rédigées par les catalogues (section `centre`) à partir des données du processus
 * principal (téléchargements, catalogue de la boutique, avancement des installations, jeu ajouté).
 */
import type { StoreProgress } from '@mire/shared/ipc';
import type { AppEmulator, AppGame, AppProgress, AppsView, DownloadRow } from '@mire/ui/utils';
import { barFor, monogram } from '../core/colors.ts';

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Traduction et langue (nombres écrits selon la langue). */
export interface Writer {
  t: Translate;
  lang: string;
}

type Item = Record<string, any>;

/** États d'un téléchargement en cours (pas en pause, ni terminé). */
export const ACTIVE_STATES: ReadonlySet<string> = new Set(['waiting', 'downloading', 'extracting']);
const STOPPED = new Set(['error', 'interrupted', 'cancelled']);
const UNITS = ['b', 'kb', 'mb', 'gb', 'tb'];

/** Taille en multiples de 1024 : « 1,5 Mo », « 1.5 MB ». */
export function formatBytes(n: number, w: Writer): string {
  const size = Number(n) || 0;
  const k = size ? Math.min(UNITS.length - 1, Math.floor(Math.log(size) / Math.log(1024))) : 0;
  const value = (size / 1024 ** k).toLocaleString(w.lang, { maximumFractionDigits: k > 1 ? 1 : 0 });
  return w.t(`centre.size.${UNITS[k]}`, { value });
}

/** Temps restant (en millisecondes) : « 12 min », « 1 h 05 » ; vide s'il est inconnu. */
export function formatEta(ms: number, w: Writer): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return w.t('centre.eta.soon');
  if (m < 60) return w.t('centre.eta.minutes', { minutes: String(m) });
  return w.t('centre.eta.hours', { hours: String(Math.floor(m / 60)), minutes: String(m % 60).padStart(2, '0') });
}

/** Ligne d'infos : « En cours · 1,5 Mo sur 3 Mo · 200 Ko/s · 4 pairs · reste 2 min · vers Super Nintendo ». */
export function downloadMeta(d: Item, w: Writer): string {
  const { t } = w;
  const state = String(d.state ?? '');
  const parts = [t(`centre.downloads.state.${state}`)];
  if (d.total) parts.push(state === 'done' ? formatBytes(d.total, w) : t('centre.downloads.meta.progress', { received: formatBytes(d.received || 0, w), total: formatBytes(d.total, w) }));
  else if (d.received) parts.push(formatBytes(d.received, w));
  if (state === 'downloading' && d.speed) parts.push(t('centre.downloads.meta.speed', { speed: formatBytes(d.speed, w) }));
  if (d.kind === 'torrent' && ACTIVE_STATES.has(state)) parts.push(t('centre.downloads.meta.peers', { count: Number(d.peers) || 0 }));
  if (state === 'downloading' && d.eta) parts.push(t('centre.downloads.meta.eta', { eta: formatEta(d.eta, w) }));
  if (d.consoleName) parts.push(t('centre.downloads.meta.toConsole', { console: String(d.consoleName) }));
  else if (d.dir) parts.push(t('centre.downloads.meta.toDownloads'));
  if (d.group) parts.push(t('centre.downloads.meta.group', { group: String(d.group) }));
  if (d.companions) parts.push(t('centre.downloads.meta.companions', { count: Number(d.companions) }));
  if (d.extracted) parts.push(t('centre.downloads.meta.extracted'));
  return parts.filter(Boolean).join(' · ');
}

/** Avancement d'un téléchargement en pour cent ; `null` s'il n'a pas de barre. */
export function downloadPercent(d: Item): number | null {
  if (d.state === 'external') return null;
  if (d.total) return Math.min(100, Math.round(((d.received || 0) / d.total) * 100));
  return d.state === 'done' ? 100 : 0;
}

const fileName = (file: string) => file.split(/[\\/]/).pop() || file;

/** Une ligne de la liste : textes, barre et boutons selon l'état (les mêmes que la vue historique). */
export function downloadRow(d: Item, w: Writer): DownloadRow {
  const state = String(d.state ?? '');
  const active = ACTIVE_STATES.has(state) && state !== 'extracting';
  const done = state === 'done';
  return {
    id: String(d.id),
    name: String(d.name || w.t('centre.downloads.untitled')),
    kind: w.t(`centre.downloads.kind.${d.kind === 'torrent' ? 'torrent' : 'http'}`),
    state,
    meta: downloadMeta(d, w),
    percent: downloadPercent(d),
    error: String(d.error || ''),
    actions: {
      pause: active,
      resume: state === 'paused',
      retry: STOPPED.has(state),
      cancel: active || state === 'paused',
      remove: STOPPED.has(state) || done || state === 'pending' || state === 'external',
      reveal: done,
      start: state === 'pending',
    },
    installers: done ? ((d.installers as string[]) || []).slice(0, 2).map((file) => ({ file, label: w.t('centre.downloads.actions.install', { file: fileName(file) }) })) : [],
  };
}

/** Vrai pour un téléchargement « en cours » (actif, en pause ou en attente), affiché en premier. */
export const isRunning = (d: Item): boolean => ACTIVE_STATES.has(d.state) || d.state === 'paused' || d.state === 'pending';

/** Les deux listes du Centre : en cours, puis terminés et autres. */
export function downloadGroups(list: readonly Item[], w: Writer): { running: DownloadRow[]; others: DownloadRow[] } {
  return {
    running: list.filter(isRunning).map((d) => downloadRow(d, w)),
    others: list.filter((d) => !isRunning(d)).map((d) => downloadRow(d, w)),
  };
}

/**
 * Applique un changement reçu du processus principal à la liste : nouveau, modifié ou retiré (`removed`). `fine` est
 * vrai quand seule la ligne de ce téléchargement change (même état : la barre et la ligne d'infos) ; sinon la liste
 * change de forme (boutons, groupe, ordre) et se redessine.
 */
export function applyDownload(list: readonly Item[], item: Item): { list: Item[]; fine: boolean } {
  const i = list.findIndex((x) => x.id === item.id);
  if (item.removed) return { list: list.filter((x) => x.id !== item.id), fine: false };
  if (i < 0) return { list: [item, ...list], fine: false };
  const next = [...list];
  next[i] = item;
  return { list: next, fine: list[i].state === item.state && !!list[i].error === !!item.error };
}

/** Texte de l'aide sous l'ajout d'un lien, selon le client torrent choisi. */
export const downloadsHint = (torrentClient: unknown, t: Translate): string =>
  t(torrentClient === 'system' ? 'centre.downloads.hint.system' : 'centre.downloads.hint.mire');

/* ------------------------------------------------------------------ */
/* Apps                                                                */
/* ------------------------------------------------------------------ */

const isBusy = (p: StoreProgress | undefined) => !!p && p.phase !== 'done' && p.phase !== 'error';

/** Avancement d'une installation, rédigé ; `null` s'il n'y en a pas (ou si elle est finie). */
export function progressText(p: StoreProgress | undefined, w: Writer): AppProgress | null {
  if (!isBusy(p)) return null;
  const { t } = w;
  const step = (() => {
    switch (p!.step) {
      case 'latestVersion':
        return t('centre.progress.latestVersion');
      case 'program':
        return t('centre.progress.program', { name: p!.name ?? '', version: String(p!.version ?? '').replace(/^v/, '') }).trim();
      case 'core':
        return t('centre.progress.core', { core: p!.core ?? '' });
      case 'game':
        return t('centre.progress.game', { name: p!.name ?? '' });
      case 'extracting':
        return t('centre.progress.extracting', { name: p!.name ?? '' });
      default:
        return t('centre.progress.preparing');
    }
  })();
  const { received = 0, total = 0 } = p!;
  if (p!.phase === 'download' && total) {
    return { text: t('centre.progress.amount', { step, received: formatBytes(received, w), total: formatBytes(total, w) }), percent: Math.min(100, Math.round((received / total) * 100)) };
  }
  return { text: step, percent: null };
}

type Catalog = Item & { emulators: Item[]; games: Item[] };

export interface AppsState {
  /** Consoles cochées pour RetroArch. */
  picks: ReadonlySet<string>;
  /** Avancement des installations, par émulateur (`<id>`) ou jeu (`game:<id>`). */
  progress: Readonly<Record<string, StoreProgress | undefined>>;
  /** Consoles déclarées : l'import demande une console qui a un dossier de jeux. */
  consoles: readonly Item[];
}

function emulatorCard(e: Item, s: AppsState, w: Writer): AppEmulator {
  const { t } = w;
  const progress = s.progress[e.id];
  const busy = isBusy(progress) || !!e.busy;
  const version = e.version && e.version !== 'latest' ? String(e.version).replace(/^v/, '') : '';
  const status = !e.available
    ? t('centre.apps.status.unavailable')
    : e.installed
      ? version
        ? t('centre.apps.status.installedVersion', { version })
        : t('centre.apps.status.installed')
      : t('centre.apps.status.notInstalled');
  const picked = (e.systems as Item[]).filter((sy) => s.picks.has(sy.id)).length;
  const install = e.retroarch
    ? { label: picked ? t('centre.apps.addConsoles', { count: picked }) : t('centre.apps.chooseConsoles'), disabled: busy || !e.available || !picked, primary: true }
    : { label: t(e.installed ? 'centre.apps.update' : 'centre.apps.install'), disabled: busy || !e.available, primary: !e.installed };
  const bios = e.bios
    ? {
        hint: String(e.bios.hint ?? ''),
        files: e.bios.files?.length ? t('centre.apps.bios.files', { files: e.bios.files.join(', ') }) : t('centre.apps.bios.none'),
        dir: t('centre.apps.bios.dir', { dir: String(e.bios.dir ?? '') }),
      }
    : null;
  return {
    id: String(e.id),
    name: String(e.name),
    desc: String(e.desc ?? ''),
    status,
    installed: !!e.installed,
    retroarch: !!e.retroarch,
    systems: (e.systems as Item[]).map((sy) => ({ id: String(sy.id), name: String(sy.name), installed: !!sy.installed, picked: s.picks.has(sy.id) })),
    systemsLabel: t('centre.apps.systems', { name: String(e.name) }),
    progress: progressText(progress, w),
    install,
    uninstall: e.installed ? { label: t('centre.apps.uninstall'), disabled: busy } : null,
    bios,
  };
}

function gameCard(g: Item, s: AppsState, w: Writer): AppGame {
  const { t } = w;
  const progress = s.progress[`game:${g.id}`];
  const system = String(g.systemName ?? g.system ?? '');
  return {
    id: String(g.id),
    name: String(g.name),
    meta: t('centre.apps.gameMeta', { system, author: String(g.author ?? '') }),
    desc: String(g.desc ?? ''),
    monogram: monogram(String(g.name)),
    color: `var(--bar-${barFor(g.system)})`,
    installed: !!g.installed,
    ready: !!g.ready,
    status: g.installed ? t('centre.apps.inLibrary') : g.ready ? '' : t('centre.apps.needConsole', { system }),
    busy: isBusy(progress),
    progress: progressText(progress, w),
  };
}

/** L'onglet des apps, d'après le catalogue de la boutique (`storeCatalog`) ; `null` tant qu'il n'est pas lu. */
export function appsView(catalog: Catalog | null | undefined, s: AppsState, w: Writer): AppsView | null {
  if (!catalog) return null;
  return {
    root: String(catalog.romsRoot ?? ''),
    unavailable: catalog.platform === 'other',
    emulators: catalog.emulators.map((e) => emulatorCard(e, s, w)),
    games: catalog.games.map((g) => gameCard(g, s, w)),
    canImport: s.consoles.some((c) => c.romsDir),
  };
}

/* ------------------------------------------------------------------ */
/* Annonces                                                            */
/* ------------------------------------------------------------------ */

/** « Jeu ajouté » (canal `rom-download`) : nom, console, nombre de fichiers d'un jeu sur disque, archive décompressée. */
export function romAddedNotice(p: Item, t: Translate): string {
  const detail = [p.files > 1 ? t('centre.notices.romFiles', { count: Number(p.files) }) : '', p.extracted ? t('centre.notices.romExtracted') : '']
    .filter(Boolean)
    .join(', ');
  const vars = { name: String(p.name ?? ''), console: String(p.consoleName ?? '') };
  return detail ? t('centre.notices.romAddedDetail', { ...vars, detail }) : t('centre.notices.romAdded', vars);
}

/** Avancement du téléchargement d'un jeu en ligne avant son lancement (canal `rom-progress`). */
export function romProgressNotice(p: Item, t: Translate): string {
  const name = String(p.name ?? '');
  if (p.phase === 'done') return t('centre.notices.romReady', { name });
  if (p.total) return t('centre.notices.romProgress', { name, percent: Math.round((p.received / p.total) * 100) });
  return t('centre.notices.romProgressUnknown', { name });
}

/** Résultat d'un ajout (canal `download-added`) : erreur, confié au logiciel de torrent, ou ajouté. */
export function downloadAddedNotice(r: Item, t: Translate): string {
  if (!r.ok) return r.error || t('centre.downloads.messages.startFailed');
  return t(r.external ? 'centre.downloads.messages.external' : 'centre.downloads.messages.addedFollow');
}
