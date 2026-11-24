/**
 * Service de continuité (P5-01) : reprend les règles appliquées par la migration v10 (`config.continuity`, voir
 * `src/main/config/migrations/continuity.ts`) et amène les plugins qui remplacent des fonctions de Mire :
 * - plugin inclus : activé tout de suite (une fois l'hôte de plugins démarré) ;
 * - plugin à installer : mis en attente, puis installé par le client des dépôts (P3-07 : signature, empreintes,
 *   transaction), depuis le dépôt officiel seulement, dès que l'index officiel a pu être lu en ligne : au démarrage
 *   (sans le retarder) ou à la mise à jour suivante des index. Sans connexion, il reste en attente sans compter
 *   d'essai ; une raison définitive (plugin introuvable dans le dépôt, aucune version compatible…) le rend
 *   « impossible », comme un échec répété `MAX_ATTEMPTS` fois : jamais de boucle.
 * L'état est gardé dans `userData/plugins/continuity.json` ; la file de la configuration est effacée une fois reprise.
 * Le récapitulatif (installé, en attente, impossible avec la raison) est rendu à l'interface ; ce qu'elle n'a pas
 * encore montré forme un message (`notice`), marqué vu par `seen()`.
 */
import type { AvailablePlugin, ContinuityItem, ContinuitySummary, PluginSummary, PluginsOutcome, RepositoryInfo } from '@mire/shared/ipc';
import type { Config } from '@mire/shared';
import { CONTINUITY_RULES, checkRules, type ContinuityRule } from '../config/migrations/continuity.ts';
import type { ConfigService } from '../config/service.ts';
import { createJsonStore } from '../storage/json-store.ts';

export const CONTINUITY_STATE_VERSION = 1;
/** Échecs passagers (réseau, paquet altéré…) tolérés avant de renoncer. */
export const MAX_ATTEMPTS = 5;
/** Raisons définitives quand l'index officiel a été lu en ligne : réessayer ne changerait rien. */
const DEFINITIVE = new Set(['unknown', 'engine', 'dependency', 'refused', 'manifest']);

export type ContinuityStatus = ContinuityItem['status'];

export interface ContinuityEntry {
  mode: ContinuityRule['mode'];
  /** Règles qui ont demandé ce plugin. */
  rules: string[];
  status: ContinuityStatus;
  /** Raison d'un échec (langue du moment, comme les pannes des plugins). */
  reason?: string;
  attempts: number;
  /** Dernier état montré à l'utilisateur. */
  seen?: ContinuityStatus;
}

interface StateFile {
  version: number;
  plugins: Record<string, ContinuityEntry>;
}

const STATUSES = new Set<ContinuityStatus>(['pending', 'installed', 'failed']);

/** Ne garde que des entrées bien formées (fichier modifié à la main). */
export function normalizeContinuityState(raw: unknown): StateFile {
  const out: StateFile = { version: CONTINUITY_STATE_VERSION, plugins: {} };
  const plugins = (raw as { plugins?: unknown })?.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return out;
  for (const [id, v] of Object.entries(plugins as Record<string, Partial<ContinuityEntry>>)) {
    if (!v || typeof v !== 'object' || (v.mode !== 'bundled' && v.mode !== 'install') || !STATUSES.has(v.status!)) continue;
    out.plugins[id] = {
      mode: v.mode,
      rules: Array.isArray(v.rules) ? v.rules.filter((r): r is string => typeof r === 'string') : [],
      status: v.status!,
      attempts: Number.isInteger(v.attempts) && v.attempts! > 0 ? v.attempts! : 0,
      ...(typeof v.reason === 'string' ? { reason: v.reason } : {}),
      ...(v.seen && STATUSES.has(v.seen) ? { seen: v.seen } : {}),
    };
  }
  return out;
}

export interface ContinuityOptions {
  file: string;
  config: Pick<ConfigService, 'get' | 'update' | 'onChange'>;
  plugins: { list(): PluginSummary[]; setEnabled(id: string, enabled: boolean): Promise<unknown> };
  repos: {
    refresh(): Promise<RepositoryInfo[]>;
    installOfficial(id: string): Promise<PluginsOutcome>;
    available(): AvailablePlugin[];
  };
  translate(key: string, vars?: Record<string, string | number>): string;
  /**
   * Réglages des plugins : les secrets déplacés en clair par la migration (`encrypted: false`) sont chiffrés dès que
   * leur plugin est là (`seal` de `settings.ts`).
   */
  secrets?: { seal(id: string): void };
  /** Le récapitulatif a changé (un plugin installé, devenu impossible…) : à montrer. */
  onChange?(summary: ContinuitySummary): void;
  rules?: readonly ContinuityRule[];
  log?(message: string): void;
}

export function createContinuity(opts: ContinuityOptions) {
  const rules = opts.rules ?? CONTINUITY_RULES;
  const log = opts.log ?? ((m: string) => console.error(m));
  for (const problem of checkRules(rules)) log(`Continuité : règle ignorée (${problem})`);
  const valid = rules.filter((r) => !checkRules([r]).length);
  const store = createJsonStore<StateFile>(opts.file, {
    defaults: { version: CONTINUITY_STATE_VERSION, plugins: {} },
    setAside: true,
    space: 2,
    onCorrupt: (err, f, kept) => log(`Continuité : ${f} illisible (${err.message})${kept ? `, mis de côté dans ${kept}` : ''}.`),
  });
  let state: StateFile = { version: CONTINUITY_STATE_VERSION, plugins: {} };
  let running: Promise<void> | null = null;
  // Demande arrivée pendant un passage (import, mise à jour des index) : un passage de plus à la fin.
  let again: { status?: RepositoryInfo[] } | null = null;
  let started = false;

  const save = () => store.set(state);
  const present = (id: string) => opts.plugins.list().find((p) => p.id === id && p.status !== 'refused') ?? null;
  const pendingOf = (mode: ContinuityRule['mode']) => Object.entries(state.plugins).filter(([, e]) => e.mode === mode && e.status === 'pending');

  function nameOf(id: string): string {
    return opts.plugins.list().find((p) => p.id === id)?.name ?? opts.repos.available().find((p) => p.id === id)?.name ?? id;
  }

  function settle(id: string, status: ContinuityStatus, reason?: string): void {
    const e = state.plugins[id];
    e.status = status;
    if (reason) e.reason = reason;
    else delete e.reason;
    save();
    log(`Continuité : ${id} ${status}${reason ? ` (${reason})` : ''}.`);
    if (status !== 'installed') return;
    try {
      opts.secrets?.seal(id);
    } catch (err) {
      // Le secret reste en clair, comme avant ; il sera chiffré à son prochain changement.
      log(`Continuité : réglages secrets de ${id} non chiffrés (${(err as Error)?.message ?? err}).`);
    }
  }

  /** Reprend la file de la configuration (migration v10, import d'un fichier ancien) ; rend vrai si elle n'était pas vide. */
  function consume(config: Config): boolean {
    const queue = config.continuity ?? [];
    if (!queue.length) return false;
    for (const ruleId of queue) {
      const rule = valid.find((r) => r.id === ruleId);
      if (!rule) {
        log(`Continuité : règle inconnue ${ruleId}, ignorée.`);
        continue;
      }
      // Rejouée (import du même fichier, arrêt avant l'effacement de la file) : rien de plus.
      const e = (state.plugins[rule.plugin] ??= { mode: rule.mode, rules: [], status: 'pending', attempts: 0 });
      if (!e.rules.includes(rule.id)) e.rules.push(rule.id);
    }
    save();
    opts.config.update((d) => void delete d.continuity);
    return true;
  }

  /** Plugins inclus : activés ; plugins à installer déjà présents (installés à la main entre-temps) : reconnus. */
  async function activate(): Promise<void> {
    for (const [id] of pendingOf('bundled')) {
      const p = opts.plugins.list().find((x) => x.id === id);
      if (!p) settle(id, 'failed', opts.translate('continuity.reasons.missing', { name: id }));
      else if (p.status === 'refused') settle(id, 'failed', p.message ?? undefined);
      else {
        if (!p.enabled) await opts.plugins.setEnabled(id, true);
        settle(id, 'installed');
      }
    }
    for (const [id] of pendingOf('install')) if (present(id)) settle(id, 'installed');
  }

  /** Installe ce qui attend, si l'index officiel a pu être lu en ligne (`status` : déjà mis à jour, sinon on le fait). */
  async function install(status?: RepositoryInfo[]): Promise<void> {
    if (!pendingOf('install').length) return;
    const statuses = status ?? (await opts.repos.refresh().catch(() => [] as RepositoryInfo[]));
    const official = statuses.find((s) => s.official);
    if (!official || official.checkedAt === null || official.error) {
      log(`Continuité : dépôt officiel injoignable (${official?.error ?? 'absent'}), installations en attente.`);
      return;
    }
    for (const [id, e] of pendingOf('install')) {
      if (present(id)) {
        settle(id, 'installed');
        continue;
      }
      const out = await opts.repos.installOfficial(id);
      if (out.ok) settle(id, 'installed');
      else if (out.code === 'busy') continue;
      else if (DEFINITIVE.has(out.code) || ++e.attempts >= MAX_ATTEMPTS) settle(id, 'failed', out.error);
      else {
        e.reason = out.error;
        save();
      }
    }
  }

  function summary(): ContinuitySummary {
    const items: ContinuityItem[] = Object.entries(state.plugins).map(([id, e]) => ({
      plugin: id,
      name: nameOf(id),
      bundled: e.mode === 'bundled',
      status: e.status,
      reason: e.status === 'pending' ? null : (e.reason ?? null),
    }));
    const unseen = Object.entries(state.plugins).filter(([, e]) => e.seen !== e.status);
    const count = (s: ContinuityStatus) => unseen.filter(([, e]) => e.status === s).length;
    const parts: string[] = [];
    if (count('installed')) parts.push(opts.translate('continuity.notice.installed', { count: count('installed') }));
    if (count('pending')) parts.push(opts.translate('continuity.notice.pending', { count: count('pending') }));
    for (const [id, e] of unseen)
      if (e.status === 'failed') parts.push(opts.translate('continuity.notice.failed', { name: nameOf(id), reason: e.reason ?? '' }));
    return { items, notice: parts.length ? parts.join(' ') : null };
  }

  function announce(): void {
    const s = summary();
    if (!s.notice) return;
    try {
      opts.onChange?.(s);
    } catch {
      // Interface fermée : le récapitulatif sera demandé au prochain affichage.
    }
  }

  /** Un passage à la fois : la file, les plugins inclus, puis les installations. */
  function run(status?: RepositoryInfo[]): Promise<void> {
    if (running) {
      again = { status };
      return running;
    }
    running = (async () => {
      for (let next: { status?: RepositoryInfo[] } | null = { status }; next; next = again, again = null) {
        try {
          consume(opts.config.get());
          await activate();
          announce();
          await install(next.status);
          announce();
        } catch (err) {
          log(`Continuité : ${(err as Error).message}`);
        }
      }
    })().finally(() => (running = null));
    return running;
  }

  return {
    /**
     * À appeler une fois l'hôte de plugins démarré. Rend la promesse de tout le travail ; seule la partie locale
     * (file, plugins inclus) est rapide, les installations attendent le réseau : ne pas attendre au démarrage.
     */
    start(): Promise<void> {
      state = normalizeContinuityState(store.load());
      if (!started) {
        started = true;
        // Import d'une configuration ancienne : ses règles arrivent par la configuration.
        // Hors de l'abonnement : la file est effacée par une nouvelle modification de la configuration.
        opts.config.onChange((next) => {
          if (next.continuity?.length) setImmediate(() => void run());
        });
      }
      return run();
    },
    /** Index des dépôts mis à jour (`reposRefresh`) : les installations en attente sont retentées. */
    afterRefresh: (status: RepositoryInfo[]): Promise<void> => (pendingOf('install').length ? run(status) : Promise.resolve()),
    summary,
    /** Le récapitulatif a été montré : son message ne revient plus, jusqu'au prochain changement d'état. */
    seen(): boolean {
      const entries = Object.values(state.plugins).filter((e) => e.seen !== e.status);
      for (const e of entries) e.seen = e.status;
      if (entries.length) save();
      return true;
    },
    flush: () => store.flush(),
  };
}

export type Continuity = ReturnType<typeof createContinuity>;
