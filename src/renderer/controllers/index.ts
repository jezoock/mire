/**
 * Contrôleurs de l'interface (P4-04) : un par écran, désigné par la balise du composant qui l'expose. Leurs méthodes
 * publiques sont les actions de Mire, appelées par `ds-trigger`, par le pont des vues historiques (`bridge.ts`), par la
 * navigation (`nav/`) et par les lecteurs (`players/`). Conventions : `registry.ts` et docs/adr/0001-dot-stash.md § 8.
 */
import { AppController } from './app.ts';
import { CentreController } from './centre.ts';
import { DialogsController } from './dialogs.ts';
import { EditorController } from './editor.ts';
import { ExplorerController } from './explorer.ts';
import { GamesController } from './games.ts';
import { HomeController } from './home.ts';
import { ImagesController } from './images.ts';
import { MusicController } from './music.ts';
import { PageController } from './page.ts';
import { PlayerController } from './player.ts';
import { RescueController } from './rescue.ts';
import { registerController } from './registry.ts';
import { SearchController } from './search.ts';
import { SettingsController } from './settings.ts';
import { VideoController } from './video.ts';
import type { ControllerContext } from './types.ts';
import { WebController } from './web.ts';

/** Classe du contrôleur de chaque balise. */
export const CONTROLLER_CLASSES = {
  'mire-app': AppController,
  'mire-home': HomeController,
  'mire-page': PageController,
  'mire-explorer': ExplorerController,
  'mire-search': SearchController,
  'mire-centre': CentreController,
  'mire-settings': SettingsController,
  'mire-player': PlayerController,
  'mire-video-player': VideoController,
  'mire-mini-player': MusicController,
  'mire-image-viewer': ImagesController,
  'mire-web': WebController,
  'mire-dialogs': DialogsController,
  'mire-editor': EditorController,
  'mire-games': GamesController,
  'mire-rescue': RescueController,
} as const;

export type ControllerTag = keyof typeof CONTROLLER_CLASSES;

/** Les contrôleurs, par nom court (`app`, `page`…), pour les modules qui les appellent directement. */
export interface Controllers {
  app: AppController;
  home: HomeController;
  page: PageController;
  explorer: ExplorerController;
  search: SearchController;
  centre: CentreController;
  settings: SettingsController;
  player: PlayerController;
  video: VideoController;
  music: MusicController;
  images: ImagesController;
  web: WebController;
  dialogs: DialogsController;
  editor: EditorController;
  games: GamesController;
  rescue: RescueController;
}

/** Crée les contrôleurs et les enregistre (les éléments `mire-*` de la page reçoivent leurs actions). */
export function createControllers(ctx: ControllerContext): Controllers {
  const c: Controllers = {
    app: new AppController(ctx),
    home: new HomeController(ctx),
    page: new PageController(ctx),
    explorer: new ExplorerController(ctx),
    search: new SearchController(ctx),
    centre: new CentreController(ctx),
    settings: new SettingsController(ctx),
    player: new PlayerController(ctx),
    video: new VideoController(ctx),
    music: new MusicController(ctx),
    images: new ImagesController(ctx),
    web: new WebController(ctx),
    dialogs: new DialogsController(ctx),
    editor: new EditorController(ctx),
    games: new GamesController(ctx),
    rescue: new RescueController(ctx),
  };
  for (const [tag, Cls] of Object.entries(CONTROLLER_CLASSES)) {
    const instance = Object.values(c).find((x) => x instanceof Cls);
    if (instance) registerController(tag, instance);
  }
  return c;
}

export {
  AppController,
  CentreController,
  DialogsController,
  EditorController,
  ExplorerController,
  GamesController,
  HomeController,
  ImagesController,
  MusicController,
  PageController,
  PlayerController,
  SearchController,
  SettingsController,
  VideoController,
  WebController,
};
