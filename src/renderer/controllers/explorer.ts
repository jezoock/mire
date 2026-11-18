import type { Element as CatalogElement, ListSummary } from '@mire/shared';
import { openEditor } from '../editors/editor.ts';
import { Controller } from './base.ts';
import { openCatalogElement } from './page.ts';

/** Choix « nouvelle liste » du formulaire d'ajout à une liste (jamais un identifiant de liste : il n'a pas de `_`). */
export const NEW_LIST = '_new';

/**
 * `mire-explorer` : explorateur (P4-08) : ouvrir une branche (colonne suivante), montrer un élément (aperçu), puis le
 * lire, modifier ses infos ou ses tags, l'ajouter à une liste. Les éléments sont désignés par leur clé, les branches
 * par leur nœud (`explorer/model.ts`). Aussi : sources de la bibliothèque et des jeux, analyse des dossiers (vues
 * historiques, par le pont).
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
    const { api, t, toast, dialogs } = this.ctx;
    const el = (await api.catalogElement(String(key))) as CatalogElement | null;
    if (!el) {
      toast(t('explorer.gone'));
      return null;
    }
    const lists = ((await api.listsList()) ?? []) as ListSummary[];
    const listName = (l: ListSummary) => (typeof l.name === 'string' ? l.name : t(l.name.key));
    const res = await dialogs.form({
      title: t('explorer.addToList.title'),
      help: t('explorer.addToList.help', { name: el.name }),
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
    const added = list ? ((await api.listsAdd(list.id, [el.key])) as number | null) : null;
    if (!list || added === null) {
      toast(t('explorer.addToList.failed'));
      return null;
    }
    toast(t(added ? 'explorer.addToList.added' : 'explorer.addToList.already', { list: listName(list) }));
    return added;
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
