#!/usr/bin/env node
/**
 * Outil des auteurs de plugins.
 * Usage : mire-plugin validate <dossier> [--official]
 * --official : validation pour le dépôt officiel (préfixe `mire.` permis, textes français obligatoires).
 * Code de sortie : 0 si le plugin est valide, 1 s'il ne l'est pas, 2 pour une commande mal écrite.
 */
import { validatePluginDir } from './validate-dir.ts';

const USAGE = 'Usage : mire-plugin validate <dossier> [--official]';

async function main(argv: string[]): Promise<number> {
  const flags = argv.filter((a) => a.startsWith('--'));
  const args = argv.filter((a) => !a.startsWith('--'));
  const unknown = flags.filter((f) => f !== '--official');
  if (args[0] !== 'validate' || args.length !== 2 || unknown.length > 0) {
    console.error(USAGE);
    return 2;
  }
  const dir = args[1]!;
  const result = await validatePluginDir(dir, { official: flags.includes('--official') });
  if (result.ok) {
    console.log(`${dir} : plugin valide.`);
    return 0;
  }
  for (const i of result.issues) console.error(`${i.path || '(manifeste)'} [${i.code}] ${i.message}`);
  console.error(`${dir} : ${result.issues.length} problème(s).`);
  return 1;
}

process.exitCode = await main(process.argv.slice(2));
