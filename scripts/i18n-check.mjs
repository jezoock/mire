/**
 * Vérifie les catalogues de textes (packages/shared/src/i18n/locales/*.json) : chacun comparé au français,
 * langue de référence (mêmes clés, mêmes variables d'interpolation), aucun texte vide, métadonnées complètes.
 * Usage : node scripts/i18n-check.mjs [dossier] — sort en erreur au premier problème trouvé, après les avoir tous listés.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCatalogs } from '../packages/shared/src/i18n/check.ts';
import { REFERENCE_LANGUAGE } from '../packages/shared/src/i18n/catalogs.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv[2] ?? path.join(ROOT, 'packages', 'shared', 'src', 'i18n', 'locales'));

const catalogs = {};
const errors = [];
for (const file of fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const code = path.basename(file, '.json');
  try {
    catalogs[code] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  } catch (err) {
    errors.push(`${code} : JSON illisible (${err.message})`);
  }
}
errors.push(...checkCatalogs(catalogs, REFERENCE_LANGUAGE));

const codes = Object.keys(catalogs).join(', ');
if (errors.length) {
  console.error(`Catalogues (${codes}) : ${errors.length} problème(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Catalogues (${codes}) : mêmes clés et mêmes variables qu'en ${REFERENCE_LANGUAGE}, aucun texte vide.`);
