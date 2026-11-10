/**
 * Stockage d'un fichier de données JSON du processus principal.
 * - Lecture tolérante : fichier absent → valeurs par défaut ; fichier illisible → `onCorrupt`, puis valeurs par défaut.
 * - Écriture atomique : le JSON est écrit dans un fichier temporaire, mis sur le disque, puis renommé
 *   par-dessus l'ancien. Une coupure en pleine écriture laisse l'ancien fichier intact (anomalie A5).
 * - Écriture différée optionnelle (`debounceMs`) : les modifications rapprochées donnent une seule écriture ;
 *   `flush()` écrit tout de suite ce qui attend (fermeture de l'application).
 * Les écritures sont synchrones : un `flush()` à la fermeture ne peut pas croiser une écriture en cours.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface JsonStoreOptions<T> {
  /** Valeur quand le fichier est absent ou illisible (copiée à chaque usage), ou fonction qui la fabrique. */
  defaults: T | (() => T);
  /** Délai de regroupement des écritures en millisecondes ; 0 (par défaut) : écriture immédiate. */
  debounceMs?: number;
  /** Fichier présent mais illisible (JSON invalide ou qui n'est pas un objet). */
  onCorrupt?: (err: Error, file: string) => void;
  /** Échec d'une écriture différée (une écriture immédiate lève l'erreur à l'appelant). */
  onError?: (err: Error, file: string) => void;
  /** Indentation du JSON, comme le troisième argument de `JSON.stringify` (aucune par défaut). */
  space?: number;
}

export interface JsonStore<T> {
  readonly file: string;
  /** Lit le fichier (lecture tolérante) ; la valeur lue devient la valeur courante. */
  load(): T;
  /** Valeur courante (celle des défauts tant que rien n'a été lu ni posé). */
  get(): T;
  /** Remplace la valeur courante et l'enregistre (tout de suite, ou après le délai de regroupement). */
  set(value: T): void;
  /** Enregistre la valeur courante après une modification en place. */
  save(): void;
  /** Écrit tout de suite l'écriture en attente, s'il y en a une. */
  flush(): void;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// Sous Windows, un renommage peut échouer brièvement quand un antivirus ou l'indexation tient le fichier.
const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_TRIES = 5;
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function renameWithRetry(from: string, to: string): void {
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (i >= RENAME_TRIES || !RETRY_CODES.has((err as NodeJS.ErrnoException).code ?? '')) throw err;
      pause(20 * i);
    }
  }
}

/** Écrit `text` dans `file` sans jamais laisser un fichier à moitié écrit. */
export function writeFileAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renameWithRetry(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Lit un fichier JSON. Absent → `null`. Illisible → l'erreur est levée.
 * Un objet JSON est attendu (tous les fichiers de données de Mire en sont).
 */
export function readJsonFile(file: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const parsed: unknown = JSON.parse(text);
  // `null` écrit tel quel : traité comme un fichier vide, comme avant.
  if (parsed === null) return null;
  if (!isPlainObject(parsed)) throw new Error('le contenu n’est pas un objet JSON');
  return parsed;
}

export function createJsonStore<T extends object>(file: string, options: JsonStoreOptions<T>): JsonStore<T> {
  const { debounceMs = 0, onCorrupt, space } = options;
  const onError = options.onError ?? ((err: Error, f: string) => console.error(`Écriture de ${f} impossible :`, err.message));
  const defaults = (): T => (typeof options.defaults === 'function' ? (options.defaults as () => T)() : structuredClone(options.defaults));

  let value: T = defaults();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function write(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    writeFileAtomic(file, JSON.stringify(value, null, space));
  }

  function load(): T {
    try {
      const read = readJsonFile(file);
      // Les clés lues complètent les valeurs par défaut (une clé absente du fichier garde sa valeur par défaut).
      value = read ? ({ ...defaults(), ...read } as T) : defaults();
    } catch (err) {
      value = defaults();
      onCorrupt?.(err as Error, file);
    }
    return value;
  }

  // Écriture différée : personne n'attend son résultat, une erreur est donc signalée à `onError`.
  function writePending(): void {
    try {
      write();
    } catch (err) {
      onError(err as Error, file);
    }
  }

  function save(): void {
    if (debounceMs <= 0) {
      write();
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(writePending, debounceMs);
  }

  return {
    file,
    load,
    get: () => value,
    set(next: T) {
      value = next;
      save();
    },
    save,
    flush() {
      if (timer) writePending();
    },
  };
}
