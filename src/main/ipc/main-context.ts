/**
 * Contexte des handlers IPC, assemblé à partir des services créés par la racine de composition
 * (src/main/index.ts). La fenêtre, les fichiers en attente et les infos manuelles sont lus au moment de l'appel.
 */
import type { PendingFiles } from '../app/lifecycle.ts';
import type { ConfigService } from '../config/service.ts';
import type { Games } from '../games/index.ts';
import type { LanguageService } from '../i18n/index.ts';
import { locationError } from '../library/index.ts';
import type { LibraryService } from '../library/service.ts';
import type { UserMetaService } from '../meta/user-meta.ts';
import type { AccessPolicy } from '../security/access-policy.ts';
import type { DataPaths } from '../storage/paths.ts';
import type { UsageService } from '../usage/index.ts';
import type { Drm, WebManager } from '../web/index.ts';
import type { Dialogs } from '../window/dialogs.ts';
import type { MainWindow } from '../window/main-window.ts';
import type { ElectronApis, MainContext } from './context.ts';

type Fn = (...args: any[]) => any;

export interface MainServices {
  electron: ElectronApis;
  config: ConfigService;
  usage: UsageService;
  i18n: LanguageService;
  access: AccessPolicy;
  window: Pick<MainWindow, 'get' | 'themeBackground'>;
  pending: PendingFiles;
  meta: UserMetaService;
  files: Pick<DataPaths, 'config' | 'metaDir'>;
  library: LibraryService;
  dialogs: Pick<Dialogs, 'openMedia' | 'pickFolder' | 'pickFile'>;
  web: WebManager;
  scraper: MainContext['scraper'];
  store: MainContext['store'];
  downloads: MainContext['downloads'];
  adblock: MainContext['adblock'];
  players: { playExternal: Fn };
  tv: { detect: Fn; channels: Fn };
  drm: Pick<Drm, 'status'>;
  searchStreaming: Fn;
  games: Games;
}

export function mainContext(s: MainServices): MainContext {
  return {
    electron: s.electron,
    config: s.config,
    usage: s.usage,
    i18n: s.i18n,
    access: s.access,
    get mainWindow() {
      return s.window.get();
    },
    get pendingFiles() {
      return s.pending.get();
    },
    set pendingFiles(next) {
      s.pending.set(next);
    },
    get userMeta() {
      return s.meta.all();
    },
    web: s.web,
    scraper: s.scraper,
    store: s.store,
    downloads: s.downloads,
    adblock: s.adblock,
    configPath: () => s.files.config,
    themeBackground: s.window.themeBackground,
    scanLibrary: s.library.scan,
    findSubtitles: s.library.findSubtitles,
    openMediaDialog: s.dialogs.openMedia,
    itemFromPath: s.library.itemFromPath,
    locationError,
    pickFolder: s.dialogs.pickFolder,
    pickFile: s.dialogs.pickFile,
    metaDir: () => s.files.metaDir,
    saveMeta: s.meta.save,
    setMeta: s.meta.set,
    pickMetaImage: s.meta.pickImage,
    playExternal: s.players.playExternal,
    detectTvService: s.tv.detect,
    fetchChannels: s.tv.channels,
    drmStatus: s.drm.status,
    searchStreaming: s.searchStreaming,
    games: s.games,
  };
}
