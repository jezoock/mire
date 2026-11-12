/**
 * Cycle de vie de l'application : instance unique (un deuxième lancement passe ses fichiers à la fenêtre déjà
 * ouverte), fichiers passés en argument, démarrage une fois Electron prêt, menu de macOS, écritures différées
 * attendues avant de quitter.
 */
import fs from 'node:fs';

/** Fichiers passés en argument (« Ouvrir avec Mire ») : ni options, ni dossiers, ni chemins introuvables. */
export function filesFromArgv(argv: readonly string[], { packaged, isFile = isFileSync }: { packaged: boolean; isFile?: (p: string) => boolean }): string[] {
  return argv
    .slice(packaged ? 1 : 2)
    .filter((a) => a && !a.startsWith('-'))
    .filter((a) => isFile(a));
}

function isFileSync(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Fichiers reçus au lancement, en attendant que l'interface les demande. */
export function createPendingFiles(initial: string[]) {
  let files = initial;
  return {
    get: () => files,
    set(next: string[]) {
      files = next;
    },
  };
}

export type PendingFiles = ReturnType<typeof createPendingFiles>;

interface MenuApi {
  setApplicationMenu(menu: Electron.Menu | null): void;
  buildFromTemplate(template: Electron.MenuItemConstructorOptions[]): Electron.Menu;
}

/** Menu de l'application : celui de macOS (application, édition, fenêtre) ; aucun ailleurs. */
export function setApplicationMenu(Menu: MenuApi, platform: NodeJS.Platform): void {
  if (platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

/** Ce que la racine de composition rend une fois les services démarrés. */
export interface Running {
  /** Deuxième lancement de Mire, avec les fichiers passés en argument. */
  onSecondInstance(files: string[]): void;
  /** Icône du Dock cliquée (macOS). */
  onActivate(): void;
  /** Avant de quitter : écritures différées et arrêts (la promesse ne doit pas durer). */
  beforeQuit(): Promise<unknown>;
}

interface AppLike {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  whenReady(): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface LifecycleOptions {
  app: AppLike;
  platform: NodeJS.Platform;
  argv: readonly string[];
  packaged: boolean;
  /** Crée et démarre les services, ouvre la fenêtre. */
  start(pending: PendingFiles): Running;
}

/** Lance Mire : rien n'est démarré si une autre instance tourne déjà (elle reçoit nos fichiers). */
export function runApp({ app, platform, argv, packaged, start }: LifecycleOptions): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  const pending = createPendingFiles(filesFromArgv(argv, { packaged }));
  let running: Running | null = null;

  app.on('second-instance', (_e: unknown, args: string[]) => running?.onSecondInstance(filesFromArgv(args, { packaged })));

  app.whenReady().then(() => {
    running = start(pending);
    app.on('activate', () => running?.onActivate());
  });

  // Avant de quitter, on attend les écritures différées (deux secondes au plus), puis on quitte pour de bon.
  let flushedBeforeQuit = false;
  app.on('before-quit', (event: { preventDefault(): void }) => {
    if (flushedBeforeQuit) return;
    flushedBeforeQuit = true;
    event.preventDefault();
    (running ? running.beforeQuit() : Promise.resolve()).finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (platform !== 'darwin') app.quit();
  });
}
