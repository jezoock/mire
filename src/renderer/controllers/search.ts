import { searchUrlFor } from '../domain/index.ts';
import { Controller, findBy, indexBy } from './base.ts';
import type { Data } from './types.ts';

/** `mire-search` : recherche globale (vos fichiers, chaînes, jeux, catalogues de streaming, sites). */
export class SearchController extends Controller {
  /** Relance une recherche récente. */
  useRecentQuery({ query }: { query: string }): void {
    if (query && this.ctx.ui.getQueries().includes(query)) this.ctx.ui.setSearchQuery(query);
  }

  /** Efface les recherches récentes. */
  clearQueries(): void {
    const { S, api, toast } = this.ctx;
    S.usage.queries = [];
    api.usageClearQueries();
    toast('Recherches récentes effacées');
  }

  #remember(): void {
    this.ctx.ui.rememberQuery(this.ctx.S.gq);
  }

  #results(kind: string): Data[] {
    return ((this.ctx.S.gs as Data)[kind] || []) as Data[];
  }

  playVideo({ path }: { path: string }): void {
    this.#remember();
    this.ctx.ui.playInContext(findBy(this.#results('videos'), 'path', path) as Data);
  }

  playTrack({ path }: { path: string }): void {
    this.#remember();
    this.ctx.ui.playInContext(findBy(this.#results('tracks'), 'path', path) as Data);
  }

  showImage({ path }: { path: string }): void {
    this.#remember();
    const images = this.#results('images');
    this.ctx.ui.openImages(images, indexBy(images, 'path', path));
  }

  playChannel({ name }: { name: string }): void {
    this.#remember();
    this.ctx.ui.playChannel(findBy(this.#results('channels'), 'name', name));
  }

  launchGame({ path }: { path: string }): void {
    this.#remember();
    this.ctx.ui.launchEntry(findBy(this.#results('games'), 'path', path));
  }

  /** Lance un jeu d'une console trouvé par la recherche. */
  launchRom({ path, consoleId }: { path: string; consoleId: unknown }): void {
    const { api, ui, toast } = this.ctx;
    this.#remember();
    const rom = this.#results('roms').find((r) => r.path === path && r.emu === consoleId);
    if (!rom) return;
    toast(`Lancement de ${rom.displayName}…`, { duration: 2500 });
    ui.pauseAudio();
    (api.launchRom(rom.emu, rom.path) as Promise<Data>).then((r) => {
      if (!r.ok) toast(r.error, { duration: 7000 });
    });
  }

  /** Ouvre un film ou une série du catalogue de streaming, désigné par sa clé (`movie-603`). */
  openTmdb({ key }: { key: string }): void {
    const r = findBy(this.ctx.S.tmdb.results, 'key', key);
    if (r) this.ctx.ui.openTmdbResult(r);
  }

  /** Cherche la recherche en cours sur un site de streaming. */
  searchSite({ id }: { id: string }): void {
    const { S, ui, toast } = this.ctx;
    this.#remember();
    const w = ((S.config as Data).web as Data[]).find((x) => x.id === id);
    if (!w) return;
    const url = searchUrlFor(w as never, S.gq);
    if (!url)
      setTimeout(
        () =>
          toast(`Pour chercher sur ${w.name} depuis Mire : cherchez le mot « mire » sur le site, puis appuyez sur « Mémoriser la recherche ».`, {
            duration: 10000,
          }),
        2600,
      );
    ui.openWeb(w.id, url || undefined);
  }
}
