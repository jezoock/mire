import type { Element as CatalogElement, ListSummary, TagSummary } from '@mire/shared';
import { openEditor } from '../editors/editor.ts';
import { baseName, checkNewName, destinations, dirName, fill, moveText, removeText, renameText, samePath, tagChoices } from '../explorer/files.ts';
import { filePath } from '../explorer/model.ts';
import type { Picked } from '../explorer/model.ts';
import { Controller } from './base.ts';
import { openCatalogElement } from './page.ts';

/** Choix « nouvelle liste » du formulaire d'ajout à une liste (jamais un identifiant de liste : il n'a pas de `_`). */
export const NEW_LIST = '_new';

/** Choix « nouveau tag » du formulaire d'ajout d'un tag (jamais un identifiant de tag : il n'a pas de `_` en tête). */
export const NEW_TAG = '_new';

/** Réponse attendue en liste ; `null` pour un refus ou une erreur du processus principal. */
const listOf = <T>(r: T[] | object | null | undefined): T[] | null => (Array.isArray(r) ? r : null);

/** Fichier contrôlé par le processus principal : son chemin, son nom, ou la raison du refus. */
type FileTarget = { ok: true; path: string; name: string } | { ok: false; error: string };

/**
 * `mire-explorer` : explorateur (P4-08) : ouvrir une branche (colonne suivante), montrer un élément (aperçu), puis le
 * lire, modifier ses infos ou ses tags, l'ajouter à une liste. Les éléments sont désignés par leur clé, les branches
 * par leur nœud (`explorer/model.ts`). Aussi : sources de la bibliothèque et des jeux, analyse des dossiers (vues
 * historiques, par le pont).
 *
 * Gérer ses fichiers (P4-09) : renommer, déplacer, mettre à la corbeille un élément, et ajouter ou retirer un tag,
 * ranger dans une liste, mettre à la corbeille plusieurs éléments choisis. Chaque opération sur un fichier est
 * confirmée par une boîte qui dit exactement ce qui sera fait ; le processus principal refait tous les contrôles.
 */
export class ExplorerController extends Controller {
  /** Ouvre une branche ; le focus va à la colonne qu'elle ouvre. */
  openNode({ node }: { node: string }): Promise<boolean> {
    return this.ctx.ui.explorer.open(String(node), { focus: true });
  }

  /** Montre l'aperçu d'un élément ; le focus va à ses actions. */
  showElement({ key }: { key: string }): Promise<boolean> {
    return this.ctx.ui.explorer.show(String(key), { focus: true });
  }

  /** Tranche suivante d'une colonne. */
  more({ node }: { node: string }): Promise<boolean> {
    return this.ctx.ui.explorer.more(String(node));
  }

  /** Ouvre un élément comme sa page l'ouvrirait (lecture, lancement, site). */
  play({ key }: { key: string }): Promise<void> {
    return openCatalogElement(this.ctx, String(key));
  }

  /** Modifier les infos : l'éditeur de P4-22. */
  async edit({ key }: { key: string }): Promise<void> {
    await openEditor(this.ctx, String(key));
  }

  /** Tags : l'éditeur de P4-22, qui a le champ des tags. */
  async editTags({ key }: { key: string }): Promise<void> {
    await openEditor(this.ctx, String(key));
  }

  /**
   * Ajoute un élément à la fin d'une liste, choisie parmi les listes existantes ou créée par son nom. Rend le nombre
   * d'éléments ajoutés (0 s'il y était déjà), ou `null` si rien n'a été fait.
   */
  async addToList({ key }: { key: string }): Promise<number | null> {
    const { api, t, toast } = this.ctx;
    const el = (await api.catalogElement(String(key))) as CatalogElement | null;
    if (!el) {
      toast(t('explorer.gone'));
      return null;
    }
    return this.#toList([el.key], t('explorer.addToList.help', { name: el.name }));
  }

  /** Range les éléments choisis à la fin d'une liste (existante ou nouvelle) ; rend le nombre d'éléments ajoutés. */
  async addPickedToList(): Promise<number | null> {
    const keys = this.ctx.ui.explorer.picked().map((p) => p.key);
    if (!keys.length) return null;
    return this.#toList(keys, this.#plural('explorer.toList.help', keys.length));
  }

  async #toList(keys: string[], help: string): Promise<number | null> {
    const { api, t, toast, dialogs } = this.ctx;
    const lists = ((await api.listsList()) ?? []) as ListSummary[];
    const listName = (l: ListSummary) => (typeof l.name === 'string' ? l.name : t(l.name.key));
    const res = await dialogs.form({
      title: t('explorer.addToList.title'),
      help,
      fields: [
        ...(lists.length
          ? [
              {
                id: 'list',
                type: 'select' as const,
                label: t('explorer.addToList.list'),
                value: lists[0]?.id ?? '',
                options: [...lists.map((l): [string, string] => [l.id, listName(l)]), [NEW_LIST, t('explorer.addToList.newList')] as [string, string]],
              },
            ]
          : []),
        { id: 'name', label: t('explorer.addToList.newList'), placeholder: t('explorer.addToList.newListHint'), required: !lists.length },
      ],
      actions: [
        { id: 'add', label: t('explorer.addToList.add'), kind: 'primary' },
        { id: 'cancel', label: t('explorer.addToList.cancel'), kind: 'ghost' },
      ],
    });
    if (res.action !== 'add') return null;
    const name = String(res.values.name ?? '').trim();
    const chosen = String(res.values.list ?? '');
    // Un nom saisi l'emporte : la liste est créée ; sinon la liste choisie.
    const list =
      name || !chosen || chosen === NEW_LIST
        ? name
          ? ((await api.listsCreate(name)) as ListSummary | null)
          : null
        : (lists.find((l) => l.id === chosen) ?? null);
    const added = list ? ((await api.listsAdd(list.id, keys)) as number | null) : null;
    if (!list || added === null) {
      toast(t('explorer.addToList.failed'));
      return null;
    }
    toast(t(added ? 'explorer.addToList.added' : 'explorer.addToList.already', { list: listName(list) }));
    return added;
  }

  /** Choisit ou retire l'élément dont la ligne a le focus (bouton Y de la manette) ; faux s'il n'y en a pas. */
  pickFocused(): boolean {
    const { explorer } = this.ctx.ui;
    const key = explorer.focusedRowKey();
    return !!key && explorer.pick(key);
  }

  /** Choisit ou retire un élément affiché. */
  pick({ key }: { key: string }): boolean {
    return this.ctx.ui.explorer.pick(String(key));
  }

  /** Retire tous les éléments choisis. */
  clearPicks(): void {
    this.ctx.ui.explorer.clearPicks();
  }

  /** Renomme le fichier d'un élément, dans son dossier : un nouveau nom, puis une confirmation. */
  async rename({ key }: { key: string }): Promise<boolean> {
    const { api, t, toast, dialogs } = this.ctx;
    const target = await this.#file(String(key));
    if (!target.ok) return this.#fail(target.error);
    const current = baseName(target.path);
    const res = await dialogs.form({
      title: t('explorer.rename.title'),
      help: t('explorer.rename.help', { name: current }),
      fields: [{ id: 'name', label: t('explorer.rename.field'), value: current, required: true }],
      actions: [
        { id: 'next', label: t('explorer.rename.next'), kind: 'primary' },
        { id: 'cancel', label: t('explorer.rename.cancel'), kind: 'ghost' },
      ],
    });
    if (res.action !== 'next') return false;
    const name = checkNewName(res.values.name, current, t);
    if (!name.ok) return this.#fail(name.error);
    const ok = await this.#confirm(
      t('explorer.rename.confirmTitle'),
      renameText(target.path, name.name, t),
      t('explorer.rename.yes'),
      t('explorer.rename.cancel'),
    );
    if (!ok) return false;
    const r = await api.filesRename(target.path, name.name);
    if (!r.ok) return this.#fail(r.error ?? t('files.errors.invalid'));
    toast(t('explorer.rename.done', { name: name.name }));
    return true;
  }

  /** Déplace le fichier d'un élément dans un autre dossier autorisé : le dossier, puis une confirmation. */
  async move({ key }: { key: string }): Promise<boolean> {
    const { api, t, toast, dialogs } = this.ctx;
    const target = await this.#file(String(key));
    if (!target.ok) return this.#fail(target.error);
    const here = dirName(target.path);
    const choices = (await destinations(this.#folders())).filter((d) => !samePath(d.path, here));
    if (!choices.length) return this.#fail(t('explorer.move.none', { name: baseName(target.path) }));
    const res = await dialogs.form({
      title: t('explorer.move.title'),
      help: t('explorer.move.help', { name: baseName(target.path) }),
      fields: [
        {
          id: 'folder',
          type: 'select',
          label: t('explorer.move.field'),
          value: choices[0]?.path ?? '',
          options: choices.map((d): [string, string] => [d.path, d.label]),
        },
      ],
      actions: [
        { id: 'next', label: t('explorer.move.next'), kind: 'primary' },
        { id: 'cancel', label: t('explorer.move.cancel'), kind: 'ghost' },
      ],
    });
    if (res.action !== 'next') return false;
    // Seul un dossier proposé est accepté (le processus principal le contrôle de nouveau).
    const dest = choices.find((d) => d.path === res.values.folder);
    if (!dest) return false;
    const ok = await this.#confirm(t('explorer.move.confirmTitle'), moveText(target.path, dest.path, t), t('explorer.move.yes'), t('explorer.move.cancel'));
    if (!ok) return false;
    const r = await api.filesMove(target.path, dest.path);
    if (!r.ok) return this.#fail(r.error ?? t('files.errors.invalid'));
    toast(t('explorer.move.done', { folder: dest.path }));
    return true;
  }

  /** Met le fichier d'un élément à la corbeille, après confirmation. */
  async remove({ key }: { key: string }): Promise<number> {
    const target = await this.#file(String(key));
    if (!target.ok) {
      this.#fail(target.error);
      return 0;
    }
    return this.#trash([target.path]);
  }

  /** Met les fichiers des éléments choisis à la corbeille, après une confirmation qui les nomme. */
  async removePicked(): Promise<number> {
    const picked = this.ctx.ui.explorer.picked();
    if (!picked.length) return 0;
    const paths = picked.map((p) => p.path);
    const notFile = picked.find((p) => !p.path);
    if (notFile) {
      this.#fail(this.ctx.t('explorer.files.notFileNamed', { name: notFile.name }));
      return 0;
    }
    const reasons = listOf(await this.ctx.api.filesCheck(paths as string[])) ?? [];
    const at = reasons.findIndex((r) => r !== null);
    if (at >= 0 || reasons.length !== paths.length) {
      this.#fail(
        this.ctx.t('explorer.files.blockedNamed', { name: picked[Math.max(at, 0)]?.name ?? '', reason: reasons[at] ?? this.ctx.t('files.errors.invalid') }),
      );
      return 0;
    }
    const removed = await this.#trash(paths as string[]);
    if (removed) this.ctx.ui.explorer.clearPicks();
    return removed;
  }

  /** Ajoute un tag (existant ou nouveau) à tous les éléments choisis. */
  addTagToPicked(): Promise<number> {
    return this.#tagPicked('add');
  }

  /** Retire un tag de tous les éléments choisis qui le portent. */
  removeTagFromPicked(): Promise<number> {
    return this.#tagPicked('remove');
  }

  async #tagPicked(mode: 'add' | 'remove'): Promise<number> {
    const { api, t, toast, dialogs } = this.ctx;
    const picked = this.ctx.ui.explorer.picked();
    if (!picked.length) return 0;
    const [known, elements] = await Promise.all([
      api.tagsList() as Promise<TagSummary[] | null>,
      Promise.all(picked.map((p) => api.catalogElement(p.key) as Promise<CatalogElement | null>)),
    ]);
    const choices = tagChoices(
      mode,
      known ?? [],
      elements.map((e) => e?.tags ?? []),
    );
    if (mode === 'remove' && !choices.length) return this.#fail(t('explorer.tag.none')) as unknown as number;
    const add = mode === 'add';
    const res = await dialogs.form({
      title: t(add ? 'explorer.tag.addTitle' : 'explorer.tag.removeTitle'),
      help: this.#plural(add ? 'explorer.tag.addHelp' : 'explorer.tag.removeHelp', picked.length),
      fields: [
        ...(choices.length
          ? [
              {
                id: 'tag',
                type: 'select' as const,
                label: t('explorer.tag.field'),
                value: choices[0]?.id ?? '',
                options: [...choices.map((x): [string, string] => [x.id, x.name]), ...(add ? [[NEW_TAG, t('explorer.tag.newTag')] as [string, string]] : [])],
              },
            ]
          : []),
        ...(add ? [{ id: 'name', label: t('explorer.tag.newTag'), placeholder: t('explorer.tag.newTagHint'), required: !choices.length }] : []),
      ],
      actions: [
        { id: 'go', label: t(add ? 'explorer.tag.add' : 'explorer.tag.remove'), kind: 'primary' },
        { id: 'cancel', label: t('explorer.tag.cancel'), kind: 'ghost' },
      ],
    });
    if (res.action !== 'go') return 0;
    const typed = add ? String(res.values.name ?? '').trim() : '';
    const chosen = choices.find((x) => x.id === res.values.tag);
    // Un nom saisi l'emporte : le tag est créé à son premier ajout.
    const tag = typed || (chosen ? chosen.id : '');
    if (!tag) return 0;
    let done = 0;
    for (const e of elements) {
      if (!e || (!add && !e.tags.includes(tag))) continue;
      if (await api.catalogSetTags(e.key, { [tag]: add })) done++;
    }
    const name = typed || chosen?.name || tag;
    if (!done) this.#fail(t('explorer.tag.failed'));
    else toast(t(add ? 'explorer.tag.added' : 'explorer.tag.removed', { tag: name }));
    return done;
  }

  /** Fichier d'un élément, contrôlé par le processus principal (dossiers autorisés, liens). */
  async #file(key: string): Promise<FileTarget> {
    const { api, t, ui } = this.ctx;
    let shown: Picked | null = ui.explorer.fileOf(key);
    if (!shown) {
      const el = (await api.catalogElement(key)) as CatalogElement | null;
      if (!el) return { ok: false, error: t('explorer.gone') };
      shown = { key, name: el.name, path: filePath(el) };
    }
    if (!shown.path) return { ok: false, error: t('explorer.files.notFile') };
    const reason = listOf(await api.filesCheck([shown.path]))?.[0];
    if (reason !== null) return { ok: false, error: reason ?? t('files.errors.invalid') };
    return { ok: true, path: shown.path, name: shown.name };
  }

  /** Confirmation, puis corbeille fichier par fichier ; rend le nombre de fichiers mis à la corbeille. */
  async #trash(paths: string[]): Promise<number> {
    const { api, t, toast } = this.ctx;
    const ok = await this.#confirm(
      fill(this.#plural('explorer.remove.title', paths.length), {}),
      removeText(paths, t, (k, n) => this.#plural(k, n)),
      t('explorer.remove.yes'),
      t('explorer.remove.cancel'),
    );
    if (!ok) return 0;
    let done = 0;
    for (const p of paths) {
      const r = await api.filesRemove(p);
      if (r.ok) done++;
      else toast(t('explorer.files.failed', { name: baseName(p), error: r.error ?? '' }), { duration: 8000 });
    }
    if (done) toast(this.#plural('explorer.remove.done', done));
    return done;
  }

  /** Boîte de confirmation : vrai si l'on confirme. */
  async #confirm(title: string, help: string, yes: string, no: string): Promise<boolean> {
    const res = await this.ctx.dialogs.form({
      title,
      help,
      actions: [
        { id: 'yes', label: yes, kind: 'primary' },
        { id: 'no', label: no, kind: 'ghost' },
      ],
    });
    return res.action === 'yes';
  }

  /** Message d'un refus ; rend faux. */
  #fail(message: string): false {
    this.ctx.toast(message, { duration: 8000 });
    return false;
  }

  #plural(key: string, count: number): string {
    return this.ctx.plural?.(key, count) ?? this.ctx.t(`${key}.other`, { count });
  }

  #folders() {
    const { api } = this.ctx;
    return {
      sources: async () => {
        const r = await api.catalogSources();
        return 'folders' in r ? r : null;
      },
      folder: async (s: string, p: string, c: string | null) => {
        const r = await api.catalogFolder(s, p, c);
        return r && 'folders' in r ? r : null;
      },
    };
  }

  /** Ajoute un dossier comme source (`kind` : `library` ou `game`). */
  addFolder({ kind }: { kind: string }): void {
    this.ctx.ui.addSourceFolder(kind);
  }

  /** Ajoute une adresse (partage réseau, serveur web, liste M3U) comme source. */
  addAddress({ kind }: { kind: string }): void {
    this.ctx.ui.askSourceAddress(kind);
  }

  removeSource({ kind, id }: { kind: string; id: string }): void {
    this.ctx.ui.removeSource(kind, id);
  }

  /** Analyse de nouveau toutes les sources. */
  rescan(): void {
    const { S, ui, toast } = this.ctx;
    S.scanned = false;
    ui.scan();
    toast('Analyse de la bibliothèque…', { duration: 2000 });
  }
}
