import { Component, Element, Host, Prop, h } from '@stencil/core';
import { readJson, readList } from '../../utils/elements.ts';
import { centreTab, idArgs } from '../../utils/centre.ts';
import type { AppEmulator, AppGame, AppProgress, AppsView, CentreLabels, ConsoleCard, DownloadRow, DownloadRowLabels } from '../../utils/centre.ts';
import type { PluginsView, ReposView } from '../../utils/plugins.ts';
import { renderPlugins, renderRepos } from './plugins.tsx';

/**
 * Vue du Centre (P4-18) : cinq onglets, Téléchargements, Apps, Consoles (P4-17), Plugins et Dépôts (P4-19).
 *
 * - Téléchargements : ajouter un lien ou un fichier .torrent (formulaires de P4-06, ouverts par le contrôleur), puis
 *   les téléchargements en cours et les autres, une ligne `mire-download-row` chacun ;
 * - Apps : dossier des jeux, émulateurs (installer, mettre à jour, désinstaller ; consoles de RetroArch à cocher ;
 *   rappel des BIOS), jeux libres et import de ses propres jeux ;
 * - Consoles : créer une console à la main ; pour chacune, la modifier (dossiers, émulateur, arguments, sites de
 *   jeux), choisir l'émulateur qui lance ses jeux, ouvrir ses sites de jeux, la retirer. Ces actions vont au
 *   contrôleur `mire-games`, avec l'identifiant de la console ;
 * - Plugins : mises à jour, plugins présents et proposés par les dépôts, ou la fiche d'un plugin (ce qu'il apporte,
 *   origine, niveau, permissions, dépendances) ; Dépôts : liste, ajout, retrait, mise à jour des listes
 *   (`plugins.tsx`).
 *
 * Elle n'a ni état ni accès au processus principal : la page (`src/renderer/centre/`) lui donne les lignes et les
 * cartes déjà rédigées. Les actions vont au contrôleur `mire-centre`, avec l'identifiant du téléchargement, de
 * l'émulateur, de la console ou du jeu.
 */
const TABS: [string, keyof CentreLabels][] = [
  ['downloads', 'tabDownloads'],
  ['apps', 'tabApps'],
  ['consoles', 'tabConsoles'],
  ['plugins', 'tabPlugins'],
  ['repos', 'tabRepos'],
];

@Component({ tag: 'mire-centre-view', shadow: false })
export class MireCentreView {
  @Element() host!: HTMLElement;

  /** Onglet affiché : `downloads`, `apps`, `consoles`, `plugins` ou `repos`. */
  @Prop({ reflect: true }) tab = 'downloads';

  /** Téléchargements en cours (actifs, en pause, en attente) puis les autres (voir `DownloadRow`). */
  @Prop() running: DownloadRow[] | string = [];
  @Prop() others: DownloadRow[] | string = [];

  /** Onglet des apps ; `null` tant que le catalogue n'est pas lu. */
  @Prop() apps: AppsView | string | null = null;

  /** Cartes de l'onglet des consoles (voir `ConsoleCard`). */
  @Prop() consoles: ConsoleCard[] | string = [];

  /** Onglets des plugins et des dépôts (P4-19) ; `null` tant que les listes ne sont pas lues. */
  @Prop() plugins: PluginsView | string | null = null;
  @Prop() repos: ReposView | string | null = null;

  /** Textes (JSON ou objet, voir `CentreLabels`), et ceux des boutons d'une ligne (`DownloadRowLabels`). */
  @Prop() labels: CentreLabels | string = '';
  @Prop() rowLabels: DownloadRowLabels | string = '';

  // Chaque rendu est signalé : la page rend le focus au contenu s'il s'est perdu ; le test de fumée vérifie qu'une
  // ligne qui avance ne redessine pas le Centre.
  componentDidRender() {
    this.host.dispatchEvent(new CustomEvent('mireCentreRender', { detail: { tab: this.tab } }));
  }

  private renderTabs(tab: string, l: CentreLabels) {
    return (
      <div class="mire-centre-view__tabs" role="group" aria-label={l.tabs || undefined}>
        {TABS.map(([id, label]) => (
          <ds-trigger
            class="mire-centre-view__tab"
            type="button"
            mods={tab === id ? 'stl-1' : 'stl-2'}
            aria-pressed={String(tab === id)}
            data-tab={id}
            target="mire-centre"
            action={`showTab:${JSON.stringify([{ tab: id }])}`}
          >
            {l[label]}
          </ds-trigger>
        ))}
      </div>
    );
  }

  private renderRows(rows: DownloadRow[], empty: string | undefined) {
    if (!rows.length) return <p class="mire-centre-view__hint">{empty}</p>;
    return (
      <div class="mire-centre-view__list">
        {rows.map((r) => (
          <mire-download-row key={r.id} row={r} labels={this.rowLabels} />
        ))}
      </div>
    );
  }

  private renderDownloads(l: CentreLabels) {
    const running = readList<DownloadRow>(this.running);
    const others = readList<DownloadRow>(this.others);
    return [
      <section class="mire-centre-view__add">
        <div class="mire-centre-view__buttons">
          <ds-trigger class="mire-centre-view__add-link" type="button" mods="stl-1" target="mire-centre" action="addLink">
            {l.add}
          </ds-trigger>
          <ds-trigger type="button" mods="stl-2" target="mire-centre" action="addTorrentFile">
            {l.torrent}
          </ds-trigger>
        </div>
        <p class="mire-centre-view__hint">{l.hint}</p>
      </section>,
      <section class="mire-centre-view__group" data-group="running">
        <h2 class="mire-centre-view__heading">
          {l.running} <span class="mire-centre-view__count">{running.length}</span>
        </h2>
        {this.renderRows(running, l.noneRunning)}
      </section>,
      <section class="mire-centre-view__group" data-group="others">
        <div class="mire-centre-view__heading-row">
          <h2 class="mire-centre-view__heading">
            {l.others} <span class="mire-centre-view__count">{others.length}</span>
          </h2>
          {others.length > 0 && (
            <ds-trigger type="button" mods="stl-3,sm" target="mire-centre" action="clearDownloads">
              {l.clear}
            </ds-trigger>
          )}
        </div>
        {this.renderRows(others, l.noneOthers)}
      </section>,
    ];
  }

  private renderProgress(p: AppProgress | null) {
    if (!p) return null;
    return (
      <div class="mire-centre-view__progress">
        <div class={{ 'mire-centre-view__bar': true, '--indeterminate': p.percent === null }}>
          <i style={{ width: `${p.percent ?? 35}%` }} />
        </div>
        <p class="mire-centre-view__status" role="status">
          {p.text}
        </p>
      </div>
    );
  }

  private renderSystems(e: AppEmulator, l: CentreLabels) {
    if (!e.retroarch) {
      return (
        <ul class="mire-centre-view__systems" aria-label={e.systemsLabel}>
          {e.systems.map((sy) => (
            <li key={sy.id} class="mire-centre-view__chip">
              {sy.name}
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div class="mire-centre-view__systems" role="group" aria-label={e.systemsLabel}>
        {e.systems.map((sy) => (
          <ds-trigger
            key={sy.id}
            class={{ 'mire-centre-view__system': true, '--installed': sy.installed }}
            type="button"
            mods={sy.picked ? 'stl-1,xs' : 'stl-2,xs'}
            aria-pressed={String(sy.picked)}
            data-key={sy.id}
            target="mire-centre"
            action={`toggleSystem:${idArgs(sy.id)}`}
          >
            {sy.name}
            {sy.installed && <span class="mire-centre-view__ok">{l.systemAdded}</span>}
          </ds-trigger>
        ))}
      </div>
    );
  }

  private renderEmulator(e: AppEmulator, l: CentreLabels) {
    const id = idArgs(e.id);
    return (
      <article key={e.id} class="mire-centre-view__card" data-key={e.id}>
        <div class="mire-centre-view__card-head">
          <h3 class="mire-centre-view__name">{e.name}</h3>
          <span class={{ 'mire-centre-view__state': true, '--ok': e.installed }}>{e.status}</span>
        </div>
        <p class="mire-centre-view__desc">{e.desc}</p>
        {this.renderSystems(e, l)}
        {this.renderProgress(e.progress)}
        <div class="mire-centre-view__actions">
          <ds-trigger
            class="mire-centre-view__install"
            type="button"
            mods={e.install.primary ? 'stl-1' : 'stl-2'}
            disabled={e.install.disabled}
            target="mire-centre"
            action={`install:${id}`}
          >
            {e.install.label}
          </ds-trigger>
          {e.uninstall && (
            <ds-trigger type="button" mods="stl-3" disabled={e.uninstall.disabled} target="mire-centre" action={`uninstall:${id}`}>
              {e.uninstall.label}
            </ds-trigger>
          )}
        </div>
        {e.bios && (
          <div class="mire-centre-view__bios">
            <h4 class="mire-centre-view__bios-title">{l.biosTitle}</h4>
            <p class="mire-centre-view__bios-hint">{e.bios.hint}</p>
            <p class="mire-centre-view__bios-files">{e.bios.files}</p>
            <p class="mire-centre-view__bios-dir" title={e.bios.dir}>
              {e.bios.dir}
            </p>
            <div class="mire-centre-view__actions">
              <ds-trigger type="button" mods="stl-2,sm" target="mire-centre" action={`addBios:${id}`}>
                {l.biosAdd}
              </ds-trigger>
              <ds-trigger type="button" mods="stl-3,sm" target="mire-centre" action={`openBios:${id}`}>
                {l.biosOpen}
              </ds-trigger>
            </div>
          </div>
        )}
      </article>
    );
  }

  private renderGame(g: AppGame, l: CentreLabels) {
    return (
      <article key={g.id} class="mire-centre-view__game" data-key={g.id}>
        <span class="mire-centre-view__art" style={{ '--mire-centre-art': g.color }} aria-hidden="true">
          {g.monogram}
        </span>
        <div class="mire-centre-view__game-text">
          <h3 class="mire-centre-view__name">{g.name}</h3>
          <p class="mire-centre-view__meta">{g.meta}</p>
          <p class="mire-centre-view__desc">{g.desc}</p>
          {this.renderProgress(g.progress)}
          {g.status ? (
            <span class={{ 'mire-centre-view__state': true, '--ok': g.installed }}>{g.status}</span>
          ) : (
            <ds-trigger type="button" mods="stl-1,sm" disabled={g.busy} target="mire-centre" action={`installGame:${idArgs(g.id)}`}>
              {l.download}
            </ds-trigger>
          )}
        </div>
      </article>
    );
  }

  private renderApps(l: CentreLabels) {
    const apps = readJson<AppsView>(this.apps);
    if (!apps) return <p class="mire-centre-view__hint">{l.loading}</p>;
    return [
      <div class="mire-centre-view__root">
        <span>
          {l.root} <strong>{apps.root}</strong>
        </span>
        <ds-trigger type="button" mods="stl-3,sm" target="mire-centre" action="chooseGamesFolder">
          {l.changeRoot}
        </ds-trigger>
      </div>,
      apps.unavailable && <p class="mire-centre-view__hint">{l.unavailable}</p>,
      <section class="mire-centre-view__group" data-group="emulators">
        <h2 class="mire-centre-view__heading">{l.emulators}</h2>
        <p class="mire-centre-view__help">{l.emulatorsHelp}</p>
        <div class="mire-centre-view__cards">{apps.emulators.map((e) => this.renderEmulator(e, l))}</div>
      </section>,
      <section class="mire-centre-view__group" data-group="games">
        <h2 class="mire-centre-view__heading">{l.games}</h2>
        <p class="mire-centre-view__help">{apps.games.length ? l.gamesHelp : l.gamesNone}</p>
        <div class="mire-centre-view__games">{apps.games.map((g) => this.renderGame(g, l))}</div>
      </section>,
      <section class="mire-centre-view__group" data-group="own">
        <h2 class="mire-centre-view__heading">{l.own}</h2>
        <p class="mire-centre-view__help">{l.ownHelp}</p>
        {apps.canImport ? (
          <ds-trigger type="button" mods="stl-2" target="mire-centre" action="importGames">
            {l.import}
          </ds-trigger>
        ) : (
          <p class="mire-centre-view__help">{l.noConsole}</p>
        )}
      </section>,
    ];
  }

  private renderConsole(c: ConsoleCard, l: CentreLabels) {
    const id = idArgs(c.id);
    return (
      <article key={c.id} class="mire-centre-view__card mire-centre-view__console" data-key={c.id}>
        <div class="mire-centre-view__card-head">
          <h3 class="mire-centre-view__name">{c.name}</h3>
          {c.store && <span class="mire-centre-view__state --ok">{l.fromApps}</span>}
        </div>
        <p class="mire-centre-view__meta">{c.meta}</p>
        <p class="mire-centre-view__desc">{c.emulator}</p>
        <div class="mire-centre-view__actions">
          <ds-trigger class="mire-centre-view__edit" type="button" mods="stl-1,sm" target="mire-games" action={`editConsole:${id}`}>
            {l.editConsole}
          </ds-trigger>
          <ds-trigger class="mire-centre-view__emulator" type="button" mods="stl-2,sm" target="mire-games" action={`chooseEmulator:${id}`}>
            {l.chooseEmulator}
          </ds-trigger>
          <ds-trigger type="button" mods="stl-2,sm" target="mire-games" action={`openSites:${id}`}>
            {l.openSites}
          </ds-trigger>
          {c.online && (
            <ds-trigger class="mire-centre-view__online" type="button" mods="stl-2,sm" target="mire-games" action={`onlineGames:${id}`}>
              {l.onlineGames}
            </ds-trigger>
          )}
          <ds-trigger type="button" mods="stl-3,sm" target="mire-games" action={`removeConsole:${id}`}>
            {l.removeConsole}
          </ds-trigger>
        </div>
      </article>
    );
  }

  private renderConsoles(l: CentreLabels) {
    const list = readList<ConsoleCard>(this.consoles);
    return [
      <section class="mire-centre-view__add">
        <div class="mire-centre-view__buttons">
          <ds-trigger class="mire-centre-view__new-console" type="button" mods="stl-1" target="mire-games" action="newConsole">
            {l.newConsole}
          </ds-trigger>
          <ds-trigger class="mire-centre-view__cleanup" type="button" mods="stl-3" target="mire-games" action="cleanup">
            {l.cleanupGames}
          </ds-trigger>
        </div>
        <p class="mire-centre-view__hint">{l.consolesHelp}</p>
        <p class="mire-centre-view__hint">{l.cleanupHelp}</p>
      </section>,
      <section class="mire-centre-view__group" data-group="consoles">
        {list.length ? (
          <div class="mire-centre-view__cards">{list.map((c) => this.renderConsole(c, l))}</div>
        ) : (
          <p class="mire-centre-view__hint">{l.noConsoles}</p>
        )}
      </section>,
    ];
  }

  private renderPanel(tab: string, l: CentreLabels) {
    if (tab === 'apps') return this.renderApps(l);
    if (tab === 'consoles') return this.renderConsoles(l);
    if (tab === 'plugins') return renderPlugins(readJson<PluginsView>(this.plugins), l);
    if (tab === 'repos') return renderRepos(readJson<ReposView>(this.repos), l);
    return this.renderDownloads(l);
  }

  render() {
    const tab = centreTab(this.tab);
    const l = readJson<CentreLabels>(this.labels) ?? {};
    return (
      <Host class={{ 'mire-centre-view': true, [`--${tab}`]: true }}>
        {this.renderTabs(tab, l)}
        {/* Un panneau par onglet (clé) : un ds-trigger résout sa cible une seule fois, il ne doit pas passer d'un
            onglet à l'autre (les boutons des consoles visent mire-games, les autres mire-centre). */}
        <div key={tab} class="mire-centre-view__panel">
          {this.renderPanel(tab, l)}
        </div>
      </Host>
    );
  }
}
