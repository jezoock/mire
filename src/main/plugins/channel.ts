/**
 * Canal de requêtes sur un port, le même des deux côtés (processus principal, Worker d'un plugin, plugin sensible
 * dans le processus principal). Repris du prototype (`spikes/hote-isole/canal.mjs`, ADR 0002, « Échanges »).
 *
 *   requête    { t: 'req', id, cible, methode, args }
 *   réponse    { t: 'res', id, ok: true, valeur } | { t: 'res', id, ok: false, erreur: { code, message } }
 *   annulation { t: 'cancel', id }       (le demandeur n'attend plus ; le traitant reçoit un AbortSignal)
 *   événement  { t: 'evt', nom, donnees } (sans réponse : journal du plugin, événements de Mire)
 *
 * Seulement des données (clonage structuré). Ce fichier est aussi intégré au runtime de l'hôte (navigateur) : il
 * n'importe rien de Node ni d'Electron.
 */

/** Codes d'erreur stables du canal. */
export const CHANNEL_ERRORS = {
  timeout: 'timeout',
  cancelled: 'cancelled',
  notFound: 'not-found',
  plugin: 'plugin-error',
  hostGone: 'host-gone',
  unavailable: 'not-available',
} as const;

export type ChannelErrorCode = (typeof CHANNEL_ERRORS)[keyof typeof CHANNEL_ERRORS];

export class ChannelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Ce que le canal utilise d'un port : envoyer, écouter, fermer. */
export interface PortLike {
  send(message: unknown): void;
  listen(listener: (message: unknown) => void): void;
  close(): void;
}

interface NodeStylePort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (e: { data: unknown } | unknown) => void): unknown;
  start?(): void;
  close(): void;
}

interface WebStylePort {
  postMessage(message: unknown): void;
  // MessagePort du navigateur : (this, MessageEvent) => any.
  onmessage: ((e: any) => void) | null;
  close(): void;
}

/**
 * Adapte un port : `MessagePortMain` d'Electron (`on('message', e => e.data)`), `MessagePort` de `node:worker_threads`
 * (`on('message', data)`), ou `MessagePort` du navigateur (`onmessage`).
 */
export function adaptPort(port: NodeStylePort | WebStylePort): PortLike {
  if (typeof (port as NodeStylePort).on === 'function') {
    const p = port as NodeStylePort;
    // MessagePortMain passe un objet `{ data, ports }` ; node:worker_threads passe la donnée elle-même.
    const electronStyle = typeof (port as { start?: unknown }).start === 'function' && !('ref' in (port as object));
    return {
      send: (m) => p.postMessage(m),
      listen: (f) => {
        p.on('message', (e) => f(electronStyle ? (e as { data: unknown }).data : e));
        p.start?.();
      },
      close: () => p.close(),
    };
  }
  const p = port as WebStylePort;
  return {
    send: (m) => p.postMessage(m),
    listen: (f) => {
      p.onmessage = (e) => f(e.data);
    },
    close: () => p.close(),
  };
}

/** Traitement d'une requête reçue : cible, méthode, arguments ; le signal suit l'annulation par le demandeur. */
export type RequestHandler = (target: string, method: string, args: unknown[], signal: AbortSignal) => unknown;

export interface ChannelOptions {
  handle?: RequestHandler | null;
  onEvent?: ((name: string, data: unknown) => void) | null;
  /** Délai par défaut d'une requête, en millisecondes (0 : aucun). */
  timeout?: number;
}

export interface RequestOptions {
  /** Millisecondes avant abandon (0 : aucun) ; par défaut, celui du canal. */
  timeout?: number;
  signal?: AbortSignal;
}

export interface Channel {
  request<T = unknown>(target: string, method: string, args?: unknown[], options?: RequestOptions): Promise<T>;
  event(name: string, data?: unknown): void;
  /** Requêtes envoyées sans réponse encore. */
  pending(): number;
  /** L'autre côté a disparu : toutes les requêtes en attente échouent avec `host-gone`. */
  breakOff(reason: string): void;
  close(): void;
}

interface Waiting {
  resolve(v: unknown): void;
  reject(e: Error): void;
  abandon(code: string, message: string): void;
  timer: ReturnType<typeof setTimeout> | null;
}

type Message =
  | { t: 'req'; id: number; cible: string; methode: string; args?: unknown[] }
  | { t: 'res'; id: number; ok: true; valeur: unknown }
  | { t: 'res'; id: number; ok: false; erreur?: { code?: string; message?: string } }
  | { t: 'cancel'; id: number }
  | { t: 'evt'; nom: string; donnees: unknown };

const isMessage = (m: unknown): m is Message => !!m && typeof m === 'object' && typeof (m as { t?: unknown }).t === 'string';

const errorOf = (err: unknown) => ({
  code: typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : CHANNEL_ERRORS.plugin,
  message: String((err as { message?: unknown })?.message ?? err),
});

export function createChannel(port: PortLike, { handle = null, onEvent = null, timeout = 5000 }: ChannelOptions = {}): Channel {
  const waiting = new Map<number, Waiting>();
  const running = new Map<number, AbortController>();
  let next = 1;
  let closed: string | null = null;

  const reply = (id: number, ok: boolean, x: unknown) =>
    port.send(ok ? { t: 'res', id, ok: true, valeur: x } : { t: 'res', id, ok: false, erreur: x as { code: string; message: string } });

  async function receive(m: Extract<Message, { t: 'req' }>): Promise<void> {
    const ctrl = new AbortController();
    running.set(m.id, ctrl);
    try {
      if (!handle) throw new ChannelError(CHANNEL_ERRORS.notFound, 'Ce côté ne traite aucune requête.');
      const value = await handle(String(m.cible), String(m.methode), Array.isArray(m.args) ? m.args : [], ctrl.signal);
      if (!ctrl.signal.aborted) reply(m.id, true, value);
    } catch (err) {
      if (!ctrl.signal.aborted && !closed) {
        try {
          reply(m.id, false, errorOf(err));
        } catch {
          // Port fermé entre-temps : plus personne n'attend.
        }
      }
    } finally {
      running.delete(m.id);
    }
  }

  port.listen((m) => {
    if (!isMessage(m) || closed) return;
    if (m.t === 'req') void receive(m);
    else if (m.t === 'res') {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (w.timer) clearTimeout(w.timer);
      if (m.ok) w.resolve(m.valeur);
      else w.reject(new ChannelError(m.erreur?.code ?? CHANNEL_ERRORS.plugin, m.erreur?.message ?? ''));
    } else if (m.t === 'cancel') running.get(m.id)?.abort();
    else if (m.t === 'evt') onEvent?.(m.nom, m.donnees);
  });

  function request<T>(target: string, method: string, args: unknown[] = [], options: RequestOptions = {}): Promise<T> {
    if (closed) return Promise.reject(new ChannelError(CHANNEL_ERRORS.hostGone, closed));
    const id = next++;
    const ms = options.timeout ?? timeout;
    return new Promise<T>((resolve, reject) => {
      const w: Waiting = {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer: null,
        abandon(code, message) {
          if (!waiting.delete(id)) return;
          if (w.timer) clearTimeout(w.timer);
          if (!closed) port.send({ t: 'cancel', id });
          reject(new ChannelError(code, message));
        },
      };
      if (ms > 0) w.timer = setTimeout(() => w.abandon(CHANNEL_ERRORS.timeout, `Pas de réponse en ${ms} ms.`), ms);
      if (options.signal?.aborted) {
        reject(new ChannelError(CHANNEL_ERRORS.cancelled, 'Requête annulée.'));
        if (w.timer) clearTimeout(w.timer);
        return;
      }
      options.signal?.addEventListener('abort', () => w.abandon(CHANNEL_ERRORS.cancelled, 'Requête annulée.'), { once: true });
      waiting.set(id, w);
      port.send({ t: 'req', id, cible: target, methode: method, args });
    });
  }

  return {
    request,
    event: (name, data) => {
      if (!closed) port.send({ t: 'evt', nom: name, donnees: data });
    },
    pending: () => waiting.size,
    breakOff(reason) {
      if (closed) return;
      closed = reason;
      for (const w of [...waiting.values()]) w.abandon(CHANNEL_ERRORS.hostGone, reason);
      for (const c of running.values()) c.abort();
    },
    close() {
      this.breakOff('Canal fermé.');
      try {
        port.close();
      } catch {
        // Déjà fermé.
      }
    },
  };
}

/**
 * Méthode appelable d'un objet rendu par un plugin : une fonction à lui, jamais une propriété héritée d'`Object` ni
 * un nom qui commence par `_` (ADR 0002, « Méthodes appelables »).
 */
export function callableMethod(instance: unknown, name: string): ((...args: unknown[]) => unknown) | null {
  if (!instance || typeof instance !== 'object') return null;
  if (typeof name !== 'string' || !name || name.startsWith('_') || name === 'constructor') return null;
  if (Object.hasOwn(Object.prototype, name)) return null;
  const f = (instance as Record<string, unknown>)[name];
  return typeof f === 'function' ? (f as (...args: unknown[]) => unknown) : null;
}
