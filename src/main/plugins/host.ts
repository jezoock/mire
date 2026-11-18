/**
 * Hôte isolé des plugins de niveau `code` (ADR 0002, hôte A) : une page cachée, sandboxée, sans Node, dans une
 * session en mémoire à lui, dont tout est refusé sauf `mire-plugin:` ; un Worker et un port par plugin.
 *
 * Isolement (ADR 0002, « Conséquences pour P3-03 ») :
 * - session en mémoire (partition sans `persist:`), `webRequest` qui annule toute requête qui n'est pas
 *   `mire-plugin:`, permissions refusées, téléchargements annulés ;
 * - fenêtres refusées, navigation annulée, WebRTC sans UDP ;
 * - `mire-plugin://` servi par cette session seule, en lecture, limité aux dossiers des plugins de cet hôte ;
 * - CSP de la page et des Workers (`protocol.ts`) ; liste de retrait dans chaque Worker (`host/worker.ts`).
 *
 * Le processus principal donne à chaque plugin un port à lui, créé ici : les requêtes reçues sur ce port sont
 * celles de ce plugin, quoi que dise le message.
 */
import path from 'node:path';
import { BrowserWindow, MessageChannelMain, session, type MessagePortMain, type Session, type WebContents } from 'electron';
import { adaptPort, createChannel, type Channel, type RequestHandler } from './channel.ts';
import { HOST_ORIGIN, PLUGIN_SCHEME, pluginProtocolHandler } from './protocol.ts';

/** Délai pour qu'un Worker démarre et annonce qu'il est prêt. */
const START_TIMEOUT = 10000;

export interface IsolatedHostOptions {
  /** Groupe de l'hôte (`installed` ; plus tard un par dépôt tiers) : nom de sa session. */
  group: string;
  /** `dist/plugin-host/` : page, Worker et preload. */
  hostDir: string;
  /** La page de l'hôte a disparu (plantage) : tous ses plugins sont arrêtés. */
  onGone(reason: string, plugins: string[]): void;
  /** Exception non rattrapée dans le Worker d'un plugin. */
  onWorkerError(pluginId: string, message: string): void;
}

export interface PluginEndpoint {
  /** Requêtes et événements de ce plugin seulement. */
  handle: RequestHandler;
  onEvent(name: string, data: unknown): void;
}

interface Running {
  win: BrowserWindow;
  wc: WebContents;
  control: MessagePortMain;
  ses: Session;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_r, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)))]).finally(() => clearTimeout(timer));
}

/** Ferme la session d'un hôte : rien ne sort, rien n'est accordé, seul `mire-plugin:` est servi. */
function lockSession(ses: Session, pluginDir: (id: string) => string | null, hostDir: string): void {
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !d.url.startsWith(`${PLUGIN_SCHEME}:`) }));
  ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (e) => e.preventDefault());
  if (ses.protocol.isProtocolHandled(PLUGIN_SCHEME)) ses.protocol.unhandle(PLUGIN_SCHEME);
  ses.protocol.handle(PLUGIN_SCHEME, pluginProtocolHandler({ hostDir, pluginDir }));
}

export function createIsolatedHost({ group, hostDir, onGone, onWorkerError }: IsolatedHostOptions) {
  const dirs = new Map<string, string>();
  const channels = new Map<string, Channel>();
  let running: Running | null = null;
  let starting: Promise<Running> | null = null;

  function gone(reason: string): void {
    const plugins = [...channels.keys()];
    for (const c of channels.values()) c.breakOff(reason);
    channels.clear();
    dirs.clear();
    const r = running;
    running = null;
    starting = null;
    if (r && !r.win.isDestroyed()) r.win.destroy();
    onGone(reason, plugins);
  }

  async function launch(): Promise<Running> {
    // Partition sans « persist: » : en mémoire, propre à ce groupe, jamais celle de la fenêtre ni des vues web.
    const ses = session.fromPartition(`mire-plugins-${group}`);
    lockSession(ses, (id) => dirs.get(id) ?? null, hostDir);
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        preload: path.join(hostDir, 'preload.js'),
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    const wc = win.webContents;
    // webRequest ne voit ni l'UDP de WebRTC (politique sans UDP), ni WebTransport et dns-prefetch (le code des plugins
    // tourne dans des Workers, sans DOM, avec la liste de retrait).
    wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.on('will-redirect', (e) => e.preventDefault());
    wc.on('render-process-gone', (_e, d) => gone(`Plugin host gone (${d.reason}).`));
    await wc.loadURL(`${HOST_ORIGIN}/index.html`);

    const { port1: control, port2 } = new MessageChannelMain();
    const ready = new Promise<void>((resolve) => {
      control.on('message', (e) => {
        const m = e.data as { t?: string; key?: string; message?: string };
        if (m?.t === 'ready') resolve();
        else if (m?.t === 'worker-error' && typeof m.key === 'string' && channels.has(m.key)) onWorkerError(m.key, String(m.message ?? ''));
      });
      control.start();
    });
    wc.postMessage('mire-host:port', null, [port2]);
    await withTimeout(ready, START_TIMEOUT, 'Plugin host page did not answer.');
    return (running = { win, wc, control, ses });
  }

  async function ensure(): Promise<Running> {
    if (running) return running;
    starting ??= launch().catch((err) => {
      starting = null;
      throw err;
    });
    return starting;
  }

  return {
    /** Démarre le Worker d'un plugin, servi depuis `dir` ; rend le canal attaché à son port. */
    async start(pluginId: string, dir: string, endpoint: PluginEndpoint, timeout: number): Promise<Channel> {
      const r = await ensure();
      dirs.set(pluginId, dir);
      const { port1, port2 } = new MessageChannelMain();
      let ready!: () => void;
      const announced = new Promise<void>((resolve) => (ready = resolve));
      const channel = createChannel(adaptPort(port1), {
        handle: endpoint.handle,
        onEvent: (name, data) => (name === 'ready' ? ready() : endpoint.onEvent(name, data)),
        timeout,
      });
      channels.set(pluginId, channel);
      r.control.postMessage({ t: 'start', key: pluginId }, [port2]);
      try {
        await withTimeout(announced, START_TIMEOUT, 'Plugin did not start.');
      } catch (err) {
        this.stop(pluginId);
        throw err;
      }
      return channel;
    },

    /** Arrête le Worker d'un plugin (les autres continuent) ; l'hôte s'arrête quand il n'a plus de plugin. */
    stop(pluginId: string): void {
      const channel = channels.get(pluginId);
      channels.delete(pluginId);
      dirs.delete(pluginId);
      channel?.close();
      if (!running) return;
      running.control.postMessage({ t: 'stop', key: pluginId });
      if (!channels.size) this.shutdown();
    },

    /** Arrête l'hôte et tous ses plugins (sans prévenir `onGone` : arrêt voulu). */
    shutdown(): void {
      for (const c of channels.values()) c.close();
      channels.clear();
      dirs.clear();
      const r = running;
      running = null;
      starting = null;
      if (r && !r.win.isDestroyed()) r.win.destroy();
    },

    /** Identifiant du processus de l'hôte (mesures, journal), ou `null`. */
    pid: (): number | null => (running ? running.wc.getOSProcessId() : null),
    plugins: (): string[] => [...channels.keys()],
  };
}

export type IsolatedHost = ReturnType<typeof createIsolatedHost>;
