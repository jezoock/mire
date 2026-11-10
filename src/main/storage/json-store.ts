/**
 * Stockage d'un fichier de données JSON du processus principal.
 * - Lecture tolérante : fichier absent → valeurs par défaut ; fichier illisible → `onCorrupt`, puis valeurs par défaut.
 * - Écriture atomique : le JSON est écrit dans un fichier temporaire, mis sur le disque, puis renommé
 *   par-dessus l'ancien. Une coupure en pleine écriture laisse l'ancien fichier intact (anomalie A5).
 * - Écriture immédiate (par défaut) : synchrone, une erreur remonte à l'appelant.
 * - Écriture différée (`debounceMs`) : asynchrone, pour ne pas bloquer le processus principal sur un gros fichier
 *   ou un disque lent. Les modifications rapprochées donnent une seule écriture ; une seule écriture est en cours
 *   à la fois, et la dernière valeur est réécrite si elle a changé entre-temps. `flush()` écrit tout de suite ce
 *   qui attend et se résout quand tout est sur le disque (fermeture de l'application).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
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
  /** Écrit tout de suite ce qui attend ; se résout quand l'écriture en cours et celle-ci sont terminées. */
  flush(): Promise<void>;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// Sous Windows, un renommage peut échouer brièvement quand un antivirus ou l'indexation tient le fichier.
const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_TRIES = 5;
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const retryable = (err: unknown) => RETRY_CODES.has((err as NodeJS.ErrnoException).code ?? '');

function renameWithRetry(from: string, to: string): void {
  for (let i = 1; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (i >= RENAME_TRIES || !retryable(err)) throw err;
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

/** Comme `writeFileAtomic`, sans bloquer le processus principal. */
export async function writeFileAtomicAsync(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const handle = await fsp.open(tmp, 'w');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let i = 1; ; i++) {
      try {
        await fsp.rename(tmp, file);
        break;
      } catch (err) {
        if (i >= RENAME_TRIES || !retryable(err)) throw err;
        await sleep(20 * i);
      }
    }
  } catch (err) {
    await fsp.rm(tmp, { force: true });
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
  // Écriture différée en cours, et nouvelle demande arrivée pendant celle-ci.
  let writing: Promise<void> | null = null;
  let again = false;

  const text = () => JSON.stringify(value, null, space);

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

  // Personne n'attend le résultat d'une écriture différée : une erreur va à `onError`, et les suivantes continuent.
  function writeLater(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    if (writing) {
      again = true;
      return writing;
    }
    writing = (async () => {
      do {
        again = false;
        try {
          await writeFileAtomicAsync(file, text());
        } catch (err) {
          onError(err as Error, file);
        }
      } while (again);
      writing = null;
    })();
    return writing;
  }

  function save(): void {
    if (debounceMs <= 0) {
      writeFileAtomic(file, text());
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(writeLater, debounceMs);
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
    flush: () => (timer ? writeLater() : (writing ?? Promise.resolve())),
  };
}

/**
 * Attend la fin des écritures (`flush()` de chaque stockage), `ms` millisecondes au plus :
 * à la fermeture, un disque bloqué ne doit pas empêcher Mire de quitter.
 * Se résout à `true` si tout a été écrit à temps.
 */
export async function flushWithin(flushes: Array<() => Promise<void>>, ms: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), ms);
  });
  const done = Promise.allSettled(flushes.map((f) => f())).then(() => true);
  try {
    return await Promise.race([done, late]);
  } finally {
    clearTimeout(timeout);
  }
}
