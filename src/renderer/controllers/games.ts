import { Controller } from './base.ts';
import type { Data } from './types.ts';
import type { Emulator, Element as CatalogElement } from '@mire/shared';
import type { EmulatorChoice, GameEmulators } from '@mire/shared/ipc';
import { consoleFields, consoleInput, emulatorOptions, isGameBookmarkKey, isRomKey } from '../games/model.ts';
import { openEditor } from '../editors/editor.ts';
import type { Site } from '../domain/sites.ts';

type Outcome<T = object> = ({ ok: true } & T) | { ok: false; error?: string };

/**
 * `mire-games` (P4-17) : consoles créées à la main (dossiers, émulateur, arguments, sites de jeux), émulateur choisi
 * pour une console et pour un jeu (D-21), sites de jeux d'une console, marque-pages « à télécharger » et suppression
 * d'un jeu. Les consoles sont désignées par leur identifiant, les jeux par leur clé d'élément : le processus
 * principal retrouve le fichier et contrôle son chemin. Les formulaires sont ceux de P4-06 ; les textes viennent des
 * catalogues (`games.ui.*`), les erreurs du processus principal sont déjà rédigées.
 */
export class GamesController extends Controller {
  private k(key: string, vars?: Record<string, string | number>): string {
    return this.ctx.t(`games.ui.${key}`, vars);
  }

  private consoleOf(id: unknown): Emulator | null {
    return ((this.ctx.S.config?.emulators ?? []) as Emulator[]).find((e) => e.id === id) ?? null;
  }

  /** Après un changement des consoles : la page relit la configuration, le Centre et les vues se redessinent. */
  private changed(r: Outcome<{ config?: unknown }> | null): boolean {
    const { toast } = this.ctx;
    if (!r?.ok) {
      toast(r?.error || this.k('failed'), { duration: 8000 });
      return false;
    }
    if (r.config) this.ctx.ui.afterConsolesChange?.(r.config as Data);
    return true;
  }

  // ---------- Consoles ----------

  /** Crée une console à la main ; rend son identifiant, ou `null` (annulé, refusé). */
  newConsole(): Promise<string | null> {
    return this.consoleForm(null);
  }

  /** Modifie une console ; rend son identifiant, ou `null`. */
  editConsole({ id }: { id: string }): Promise<string | null> {
    const emu = this.consoleOf(id);
    if (!emu) {
      this.ctx.toast(this.k('consoleGone'));
      return Promise.resolve(null);
    }
    return this.consoleForm(emu);
  }

  private async consoleForm(emu: Emulator | null): Promise<string | null> {
    const { api, t, dialogs, toast } = this.ctx;
    const [systems, siteInfo] = await Promise.all([
      api.gameSystems() as Promise<{ id: string; name: string }[]>,
      emu ? (api.romSites(emu.id) as Promise<{ sites?: Site[]; defaults?: Site[] } | null>) : Promise.resolve(null),
    ]);
    const out: { saved: Outcome<{ id: string; config: unknown }> | null } = { saved: null };
    const res = await dialogs.form({
      title: emu ? this.k('form.editTitle', { name: String(emu.name || emu.id) }) : this.k('form.newTitle'),
      help: this.k('form.help'),
      wide: true,
      fields: consoleFields(emu, systems ?? [], siteInfo?.sites ?? [], t),
      actions: [
        { id: 'save', label: this.k('form.save'), kind: 'primary' },
        { id: 'cancel', label: this.k('form.cancel'), kind: 'ghost' },
      ],
      // Enregistré depuis la boîte : un refus (nom ou émulateur manquant) la laisse ouverte, avec son message.
      onAction: async (action, form) => {
        if (action !== 'save') return false;
        const r = (await api.consoleSave(consoleInput(form.values(), siteInfo?.defaults ?? []), emu?.id)) as Outcome<{ id: string; config: unknown }> | null;
        out.saved = r;
        if (!r?.ok) toast(r?.error || this.k('failed'), { duration: 8000 });
        return !r?.ok;
      },
    });
    const saved = out.saved;
    if (res.action !== 'save' || !saved?.ok) return null;
    this.changed(saved);
    toast(emu ? this.k('consoleSaved') : this.k('consoleCreated'));
    return saved.id;
  }

  /** Retire une console de Mire (l'émulateur et les jeux restent sur le disque), après confirmation. */
  async removeConsole({ id }: { id: string }): Promise<boolean> {
    const { api, ui, toast } = this.ctx;
    const emu = this.consoleOf(id);
    if (!emu) return false;
    const ok = await ui.confirm(this.k('remove.title', { name: String(emu.name || id) }), this.k('remove.help'), this.k('remove.yes'));
    if (!ok) return false;
    if (!this.changed((await api.consoleRemove(id)) as Outcome<{ config: unknown }> | null)) return false;
    toast(this.k('consoleRemoved'));
    return true;
  }

  /** Choisit l'émulateur qui lance les jeux d'une console : le sien, ou celui d'une console du même système. */
  async chooseEmulator({ id }: { id: string }): Promise<boolean> {
    const { api, t, dialogs, toast } = this.ctx;
    const emu = this.consoleOf(id);
    if (!emu) return false;
    const choices = ((await api.consoleEmulators(id)) ?? []) as EmulatorChoice[];
    const res = await dialogs.form({
      title: this.k('emulators.consoleTitle', { name: String(emu.name || id) }),
      help: choices.length > 1 ? this.k('emulators.consoleHelp') : this.k('emulators.alone'),
      fields: [
        { id: 'emulator', type: 'select', label: this.k('emulators.label'), value: emu.emulator ?? id, options: emulatorOptions(choices, id, t), full: true },
      ],
      actions: [
        { id: 'save', label: this.k('form.save'), kind: 'primary' },
        { id: 'cancel', label: this.k('form.cancel'), kind: 'ghost' },
      ],
    });
    if (res.action !== 'save') return false;
    const value = String(res.values.emulator ?? '');
    if (!this.changed((await api.consoleSetEmulator(id, value && value !== id ? value : null)) as Outcome<{ config: unknown }> | null)) return false;
    toast(this.k('emulators.saved'));
    return true;
  }

  /** Ouvre les sites de jeux d'une console (navigateur de téléchargement des jeux). */
  openSites({ id }: { id: string }): void {
    if (this.consoleOf(id)) this.ctx.ui.openRomBrowser(id);
  }

  // ---------- Un jeu ----------

  /**
   * Boîte d'un jeu désigné par sa clé : émulateur choisi pour lui (jeu de console), lancer, modifier ses infos,
   * le supprimer. Rend le bouton choisi, ou `null` si le jeu n'existe plus.
   */
  async gameOptions({ key }: { key: string }): Promise<string | null> {
    const { api, t, dialogs } = this.ctx;
    const el = (await api.catalogElement(key)) as CatalogElement | null;
    if (!el) {
      this.ctx.toast(t('editors.gone'));
      return null;
    }
    if (isGameBookmarkKey(key)) return this.bookmark({ key });
    const emus = isRomKey(key) ? ((await api.gameEmulators(key)) as Outcome<GameEmulators> | null) : null;
    const many = !!(emus?.ok && emus.choices.length > 1);
    const fields =
      emus?.ok && many
        ? [
            {
              id: 'emulator',
              type: 'select' as const,
              label: this.k('emulators.label'),
              value: emus.game ?? '',
              options: emulatorOptions(emus.choices, emus.console, t, { consoleDefault: emus.consoleDefault }),
              full: true,
            },
          ]
        : [];
    const res = await dialogs.form({
      title: el.name,
      help: emus?.ok ? (many ? this.k('game.help') : this.k('game.alone')) : '',
      fields,
      actions: [
        { id: 'launch', label: this.k('game.launch'), kind: 'primary' },
        ...(many ? [{ id: 'save', label: this.k('game.save') }] : []),
        { id: 'edit', label: this.k('game.edit') },
        { id: 'delete', label: this.k('game.delete'), kind: 'ghost' as const },
        { id: 'cancel', label: this.k('form.cancel'), kind: 'ghost' as const },
      ],
    });
    const chosen = String(res.values?.emulator ?? '');
    if (many && (res.action === 'save' || res.action === 'launch') && emus?.ok && chosen !== (emus.game ?? '')) {
      if (!this.changed((await api.gameSetEmulator(key, chosen || null)) as Outcome<{ config: unknown }> | null)) return res.action;
      if (res.action === 'save') this.ctx.toast(this.k('emulators.saved'));
    }
    if (res.action === 'launch') await this.launch({ key });
    else if (res.action === 'edit') await openEditor(this.ctx, key);
    else if (res.action === 'delete') await this.deleteGame({ key, name: el.name });
    return res.action;
  }

  /** Lance un jeu désigné par sa clé ; `emulator` : pour cette fois, l'émulateur d'une console du même système. */
  async launch({ key, emulator }: { key: string; emulator?: string }): Promise<boolean> {
    const { api, ui, toast } = this.ctx;
    const el = (await api.catalogElement(key)) as CatalogElement | null;
    if (!el) return false;
    if (el.open.kind === 'program') {
      ui.launchEntry({ name: el.name, path: el.open.path });
      return true;
    }
    toast(this.k('game.launching', { name: el.name }), { duration: 2500 });
    ui.pauseAudio();
    const r = (await api.gameLaunch(key, emulator)) as Outcome | null;
    if (!r?.ok) toast(r?.error || this.k('failed'), { duration: 7000 });
    return !!r?.ok;
  }

  /** Supprime un jeu désigné par sa clé, après confirmation : le processus principal contrôle le fichier. */
  async deleteGame({ key, name }: { key: string; name?: string }): Promise<boolean> {
    const { api, ui, toast } = this.ctx;
    const label = name ?? ((await api.catalogElement(key)) as CatalogElement | null)?.name ?? '';
    const ok = await ui.confirm(this.k('delete.title', { name: label }), isRomKey(key) ? this.k('delete.rom') : this.k('delete.pc'), this.k('delete.yes'));
    if (!ok) return false;
    if (!this.changed((await api.gameDeleteElement(key)) as Outcome<{ config?: unknown }> | null)) return false;
    toast(this.k('delete.done'));
    return true;
  }

  // ---------- Marque-pages « à télécharger » ----------

  /** Boîte d'un jeu mis en marque-page : le télécharger ou le retirer. */
  async bookmark({ key }: { key: string }): Promise<string | null> {
    const { api, ui, dialogs, toast } = this.ctx;
    const el = (await api.catalogElement(key)) as CatalogElement | null;
    const id = key.slice('gamebm:'.length);
    if (!el || !isGameBookmarkKey(key)) return null;
    const res = await dialogs.form({
      title: el.name,
      help: this.k('bookmark.help'),
      fields: [],
      actions: [
        { id: 'download', label: this.k('bookmark.download'), kind: 'primary' },
        { id: 'remove', label: this.k('bookmark.remove'), kind: 'ghost' },
        { id: 'cancel', label: this.k('form.cancel'), kind: 'ghost' },
      ],
    });
    if (res.action === 'download') ui.downloadGameBookmark(id);
    else if (res.action === 'remove') {
      const ok = await ui.confirm(this.k('bookmark.removeTitle', { name: el.name }), this.k('bookmark.removeHelp'), this.k('bookmark.remove'));
      if (ok && this.changed((await api.gameBookmarkRemove(id)) as Outcome<{ config: unknown }> | null)) toast(this.k('bookmark.removed'));
    }
    return res.action;
  }
}
