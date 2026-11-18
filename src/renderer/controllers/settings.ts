import { parsePluginFieldKey } from '@mire/ui/utils';
import { parseSites } from '../domain/index.ts';
import { plural } from '../core/format.ts';
import { isHomeList, moveChosen, toggleChosen, withChosen } from '../home/settings.ts';
import { METADATA_PROVIDERS } from '../settings/model.ts';
import { Controller } from './base.ts';
import type { Data } from './types.ts';

/** Listes de la configuration modifiées par les boutons « Ajouter » et « Retirer » des Réglages. */
const ADBLOCK_LISTS: Readonly<Record<string, string>> = { 'adblock.allowlist': 'allowlist', 'adblock.customLists': 'customLists' };

/**
 * `mire-settings` : réglages de Mire et des pages (apparence, menu, accueil, sites, bloqueur, télévision…). L'écran
 * Réglages (P4-20) enregistre chaque champ dès qu'il change (`setValue`) ; seul l'éditeur JSON a son bouton
 * (`saveAdvanced`).
 */
export class SettingsController extends Controller {
  // ---------- Écran Réglages (P4-20) ----------

  /**
   * Enregistre un champ de l'écran Réglages : `key` est un chemin de la configuration (`ui.home.clock`) ou le réglage
   * d'un plugin (`plugin:<id>:<réglage>`). Appelé par la page à chaque changement, pas par un bouton.
   */
  async setValue({ key, value }: { key: string; value: unknown }): Promise<void> {
    const { api, ui, toast, t } = this.ctx;
    const plugin = parsePluginFieldKey(key);
    if (plugin) {
      // Un secret laissé vide n'efface pas celui qui est saisi.
      if (value === '') return;
      const r = (await api.pluginsSetSetting(plugin.plugin, plugin.key, value)) as Data;
      if (r?.ok) toast(t('settingsView.saved'), { duration: 1500 });
      else toast(r?.error || t('settingsView.saved'), { duration: 6000 });
      await ui.settings.refresh({ plugins: true });
      return;
    }
    if (key === 'adblock.enabled') {
      await ui.afterAdblockChange(await api.adblockSetEnabled(!!value));
      toast(t(value ? 'settingsView.adblock.on' : 'settingsView.adblock.off'));
    } else await ui.setCfg(key, value);
    await ui.settings.refresh();
  }

  /** Choisit un programme ou un dossier pour le champ `key`, et l'enregistre. */
  async pickPath({ key, pick }: { key: string; pick: string }): Promise<void> {
    const { api } = this.ctx;
    const chosen = (pick === 'program' ? await api.pickFile('program' as never) : await api.pickFolder()) as string | null;
    if (chosen) await this.setValue({ key, value: chosen });
  }

  /** Ajoute à la liste `key` le texte tapé à côté (brouillon de la page). */
  async addToList({ key }: { key: string }): Promise<void> {
    const { S, ui } = this.ctx;
    const text = (ui.settings.draft(key) ?? '').trim();
    if (!text) return;
    const plugin = parsePluginFieldKey(key);
    if (key === 'adblock.customLists') {
      if (!(await this.addFilterList({ url: text }))) return;
    } else if (ADBLOCK_LISTS[key]) {
      const list = ADBLOCK_LISTS[key];
      const st = ((S.adblock as Data | null) || (await this.ctx.api.adblockStatus())) as Data;
      await ui.afterAdblockChange(await this.ctx.api.adblockSetLists({ [list]: [...new Set([...(st[list] as string[]), text])] } as never));
    } else if (plugin) {
      const info = ((await this.ctx.api.pluginsSettings()) as Data[]).find((p) => p.id === plugin.plugin);
      const current = (info?.values?.[plugin.key] as string[] | undefined) ?? [];
      await this.setValue({ key, value: [...new Set([...current, text])] });
    } else return;
    ui.settings.clearDraft(key);
    await ui.settings.refresh({ plugins: !!plugin });
  }

  /** Retire `value` de la liste `key`. */
  async removeFromList({ key, value }: { key: string; value: string }): Promise<void> {
    const { ui } = this.ctx;
    const plugin = parsePluginFieldKey(key);
    if (ADBLOCK_LISTS[key]) await this.removeFilterList({ kind: ADBLOCK_LISTS[key], id: value });
    else if (plugin) {
      const info = ((await this.ctx.api.pluginsSettings()) as Data[]).find((p) => p.id === plugin.plugin);
      const current = (info?.values?.[plugin.key] as string[] | undefined) ?? [];
      await this.setValue({ key, value: current.filter((x) => x !== value) });
      return;
    }
    await ui.settings.refresh();
  }

  /**
   * Nouvel ordre d'une liste ordonnable (`ds-sortable`) : `rows`, `bars`, `sites` de l'accueil, ou `providers` (ordre
   * des fournisseurs d'infos). Appelé par la page quand l'ordre change.
   */
  async setOrder({ kind, keys }: { kind: string; keys: string[] }): Promise<void> {
    const { ui } = this.ctx;
    if (kind === 'providers') {
      const ids = keys.filter((k) => (METADATA_PROVIDERS as readonly string[]).includes(k));
      await ui.setCfg('catalog.metadataProviders', ids);
    } else {
      if (!isHomeList(kind)) throw new Error(`Liste inconnue : ${kind}`);
      await ui.saveUi((u) => {
        u.home = withChosen(u.home, kind, keys.map(String));
      });
    }
    await ui.settings.refresh();
  }

  /** Ouvre les réglages d'une page (`page` : son identifiant), à un onglet. */
  openPageSettings({ page, tab }: { page: string; tab?: string }): void {
    const { ui } = this.ctx;
    if (ui.open(page)) ui.openPageSettings(tab);
  }

  /** Enregistre l'éditeur JSON « Sites, jeux et consoles » (le seul champ qui a son bouton « Enregistrer »). */
  async saveAdvanced(): Promise<void> {
    const { S, api, ui, toast, t } = this.ctx;
    const text = ui.settings.draft('advanced');
    if (text === undefined) return;
    let adv: Data;
    try {
      adv = JSON.parse(text);
    } catch (e) {
      toast(t('settingsView.advanced.error', { message: (e as Error).message }), { duration: 8000 });
      return;
    }
    if (!adv || typeof adv !== 'object' || Array.isArray(adv)) {
      toast(t('settingsView.advanced.notObject'));
      return;
    }
    for (const k of ['web', 'games', 'emulators']) {
      if (k in adv && !Array.isArray(adv[k])) {
        toast(t('settingsView.advanced.notList', { key: k }));
        return;
      }
    }
    const next = structuredClone(S.config) as Data;
    for (const k of ['web', 'games', 'emulators']) if (k in adv) next[k] = adv[k];
    const saved = (await api.saveConfig(next as never)) as Data | null;
    if (!saved || saved.ok === false) {
      toast(saved?.error || t('settingsView.config.importFailed'));
      return;
    }
    S.config = saved as typeof S.config;
    S.romsCache = {};
    ui.search.resetWatch();
    toast(t('settingsView.advanced.saved'));
    await ui.settings.refresh();
  }

  /** Analyse de nouveau les sources. */
  rescan(): void {
    this.ctx.ui.scan();
  }

  // ---------- Apparence, menu, accueil ----------
  // ---------- Apparence, menu, accueil ----------

  async setTheme({ id }: { id: string }): Promise<void> {
    await this.ctx.ui.saveUi((ui) => {
      ui.theme = id;
    });
    await this.ctx.ui.settings.refresh();
  }

  /** Thème des pages (P4-11, `theme.json`) : appliqué tout de suite, sans redémarrage. */
  async setPageTheme({ id }: { id: string }): Promise<void> {
    await this.ctx.ui.saveUi((ui) => {
      ui.pageTheme = id;
    });
    await this.ctx.ui.settings.refresh();
  }

  /** Position du menu : `left`, `right`, `top`, `bottom`. */
  async setMenuPosition({ id }: { id: string }): Promise<void> {
    await this.ctx.ui.saveUi((ui) => {
      ui.menu = { ...ui.menu, position: id };
    });
    this.ctx.ui.applyMenu();
  }

  /**
   * Déplace une valeur d'une liste de l'accueil (P4-12) : `kind` `rows` (rangées), `bars` (barres de la mire) ou
   * `sites` (sites épinglés) ; `dir` : -1 vers le haut, 1 vers le bas.
   */
  async moveHomeItem({ kind, id, dir }: { kind: string; id: string; dir: number }): Promise<void> {
    if (!isHomeList(kind)) throw new Error(`Liste de l'accueil inconnue : ${kind}`);
    await this.ctx.ui.saveUi((ui) => {
      ui.home = moveChosen(ui.home, kind, String(id), Number(dir));
    });
  }

  /** Montre (`on`) ou cache une valeur d'une liste de l'accueil (voir `moveHomeItem`). */
  async toggleHomeItem({ kind, id, on }: { kind: string; id: string; on: boolean }): Promise<void> {
    if (!isHomeList(kind)) throw new Error(`Liste de l'accueil inconnue : ${kind}`);
    await this.ctx.ui.saveUi((ui) => {
      ui.home = toggleChosen(ui.home, kind, String(id), !!on);
    });
    await this.ctx.ui.settings.refresh();
  }

  /** Horloge de l'accueil : affichée ou non. */
  async setHomeClock({ on }: { on: boolean }): Promise<void> {
    await this.ctx.ui.saveUi((ui) => {
      ui.home = { ...ui.home, clock: !!on };
    });
  }

  // ---------- Configuration ----------

  async exportConfig(): Promise<void> {
    const r = (await this.ctx.api.configExport()) as Data | null;
    const { toast, t } = this.ctx;
    if (r?.ok) toast(t('settingsView.config.exported'));
    else if (r && !r.canceled) toast(t('settingsView.config.exportFailed'), { duration: 6000 });
  }

  /** Importe une configuration (`mode` : `replace` ou `merge`). */
  async importConfig({ mode = 'replace' }: { mode?: string } = {}): Promise<void> {
    const { S, api, ui, toast, t } = this.ctx;
    const r = (await api.configImport(mode as never)) as Data | null;
    if (r?.ok) {
      S.config = r.config;
      if (r.usage) S.usage = r.usage;
      S.autoGames = [];
      S.localRoms = {};
      toast(t('settingsView.config.imported'));
      ui.scan();
      ui.loadLocalRoms();
      ui.go(S.section);
      await ui.settings.refresh({ plugins: true });
    } else if (r && !r.canceled) toast(r?.error || t('settingsView.config.importFailed'), { duration: 8000 });
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
      toast(this.ctx.t('settingsView.adblock.badList'));
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
