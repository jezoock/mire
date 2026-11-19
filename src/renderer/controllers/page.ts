import { searchUrlFor } from '../domain/index.ts';
import { plural } from '../core/format.ts';
import { Controller, findBy, indexBy } from './base.ts';
import type { ControllerContext, Data, ItemRef } from './types.ts';
import type { Element as CatalogElement, InfoScalar, PagePath } from '@mire/shared';
import { isGameBookmarkKey } from '../games/model.ts';
import { callAction } from './registry.ts';

/**
 * `mire-page` : pages de contenus (vidéos, musique, images, télévision, jeux et consoles) : lecture, filtres et tris,
 * regroupements (séries, saisons, consoles), infos des éléments.
 */
export class PageController extends Controller {
  // ---------- Lecture ----------

  playVideo({ path }: { path: string }): void {
    const { S, ui } = this.ctx;
    ui.openVideo(S.list, indexBy(S.list, 'path', path));
  }

  /** Lit un morceau : la liste filtrée pendant une recherche, sinon son album. */
  playTrack({ path }: { path: string }): void {
    const { S, ui } = this.ctx;
    const t0 = findBy(S.list, 'path', path);
    if (S.query) {
      ui.playQueue(S.list, indexBy(S.list, 'path', path));
      return;
    }
    if (!t0) throw new Error(`Morceau introuvable : ${path}`);
    const album = S.list.filter((x) => x.dir === t0.dir);
    ui.playQueue(album, album.indexOf(t0));
  }

  /** Lit un album (les morceaux d'un dossier) depuis le début. */
  playAlbum({ dir }: { dir: string }): void {
    const { S, ui } = this.ctx;
    ui.playQueue(
      S.list.filter((x) => x.dir === dir),
      0,
    );
  }

  showImage({ path }: { path: string }): void {
    const { S, ui } = this.ctx;
    ui.openImages(S.list, indexBy(S.list, 'path', path));
  }

  /** Regarde une chaîne, désignée par son nom. */
  playChannel({ name }: { name: string }): void {
    this.ctx.ui.playChannel(findBy(this.ctx.S.list, 'name', name));
  }

  // ---------- Télévision ----------

  reloadChannels(): void {
    const { S, ui } = this.ctx;
    S.channels = null;
    S.tvWeb = null;
    ui.loadChannels();
  }

  /** Cherche la box sur le réseau. */
  async detectBox(): Promise<void> {
    const { S, api, ui, toast } = this.ctx;
    toast('Recherche de votre box sur le réseau…', { duration: 3000 });
    const r = (await api.tvDetect()) as Data | null;
    S.config = ((await api.getConfig()) as Data).config;
    if (r?.id) {
      S.channels = null;
      S.tvWeb = null;
      ui.loadChannels();
      toast(`${r.name} détecté.`);
    } else toast('Aucune box reconnue. Choisissez votre service dans la liste.', { duration: 6000 });
    ui.render();
  }

  /** Ouvre le portail web du service de télévision. */
  openTvPortal(): void {
    const { S, ui } = this.ctx;
    if (S.tvWeb) ui.openTvWeb(S.tvWeb as unknown as Data);
  }

  // ---------- Jeux ----------

  cleanupGames(): void {
    this.ctx.ui.cleanupGames();
  }

  /** Lance un jeu de la page Jeux, désigné par son chemin. */
  launchGame({ path }: { path: string }): void {
    this.ctx.ui.launchEntry(findBy(this.ctx.S.gameList, 'path', path));
  }

  addGame(): void {
    this.ctx.ui.addGame();
  }

  /** Télécharge un jeu mis en marque-page. */
  downloadGameBookmark({ id }: { id: string }): void {
    this.ctx.ui.downloadGameBookmark(id);
  }

  async removeGameBookmark({ id }: { id: string }): Promise<void> {
    const { S, api, ui, toast } = this.ctx;
    const ok = await ui.confirm('Retirer ce jeu ?', 'Le marque-page et son téléchargement en attente seront retirés.', 'Retirer');
    if (!ok) return;
    const r = (await api.gameBookmarkRemove(id)) as Data | null;
    if (r?.config) S.config = r.config;
    await ui.loadDownloads();
    toast('Jeu retiré');
    ui.render();
  }

  /** Supprime un jeu (fichier d'une console, ou jeu PC ajouté à la main), après confirmation. */
  async deleteGame({ ref }: { ref: Data }): Promise<void> {
    const { S, api, ui, toast } = this.ctx;
    const ok = await ui.confirm(
      `Supprimer « ${ref.label} » ?`,
      ref.kind === 'rom' ? 'Le fichier du jeu sera supprimé de l’ordinateur.' : 'Le jeu sera retiré de la liste.',
      'Supprimer',
    );
    if (!ok) return;
    const r = (await api.gameDelete(ref as never)) as Data | null;
    if (!r?.ok) {
      toast(r?.error || 'Suppression impossible.', { duration: 8000 });
      return;
    }
    if (r.config) S.config = r.config;
    if (ref.kind === 'rom' && ref.consoleId != null) {
      const rr = (await api.listRoms(ref.consoleId)) as Data | null;
      if (rr?.ok) S.localRoms[ref.consoleId] = rr.roms;
      if (S.romsOf === ref.consoleId) S.roms = rr?.roms;
    } else S.autoGames = S.autoGames.filter((g) => g.path !== ref.path);
    toast('Jeu supprimé');
    ui.render();
  }

  /** Supprime le jeu sélectionné (touche Suppr) ; faux si la sélection n'est pas un jeu qu'on peut supprimer. */
  deleteSelection(): boolean {
    const { ui } = this.ctx;
    const ref = ui.selectedRef();
    if (!ui.deletableGame(ref)) return false;
    ui.deleteGameRef(ref as ItemRef);
    return true;
  }

  /** Filtre les jeux par système (`id` vide : tous). */
  filterSystem({ id }: { id: string }): void {
    const { S, ui, page } = this.ctx;
    S.gameSystem = id;
    S.genre = '';
    S.limit = page;
    ui.render({ resetScroll: true });
  }

  /** Filtre par genre (`id` vide : tous). */
  filterGenre({ id }: { id: string }): void {
    const { S, ui, page } = this.ctx;
    S.genre = id;
    S.limit = page;
    ui.render();
  }

  // ---------- Consoles ----------

  openConsole({ consoleId }: { consoleId: unknown }): void {
    this.ctx.ui.openEmu(consoleId);
  }

  closeConsole(): void {
    this.ctx.ui.closeRoms();
  }

  editConsole({ consoleId }: { consoleId: unknown }): void {
    this.ctx.ui.editConsole(consoleId);
  }

  /** Lance un jeu d'une console : celle qui est ouverte, sauf `consoleId`. */
  launchRom({ path, consoleId }: { path: string; consoleId?: unknown }): void {
    const { S, ui } = this.ctx;
    const rom = S.list.find((x) => x.path === path && (consoleId === undefined || x.consoleId === consoleId));
    ui.launchRom(rom, consoleId);
  }

  /** Affiche les jeux en ligne de la console ouverte. */
  async showOnlineRoms(): Promise<void> {
    const { S, api, ui, toast, page } = this.ctx;
    S.romsOnline = true;
    S.romsOnlineLoading = true;
    S.limit = page;
    ui.render();
    const r = (await api.romListSource(S.romsOf as never, (S.romsSource || undefined) as never)) as Data | null;
    S.romsOnlineLoading = false;
    if (r?.ok) {
      S.roms = r.roms;
      S.romsWarnings = r.errors || [];
    } else toast(r?.error || 'Impossible de lire la source en ligne.', { duration: 7000 });
    ui.render();
  }

  /** Choisit la source en ligne des jeux de la console ouverte (`id` vide : la première). */
  async chooseRomSource({ id }: { id: string }): Promise<void> {
    const { S, api, ui, toast, page } = this.ctx;
    S.romsSource = id;
    S.romsOnline = true;
    S.romsOnlineLoading = true;
    S.limit = page;
    ui.render();
    const r = (await api.romListSource(S.romsOf as never, (S.romsSource || undefined) as never)) as Data | null;
    S.romsOnlineLoading = false;
    if (r?.ok) {
      S.roms = r.roms;
      S.romsWarnings = r.errors || [];
    } else toast(r?.error || 'Source illisible.', { duration: 7000 });
    ui.render();
  }

  /** Sites de téléchargement d'une console (ou `pc`), sur un site et une adresse facultatifs. */
  openRomSites({ consoleId, site, url }: { consoleId: unknown; site?: number; url?: string }): void {
    this.ctx.ui.openRomBrowser(consoleId, site === undefined && url === undefined ? undefined : { site, url });
  }

  /** « Télécharger des jeux » : sites de la console, ou des jeux PC (`pc`, s'il y en a). */
  downloadGames({ consoleId }: { consoleId?: unknown }): void {
    const { S, ui, toast } = this.ctx;
    if (consoleId && consoleId !== 'pc') {
      ui.openRomBrowser(consoleId);
      return;
    }
    if (!((S.config as Data).pcSites || []).length) {
      toast('Ajoutez d’abord un site dans les réglages de la page Jeux, onglet Jeux PC.', { duration: 7000 });
      ui.openPageSettings('pc');
      return;
    }
    ui.openRomBrowser('pc');
  }

  /** Cherche la recherche en cours sur un site de la console (`site` : sa position dans la liste des sites). */
  searchRomSite({ consoleId, site }: { consoleId: unknown; site: number }): void {
    const { S, ui, toast } = this.ctx;
    const s = ((S.romSites as Data)[consoleId as string] || [])[site];
    if (!s) return;
    if (!s.search) {
      ui.openRomBrowser(consoleId, { site });
      setTimeout(
        () => toast(`La recherche de ${s.name} n’est pas encore connue : cherchez le mot « mire » sur le site, puis appuyez sur la loupe.`, { duration: 9000 }),
        2600,
      );
      return;
    }
    ui.openRomBrowser(consoleId, { site, url: searchUrlFor(s, S.query) as string });
  }

  /** Télécharge un jeu en ligne de la console ouverte. */
  async downloadRom({ path }: { path: string }): Promise<void> {
    const { S, api, toast } = this.ctx;
    const r = (await api.romDownload(S.romsOf as never, path)) as Data | null;
    if (!r?.ok) toast(r?.error || 'Téléchargement impossible.', { duration: 6000 });
    else if (r.total > 1 && !r.count) toast('Tous les fichiers de ce jeu sont déjà sur l’ordinateur.');
    else
      toast(
        r.total > 1
          ? `${plural(r.count, 'fichier', 'fichiers')} à télécharger pour ce jeu (l’index et ses pistes), dans un dossier à son nom. Suivez-les dans le Centre.`
          : 'Téléchargement ajouté : il ira dans le dossier de la console. Suivez-le dans le Centre.',
        { duration: 7000 },
      );
  }

  /** Télécharge tous les jeux en ligne de la console ouverte qui ne sont pas déjà sur l'ordinateur. */
  async downloadAllRoms(): Promise<void> {
    const { S, api, ui, toast } = this.ctx;
    const roms = (S.roms || []) as Data[];
    const all = roms.filter((r) => r.remote);
    const fileOf = (r: Data) => decodeURIComponent(String(r.path).split('/').pop()!.split('?')[0]!).toLowerCase();
    const localNames = new Set(roms.filter((r) => !r.remote).map((r) => String(r.path).split(/[\\/]/).pop()!.toLowerCase()));
    const todo = all.filter((r) => !localNames.has(fileOf(r)));
    if (!todo.length) return;
    const ok = await ui.confirm(
      `Télécharger ${plural(todo.length, 'jeu', 'jeux')} dans le dossier de ${ui.consoleName(S.romsOf) || 'la console'} ?`,
      'Selon leur taille, cela peut prendre de la place et du temps. Vous pourrez suivre et mettre en pause chaque téléchargement dans le Centre.',
      'Tout télécharger',
    );
    if (!ok) return;
    let n = 0;
    for (const r of todo) {
      const res = (await api.romDownload(S.romsOf as never, r.path)) as Data | null;
      if (res?.ok) n++;
    }
    toast(`${plural(n, 'téléchargement ajouté', 'téléchargements ajoutés')}. Suivez-les dans le Centre.`, { duration: 6000 });
  }

  // ---------- Vidéos : séries, saisons, filtres ----------

  /** Ouvre une série (ses saisons ou ses épisodes), désignée par sa clé. */
  openSeries({ key }: { key: string }): void {
    const { S, ui, page } = this.ctx;
    const c = findBy(S.videoCards, 'key', key);
    if (!c) return;
    S.videoSeries = c.key;
    S.videoSeason = null;
    S.limit = page;
    ui.render({ resetScroll: true });
  }

  openSeason({ season }: { season: number }): void {
    const { S, ui, page } = this.ctx;
    S.videoSeason = Number(season);
    S.limit = page;
    ui.render({ resetScroll: true });
  }

  closeSeries(): void {
    const { S, ui } = this.ctx;
    S.videoSeries = null;
    S.videoSeason = null;
    ui.render({ resetScroll: true });
  }

  closeSeason(): void {
    const { S, ui } = this.ctx;
    S.videoSeason = null;
    ui.render({ resetScroll: true });
  }

  /** Filtre les vidéos par source (`id` vide : toutes). */
  filterSource({ id }: { id: string }): void {
    const { S, ui, page } = this.ctx;
    S.videoSource = id;
    S.limit = page;
    ui.render({ resetScroll: true });
  }

  /** Trie les vidéos (`title`, `year`, `source`). */
  sortVideos({ id }: { id: string }): void {
    const { S, ui, page } = this.ctx;
    S.videoSort = id;
    S.limit = page;
    ui.render({ resetScroll: true });
  }

  // ---------- Infos des éléments ----------

  /** Modifie les infos d'un album, désigné par le chemin d'un de ses morceaux. */
  editAlbum({ path }: { path: string }): void {
    this.ctx.ui.editRef({ kind: 'album', item: findBy(this.ctx.S.list, 'path', path) });
  }

  /** Récupère les infos en ligne d'une page (`videos`, `music`, `games`) ; arrête la récupération en cours. */
  scrapeSection({ kind, force = false }: { kind: string; force?: boolean }): void {
    const { S, api, ui } = this.ctx;
    if ((S.scraping as Data | null)?.running) {
      api.scrapeCancel();
      return;
    }
    ui.startScrape([kind], { force });
    ui.updateScrapeButton();
  }

  // ---------- Vue de page (P4-11) ----------

  /** Ouvre un regroupement du niveau affiché (Friends, Saison 1, « Autres » : `null`), désigné par sa valeur. */
  openGroup({ value }: { value: InfoScalar | null }): boolean {
    return this.ctx.ui.openPageGroup(value);
  }

  /** Revient à une étape du chemin parcouru (`[]` : la page elle-même). */
  openPath({ path }: { path: PagePath }): boolean {
    return this.ctx.ui.openPagePath(Array.isArray(path) ? path : []);
  }

  /** Tranche suivante du niveau affiché. */
  async loadMore(): Promise<void> {
    await this.ctx.ui.loadMorePage();
  }

  /** Ancienne vue de la page affichée (section historique), tant que la vue de page n'en reprend pas tout. */
  openLegacy(): void {
    const section = this.ctx.ui.pageLegacySection();
    if (section) this.ctx.ui.go(section, { focus: 'content' });
  }

  /** Ouvre, lit ou lance un élément du catalogue, désigné par sa clé, selon sa façon de s'ouvrir. */
  async openElement({ key }: { key: string }): Promise<void> {
    await openCatalogElement(this.ctx, key);
  }
}

/**
 * Ouvre, lit ou lance un élément du catalogue selon sa façon de s'ouvrir (`open`) : fichier, site, jeu de console,
 * programme ou flux. Partagé par la vue de page et l'accueil (P4-12).
 */
export async function openCatalogElement(ctx: ControllerContext, key: string): Promise<void> {
  const { S, api, ui } = ctx;
  const el = (await api.catalogElement(key)) as CatalogElement | null;
  if (!el) throw new Error(`Élément introuvable : ${key}`);
  const o = el.open;
  // Jeux (P4-17) : un jeu de console se lance par sa clé (émulateur choisi pour lui) ; un marque-page « à
  // télécharger » ouvre sa boîte (télécharger, retirer).
  if (o.kind === 'game') {
    await callAction('mire-games', 'launch', { key });
    return;
  }
  if (isGameBookmarkKey(key)) {
    await callAction('mire-games', 'bookmark', { key });
    return;
  }
  if (o.kind === 'file') ui.playInContext(mediaItemOf(S, el, o.path));
  else if (o.kind === 'site') {
    if (!o.site) throw new Error(`Site sans service : ${key}`);
    ui.openWeb(o.site, o.url);
  } else if (o.kind === 'program') {
    const manualIndex = (S.config?.games ?? []).findIndex((g: Data) => g.path === o.path);
    ui.launchEntry(manualIndex >= 0 ? { manualIndex, name: el.name, path: o.path } : { name: el.name, path: o.path });
  } else {
    const known = (S.channels ?? []).find((c) => (c.variants as Data[] | undefined)?.some((v) => v.url === o.url));
    ui.playChannel(known ?? { name: el.name, variants: [{ q: 'hd', url: o.url }] });
  }
}

/** Élément de l'interface historique pour un fichier du catalogue (sa liste de lecture vient de son dossier). */
function mediaItemOf(S: ControllerContext['S'], el: CatalogElement, path: string): Data {
  const known = [...S.videos, ...S.tracks, ...S.images].find((x) => x.path === path);
  if (known) return known as Data;
  const kind = el.tags.includes('video') ? 'video' : el.tags.includes('audio') ? 'audio' : 'image';
  return { path, name: el.name, kind };
}
