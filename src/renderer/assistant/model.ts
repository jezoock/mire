/**
 * Assistant du premier lancement (P4-23), côté page et sans DOM : choix proposés d'après les catégories de l'index
 * (`AvailablePlugin.categories`, vocabulaire dans `docs/assistant.md`), pack de la langue du système, plugins à
 * installer avec leurs dépendances, enchaînement des étapes et texte de chaque étape (catalogues `assistant.*`).
 *
 * Seules les six familles de la fiche sont connues ici ; tout le reste (box, services, packs de langue, plugins de
 * chaque famille) vient de l'index. Une famille sans plugin dans l'index n'est pas proposée.
 */
import type { AvailablePlugin, PluginsProgress } from '@mire/shared/ipc';
import type { AssistantButtons, AssistantChoice, AssistantItem, AssistantView } from '@mire/ui/utils';
import { permissionLines, pluginProgress } from '../centre/plugins.ts';
import type { Translate, Writer } from '../centre/model.ts';

/** Familles de la fiche, dans l'ordre affiché. */
export const FAMILIES = ['movies', 'music', 'photos', 'games', 'tv', 'streaming'] as const;
export type Family = (typeof FAMILIES)[number];
/** Catégorie d'un pack de box (famille `tv`) et d'un service de streaming (famille `streaming`). */
export const BOX = 'tv-box';
export const SERVICE = 'streaming-service';
export const LANGUAGE_PREFIX = 'language:';

export type Step = 'welcome' | 'language' | 'uses' | 'box' | 'services' | 'summary' | 'install' | 'done';

/** Résultat de l'installation d'un plugin du plan. */
export interface InstallResult {
  state: 'waiting' | 'running' | 'installed' | 'failed' | 'declined';
  message?: string;
}

/** État d'un passage dans l'assistant (gardé par la page, changé par le contrôleur `mire-assistant`). */
export interface Session {
  step: Step;
  /** Lecture des dépôts en cours. */
  loading: boolean;
  /** Plugins proposés par les dépôts, `null` tant qu'ils ne sont pas lus. */
  offers: AvailablePlugin[] | null;
  /** La lecture en ligne des dépôts a échoué (le cache a servi, s'il y en avait un). */
  offline: boolean;
  /** Langues préférées du système, la première d'abord. */
  systemLanguages: string[];
  /** Langues intégrées à Mire (catalogues), et langue de l'interface. */
  builtin: string[];
  language: string;
  uses: Family[];
  /** Identifiant de la box choisie, `null` : aucune. */
  box: string | null;
  services: string[];
  results: Record<string, InstallResult>;
  progress: Record<string, PluginsProgress>;
}

export function newSession(): Session {
  return {
    step: 'welcome',
    loading: false,
    offers: null,
    offline: false,
    systemLanguages: [],
    builtin: [],
    language: 'en',
    uses: [],
    box: null,
    services: [],
    results: {},
    progress: {},
  };
}

const isFamily = (v: unknown): v is Family => (FAMILIES as readonly string[]).includes(v as string);
export const asFamily = (v: unknown): Family | null => (isFamily(v) ? v : null);

/**
 * Plugins que l'assistant peut proposer : installables (version compatible, pas déjà fournis par un autre dépôt), un
 * seul par identifiant (le dépôt officiel d'abord). Un plugin déjà installé reste connu (dépendance déjà là), mais n'est
 * jamais à installer.
 */
export function usableOffers(list: readonly AvailablePlugin[]): AvailablePlugin[] {
  const byId = new Map<string, AvailablePlugin>();
  for (const p of list) {
    if (p.version === null || p.conflict) continue;
    const seen = byId.get(p.id);
    if (!seen || (p.official && !seen.official)) byId.set(p.id, p);
  }
  return [...byId.values()];
}

/** Familles d'un plugin : ses catégories de famille, plus `tv` pour une box et `streaming` pour un service. */
export function familiesOf(p: Pick<AvailablePlugin, 'categories'>): Family[] {
  const cats = p.categories ?? [];
  const out = new Set<Family>(cats.filter(isFamily));
  if (cats.includes(BOX)) out.add('tv');
  if (cats.includes(SERVICE)) out.add('streaming');
  return FAMILIES.filter((f) => out.has(f));
}

const isBox = (p: AvailablePlugin) => p.categories.includes(BOX);
const isService = (p: AvailablePlugin) => p.categories.includes(SERVICE);
const isLanguage = (p: AvailablePlugin) => p.categories.some((c) => c.startsWith(LANGUAGE_PREFIX));
const byName = (a: AvailablePlugin, b: AvailablePlugin) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Ce que l'index permet de proposer : familles qui ont au moins un plugin, box et services. */
export function choicesOf(offers: readonly AvailablePlugin[]): { families: Family[]; boxes: AvailablePlugin[]; services: AvailablePlugin[] } {
  const present = new Set(offers.flatMap(familiesOf));
  return {
    families: FAMILIES.filter((f) => present.has(f)),
    boxes: offers.filter(isBox).sort(byName),
    services: offers.filter(isService).sort(byName),
  };
}

/** Code de langue en minuscules et sa langue de base (`pt-BR` → `pt-br`, `pt`). */
const variants = (code: string): string[] => {
  const lower = code.toLowerCase();
  const base = lower.split('-')[0];
  return base === lower ? [lower] : [lower, base];
};

/**
 * Langue du système (la première préférée) et son pack proposé par l'index : la langue exacte, sinon sa langue de base.
 * L'anglais est au cœur de Mire : jamais de pack pour lui. `pack` est `null` si l'index n'en propose pas.
 */
export function languagePack(offers: readonly AvailablePlugin[], systemLanguages: readonly string[]): { code: string | null; pack: AvailablePlugin | null } {
  const code = systemLanguages[0] ?? null;
  if (!code) return { code: null, pack: null };
  const wanted = variants(code);
  if (wanted.includes('en')) return { code, pack: null };
  for (const v of wanted) {
    const pack = offers.find((p) => p.categories.includes(`${LANGUAGE_PREFIX}${v}`));
    if (pack) return { code, pack };
  }
  return { code, pack: null };
}

/** Un plugin du plan : pourquoi il est là, et pour une dépendance, les plugins qui en ont besoin. */
export interface PlanItem {
  offer: AvailablePlugin;
  reason: 'language' | Family | 'box' | 'service' | 'dependency';
  /** Plugin demandé par l'utilisateur (installé par son propre appel) ; une dépendance vient avec lui. */
  root: boolean;
  requiredBy: string[];
}

/**
 * Plugins à installer d'après les choix : le pack de langue, les plugins de chaque famille choisie (hors box, services
 * et packs de langue), la box, les services ; puis leurs dépendances non installées, de proche en proche. Rien de ce
 * qui est déjà installé.
 */
export function installPlan(s: Pick<Session, 'offers' | 'systemLanguages' | 'uses' | 'box' | 'services'>): PlanItem[] {
  const offers = usableOffers(s.offers ?? []);
  const byId = new Map(offers.map((p) => [p.id, p]));
  const plan = new Map<string, PlanItem>();
  const addRoot = (p: AvailablePlugin | undefined, reason: PlanItem['reason']) => {
    if (p && !p.installed && !plan.has(p.id)) plan.set(p.id, { offer: p, reason, root: true, requiredBy: [] });
  };
  addRoot(languagePack(offers, s.systemLanguages).pack ?? undefined, 'language');
  for (const f of FAMILIES) {
    if (!s.uses.includes(f)) continue;
    for (const p of offers.filter((o) => familiesOf(o).includes(f) && !isBox(o) && !isService(o) && !isLanguage(o)).sort(byName)) addRoot(p, f);
  }
  if (s.uses.includes('tv') && s.box) addRoot(byId.get(s.box), 'box');
  if (s.uses.includes('streaming')) for (const id of s.services) addRoot(byId.get(id), 'service');
  // Dépendances, de proche en proche (une dépendance déjà dans le plan note seulement qui en a besoin).
  const queue = [...plan.values()];
  while (queue.length) {
    const item = queue.shift()!;
    for (const dep of Object.keys(item.offer.dependencies ?? {})) {
      const known = plan.get(dep);
      if (known) {
        if (!known.root && !known.requiredBy.includes(item.offer.id)) known.requiredBy.push(item.offer.id);
        continue;
      }
      const offer = byId.get(dep);
      if (!offer || offer.installed) continue;
      const next: PlanItem = { offer, reason: 'dependency', root: false, requiredBy: [item.offer.id] };
      plan.set(dep, next);
      queue.push(next);
    }
  }
  return [...plan.values()];
}

/** Étapes du parcours d'après les choix : la box et les services ne sont demandés que s'il y a de quoi choisir. */
export function stepsOf(s: Pick<Session, 'offers' | 'uses'>): Step[] {
  const { boxes, services } = choicesOf(usableOffers(s.offers ?? []));
  return [
    'welcome',
    'language',
    'uses',
    ...(s.uses.includes('tv') && boxes.length ? (['box'] as Step[]) : []),
    ...(s.uses.includes('streaming') && services.length ? (['services'] as Step[]) : []),
    'summary',
  ];
}

/** Étape suivante (`dir` 1) ou précédente (-1) du parcours ; reste sur place aux bouts. */
export function stepAfter(s: Pick<Session, 'offers' | 'uses' | 'step'>, dir: 1 | -1): Step {
  const steps = stepsOf(s);
  const i = steps.indexOf(s.step);
  if (i < 0) return s.step;
  return steps[Math.max(0, Math.min(steps.length - 1, i + dir))];
}

/** Bascule une valeur dans une liste (copie). */
export const toggle = <T>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

// ---------- Textes ----------

const a = (t: Translate, key: string, vars?: Record<string, string | number>) => t(`assistant.${key}`, vars);

/** Nom d'une langue dans cette langue (« français »), sinon son code. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Paragraphes de l'étape « Langue ». */
export function languageText(s: Session, t: Translate): string[] {
  const offers = usableOffers(s.offers ?? []);
  const { code, pack } = languagePack(offers, s.systemLanguages);
  const current = languageName(s.language);
  if (!code) return [a(t, 'language.current', { language: current })];
  const system = languageName(code);
  if (pack) return [a(t, 'language.system', { language: system }), a(t, pack.installed ? 'language.packInstalled' : 'language.pack', { name: pack.name })];
  const builtin = variants(code).some((v) => s.builtin.some((b) => b.toLowerCase() === v));
  return [a(t, 'language.system', { language: system }), builtin ? a(t, 'language.builtin') : a(t, 'language.missing', { language: current })];
}

const reasonText = (item: PlanItem, names: (id: string) => string, t: Translate): string =>
  item.reason === 'dependency'
    ? a(t, 'summary.requiredBy', { names: item.requiredBy.map(names).join(', ') })
    : item.reason === 'language' || item.reason === 'box' || item.reason === 'service'
      ? a(t, `summary.reasons.${item.reason}`)
      : a(t, `uses.families.${item.reason}.label`);

function badges(p: AvailablePlugin, t: Translate): string[] {
  const out: string[] = [];
  if (!p.official) out.push(t('centre.plugins.trust.thirdParty'));
  if (p.sensitive && !p.consented) out.push(a(t, 'summary.consentNeeded'));
  return out;
}

const STATUS_TONE: Record<InstallResult['state'], AssistantItem['tone']> = {
  waiting: '',
  running: 'busy',
  installed: 'ok',
  failed: 'error',
  declined: 'off',
};

function planItems(s: Session, w: Writer): AssistantItem[] {
  const { t } = w;
  const plan = installPlan(s);
  const names = (id: string) => plan.find((i) => i.offer.id === id)?.offer.name ?? usableOffers(s.offers ?? []).find((p) => p.id === id)?.name ?? id;
  const installing = s.step === 'install' || s.step === 'done';
  return plan.map((item) => {
    const lines = permissionLines(item.offer.permissions, t);
    const result = s.results[item.offer.id];
    const progress = installing && item.root ? pluginProgress(s.progress[item.offer.id], names, w) : null;
    const status = !installing || !result ? '' : result.state === 'failed' && result.message ? result.message : a(t, `install.states.${result.state}`);
    return {
      key: item.offer.id,
      name: item.offer.name,
      reason: reasonText(item, names, t),
      lines: lines.length ? lines : [{ text: t('centre.plugins.sheet.noPermissions'), sensitive: false }],
      badges: badges(item.offer, t),
      status: progress?.text ?? status,
      tone: result ? STATUS_TONE[result.state] : '',
      progress: progress?.percent ?? null,
    };
  });
}

const choice = (key: string, label: string, description: string, pressed: boolean, action: AssistantChoice['action']): AssistantChoice => ({
  key,
  label,
  description,
  pressed,
  action,
});

/** Ce qu'affiche `mire-assistant-view` pour l'étape en cours. */
export function assistantView(s: Session, w: Writer): AssistantView {
  const { t } = w;
  const offers = usableOffers(s.offers ?? []);
  const { families, boxes, services } = choicesOf(offers);
  const steps = stepsOf(s);
  const at = steps.indexOf(s.step);
  const view: AssistantView = {
    step: s.step,
    progress: at > 0 ? a(t, 'progress', { step: at, count: steps.length - 1 }) : '',
    title: a(t, `${s.step}.title`),
    paragraphs: [],
    choicesLabel: '',
    choiceMode: 'toggle',
    choices: [],
    itemsLabel: '',
    items: [],
    busy: s.loading ? a(t, 'welcome.loading') : '',
    buttons: {},
  };
  const nav: AssistantButtons = { back: a(t, 'buttons.back'), next: a(t, 'buttons.next'), skip: a(t, 'buttons.skip') };
  switch (s.step) {
    case 'welcome':
      view.paragraphs = [a(t, 'welcome.help'), a(t, 'welcome.network')];
      view.buttons = { start: a(t, 'buttons.start'), skip: a(t, 'buttons.skip') };
      break;
    case 'language':
      view.paragraphs = languageText(s, t);
      view.buttons = nav;
      break;
    case 'uses':
      view.paragraphs = [families.length ? a(t, 'uses.help') : a(t, s.offline ? 'uses.offline' : 'uses.none')];
      view.choicesLabel = a(t, 'uses.title');
      view.choices = families.map((f) => choice(f, a(t, `uses.families.${f}.label`), a(t, `uses.families.${f}.help`), s.uses.includes(f), 'toggleUse'));
      view.buttons = nav;
      break;
    case 'box':
      view.paragraphs = [a(t, 'box.help')];
      view.choicesLabel = a(t, 'box.title');
      view.choiceMode = 'radio';
      view.choices = [
        ...boxes.map((p) => choice(p.id, p.name, p.description ?? '', s.box === p.id, 'chooseBox')),
        choice('', a(t, 'box.none'), '', s.box === null, 'chooseBox'),
      ];
      view.buttons = nav;
      break;
    case 'services':
      view.paragraphs = [a(t, 'services.help')];
      view.choicesLabel = a(t, 'services.title');
      view.choices = services.map((p) => choice(p.id, p.name, p.description ?? '', s.services.includes(p.id), 'toggleService'));
      view.buttons = nav;
      break;
    case 'summary': {
      view.items = planItems(s, w);
      view.itemsLabel = a(t, 'summary.title');
      view.paragraphs = view.items.length ? [a(t, 'summary.help'), a(t, 'summary.later')] : [a(t, 'summary.empty'), a(t, 'summary.later')];
      view.buttons = view.items.length
        ? { back: a(t, 'buttons.back'), install: a(t, 'buttons.install'), skip: a(t, 'buttons.nothing') }
        : { back: a(t, 'buttons.back'), finish: a(t, 'buttons.finish') };
      break;
    }
    case 'install':
      view.items = planItems(s, w);
      view.itemsLabel = a(t, 'summary.title');
      view.paragraphs = [a(t, 'install.help')];
      view.busy = a(t, 'install.busy');
      break;
    case 'done': {
      view.items = planItems(s, w);
      view.itemsLabel = a(t, 'summary.title');
      const failed = Object.values(s.results).some((r) => r.state === 'failed' || r.state === 'declined');
      view.paragraphs = [a(t, failed ? 'done.someFailed' : 'done.help'), a(t, 'summary.later')];
      view.buttons = { finish: a(t, 'buttons.finish'), openCentre: a(t, 'buttons.openCentre') };
      break;
    }
  }
  return view;
}
