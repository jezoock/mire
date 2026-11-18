import { parseSites } from '../domain/index.ts';
import { plural } from '../core/format.ts';
import { Controller } from './base.ts';
import type { Data } from './types.ts';

/** `mire-settings` : réglages de Mire et des pages (apparence, menu, accueil, sites, bloqueur, télévision…). */
export class SettingsController extends Controller {
  // ---------- Apparence, menu, accueil ----------

  async setTheme({ id }: { id: string }): Promise<void> {
    await this.ctx.ui.saveUi((ui) => {
      ui.theme = id;
    });
  }

  /** Thème des pages (P4-11, `theme.json`) : appliqué tout de suite, sans redémarrage. */
  async setPageTheme({ id }: { id: string }): Promise<void> {
    await this.ctx.ui.saveUi((ui) => {
      ui.pageTheme = id;
    });
  }

  /** Position du menu : `left`, `right`, `top`, `bottom`. */
  async setMenuPosition({ id }: { id: string }): Promise<void> {
    await this.ctx.ui.saveUi((ui) => {
      ui.menu = { ...ui.menu, position: id };
    });
    this.ctx.ui.applyMenu();
  }

  /** Déplace un élément de l'accueil (`kind` : liste de l'accueil, `dir` : -1 vers le haut, 1 vers le bas). */
  async moveHomeItem({ kind, id, dir }: { kind: string; id: string; dir: number }): Promise<void> {
    await this.ctx.ui.saveUi((ui) => {
      const list = [...ui.home[kind]];
      const k = list.indexOf(id);
      const j = k + Number(dir);
      if (k < 0 || j < 0 || j >= list.length) return;
      [list[k], list[j]] = [list[j], list[k]];
      ui.home[kind] = list;
    });
  }

  // ---------- Configuration ----------

  async exportConfig(): Promise<void> {
    const r = (await this.ctx.api.configExport()) as Data | null;
    if (r?.ok) this.ctx.toast('Configuration exportée.');
    else if (r && !r.canceled) this.ctx.toast('Export impossible.', { duration: 6000 });
  }

  /** Importe une configuration (`mode` : `replace` ou `merge`). */
  async importConfig({ mode = 'replace' }: { mode?: string } = {}): Promise<void> {
    const { S, api, ui, toast } = this.ctx;
    const r = (await api.configImport(mode as never)) as Data | null;
    if (r?.ok) {
      S.config = r.config;
      if (r.usage) S.usage = r.usage;
      S.autoGames = [];
      S.localRoms = {};
      toast('Configuration importée.');
      ui.scan();
      ui.loadLocalRoms();
      ui.go(S.section);
    } else if (r && !r.canceled) toast(r?.error || 'Import impossible.', { duration: 8000 });
  }

  revealConfig(): void {
    this.ctx.api.revealConfig();
  }

  /** Choisit un fichier (`kind` : son type) ; rend son chemin, ou une chaîne vide. */
  async browse({ kind }: { kind: string }): Promise<string> {
    return ((await this.ctx.api.pickFile(kind as never)) as string | null) || '';
  }

  // ---------- Sites ----------

  /** Ajoute un site de streaming ; vrai s'il a été ajouté. */
  async addSite({ name, url }: { name: string; url: string }): Promise<boolean> {
    const { S, api, toast } = this.ctx;
    if (!name || !url) {
      toast('Indiquez un nom et une adresse.');
      return false;
    }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const next = structuredClone(S.config) as Data;
    next.web.push({ name, url, mode: 'integrated', color: '#59625B', search: '' });
    S.config = (await api.saveConfig(next as never)) as typeof S.config;
    toast(`${name} ajouté dans Streaming`);
    return true;
  }

  /** Enregistre les sites de jeux PC (un par ligne). */
  async savePcSites({ text }: { text: string }): Promise<void> {
    const { S, api, toast } = this.ctx;
    const sites = parseSites(text);
    S.config = (await api.saveConfig({ ...S.config, pcSites: sites } as never)) as typeof S.config;
    toast(`${plural(sites.length, 'site enregistré', 'sites enregistrés')}.`);
  }

  // ---------- Bloqueur de publicités ----------

  /** Met à jour les listes de filtres. */
  async updateFilterLists(): Promise<void> {
    const { api, ui, toast } = this.ctx;
    toast('Mise à jour des listes de filtres…', { duration: 2500 });
    const st = (await api.adblockUpdate()) as Data | null;
    if (st?.ok === false) toast(st.error, { duration: 8000 });
    else {
      await ui.afterAdblockChange(st);
      toast('Listes de filtres à jour');
    }
  }

  /** Retire une liste de filtres (`kind` : `lists` ou `customLists`, `id` : la liste). */
  async removeFilterList({ kind, id }: { kind: string; id: string }): Promise<void> {
    const { S, api, ui, toast } = this.ctx;
    const st = ((S.adblock as Data | null) || (await api.adblockStatus())) as Data;
    const next = (st[kind] as string[]).filter((x) => x !== id);
    await ui.afterAdblockChange(await api.adblockSetLists({ [kind]: next } as never));
    if (kind === 'customLists') toast('Liste retirée. Elle ne servira plus après la prochaine mise à jour des listes.');
  }

  /** Ajoute une liste de filtres (adresse complète), puis lance la mise à jour des listes ; vrai si elle est ajoutée. */
  async addFilterList({ url }: { url: string }): Promise<boolean> {
    const { S, api, ui, toast } = this.ctx;
    if (!/^https?:\/\//i.test(url)) {
      toast('Indiquez l’adresse complète de la liste (https://…).');
      return false;
    }
    const st = ((S.adblock as Data | null) || (await api.adblockStatus())) as Data;
    await ui.afterAdblockChange(await api.adblockSetLists({ customLists: [...new Set([...st.customLists, url])] } as never));
    toast('Liste ajoutée. Mise à jour des listes…', { duration: 2500 });
    // La mise à jour prend du temps : la liste est déjà ajoutée, l'action est terminée.
    void (api.adblockUpdate() as Promise<Data | null>).then(async (st2) => {
      if (st2?.ok === false) toast(st2.error, { duration: 8000 });
      else await ui.afterAdblockChange(st2);
    });
    return true;
  }

  // ---------- Infos en ligne ----------

  /** Récupère de nouveau les infos de toutes les pages. */
  scrapeAll(): void {
    this.ctx.ui.startScrape(['videos', 'music', 'games'], { force: true });
    this.ctx.toast('Récupération lancée : le bouton en haut des sections Vidéos, Musique et Jeux montre l’avancement.', { duration: 6000 });
  }

  async clearScrape(): Promise<void> {
    await this.ctx.api.scrapeClear();
    await this.ctx.ui.reloadScrape();
    this.ctx.toast('Infos récupérées effacées');
  }

  // ---------- Télévision, téléchargements ----------

  /** Choisit le service de télévision. */
  async setTvService({ id }: { id: string }): Promise<void> {
    const { S, api, ui } = this.ctx;
    const cfg = await api.tvSetActive(id);
    S.config = cfg as typeof S.config;
    S.channels = null;
    S.tvWeb = null;
    S.tvError = null;
    ui.refreshPanel();
    if (S.section === 'tv') ui.loadChannels();
  }

  /** Choisit le dossier des téléchargements. */
  async chooseDownloadFolder(): Promise<void> {
    const { S, api, ui } = this.ctx;
    const dir = await api.downloadsPickDir();
    if (!dir) return;
    await ui.setCfg('downloads.dir', dir);
    S.dlSettings.dir = dir;
    ui.refreshPanel();
  }
}
