/**
 * Centre, plugins et dépôts (P4-19), côté page et sans DOM : cartes des plugins (mises à jour, installés, disponibles),
 * fiche d'un plugin (ce qu'il apporte, origine, niveau, permissions, dépendances), cartes des dépôts, avancement des
 * installations et textes des boîtes (accord, ajout d'un dépôt), rédigés par les catalogues (`centre.plugins`,
 * `centre.repos`) à partir des listes du processus principal (`pluginsList`, `reposPlugins`, `reposList`).
 *
 * Les noms, descriptions, hôtes et adresses viennent d'un index ou d'un manifeste : ils restent des textes (la vue ne
 * les interprète jamais comme du HTML) et aucun n'est rendu en lien ni en image.
 */
import type { AvailablePlugin, PluginConsentRequest, PluginSummary, PluginsProgress, RepositoryInfo } from '@mire/shared/ipc';
import type { AppProgress, PluginButton, PluginCard, PluginLine, PluginSheet, PluginsView, RepoCard, ReposView } from '@mire/ui/utils';
import { actionArgs, groupFingerprint, offerKey } from '@mire/ui/utils';
import { formatBytes } from './model.ts';
import type { Translate, Writer } from './model.ts';

/** Listes lues du processus principal, l'avancement des installations (par plugin demandé) et la fiche ouverte. */
export interface PluginsState {
  installed: readonly PluginSummary[];
  available: readonly AvailablePlugin[];
  repos: readonly RepositoryInfo[];
  progress: Readonly<Record<string, PluginsProgress>>;
  /** Clé de la fiche ouverte (`offerKey` d'un plugin proposé, identifiant d'un plugin présent), ou `null`. */
  sheet: string | null;
}

type Level = PluginSummary['level'];

const KNOWN_PERMISSIONS = ['hosts', 'folders', 'localNetwork', 'launch', 'webViews', 'deleteFiles'];
/** Permissions réservées au niveau `privileged` : un accès étendu à l'ordinateur. */
const SENSITIVE_PERMISSIONS = new Set(['localNetwork', 'launch', 'webViews', 'deleteFiles']);
const CONTRIBUTION_KINDS = new Set([
  'sources',
  'metadata',
  'taggers',
  'search',
  'webExtensions',
  'downloaders',
  'webApps',
  'apps',
  'systems',
  'packs',
  'pages',
  'themes',
  'palettes',
  'languages',
  'gamepads',
]);
const MAX_HOSTS = 20;

const k = (t: Translate, key: string, vars?: Record<string, string | number>) => t(`centre.plugins.${key}`, vars);

/** Niveau de sécurité, en mots simples. */
export function levelText(level: Level, t: Translate): string {
  return level ? k(t, `level.${level}`) : k(t, 'level.unknown');
}

/**
 * Permissions demandées, une ligne chacune ; `sensitive` pour celles qui donnent un accès étendu à l'ordinateur. Une
 * permission inconnue de cette version de Mire est montrée par son nom, comme sensible.
 */
export function permissionLines(permissions: Readonly<Record<string, unknown>> | null | undefined, t: Translate): PluginLine[] {
  const out: PluginLine[] = [];
  for (const [name, value] of Object.entries(permissions ?? {})) {
    if (name === 'hosts') {
      const hosts = (Array.isArray(value) ? value : []).filter((h): h is string => typeof h === 'string' && h !== '');
      if (!hosts.length) continue;
      const shown = hosts.slice(0, MAX_HOSTS).join(', ');
      const more = hosts.length > MAX_HOSTS ? k(t, 'permissions.more', { count: hosts.length - MAX_HOSTS }) : '';
      out.push({ text: k(t, 'permissions.hosts', { hosts: `${shown}${more}` }), sensitive: false });
    } else if (value === false || value == null || (Array.isArray(value) && !value.length)) {
      continue;
    } else if (KNOWN_PERMISSIONS.includes(name)) {
      out.push({ text: k(t, `permissions.${name}`), sensitive: SENSITIVE_PERMISSIONS.has(name) });
    } else {
      out.push({ text: k(t, 'permissions.other', { name }), sensitive: true });
    }
  }
  return out;
}

/** Ce que le plugin apporte : natures de contributions rédigées, sans doublon. */
export function contributesLines(kinds: readonly string[], t: Translate): string[] {
  const out = [...new Set(kinds)].map((kind) => (CONTRIBUTION_KINDS.has(kind) ? k(t, `contributes.${kind}`) : kind));
  return [...new Set(out)];
}

/** Badge de confiance : livré avec Mire, dépôt officiel, dépôt tiers, installé à la main. */
export function trustBadge(trust: PluginSummary['trust'], t: Translate): string {
  return k(t, `trust.${trust === 'third-party' ? 'thirdParty' : trust}`);
}

const repoName = (repos: readonly RepositoryInfo[], id: string | null) => repos.find((r) => r.id === id)?.name ?? id ?? '';

/** Origine d'un plugin présent : livré avec Mire, dépôt (par son nom), installé à la main. */
export function originText(p: Pick<PluginSummary, 'trust' | 'repository'>, repos: readonly RepositoryInfo[], t: Translate): string {
  if (p.trust === 'bundled') return k(t, 'origin.bundled');
  if (p.trust === 'local') return k(t, 'origin.local');
  if (p.trust === 'official') return k(t, 'origin.official');
  return k(t, 'origin.repository', { name: repoName(repos, p.repository) });
}

/** État d'un plugin présent, et son genre (couleur). */
export function pluginState(p: PluginSummary, t: Translate): { status: string; tone: PluginCard['tone'] } {
  const tone: PluginCard['tone'] = p.status === 'active' ? 'ok' : p.status === 'disabled' ? 'off' : 'error';
  const status = k(t, `status.${p.status}`);
  return { status: p.restartRequired ? k(t, 'status.restart', { status }) : status, tone };
}

/** Avancement d'une installation, rédigé ; `null` une fois terminée. */
export function pluginProgress(p: PluginsProgress | undefined, names: (id: string) => string, w: Writer): AppProgress | null {
  if (!p || p.phase === 'done' || p.phase === 'error') return null;
  const name = names(p.plugin ?? p.id);
  if (p.phase === 'download' && p.total) {
    const amount = k(w.t, 'progress.amount', { received: formatBytes(p.received ?? 0, w), total: formatBytes(p.total, w) });
    return { text: `${k(w.t, 'progress.download', { name })} · ${amount}`, percent: Math.min(100, Math.round(((p.received ?? 0) / p.total) * 100)) };
  }
  return { text: k(w.t, `progress.${p.phase}`, { name }), percent: null };
}

const button = (action: string, label: string, style: PluginButton['style'], arg: Record<string, string> | null, disabled = false): PluginButton => ({
  action,
  args: arg ? actionArgs(arg) : '',
  label,
  style,
  disabled,
});

/** Nom d'un plugin d'après les listes (présent d'abord), sinon son identifiant. */
export const nameFinder =
  (s: Pick<PluginsState, 'installed' | 'available'>) =>
  (id: string): string =>
    s.installed.find((p) => p.id === id)?.name ?? s.available.find((p) => p.id === id)?.name ?? id;

/** L'offre du dépôt qui a installé un plugin présent (celle qui le met à jour), s'il le propose encore. */
export const ownOffer = (s: Pick<PluginsState, 'available'>, id: string): AvailablePlugin | undefined =>
  s.available.find((o) => o.id === id && o.installed !== null && !o.conflict);

const isThirdSensitive = (p: { trust: string; level: Level }) => p.trust === 'third-party' && p.level === 'privileged';

function badgesOf(p: { trust: PluginSummary['trust'] | AvailablePlugin['trust']; level: Level }, t: Translate): string[] {
  const out: string[] = [];
  if (p.trust === 'third-party') out.push(trustBadge('third-party', t));
  if (p.level === 'privileged') out.push(k(t, 'badges.privileged'));
  return out;
}

function installedCard(p: PluginSummary, s: PluginsState, w: Writer): PluginCard {
  const { t } = w;
  const offer = ownOffer(s, p.id);
  const { status, tone } =
    p.status === 'active' && offer?.update ? { status: k(t, 'status.update', { version: offer.update }), tone: 'warn' as const } : pluginState(p, t);
  const buttons = [button('openPlugin', k(t, 'actions.open'), 'stl-2', { key: p.id })];
  if (p.status !== 'refused') {
    buttons.push(
      p.enabled
        ? button('disablePlugin', k(t, 'actions.disable'), 'stl-3', { id: p.id })
        : button('enablePlugin', k(t, 'actions.enable'), 'stl-3', { id: p.id }),
    );
  }
  return {
    key: p.id,
    name: p.name,
    meta: [p.version ? k(t, 'version', { version: p.version }) : '', originText(p, s.repos, t), levelText(p.level, t)].filter(Boolean).join(' · '),
    desc: offer?.description ?? '',
    badges: badgesOf(p, t),
    status,
    tone,
    progress: pluginProgress(s.progress[p.id], nameFinder(s), w),
    buttons,
  };
}

function updateCard(p: PluginSummary, offer: AvailablePlugin, s: PluginsState, w: Writer): PluginCard {
  const { t } = w;
  const busy = !!pluginProgress(s.progress[p.id], nameFinder(s), w);
  return {
    key: p.id,
    name: p.name,
    meta: [k(t, 'updateFrom', { from: p.version ?? '?', to: offer.update ?? '' }), originText(p, s.repos, t)].join(' · '),
    desc: offer.description ?? '',
    badges: badgesOf(offer, t),
    status: '',
    tone: '',
    progress: pluginProgress(s.progress[p.id], nameFinder(s), w),
    buttons: [button('openPlugin', k(t, 'actions.open'), 'stl-2', { key: p.id }), button('updatePlugin', k(t, 'actions.update'), 'stl-1', { id: p.id }, busy)],
  };
}

function offerCard(o: AvailablePlugin, s: PluginsState, w: Writer): PluginCard {
  const { t } = w;
  const version = o.version ? k(t, 'version', { version: o.version }) : k(t, 'noVersion');
  return {
    key: offerKey(o.repository, o.id),
    name: o.name,
    meta: [version, k(t, 'origin.repository', { name: repoName(s.repos, o.repository) }), levelText(o.level, t)].join(' · '),
    desc: o.description ?? '',
    badges: badgesOf(o, t),
    status: '',
    tone: '',
    progress: pluginProgress(s.progress[o.id], nameFinder(s), w),
    buttons: [button('openPlugin', k(t, 'actions.open'), 'stl-2', { key: offerKey(o.repository, o.id) })],
  };
}

const byName = <T extends { name: string }>(list: T[], lang: string) => list.sort((a, b) => a.name.localeCompare(b.name, lang));

/** Dernière lecture en ligne des listes des dépôts pendant cette session. */
export function checkedText(repos: readonly RepositoryInfo[], w: Writer): string {
  const last = Math.max(0, ...repos.map((r) => r.checkedAt ?? 0));
  if (!last) return k(w.t, 'notChecked');
  return k(w.t, 'checked', { time: new Date(last).toLocaleTimeString(w.lang, { hour: '2-digit', minute: '2-digit' }) });
}

function dependencyLines(deps: Readonly<Record<string, string>>, s: PluginsState, t: Translate): string[] {
  const names = nameFinder(s);
  return Object.entries(deps).map(([id, range]) => {
    const present = s.installed.find((p) => p.id === id);
    return k(t, present ? 'sheet.dependencyInstalled' : 'sheet.dependency', { name: names(id), range });
  });
}

/** Fiche d'un plugin présent : son état, et l'offre de son dépôt (description, mise à jour) s'il y en a une. */
function installedSheet(p: PluginSummary, s: PluginsState, w: Writer): PluginSheet {
  const { t } = w;
  const offer = ownOffer(s, p.id);
  const progress = pluginProgress(s.progress[p.id], nameFinder(s), w);
  const facts = [
    { label: k(t, 'sheet.version'), value: p.version ?? '?' },
    { label: k(t, 'sheet.origin'), value: originText(p, s.repos, t) },
    { label: k(t, 'sheet.level'), value: levelText(p.level, t) },
    { label: k(t, 'sheet.state'), value: pluginState(p, t).status },
  ];
  if (offer?.update) facts.splice(1, 0, { label: k(t, 'sheet.update'), value: offer.update });
  const buttons: PluginButton[] = [];
  if (offer?.update) buttons.push(button('updatePlugin', k(t, 'actions.updateTo', { version: offer.update }), 'stl-1', { id: p.id }, !!progress));
  if (p.status !== 'refused') {
    buttons.push(
      p.enabled
        ? button('disablePlugin', k(t, 'actions.disable'), 'stl-2', { id: p.id })
        : button('enablePlugin', k(t, 'actions.enable'), 'stl-2', { id: p.id }),
    );
  }
  if (p.origin !== 'bundled') buttons.push(button('uninstallPlugin', k(t, 'actions.uninstall'), 'stl-3', { id: p.id }, !!progress));
  return {
    key: p.id,
    name: p.name,
    desc: offer?.description ?? '',
    badges: badgesOf(p, t),
    facts,
    contributes: contributesLines(
      p.contributions.map((c) => c.kind),
      t,
    ),
    permissions: permissionLines(p.permissions, t),
    dependencies: dependencyLines(p.dependencies ?? {}, s, t),
    warning: isThirdSensitive(p) ? k(t, 'sheet.warningInstalled') : '',
    message: p.message ?? '',
    progress,
    buttons,
  };
}

/** Fiche d'un plugin proposé par un dépôt : tout ce qu'il demande, montré avant de l'installer. */
function offerSheet(o: AvailablePlugin, s: PluginsState, w: Writer): PluginSheet {
  const { t } = w;
  const progress = pluginProgress(s.progress[o.id], nameFinder(s), w);
  const facts = [
    { label: k(t, 'sheet.version'), value: o.version ?? k(t, 'noVersionLatest', { latest: o.latest }) },
    { label: k(t, 'sheet.origin'), value: k(t, 'origin.repository', { name: repoName(s.repos, o.repository) }) },
    { label: k(t, 'sheet.level'), value: levelText(o.level, t) },
    { label: k(t, 'sheet.size'), value: formatBytes(o.size, w) },
  ];
  const message = o.conflict ? k(t, 'sheet.conflict') : '';
  return {
    key: offerKey(o.repository, o.id),
    name: o.name,
    desc: o.description ?? '',
    badges: badgesOf(o, t),
    facts,
    contributes: contributesLines(o.contributes, t),
    permissions: permissionLines(o.permissions, t),
    dependencies: dependencyLines(o.dependencies, s, t),
    warning: o.sensitive ? k(t, 'sheet.warning') : '',
    message,
    progress,
    buttons: [button('installPlugin', k(t, 'actions.install'), 'stl-1', { id: o.id, repository: o.repository }, !o.version || o.conflict || !!progress)],
  };
}

/** Fiche d'après sa clé, ou `null` si le plugin n'est plus dans les listes. */
export function pluginSheet(key: string | null, s: PluginsState, w: Writer): PluginSheet | null {
  if (!key) return null;
  const present = s.installed.find((p) => p.id === key);
  if (present) return installedSheet(present, s, w);
  const offer = s.available.find((o) => offerKey(o.repository, o.id) === key);
  return offer ? offerSheet(offer, s, w) : null;
}

/** L'onglet des plugins ; `null` tant que les listes ne sont pas lues. */
export function pluginsView(s: PluginsState | null, w: Writer): PluginsView | null {
  if (!s) return null;
  const updates: PluginCard[] = [];
  for (const p of s.installed) {
    const offer = ownOffer(s, p.id);
    if (offer?.update) updates.push(updateCard(p, offer, s, w));
  }
  const offers = s.available.filter((o) => o.installed === null && !s.installed.some((p) => p.id === o.id));
  return {
    checked: checkedText(s.repos, w),
    updates: byName(updates, w.lang),
    installed: byName(
      s.installed.map((p) => installedCard(p, s, w)),
      w.lang,
    ),
    available: byName(
      offers.map((o) => offerCard(o, s, w)),
      w.lang,
    ),
    sheet: pluginSheet(s.sheet, s, w),
  };
}

/** Date de la liste des plugins d'un dépôt. */
export function repoDate(generated: string | null, w: Writer): string {
  const d = generated ? new Date(generated) : null;
  if (!d || Number.isNaN(d.getTime())) return w.t('centre.repos.never');
  return w.t('centre.repos.date', { date: d.toLocaleDateString(w.lang, { day: 'numeric', month: 'long', year: 'numeric' }) });
}

/** Les cartes des dépôts : l'officiel d'abord. */
export function reposView(repos: readonly RepositoryInfo[] | null, w: Writer): ReposView | null {
  if (!repos) return null;
  const { t } = w;
  const cards: RepoCard[] = [...repos]
    .sort((a, b) => Number(b.official) - Number(a.official))
    .map((r) => ({
      id: r.id,
      name: r.name,
      badge: t(r.official ? 'centre.repos.official' : 'centre.repos.thirdParty'),
      index: r.index,
      fingerprint: groupFingerprint(r.fingerprint),
      date: repoDate(r.generated, w),
      error: r.message ?? '',
      removable: !r.official,
    }));
  return { repos: cards };
}

/**
 * Contrôle, dans l'interface, de ce que l'on saisit pour ajouter un dépôt, pour un message immédiat : `null` si la
 * saisie peut être envoyée, sinon la clé du message (`centre.repos.add.errors.*`). Le processus principal vérifie de
 * nouveau l'adresse et la clé.
 */
export function repoInputError(index: string, publicKey: string): 'address' | 'https' | 'key' | null {
  let url: URL;
  try {
    url = new URL(index.trim());
  } catch {
    return 'address';
  }
  if (url.protocol !== 'https:') return 'https';
  if (url.username || url.password || !url.hostname) return 'address';
  if (!/-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----/.test(publicKey)) return 'key';
  return null;
}

/** Texte de la boîte d'accord : l'avertissement renforcé, puis ce que chaque version demande. */
export function consentHelp(requests: readonly PluginConsentRequest[], names: (id: string) => string, t: Translate): string {
  const lines = [t('centre.plugins.consent.warning')];
  for (const r of requests) {
    lines.push('', t('centre.plugins.consent.plugin', { name: names(r.plugin), version: r.version, level: levelText(r.level, t) }));
    const perms = permissionLines(r.permissions, t);
    lines.push(...(perms.length ? perms.map((p) => `• ${p.text}`) : [`• ${t('centre.plugins.sheet.noPermissions')}`]));
  }
  return lines.join('\n');
}
