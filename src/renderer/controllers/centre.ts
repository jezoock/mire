import { plural } from '../core/format.ts';
import { Controller } from './base.ts';
import type { Data } from './types.ts';

/** Destination d'un téléchargement : le dossier d'une console, ou le dossier des téléchargements (`''`). */
const destOf = (consoleId: string) => (consoleId === '' ? {} : { console: consoleId });

/** `mire-centre` : téléchargements, boutique (émulateurs, jeux libres), BIOS. */
export class CentreController extends Controller {
  // ---------- Téléchargements ----------

  /** Ajoute un lien (https://… ou magnet:?…) ; vrai s'il a été ajouté. */
  async addDownload({ url, console = '' }: { url: string; console?: string }): Promise<boolean> {
    const { api, toast } = this.ctx;
    if (!url) {
      toast('Collez d’abord un lien (https://… ou magnet:?…).');
      return false;
    }
    const r = (await api.downloadsAddUrl(url, destOf(console) as never)) as Data | null;
    if (!r?.ok) {
      toast(r?.error || 'Ce lien n’a pas pu être ajouté.', { duration: 8000 });
      return false;
    }
    toast(r.external ? 'Lien confié à votre logiciel de torrent.' : 'Téléchargement ajouté.');
    return true;
  }

  /** Ajoute un fichier .torrent choisi sur l'ordinateur. */
  async addTorrentFile({ console = '' }: { console?: string } = {}): Promise<void> {
    const r = (await this.ctx.api.downloadsAddTorrentFile(destOf(console) as never)) as Data | null;
    if (r && !r.ok && !r.canceled) this.ctx.toast(r.error || 'Ce fichier .torrent n’a pas pu être ajouté.', { duration: 8000 });
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
    this.ctx.toast('Téléchargement lancé.');
  }

  /** Annule un téléchargement après confirmation ; ses fichiers sont supprimés. */
  async cancelDownload({ id }: { id: string }): Promise<void> {
    const { S, api, ui } = this.ctx;
    const d = S.downloads.find((x) => x.id === id);
    const ok = await ui.confirm(
      `Annuler « ${d?.name || 'ce téléchargement'} » ?`,
      'Les fichiers déjà téléchargés pour lui seront supprimés.',
      'Annuler le téléchargement',
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
    if (!r?.ok) this.ctx.toast(r?.error || 'Le programme d’installation n’a pas pu être lancé.', { duration: 8000 });
  }

  // ---------- Boutique ----------

  /** Coche ou décoche un système à installer avec RetroArch. */
  toggleSystem({ id }: { id: string }): void {
    const { S, ui } = this.ctx;
    if (S.raPick.has(id)) S.raPick.delete(id);
    else S.raPick.add(id);
    if (ui.isPanelOpen()) ui.refreshPanel();
    else ui.render();
  }

  /** Installe un émulateur (RetroArch : avec les systèmes cochés). */
  async install({ id }: { id: string }): Promise<void> {
    const { S, api, ui } = this.ctx;
    const systems = id === 'retroarch' ? [...S.raPick] : [];
    S.storeProgress[id] = { phase: 'resolve', label: 'Préparation…' };
    ui.refreshPanel();
    const r = (await api.storeInstall(id, systems)) as Data | null;
    delete S.storeProgress[id];
    if (r?.ok && id === 'retroarch') S.raPick.clear();
    await ui.afterStoreChange(r, r?.ok ? 'Installé. Les consoles sont prêtes dans « Ma ludothèque ».' : '');
  }

  async uninstall({ id }: { id: string }): Promise<void> {
    const r = await this.ctx.api.storeUninstall(id);
    await this.ctx.ui.afterStoreChange(r, 'Émulateur désinstallé. Vos jeux sont conservés.');
  }

  /** Ajoute un jeu libre de la boutique. */
  async installGame({ id }: { id: string }): Promise<void> {
    const { S, api, ui, toast } = this.ctx;
    const key = `game:${id}`;
    S.storeProgress[key] = { phase: 'download', label: 'Téléchargement…' };
    ui.refreshPanel();
    const r = (await api.storeGame(id)) as Data | null;
    delete S.storeProgress[key];
    await ui.afterStoreChange(r, r?.ok ? 'Jeu ajouté à votre ludothèque.' : '');
    if (!r?.ok && r?.error) toast(r.error, { duration: 7000 });
  }

  /** Copie des jeux choisis sur l'ordinateur dans le dossier d'une console. */
  async importGames({ console }: { console?: string } = {}): Promise<void> {
    const { S, api, toast } = this.ctx;
    const r = (await api.storeImport(console as never)) as Data | null;
    if (r?.ok && r.count) {
      S.romsCache = {};
      toast(`${plural(r.count, 'jeu copié', 'jeux copiés')} dans ${r.console}.`);
    } else if (r && !r.ok) toast(r.error, { duration: 7000 });
  }

  /** Choisit le dossier des prochaines consoles. */
  async chooseGamesFolder(): Promise<void> {
    const { S, api, ui, toast } = this.ctx;
    const cfg = await api.storePickRoot();
    if (cfg) {
      S.config = cfg as typeof S.config;
      await ui.loadCatalog();
      toast('Les prochaines consoles utiliseront ce dossier.');
    }
  }

  // ---------- BIOS ----------

  async addBios({ id }: { id: string }): Promise<void> {
    const { api, ui, toast } = this.ctx;
    const r = (await api.biosAdd(id)) as Data | null;
    if (r?.ok) {
      toast(`${plural(r.copied.length, 'fichier copié', 'fichiers copiés')} dans le dossier des BIOS.`);
      await ui.loadCatalog();
    } else if (r && !r.canceled) toast(r.error || 'Copie impossible.', { duration: 8000 });
  }

  async openBios({ id }: { id: string }): Promise<void> {
    const r = (await this.ctx.api.biosOpen(id)) as Data | null;
    if (r && !r.ok && r.error) this.ctx.toast(r.error);
  }
}
