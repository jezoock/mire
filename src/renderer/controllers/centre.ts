import type {
  PluginConsentRequest,
  PluginSummary,
  PluginsOutcome,
  RepositoryInfo,
  RepositoryOutcome,
  RepositoryPreview,
  RepositoryRemoveOutcome,
  UninstallOutcome,
} from '@mire/shared/ipc';
import { groupFingerprint } from '@mire/ui/utils';
import { consentHelp, nameFinder, repoInputError } from '../centre/plugins.ts';
import { Controller } from './base.ts';
import type { Data } from './types.ts';

/** Destination d'un téléchargement : le dossier d'une console, ou le dossier des téléchargements (`''`). */
const destOf = (consoleId: string) => (consoleId === '' ? {} : { console: consoleId });

/** Focus après le rendu (P4-19) : le bouton « Retour » d'une fiche, le bouton « Voir la fiche » d'une carte. */
const SHEET_BACK = '.mire-centre-view__sheet-back button';
const openButtonOf = (key: string) => `.mire-centre-view__plugin[data-key="${key.replace(/["\\]/g, '')}"] .--openPlugin button`;

/**
 * `mire-centre` (P4-18) : onglets du Centre, téléchargements (ajouter un lien ou un .torrent, suivre, annuler), apps
 * (émulateurs, consoles de RetroArch, jeux libres, import) et BIOS ; plugins (fiche, installer avec l'accord demandé
 * pour un plugin tiers de code sensible, mettre à jour, activer, désactiver, désinstaller) et dépôts (mettre à jour les
 * listes, ajouter en deux temps, retirer), P4-19. Les messages viennent des catalogues (`centre.*`) ; les erreurs
 * rendues par le processus principal (`{ ok: false, error }`) sont déjà rédigées.
 *
 * Ce qui part vers le processus principal pour les plugins et les dépôts : des identifiants, des versions, l'adresse
 * et la clé saisies, l'empreinte montrée. Il vérifie tout de nouveau (`src/main/ipc/handlers/plugins.ts`).
 */
export class CentreController extends Controller {
  /** Affiche un onglet du Centre : `downloads` ou `apps`. */
  showTab({ tab }: { tab: string }): void {
    this.ctx.ui.showCentreTab(tab);
  }

  /** Ouvre le Centre sur ses apps (« Ouvrir les apps du Centre » de la page Jeux historique). */
  openApps(): void {
    this.ctx.ui.showCentreTab('apps');
    this.ctx.ui.open('screen:center', { focus: 'content' });
  }

  // ---------- Téléchargements ----------

  /** Formulaire d'ajout (P4-06) : un lien et sa destination, ou un fichier .torrent. */
  async addLink(): Promise<void> {
    const { S, t, dialogs } = this.ctx;
    const k = (key: string) => t(`centre.downloads.form.${key}`);
    const options: [string, string][] = [
      ['', k('destDownloads')],
      ...(S.config?.emulators ?? []).map((e): [string, string] => [String(e.id), t('centre.downloads.form.destConsole', { name: String(e.name) })]),
    ];
    const res = await dialogs.form({
      title: k('title'),
      help: k('help'),
      fields: [
        { id: 'url', type: 'text', label: k('url'), placeholder: k('urlPlaceholder'), required: true },
        { id: 'dest', type: 'select', label: k('dest'), options, value: '' },
      ],
      actions: [
        { id: 'add', label: k('add'), kind: 'primary' },
        { id: 'torrent', label: k('torrent'), kind: '' },
      ],
    });
    const dest = String(res.values?.dest ?? '');
    if (res.action === 'add') await this.addDownload({ url: String(res.values?.url ?? '').trim(), console: dest });
    else if (res.action === 'torrent') await this.addTorrentFile({ console: dest });
  }

  /** Ajoute un lien (https://… ou magnet:?…) ; vrai s'il a été ajouté. */
  async addDownload({ url, console = '' }: { url: string; console?: string }): Promise<boolean> {
    const { api, toast, t } = this.ctx;
    if (!url) {
      toast(t('centre.downloads.messages.needUrl'));
      return false;
    }
    const r = (await api.downloadsAddUrl(url, destOf(console) as never)) as Data | null;
    if (!r?.ok) {
      toast(r?.error || t('centre.downloads.messages.addFailed'), { duration: 8000 });
      return false;
    }
    toast(t(r.external ? 'centre.downloads.messages.external' : 'centre.downloads.messages.added'));
    return true;
  }

  /** Ajoute un fichier .torrent choisi sur l'ordinateur. */
  async addTorrentFile({ console = '' }: { console?: string } = {}): Promise<void> {
    const r = (await this.ctx.api.downloadsAddTorrentFile(destOf(console) as never)) as Data | null;
    if (r && !r.ok && !r.canceled) this.ctx.toast(r.error || this.ctx.t('centre.downloads.messages.torrentFailed'), { duration: 8000 });
  }

  async pauseDownload({ id }: { id: string }): Promise<void> {
    await this.ctx.api.downloadsPause(id);
  }

  async resumeDownload({ id }: { id: string }): Promise<void> {
    await this.ctx.api.downloadsResume(id);
  }

  /** Lance un téléchargement en attente. */
  async startDownload({ id }: { id: string }): Promise<void> {
    await this.ctx.api.downloadsResume(id);
    this.ctx.toast(this.ctx.t('centre.downloads.messages.started'));
  }

  /** Annule un téléchargement après confirmation ; ses fichiers sont supprimés. */
  async cancelDownload({ id }: { id: string }): Promise<void> {
    const { S, api, ui, t } = this.ctx;
    const d = S.downloads.find((x) => x.id === id);
    const ok = await ui.confirm(
      t('centre.downloads.messages.cancelTitle', { name: String(d?.name || t('centre.downloads.messages.cancelUntitled')) }),
      t('centre.downloads.messages.cancelHelp'),
      t('centre.downloads.messages.cancelYes'),
    );
    if (ok) await api.downloadsCancel(id, true);
  }

  async removeDownload({ id }: { id: string }): Promise<void> {
    await this.ctx.api.downloadsRemove(id);
  }

  /** Retire de la liste les téléchargements terminés. */
  async clearDownloads(): Promise<void> {
    const { S, api, ui } = this.ctx;
    const r = await api.downloadsClear();
    S.downloads = (r || []) as typeof S.downloads;
    ui.render();
    ui.updateDlBadge();
  }

  async revealDownload({ id }: { id: string }): Promise<void> {
    await this.ctx.api.downloadsReveal(id);
  }

  /** Lance le programme d'installation téléchargé (`file` : son chemin dans le téléchargement). */
  async runInstaller({ id, file }: { id: string; file: string }): Promise<void> {
    const r = (await this.ctx.api.downloadsRunInstaller(id, file)) as Data | null;
    if (!r?.ok) this.ctx.toast(r?.error || this.ctx.t('centre.downloads.messages.installerFailed'), { duration: 8000 });
  }

  // ---------- Apps ----------

  /** Coche ou décoche une console à installer avec RetroArch. */
  toggleSystem({ id }: { id: string }): void {
    const { S, ui } = this.ctx;
    if (S.raPick.has(id)) S.raPick.delete(id);
    else S.raPick.add(id);
    ui.render();
  }

  /** Installe un émulateur (RetroArch : avec les consoles cochées), suivi par l'avancement envoyé par le processus principal. */
  async install({ id }: { id: string }): Promise<void> {
    const { S, api, ui, t } = this.ctx;
    const systems = id === 'retroarch' ? [...S.raPick] : [];
    S.storeProgress[id] = { id, phase: 'resolve' };
    ui.render();
    const r = (await api.storeInstall(id, systems)) as Data | null;
    delete S.storeProgress[id];
    if (r?.ok && id === 'retroarch') S.raPick.clear();
    await ui.afterStoreChange(r, r?.ok ? t('centre.apps.messages.installed') : '');
  }

  async uninstall({ id }: { id: string }): Promise<void> {
    const r = await this.ctx.api.storeUninstall(id);
    await this.ctx.ui.afterStoreChange(r, this.ctx.t('centre.apps.messages.uninstalled'));
  }

  /** Ajoute un jeu libre de la boutique. */
  async installGame({ id }: { id: string }): Promise<void> {
    const { S, api, ui, toast, t } = this.ctx;
    const key = `game:${id}`;
    S.storeProgress[key] = { id: key, phase: 'download', step: 'game' };
    ui.render();
    const r = (await api.storeGame(id)) as Data | null;
    delete S.storeProgress[key];
    await ui.afterStoreChange(r, r?.ok ? t('centre.apps.messages.gameAdded') : '');
    if (!r?.ok && r?.error) toast(r.error, { duration: 7000 });
  }

  /**
   * Copie des jeux choisis sur l'ordinateur dans le dossier d'une console. Sans console, un formulaire la demande
   * parmi celles qui ont un dossier de jeux.
   */
  async importGames({ console }: { console?: string } = {}): Promise<void> {
    const { S, api, toast, t, dialogs } = this.ctx;
    let target = console;
    if (target == null) {
      const consoles = (S.config?.emulators ?? []).filter((e) => e.romsDir);
      if (!consoles.length) return;
      const k = (key: string) => t(`centre.apps.importForm.${key}`);
      const res = await dialogs.form({
        title: k('title'),
        help: k('help'),
        fields: [
          {
            id: 'console',
            type: 'select',
            label: k('console'),
            options: consoles.map((e): [string, string] => [String(e.id), String(e.name)]),
            value: String(consoles[0]!.id),
          },
        ],
        actions: [{ id: 'choose', label: k('choose'), kind: 'primary' }],
      });
      if (res.action !== 'choose') return;
      target = String(res.values?.console ?? '');
    }
    const r = (await api.storeImport(target as never)) as Data | null;
    if (r?.ok && r.count) {
      S.romsCache = {};
      toast(t('centre.apps.messages.imported', { count: Number(r.count), console: String(r.console) }));
    } else if (r && !r.ok) toast(r.error, { duration: 7000 });
  }

  /** Choisit le dossier des prochaines consoles. */
  async chooseGamesFolder(): Promise<void> {
    const { S, api, ui, toast, t } = this.ctx;
    const cfg = await api.storePickRoot();
    if (cfg) {
      S.config = cfg as typeof S.config;
      await ui.loadCatalog();
      toast(t('centre.apps.messages.rootChanged'));
    }
  }

  // ---------- BIOS ----------

  async addBios({ id }: { id: string }): Promise<void> {
    const { api, ui, toast, t } = this.ctx;
    const r = (await api.biosAdd(id)) as Data | null;
    if (r?.ok) {
      toast(t('centre.apps.messages.biosCopied', { count: r.copied.length }));
      await ui.loadCatalog();
    } else if (r && !r.canceled) toast(r.error || t('centre.apps.messages.biosFailed'), { duration: 8000 });
  }

  async openBios({ id }: { id: string }): Promise<void> {
    const r = (await this.ctx.api.biosOpen(id)) as Data | null;
    if (r && !r.ok && r.error) this.ctx.toast(r.error);
  }
  // ---------- Plugins (P4-19) ----------

  /** Lit les listes des dépôts en ligne (seul moment où le Centre va sur le réseau), puis relit les plugins. */
  async refreshRepos(): Promise<void> {
    const { api, ui, toast, t } = this.ctx;
    const repos = (await api.reposRefresh()) as RepositoryInfo[] | null;
    await ui.loadPlugins();
    toast(t(!Array.isArray(repos) || repos.some((r) => r.error) ? 'centre.repos.messages.refreshErrors' : 'centre.repos.messages.refreshed'), {
      duration: 6000,
    });
  }

  /** Ouvre la fiche d'un plugin (`key` : identifiant d'un plugin présent, `<dépôt>/<identifiant>` d'un plugin proposé). */
  openPlugin({ key }: { key: string }): void {
    this.ctx.S.pluginSheet = String(key);
    this.ctx.ui.refreshCentre(SHEET_BACK);
  }

  /** Revient aux listes, le focus sur la carte de la fiche refermée. */
  closePlugin(): void {
    const { S, ui } = this.ctx;
    const key = S.pluginSheet;
    S.pluginSheet = null;
    ui.refreshCentre(key ? openButtonOf(key) : undefined);
  }

  /**
   * Installe un plugin proposé par un dépôt, avec ses dépendances. Si une version demande l'accord (plugin tiers de code
   * sensible), le processus principal refuse avant tout téléchargement : l'avertissement renforcé est affiché, et
   * l'accord n'est donné (`pluginsConsent`) que si l'utilisateur le confirme ; l'installation est alors relancée.
   */
  async installPlugin({ id, repository }: { id: string; repository: string }): Promise<void> {
    const { api } = this.ctx;
    let r = (await api.pluginsInstall(id, undefined, repository)) as PluginsOutcome | null;
    if (r && !r.ok && r.code === 'consent' && r.consent?.length) {
      if (!(await this.#consent(r.consent))) return;
      r = (await api.pluginsInstall(id, undefined, repository)) as PluginsOutcome | null;
    }
    // Installé : la fiche ouverte devient celle du plugin présent.
    if (r?.ok && this.ctx.S.pluginSheet?.endsWith(`/${id}`)) this.ctx.S.pluginSheet = id;
    await this.#afterInstall(r, id, 'installed');
  }

  /** Met à jour un plugin depuis le dépôt qui l'a installé (accord redemandé si la version élargit ce qu'il demande). */
  async updatePlugin({ id }: { id: string }): Promise<void> {
    const { api } = this.ctx;
    let r = (await api.pluginsUpdate(id)) as PluginsOutcome | null;
    if (r && !r.ok && r.code === 'consent' && r.consent?.length) {
      if (!(await this.#consent(r.consent))) return;
      r = (await api.pluginsUpdate(id)) as PluginsOutcome | null;
    }
    await this.#afterInstall(r, id, 'updated');
  }

  async enablePlugin({ id }: { id: string }): Promise<void> {
    await this.#setEnabled(id, true);
  }

  async disablePlugin({ id }: { id: string }): Promise<void> {
    await this.#setEnabled(id, false);
  }

  /** Désinstalle un plugin, en gardant ou non ses données (au choix, dans une boîte). */
  async uninstallPlugin({ id }: { id: string }): Promise<void> {
    const { S, api, ui, toast, t, dialogs } = this.ctx;
    const name = this.#name(id);
    const k = (key: string) => t(`centre.plugins.uninstall.${key}`, { name });
    const res = await dialogs.form({
      title: k('title'),
      help: k('help'),
      fields: [],
      actions: [
        { id: 'keep', label: k('keep'), kind: 'primary' },
        { id: 'erase', label: k('erase'), kind: '' },
        { id: 'cancel', label: k('cancel'), kind: 'ghost' },
      ],
    });
    if (res.action !== 'keep' && res.action !== 'erase') return;
    const r = (await api.pluginsUninstall(id, res.action === 'keep')) as UninstallOutcome | null;
    if (!r) toast(t('centre.plugins.messages.refused'));
    else if (!r.ok) toast(r.message, { duration: 8000 });
    else {
      const key = r.restored ? 'restored' : r.keptData ? 'uninstalledKept' : 'uninstalled';
      toast(t(`centre.plugins.messages.${key}`, { name }), { duration: 6000 });
      if (!r.restored && S.pluginSheet === id) S.pluginSheet = null;
    }
    await ui.loadPlugins();
  }

  // ---------- Dépôts (P4-19) ----------

  /**
   * Ajoute un dépôt tiers en deux temps : l'adresse de sa liste et sa clé (contrôlées ici, vérifiées par le processus
   * principal, qui lit la liste signée), puis le nom et l'empreinte de la clé à comparer avec ce que publie le dépôt.
   * Le dépôt n'est ajouté qu'avec l'empreinte montrée.
   */
  async addRepository(): Promise<void> {
    const { api, ui, toast, t, dialogs } = this.ctx;
    const f = (key: string) => t(`centre.repos.form.${key}`);
    let index = '';
    let key = '';
    let preview: RepositoryPreview | null = null;
    const res = await dialogs.form({
      title: f('title'),
      help: f('help'),
      fields: [
        { id: 'index', type: 'text', label: f('index'), placeholder: f('indexPlaceholder'), required: true, full: true },
        { id: 'key', type: 'textarea', label: f('key'), placeholder: f('keyPlaceholder'), required: true, rows: 5 },
      ],
      actions: [
        { id: 'check', label: f('check'), kind: 'primary' },
        { id: 'cancel', label: f('cancel'), kind: 'ghost' },
      ],
      onAction: async (action, form) => {
        if (action !== 'check') return false;
        const values = form.values();
        index = String(values.index ?? '').trim();
        key = String(values.key ?? '').trim();
        const problem = repoInputError(index, key);
        if (problem) {
          form.help(f(`errors.${problem}`));
          return true;
        }
        const r = (await api.reposInspect(index, key)) as RepositoryOutcome | null;
        if (!r || !r.ok) {
          form.help(r ? r.error : f('errors.refused'));
          return true;
        }
        preview = r.repository;
        return false;
      },
    });
    const seen = preview as RepositoryPreview | null;
    if (res.action !== 'check' || !seen) return;
    if (!(await this.#confirmRepository(seen))) return;
    const r = (await api.reposAdd(index, key, seen.fingerprint)) as RepositoryOutcome | null;
    if (!r) toast(t('centre.repos.messages.refused'));
    else if (!r.ok) toast(r.error, { duration: 8000 });
    else toast(t('centre.repos.messages.added', { name: r.repository.name }), { duration: 6000 });
    await ui.loadPlugins();
  }

  /** Retire un dépôt tiers : garder ses plugins (sans mises à jour), ou les désinstaller (en gardant ou non leurs données). */
  async removeRepository({ id }: { id: string }): Promise<void> {
    const { S, api, ui, toast, t, dialogs } = this.ctx;
    const name = S.plugins?.repos.find((r) => r.id === id)?.name ?? id;
    const k = (key: string) => t(`centre.repos.removeForm.${key}`, { name });
    const res = await dialogs.form({
      title: k('title'),
      help: k('help'),
      fields: [],
      actions: [
        { id: 'keep', label: k('keep'), kind: 'primary' },
        { id: 'uninstall', label: k('uninstall'), kind: '' },
        { id: 'erase', label: k('erase'), kind: '' },
        { id: 'cancel', label: k('cancel'), kind: 'ghost' },
      ],
    });
    if (!['keep', 'uninstall', 'erase'].includes(res.action)) return;
    const r = (await api.reposRemove(id, res.action !== 'keep', res.action !== 'erase')) as RepositoryRemoveOutcome | null;
    if (!r) toast(t('centre.repos.messages.refused'));
    else if (!r.ok) toast(r.error, { duration: 8000 });
    else {
      const names = nameFinder({ installed: S.plugins?.installed ?? [], available: S.plugins?.available ?? [] });
      const parts = [
        res.action === 'keep'
          ? t('centre.repos.messages.removed')
          : r.uninstalled.length
            ? t('centre.repos.messages.removedUninstalled', { count: r.uninstalled.length })
            : t('centre.repos.messages.removedNone'),
      ];
      if (r.kept.length) parts.push(t('centre.repos.messages.kept', { names: r.kept.map((p) => names(p.id)).join(', ') }));
      toast(parts.join(' '), { duration: 8000 });
    }
    await ui.loadPlugins();
  }

  // ---------- Aides ----------

  #name(id: string): string {
    const { S } = this.ctx;
    return nameFinder({ installed: S.plugins?.installed ?? [], available: S.plugins?.available ?? [] })(id);
  }

  /**
   * Avertissement renforcé pour les versions à accepter, puis l'accord, version par version, seulement si
   * l'utilisateur l'a confirmé par son bouton. Vrai si tout a été accepté.
   */
  async #consent(requests: PluginConsentRequest[]): Promise<boolean> {
    const { api, toast, t, dialogs } = this.ctx;
    const res = await dialogs.form({
      title: t('centre.plugins.consent.title'),
      help: consentHelp(requests, (id) => this.#name(id), t),
      fields: [],
      actions: [
        { id: 'cancel', label: t('centre.plugins.consent.cancel'), kind: 'primary' },
        { id: 'accept', label: t('centre.plugins.consent.accept'), kind: '' },
      ],
    });
    if (res.action !== 'accept') {
      toast(t('centre.plugins.messages.notConsented'));
      return false;
    }
    for (const r of requests) {
      if (!(await api.pluginsConsent(r.plugin, r.repository, r.version))) {
        toast(t('centre.plugins.messages.refused'));
        return false;
      }
    }
    return true;
  }

  /** Deuxième temps de l'ajout d'un dépôt : nom, empreinte à comparer, nombre de plugins. */
  async #confirmRepository(p: RepositoryPreview): Promise<boolean> {
    const { t, dialogs } = this.ctx;
    const k = (key: string, vars?: Record<string, string | number>) => t(`centre.repos.confirm.${key}`, vars);
    const lines = [
      k('help'),
      '',
      k('fingerprint', { fingerprint: groupFingerprint(p.fingerprint) }),
      k('index', { index: p.index }),
      k('plugins', { count: p.plugins }),
    ];
    if (p.sensitive) lines.push(k('sensitive', { count: p.sensitive }));
    const res = await dialogs.form({
      title: k('title', { name: p.name }),
      help: lines.join('\n'),
      fields: [],
      actions: [
        { id: 'add', label: k('add'), kind: 'primary' },
        { id: 'cancel', label: k('cancel'), kind: 'ghost' },
      ],
    });
    return res.action === 'add';
  }

  async #setEnabled(id: string, enabled: boolean): Promise<void> {
    const { api, ui, toast, t } = this.ctx;
    const p = (await api.pluginsSetEnabled(id, enabled)) as PluginSummary | null;
    if (!p) toast(t('centre.plugins.messages.refused'));
    else if (enabled && p.status !== 'active' && p.message) toast(p.message, { duration: 8000 });
    else toast(t(enabled ? 'centre.plugins.messages.enabled' : 'centre.plugins.messages.disabled', { name: p.name }));
    await ui.loadPlugins();
  }

  async #afterInstall(r: PluginsOutcome | null, id: string, done: 'installed' | 'updated'): Promise<void> {
    const { S, ui, toast, t } = this.ctx;
    delete S.pluginProgress[id];
    if (!r) toast(t('centre.plugins.messages.refused'));
    else if (!r.ok) toast(r.error, { duration: 9000 });
    else toast(t(`centre.plugins.messages.${done}`, { name: this.#name(id) }), { duration: 6000 });
    await ui.loadPlugins();
  }
}
