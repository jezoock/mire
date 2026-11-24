// Contexte de plugin simulé (forme de `PluginContext` du SDK) : `files.walk` parcourt un vrai dossier comme Mire
// (fichiers seulement, liens non suivis, extensions, profondeur, fichiers et dossiers cachés écartés) et
// `files.readBytes` lit un fichier ; seuls les dossiers accordés sont lisibles, et les dossiers demandés sont notés.
import fs from 'node:fs/promises';
import path from 'node:path';

const inside = (p, roots) => roots.some((r) => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep));

export function fakeContext(granted = []) {
  const walked = [];
  const check = (p) => {
    if (granted.length && !inside(path.resolve(p), granted)) throw new Error('Folder not granted.');
  };
  const files = {
    async walk(root, options = {}) {
      check(root);
      walked.push({ root, options });
      await fs.access(root).catch(() => {
        throw new Error('Folder not found.');
      });
      const exts = options.extensions ? new Set(options.extensions.map((e) => `.${e.toLowerCase().replace(/^\./, '')}`)) : null;
      const depth = options.depth ?? Infinity;
      const hidden = options.skipHidden === true;
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
            if (level < depth && !(hidden && (d.name.startsWith('.') || d.name.startsWith('$')))) stack.push({ dir: full, level: level + 1 });
          } else if (d.isFile() && !(hidden && d.name.startsWith('.')) && (!exts || exts.has(path.extname(d.name).toLowerCase()))) {
            const st = await fs.stat(full);
            out.push({ path: full, size: st.size, modified: st.mtimeMs });
          }
        }
      }
      return out;
    },
    async readBytes(p) {
      check(p);
      return new Uint8Array(await fs.readFile(p));
    },
  };
  return { ctx: { id: 'mire.games.roms', version: '1.0.0', locale: 'fr', files }, walked };
}
