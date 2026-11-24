// Banc de vitesse des sources de fichiers incluses (P5-11c, P5-11d) : `library.scan()` d'une grande bibliothèque lue
// par le plugin réel, branché au cœur comme dans Mire (test/library/plugin-folders.ts). Pas lancé par `npm test`.
//
//   node test/library/bench-sources.ts [dossier] [local|network]
//
// Sans dossier, une bibliothèque de 38 000 vidéos est créée dans un dossier temporaire (400 dossiers de 95 vidéos,
// une affiche et un sous-titre par dossier). `network` : le dossier est présenté comme un partage réseau.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { wireLocalPlugin } from './plugin-folders.ts';

function makeLibrary(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-banc-'));
  for (let d = 0; d < 400; d++) {
    const dir = path.join(root, `Série ${d}`, `Saison ${(d % 5) + 1}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 95; i++) fs.writeFileSync(path.join(dir, `Série ${d} S01E${String(i).padStart(2, '0')}.mkv`), '');
    fs.writeFileSync(path.join(dir, 'poster.jpg'), '');
    fs.writeFileSync(path.join(dir, `Série ${d} S01E00.fr.srt`), '');
  }
  return root;
}

const [given, kind = 'local'] = process.argv.slice(2);
const root = given ? path.resolve(given) : makeLibrary();
const cfg = { library: { sources: [{ id: 'v', kind: 'video', location: root }] }, bookmarks: [] } as unknown as Config;
const catalog = createCatalog({
  dir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-banc-catalogue-')), 'sources'),
  debounceMs: 0,
  onIgnored: () => {},
});
const { library } = await wireLocalPlugin({ config: { get: () => cfg }, catalog, plugin: kind === 'network' ? 'network' : 'local' });
for (let i = 0; i < 4; i++) {
  const t = performance.now();
  const { items } = await library.scan();
  console.log(`analyse ${i + 1} : ${items.length} éléments, ${Math.round(performance.now() - t)} ms`);
}
if (!given) fs.rmSync(root, { recursive: true, force: true });
process.exit(0);
