import { parsePluginFieldKey } from '@mire/ui/utils';
import { parseSites } from '../domain/index.ts';
import { plural } from '../core/format.ts';
import { isHomeList, moveChosen, toggleChosen, withChosen } from '../home/settings.ts';
import { METADATA_PROVIDERS, SOURCE_KINDS } from '../settings/model.ts';
import { openPageEditor } from '../settings/page-editor.ts';
import { PAGES_LIST } from '../settings/pages.ts';
import { openListEditor, openTagEditor } from '../settings/tag-editor.ts';
import { FILE_RULES_LIST, LISTS_LIST, TAGS_LIST, listName, withFileRule, withoutFileRule } from '../settings/tags.ts';
import { pageName } from '../pages/model.ts';
import type { ListSummary, PageDefinition, TagOverview, TagSummary } from '@mire/shared';
import { CENTRE_VIEW } from '../shell/router.ts';
import { Controller } from './base.ts';
import type { Data } from './types.ts';

/** Nature des sources d'une liste de l'écran Réglages (`sources:video` → `video`). */
function sourceKind(key: string): string {
  const kind = key.startsWith('sources:') ? key.slice('sources:'.length) : '';
  if (!(SOURCE_KINDS as readonly string[]).includes(kind)) throw new Error(`Liste de sources inconnue : ${key}`);
  return kind;
}

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
    if (key === 'tv.active') {
      await this.setTvService({ id: String(value) });
      toast(t('settingsView.saved'), { duration: 1500 });
    } else if (key === 'tv.playlist') await this.setTvPlaylist(String(value));
    else if (key === 'adblock.enabled') {
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
    if (kind === LISTS_LIST) {
      await this.ctx.api.listsReorder(keys.map(String));
    } else if (kind === 'providers') {
      // Ceux du cœur, et ceux des plugins actifs (P4-20).
      const plugins = (((await this.ctx.api.pluginsMetadataProviders()) as { id: string }[] | null) ?? []).map((p) => p.id);
      const known = [...METADATA_PROVIDERS, ...plugins];
      await ui.setCfg(
        'catalog.metadataProviders',
        keys.filter((k) => known.includes(k)),
      );
    } else {
      if (!isHomeList(kind)) throw new Error(`Liste inconnue : ${kind}`);
      await ui.saveUi((u) => {
        u.home = withChosen(u.home, kind, keys.map(String));
      });
    }
    await ui.settings.refresh();
  }

  // ---------- Blocs propres aux pages (P4-20, partie 2) ----------

  /** Ouvre le Centre à un onglet (`consoles` : là où les consoles se créent et se modifient). */
  openCentreTab({ tab }: { tab: string }): void {
    const { ui } = this.ctx;
    if (ui.open(CENTRE_VIEW)) ui.showCentreTab(tab);
  }

  /** Ajoute une source de la nature de la liste `key` (`sources:<nature>`) : un dossier choisi par le processus principal. */
  async addSourceFolder({ key }: { key: string }): Promise<void> {
    await this.ctx.ui.addSourceFolder(sourceKind(key));
    await this.ctx.ui.settings.refresh();
  }

  /** Ajoute une adresse (partage réseau, serveur web, liste M3U) comme source de la liste `key`. */
  async addSourceAddress({ key }: { key: string }): Promise<void> {
    await this.ctx.ui.askSourceAddress(sourceKind(key));
    await this.ctx.ui.settings.refresh();
  }

  /** Ajoute un élément à la liste `key` (`web`, `pcSites`) d'après les champs remplis à côté (brouillons). */
  async addEntry({ key }: { key: string }): Promise<void> {
    const { ui } = this.ctx;
    const draft = (id: string) => (ui.settings.draft(`${key}.${id}`) ?? '').trim();
    const fields = key === 'web' ? ['name', 'url'] : key === 'pcSites' ? ['name', 'url', 'search'] : key === FILE_RULES_LIST ? ['ext', 'tags'] : null;
    if (!fields) throw new Error(`Liste inconnue : ${key}`);
    const done =
      key === FILE_RULES_LIST
        ? await this.addFileRule()
        : key === 'web'
          ? await this.addSite({ name: draft('name'), url: draft('url') })
          : await this.addPcSite(draft('name'), draft('url'), draft('search'));
    if (!done) return;
    for (const id of fields) ui.settings.clearDraft(`${key}.${id}`);
    await ui.settings.refresh();
  }

  // ---------- Administration des pages (P4-21) ----------

  /** Crée un élément de la liste `key` dans une boîte de dialogue (`pages` : une page ; `lists` : une liste). */
  async createEntry({ key }: { key: string }): Promise<void> {
    if (key === PAGES_LIST) {
      if (await openPageEditor(this.ctx, null)) await this.afterPagesChange();
    } else if (key === LISTS_LIST) {
      if (await openListEditor(this.ctx, null)) await this.ctx.ui.settings.refresh();
    } else throw new Error(`Liste inconnue : ${key}`);
  }

  /** Modifie l'élément `id` de la liste `key` dans une boîte de dialogue : une page, un tag, une liste. */
  async editEntry({ key, id }: { key: string; id: string }): Promise<void> {
    if (key === PAGES_LIST) {
      if (await openPageEditor(this.ctx, String(id))) await this.afterPagesChange();
    } else if (key === TAGS_LIST) {
      if (await openTagEditor(this.ctx, String(id))) await this.afterTagsChange();
    } else if (key === LISTS_LIST) {
      const list = (((await this.ctx.api.listsList()) as ListSummary[] | null) ?? []).find((l) => l.id === String(id));
      if (list && (await openListEditor(this.ctx, list))) await this.ctx.ui.settings.refresh();
    } else throw new Error(`Liste inconnue : ${key}`);
  }

  /** Tags changés : les pages et la recherche suivent par le moteur ; l'écran Réglages se relit. */
  private async afterTagsChange(): Promise<void> {
    this.ctx.ui.afterEdit?.();
    await this.ctx.ui.settings.refresh();
  }

  /** Supprime un tag de l'utilisateur, après confirmation : il quitte chaque élément. */
  private async removeTag(id: string): Promise<void> {
    const { api, ui, toast, t } = this.ctx;
    const tag = (((await api.tagsOverview()) as TagOverview[] | null) ?? []).find((x) => x.id === id);
    if (!tag || tag.origin !== 'user') return;
    const help = t('settingsView.tags.removeHelp', { count: tag.count });
    if (!(await ui.confirm(t('settingsView.tags.removeTitle', { name: tag.name }), help, t('settingsView.tags.removeYes')))) return;
    if (await api.tagsRemove(id)) toast(t('settingsView.tags.removed', { name: tag.name }));
    await this.afterTagsChange();
  }

  /** Supprime une liste, après confirmation ; ses éléments restent dans le catalogue. */
  private async removeList(id: string): Promise<void> {
    const { api, ui, toast, t } = this.ctx;
    const list = (((await api.listsList()) as ListSummary[] | null) ?? []).find((l) => l.id === id);
    if (!list) return;
    const name = listName(list, t);
    if (!(await ui.confirm(t('settingsView.lists.removeTitle', { name }), t('settingsView.lists.removeHelp'), t('settingsView.lists.removeYes')))) return;
    if (await api.listsRemove(id)) toast(t('settingsView.lists.removed', { name }));
    await ui.settings.refresh();
  }

  /** Règle par type de fichier ajoutée ou changée, d'après les champs remplis à côté (brouillons). */
  private async addFileRule(): Promise<boolean> {
    const { S, api, ui, toast, t } = this.ctx;
    const known = ((await api.tagsList()) as TagSummary[] | null) ?? [];
    const draft = (id: string) => ui.settings.draft(`${FILE_RULES_LIST}.${id}`) ?? '';
    const rules = withFileRule(S.config, draft('ext'), draft('tags'), known);
    if (!rules) {
      toast(t('settingsView.tags.rules.badExt'));
      return false;
    }
    await ui.setCfg('catalog.fileTags', rules);
    toast(t('settingsView.saved'), { duration: 1500 });
    return true;
  }

  /** Remet l'élément `id` de la liste `key` comme à l'origine (`pages` : la page prête à l'emploi), après confirmation. */
  async restoreEntry({ key, id }: { key: string; id: string }): Promise<void> {
    if (key !== PAGES_LIST) throw new Error(`Liste inconnue : ${key}`);
    const { api, ui, toast, t } = this.ctx;
    const page = (await api.pagesGet(String(id))) as PageDefinition | null;
    const name = page ? pageName(page, t) : String(id);
    if (!(await ui.confirm(t('settingsView.pages.restoreTitle', { name }), t('settingsView.pages.restoreHelp'), t('settingsView.pages.restoreYes')))) return;
    const back = (await api.pagesReset(String(id))) as PageDefinition | null;
    if (back) toast(t('settingsView.pages.restored', { name: pageName(back, t) }));
    await this.afterPagesChange();
  }

  /** Pages changées : le menu et l'écran Réglages suivent. */
  private async afterPagesChange(): Promise<void> {
    await this.ctx.ui.reloadPages?.();
    await this.ctx.ui.settings.refresh();
  }

  /** Supprime une page après confirmation ; une page prête à l'emploi pourra revenir (« Revenir à l'origine »). */
  private async removePage(id: string): Promise<void> {
    const { api, ui, toast, t } = this.ctx;
    const page = (await api.pagesGet(id)) as PageDefinition | null;
    if (!page) return;
    const name = pageName(page, t);
    if (!(await ui.confirm(t('settingsView.pages.removeTitle', { name }), t('settingsView.pages.removeHelp'), t('settingsView.pages.removeYes')))) return;
    if (await api.pagesRemove(id)) toast(t('settingsView.pages.removed', { name }));
    await this.afterPagesChange();
  }

  /** Retire l'élément `id` de la liste `key` : une source, un site, un jeu PC (son chemin), un site de jeux PC, une page. */
  async removeEntry({ key, id }: { key: string; id: string }): Promise<void> {
    const { S, api, ui, toast, t } = this.ctx;
    if (key === PAGES_LIST) return this.removePage(String(id));
    if (key === TAGS_LIST) return this.removeTag(String(id));
    if (key === LISTS_LIST) return this.removeList(String(id));
    if (key === FILE_RULES_LIST) {
      await ui.setCfg('catalog.fileTags', withoutFileRule(S.config, String(id)));
      toast(t('settingsView.removed'), { duration: 1500 });
      return ui.settings.refresh();
    }
    if (key.startsWith('sources:')) await ui.removeSource(sourceKind(key), id);
    else {
      const next = structuredClone(S.config) as Data;
      if (key === 'web') next.web = next.web.filter((x: Data) => x.id !== id);
      else if (key === 'games') next.games = next.games.filter((x: Data) => x.path !== id);
      else if (key === 'pcSites') next.pcSites = (next.pcSites ?? []).filter((x: Data) => (x.url || x.name) !== id);
      else throw new Error(`Liste inconnue : ${key}`);
      S.config = (await api.saveConfig(next as never)) as typeof S.config;
      toast(t('settingsView.removed'), { duration: 1500 });
    }
    await ui.settings.refresh();
  }

  /** Ajoute un jeu PC à la main (programme choisi par le processus principal). */
  async addPcGame(): Promise<void> {
    await this.ctx.ui.addGame();
    await this.ctx.ui.settings.refresh();
  }

  /** Cherche la box sur le réseau ; le service trouvé devient le service actif. */
  async detectTvBox(): Promise<void> {
    const { S, api, ui, toast, t } = this.ctx;
    toast(t('settingsView.tv.detecting'), { duration: 3000 });
    const r = (await api.tvDetect()) as Data | null;
    S.config = ((await api.getConfig()) as Data).config;
    if (r?.id) {
      this.resetChannels();
      toast(t('settingsView.tv.detected', { name: r.name }));
    } else toast(t('settingsView.tv.notDetected'), { duration: 6000 });
    await ui.settings.refresh();
  }

  /** Recharge les chaînes du service actif. */
  reloadTv(): void {
    this.resetChannels();
    this.ctx.toast(this.ctx.t('settingsView.tv.reloaded'), { duration: 1500 });
  }

  private resetChannels(): void {
    const { S, ui } = this.ctx;
    S.channels = null;
    S.tvWeb = null;
    S.tvError = null;
    if (S.section === 'tv') ui.loadChannels();
  }

  /** Adresse de la playlist du service de télévision actif. */
  private async setTvPlaylist(url: string): Promise<void> {
    const { S, api, toast, t } = this.ctx;
    const tv = (S.config as Data).tv as Data;
    const services = tv.services.map((x: Data) => (x.id === tv.active ? { ...x, url } : x));
    S.config = (await api.saveConfig({ ...S.config, tv: { ...tv, services } } as never)) as typeof S.config;
    this.resetChannels();
    toast(t('settingsView.saved'), { duration: 1500 });
  }

  /** Ajoute un site de jeux PC ; vrai s'il a été ajouté. */
  private async addPcSite(name: string, url: string, search: string): Promise<boolean> {
    const { S, api, toast, t } = this.ctx;
    const site = parseSites([name, url, search].filter(Boolean).join(' | '))[0];
    if (!site?.url) {
      toast(t('settingsView.pcSites.missing'));
      return false;
    }
    const sites = [...(((S.config as Data).pcSites as Data[] | undefined) ?? []).filter((x) => x.url !== site.url), site];
    S.config = (await api.saveConfig({ ...S.config, pcSites: sites } as never)) as typeof S.config;
    toast(t('settingsView.saved'), { duration: 1500 });
    return true;
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

  /** Relance l'assistant du premier lancement (P4-23) : rien n'est retiré, seuls les plugins choisis s'ajoutent. */
  runAssistant(): void {
    this.ctx.ui.assistant.open();
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
      toast(this.ctx.t('settingsView.web.missing'));
      return false;
    }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const next = structuredClone(S.config) as Data;
    next.web.push({ name, url, mode: 'integrated', color: '#59625B', search: '' });
    S.config = (await api.saveConfig(next as never)) as typeof S.config;
    toast(this.ctx.t('settingsView.web.added', { name }));
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
    await ui.settings.refresh();
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
