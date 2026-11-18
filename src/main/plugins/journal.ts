/**
 * Journal par plugin : `userData/plugins/logs/<id>.log`, une ligne par message (date, niveau, texte). Ce que le
 * plugin écrit par `ctx.log`, ses refus, ses erreurs et ses désactivations. Le fichier est borné : au-delà de
 * `maxBytes`, il devient `<id>.log.1` (l'ancien `.1` est remplacé).
 */
import fs from 'node:fs';
import path from 'node:path';

export type JournalLevel = 'info' | 'warn' | 'error';

export interface JournalOptions {
  dir: string;
  maxBytes?: number;
  now?: () => Date;
}

const MAX_LINE = 2000;

export function createJournal({ dir, maxBytes = 256 * 1024, now = () => new Date() }: JournalOptions) {
  let ready = false;
  const fileOf = (id: string) => path.join(dir, `${id}.log`);

  function write(id: string, level: JournalLevel, message: string): void {
    const line = `${now().toISOString()} ${level.toUpperCase()} ${message.replace(/\s*\n\s*/g, ' ').slice(0, MAX_LINE)}\n`;
    try {
      if (!ready) fs.mkdirSync(dir, { recursive: true });
      ready = true;
      const file = fileOf(id);
      const size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0;
      if (size + line.length > maxBytes) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, line);
    } catch (err) {
      console.error(`Plugins : journal de ${id} impossible à écrire (${(err as Error).message}).`);
    }
  }

  return {
    file: fileOf,
    write,
  };
}

export type Journal = ReturnType<typeof createJournal>;
