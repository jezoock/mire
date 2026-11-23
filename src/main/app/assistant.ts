/**
 * Assistant du premier lancement (P4-23), côté processus principal : dit seulement s'il faut l'ouvrir au démarrage, et
 * retient qu'il a été terminé ou passé. Tout ce qu'il installe passe par le client des dépôts, comme le Centre.
 *
 * État : `userData/assistant.json` (`{ "pending": true }` tant qu'il n'est ni terminé ni passé). Le fichier est créé
 * au premier lancement seulement, c'est-à-dire quand la configuration n'existait pas encore : une installation
 * existante (configuration déjà là, pas de fichier) ne le voit jamais, sauf si on le relance depuis les Réglages.
 * Quitter Mire en plein assistant le rouvre au lancement suivant.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AssistantState } from '@mire/shared/ipc';

export interface AssistantOptions {
  /** `userData/assistant.json`. */
  file: string;
  /** La configuration n'existait pas au démarrage : c'est le premier lancement. */
  fresh: boolean;
  /** Langues préférées du système, la première d'abord (`app.getPreferredSystemLanguages()`). */
  systemLanguages: () => readonly string[];
  log?: (message: string) => void;
}

/** Au plus autant de langues du système transmises à l'interface. */
const MAX_LANGUAGES = 8;
const LANGUAGE_RE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,4}$/;

/** Langues du système bien formées, sans doublon, au plus `MAX_LANGUAGES`. */
export function cleanLanguages(list: readonly unknown[]): string[] {
  const ok = list.filter((l): l is string => typeof l === 'string' && LANGUAGE_RE.test(l));
  return [...new Set(ok)].slice(0, MAX_LANGUAGES);
}

export function createAssistant(opts: AssistantOptions) {
  const log = opts.log ?? ((m: string) => console.error(m));
  let pending = read();

  function read(): boolean {
    let raw: string;
    try {
      raw = fs.readFileSync(opts.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`Assistant : ${opts.file} illisible (${(err as Error).message}).`);
      // Premier lancement : l'assistant reste à faire, même si Mire est quitté avant la fin.
      if (!opts.fresh) return false;
      write(true);
      return true;
    }
    try {
      return (JSON.parse(raw) as { pending?: unknown })?.pending === true;
    } catch {
      log(`Assistant : ${opts.file} mal formé, ignoré.`);
      return false;
    }
  }

  function write(value: boolean): void {
    try {
      fs.mkdirSync(path.dirname(opts.file), { recursive: true });
      const tmp = `${opts.file}.${randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ pending: value }));
      fs.renameSync(tmp, opts.file);
    } catch (err) {
      log(`Assistant : ${opts.file} non enregistré (${(err as Error).message}).`);
    }
  }

  return {
    /** Faut-il ouvrir l'assistant au démarrage, et les langues du système (pour proposer leur pack). */
    state(): AssistantState {
      let languages: string[] = [];
      try {
        languages = cleanLanguages(opts.systemLanguages());
      } catch {
        // Langues du système illisibles : aucun pack proposé d'office.
      }
      return { open: pending, systemLanguages: languages };
    },
    /** Assistant terminé ou passé : il ne s'ouvrira plus au démarrage. */
    finish(): boolean {
      pending = false;
      write(false);
      return true;
    },
  };
}

export type Assistant = ReturnType<typeof createAssistant>;
