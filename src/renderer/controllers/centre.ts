import { Controller } from './base.ts';
import type { Data } from './types.ts';

/** Destination d'un téléchargement : le dossier d'une console, ou le dossier des téléchargements (`''`). */
const destOf = (consoleId: string) => (consoleId === '' ? {} : { console: consoleId });

/**
 * `mire-centre` (P4-18) : onglets du Centre, téléchargements (ajouter un lien ou un .torrent, suivre, annuler), apps
 * (émulateurs, consoles de RetroArch, jeux libres, import) et BIOS. Les messages viennent des catalogues (`centre.*`) ;
 * les erreurs rendues par le processus principal (`{ ok: false, error }`) sont déjà rédigées.
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
}
