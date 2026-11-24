// Contexte de plugin simulé (forme de `PluginContext` du SDK) : `files.walk` parcourt un vrai dossier comme Mire
// (fichiers seulement, liens non suivis, extensions et profondeur), et note les dossiers demandés.
import fs from 'node:fs/promises';
import path from 'node:path';

export function fakeContext() {
  const walked = [];
  const files = {
    async walk(root, options = {}) {
      walked.push({ root, options });
      const exts = options.extensions ? new Set(options.extensions.map((e) => `.${e.toLowerCase()}`)) : null;
      const depth = options.depth ?? Infinity;
      const out = [];
      const stack = [{ dir: root, level: 0 }];
      while (stack.length) {
        const { dir, level } = stack.pop();
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const d of entries) {
          const full = path.join(dir, d.name);
          if (d.isDirectory()) {
            if (level < depth) stack.push({ dir: full, level: level + 1 });
          } else if (d.isFile() && (!exts || exts.has(path.extname(d.name).toLowerCase()))) {
            const st = await fs.stat(full);
            out.push({ path: full, size: st.size, modified: st.mtimeMs });
          }
        }
      }
      return out;
    },
  };
  return { ctx: { id: 'mire.games.pc', version: '1.0.0', locale: 'fr', files }, walked };
}
