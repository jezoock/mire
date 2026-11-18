/**
 * Pile des boîtes de dialogue ouvertes par le service des boîtes (P4-06), sans DOM : la dernière ouverte est au
 * premier plan ; le passage de « aucune boîte » à « au moins une » (et retour) est signalé, pour masquer puis
 * réafficher la vue web native. Testée sous `node:test` (`test/renderer/dialogs.test.ts`).
 */

export type StackListener = (open: boolean) => void;

export class DialogStack<T> {
  #entries: { id: string; entry: T }[] = [];
  #listeners = new Set<StackListener>();
  #count = 0;

  /** Nouvelle clé de boîte, unique pour la pile (`d1`, `d2`…). */
  nextId(): string {
    return `d${++this.#count}`;
  }

  get size(): number {
    return this.#entries.length;
  }

  /** Boîte au premier plan, ou `undefined`. */
  top(): T | undefined {
    return this.#entries.at(-1)?.entry;
  }

  topId(): string | undefined {
    return this.#entries.at(-1)?.id;
  }

  get(id: string): T | undefined {
    return this.#entries.find((e) => e.id === id)?.entry;
  }

  /** Ajoute une boîte au premier plan (une clé déjà présente y remonte). */
  push(id: string, entry: T): void {
    const wasEmpty = this.#entries.length === 0;
    this.#entries = this.#entries.filter((e) => e.id !== id);
    this.#entries.push({ id, entry });
    if (wasEmpty) this.#emit(true);
  }

  /** Retire une boîte, où qu'elle soit dans la pile ; rend ce qui était retenu, ou `undefined`. */
  remove(id: string): T | undefined {
    const found = this.#entries.find((e) => e.id === id);
    if (!found) return undefined;
    this.#entries = this.#entries.filter((e) => e !== found);
    if (this.#entries.length === 0) this.#emit(false);
    return found.entry;
  }

  /** Suit l'ouverture de la première boîte (`true`) et la fermeture de la dernière (`false`). Rend l'arrêt du suivi. */
  onChange(listener: StackListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(open: boolean): void {
    for (const listener of this.#listeners) listener(open);
  }
}
