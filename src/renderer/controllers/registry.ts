/**
 * Registre des contrôleurs de l'interface (P4-04, docs/adr/0001-dot-stash.md § 8).
 *
 * Un contrôleur porte les actions d'un écran (`mire-app`, `mire-page`…) : ses méthodes publiques, appelées par
 * `ds-trigger` (`target="mire-app" action='go:[{"section":"videos"}]'`), par le pont des vues historiques
 * (`data-action`) et par la navigation et les lecteurs. Les contrôleurs vivent ici, avec l'état et le client API, et
 * s'enregistrent au démarrage. Un composant `mire-*` qui a un contrôleur n'importe rien d'ici : il émet `mireConnect`
 * à sa connexion, et le registre lui donne alors les actions de son contrôleur, qui deviennent ses méthodes.
 *
 * Conventions :
 * - méthodes publiques = actions, nommées par un verbe en camelCase ; les aides sont privées (`#aide`) ;
 * - au plus un argument : un objet JSON qui désigne les éléments par une clé stable (`{ path }`, `{ id }`) ;
 * - une action qui échoue rejette : l'erreur est signalée par un message (toast) ;
 * - pendant une action asynchrone, le `ds-trigger` qui l'a lancée porte `aria-busy="true"` et ne la relance pas.
 */

export type ActionArgs = Record<string, unknown>;
export type Controller = object;

/** Ce qui est connu d'une action au moment où elle échoue. */
export interface ActionContext {
  tag: string;
  method: string;
}

export type ActionErrorHandler = (error: unknown, context: ActionContext) => void;

const controllers = new Map<string, Controller>();
let errorHandler: ActionErrorHandler = (error) => console.error(error);

/** Méthodes publiques d'un contrôleur (prototypes compris, hors `Object`), dans l'ordre de déclaration. */
export function actionNames(ctrl: Controller): string[] {
  const names: string[] = [];
  for (let proto = Object.getPrototypeOf(ctrl); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || names.includes(name)) continue;
      if (typeof Object.getOwnPropertyDescriptor(proto, name)?.value === 'function') names.push(name);
    }
  }
  return names;
}

/** Message affiché quand une action échoue (branché par l'interface sur ses toasts). */
export function setActionErrorHandler(handler: ActionErrorHandler): void {
  errorHandler = handler;
}

/** Contrôleur enregistré pour une balise (`mire-app`…). */
export function controller<T extends Controller = Controller>(tag: string): T | undefined {
  return controllers.get(tag) as T | undefined;
}

/** Enregistre le contrôleur d'une balise et l'attache aux éléments déjà présents dans la page. */
export function registerController(tag: string, ctrl: Controller): void {
  controllers.set(tag, ctrl);
  if (typeof document === 'undefined') return;
  listenConnections();
  for (const el of document.querySelectorAll(tag)) bindController(el);
}

// Composants mire-* connectés après l'enregistrement de leur contrôleur (ils émettent `mireConnect`).
let listening = false;
function listenConnections(): void {
  if (listening) return;
  listening = true;
  document.addEventListener('mireConnect', (e) => bindController(e.target as Element));
}

/** Signale l'échec d'une action (message à l'écran, détail dans la console). */
export function reportActionError(error: unknown, context: ActionContext): void {
  errorHandler(error, context);
}

/** Résultat d'une action : `ok` faux si elle a échoué, si elle n'existe pas ou si son déclencheur est occupé. */
export interface ActionResult {
  ok: boolean;
  value?: unknown;
}

/** Appelle une action : erreurs signalées, état « en cours » du déclencheur. Ne rejette jamais. */
export async function invokeAction(tag: string, method: string, args?: ActionArgs, trigger?: Element | null): Promise<ActionResult> {
  const ctrl = controllers.get(tag) as Record<string, unknown> | undefined;
  const fn = ctrl?.[method];
  if (typeof fn !== 'function' || !actionNames(ctrl!).includes(method)) {
    errorHandler(new Error(`Action inconnue : ${tag}.${method}`), { tag, method });
    return { ok: false };
  }
  if (trigger?.getAttribute('aria-busy') === 'true') return { ok: false };
  trigger?.setAttribute('aria-busy', 'true');
  try {
    return { ok: true, value: await fn.call(ctrl, args) };
  } catch (error) {
    errorHandler(error, { tag, method });
    return { ok: false };
  } finally {
    trigger?.removeAttribute('aria-busy');
  }
}

/** Comme `invokeAction`, mais rend la valeur de l'action (`undefined` si elle a échoué). */
export async function callAction(tag: string, method: string, args?: ActionArgs, trigger?: Element | null): Promise<unknown> {
  return (await invokeAction(tag, method, args, trigger)).value;
}

// Déclencheur du clic en cours : `ds-trigger` appelle la méthode de sa cible pendant le clic (souris, Entrée ou
// Espace), sans se faire connaître ; on le retient le temps de ce clic.
let clicked: Element | null = null;
let watching = false;
function watchTriggers(): void {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener(
    'click',
    (e) => {
      clicked = (e.target as Element | null)?.closest?.('ds-trigger') ?? null;
      if (clicked) setTimeout(() => (clicked = null));
    },
    true,
  );
}

function triggerOf(host: Element, method: string): Element | null {
  const t = clicked;
  if (!t || t.getAttribute('action')?.split(':')[0] !== method) return null;
  const target = t.getAttribute('target');
  return target && document.querySelector(target) === host ? t : null;
}

/** Donne à un élément `mire-*` les actions du contrôleur de sa balise (sans effet s'il n'est pas encore enregistré). */
export function bindController(host: Element): void {
  const tag = host.localName;
  const ctrl = controllers.get(tag);
  if (!ctrl) return;
  watchTriggers();
  for (const name of actionNames(ctrl)) {
    Object.defineProperty(host, name, {
      configurable: true,
      value: (args?: ActionArgs) => callAction(tag, name, args, triggerOf(host, name)),
    });
  }
}
