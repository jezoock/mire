import type { AssistantState, AvailablePlugin, LanguageInfo, PluginConsentRequest, PluginsOutcome } from '@mire/shared/ipc';
import { asFamily, installPlan, stepAfter, toggle, usableOffers, type Session } from '../assistant/model.ts';
import { consentHelp } from '../centre/plugins.ts';
import { Controller } from './base.ts';

/**
 * `mire-assistant` : assistant du premier lancement (P4-23). Étapes (commencer, suivante, précédente), choix (familles,
 * box, services, désignés par leur clé), installation des plugins retenus au récapitulatif, sortie (terminer, passer,
 * ouvrir le Centre).
 *
 * Ce qui part vers le processus principal : des identifiants de plugin et de dépôt, et pour un accord la version que
 * le processus principal a lui-même demandée. Rien n'est installé avant le bouton « Installer » du récapitulatif, et un
 * accord n'est jamais donné sans la boîte d'avertissement du Centre, confirmée par l'utilisateur.
 */
export class AssistantController extends Controller {
  /** Première lecture des dépôts en ligne (le cache sert sans connexion), puis l'étape « Langue ». */
  async start(): Promise<void> {
    const { api, ui } = this.ctx;
    const s = this.#s();
    if (s.loading) return;
    s.loading = true;
    ui.assistant.refresh();
    try {
      const [repos, state, lang] = await Promise.all([api.reposRefresh(), api.assistantState(), api.i18nGet()]);
      const offers = (await api.reposPlugins()) as AvailablePlugin[] | null;
      s.offers = Array.isArray(offers) ? offers : [];
      s.offline = !Array.isArray(repos) || repos.some((r) => r.error);
      const st = state as Partial<AssistantState> | null;
      const li = lang as Partial<LanguageInfo> | null;
      s.systemLanguages = Array.isArray(st?.systemLanguages) ? st.systemLanguages : [];
      s.builtin = (li?.available ?? []).map((l) => l.code);
      s.language = li?.language ?? 'en';
    } catch {
      s.offers = [];
      s.offline = true;
    } finally {
      s.loading = false;
    }
    s.step = 'language';
    ui.assistant.refresh(true);
  }

  next(): void {
    this.#move(1);
  }

  back(): void {
    this.#move(-1);
  }

  /** Coche ou décoche une famille (`movies`, `music`…) ; une clé inconnue est ignorée. */
  toggleUse({ key }: { key: string }): void {
    const family = asFamily(key);
    if (!family) return;
    const s = this.#s();
    s.uses = toggle(s.uses, family);
    this.ctx.ui.assistant.refresh();
  }

  /** Choisit la box (`''` : aucune) parmi celles que l'index propose. */
  chooseBox({ id }: { id: string }): void {
    const s = this.#s();
    const known = usableOffers(s.offers ?? []).some((p) => p.id === id && p.categories.includes('tv-box'));
    if (id !== '' && !known) return;
    s.box = id === '' ? null : id;
    this.ctx.ui.assistant.refresh();
  }

  /** Coche ou décoche un service de streaming proposé par l'index. */
  toggleService({ id }: { id: string }): void {
    const s = this.#s();
    if (!usableOffers(s.offers ?? []).some((p) => p.id === id && p.categories.includes('streaming-service'))) return;
    s.services = toggle(s.services, id);
    this.ctx.ui.assistant.refresh();
  }

  /**
   * Installe les plugins du récapitulatif, un appel par plugin demandé (ses dépendances viennent avec lui). Un plugin
   * qui demande l'accord affiche l'avertissement du Centre ; sans confirmation, il n'est pas installé et l'assistant
   * continue. Un échec n'arrête rien : il est montré, et se rattrape dans le Centre.
   */
  async install(): Promise<void> {
    const { api, ui } = this.ctx;
    const s = this.#s();
    if (s.step !== 'summary') return;
    const plan = installPlan(s);
    s.results = Object.fromEntries(plan.map((i) => [i.offer.id, { state: 'waiting' as const }]));
    s.progress = {};
    s.step = 'install';
    ui.assistant.refresh(true);
    const done = new Set<string>();
    for (const item of plan.filter((i) => i.root)) {
      const { id, repository } = item.offer;
      if (done.has(id)) continue;
      s.results[id] = { state: 'running' };
      ui.assistant.refresh();
      let r = (await api.pluginsInstall(id, undefined, repository).catch(() => null)) as PluginsOutcome | null;
      if (r && !r.ok && r.code === 'consent' && r.consent?.length) {
        if (!(await this.#consent(r.consent))) {
          s.results[id] = { state: 'declined' };
          continue;
        }
        r = (await api.pluginsInstall(id, undefined, repository).catch(() => null)) as PluginsOutcome | null;
      }
      delete s.progress[id];
      if (r?.ok) {
        for (const p of r.plugins) done.add(p.id);
        s.results[id] = { state: 'installed' };
      } else s.results[id] = { state: 'failed', message: r && !r.ok ? r.error : this.ctx.t('centre.plugins.messages.refused') };
    }
    // Dépendances : installées avec un plugin, sinon en échec avec lui.
    for (const item of plan.filter((i) => !i.root)) s.results[item.offer.id] = done.has(item.offer.id) ? { state: 'installed' } : { state: 'failed' };
    s.step = 'done';
    await ui.loadPlugins();
    ui.assistant.refresh(true);
  }

  /** Passe l'assistant : rien n'est installé ; tout se règle dans le Centre. */
  async skip(): Promise<void> {
    const { toast, t } = this.ctx;
    await this.#finish('home');
    toast(t('assistant.skipped'), { duration: 6000 });
  }

  async finish(): Promise<void> {
    await this.#finish('home');
  }

  /** Termine l'assistant et ouvre l'onglet Plugins du Centre (pour réessayer une installation). */
  async openCentre(): Promise<void> {
    await this.#finish('centre');
  }

  // ---------- Aides ----------

  #s(): Session {
    return this.ctx.ui.assistant.session();
  }

  #move(dir: 1 | -1): void {
    const s = this.#s();
    if (s.loading || s.step === 'install' || s.step === 'done') return;
    const next = stepAfter(s, dir);
    if (next === s.step) return;
    s.step = next;
    this.ctx.ui.assistant.refresh(true);
  }

  async #finish(to: 'home' | 'centre'): Promise<void> {
    if (this.#s().step === 'install') return;
    await this.ctx.api.assistantFinish().catch(() => false);
    this.ctx.ui.assistant.close(to);
  }

  #name(id: string): string {
    return (this.#s().offers ?? []).find((p) => p.id === id)?.name ?? id;
  }

  /** Avertissement renforcé du Centre ; l'accord n'est donné qu'après « J'ai compris, installer ». */
  async #consent(requests: PluginConsentRequest[]): Promise<boolean> {
    const { api, t, dialogs } = this.ctx;
    const res = await dialogs.form({
      title: t('centre.plugins.consent.title'),
      help: consentHelp(requests, (id) => this.#name(id), t),
      fields: [],
      actions: [
        { id: 'cancel', label: t('centre.plugins.consent.cancel'), kind: 'primary' },
        { id: 'accept', label: t('centre.plugins.consent.accept'), kind: '' },
      ],
    });
    if (res.action !== 'accept') return false;
    for (const r of requests) if (!(await api.pluginsConsent(r.plugin, r.repository, r.version))) return false;
    return true;
  }
}
