// Contexte de plugin simulé (forme de `PluginContext` du SDK) : `files.walk` et `files.exists` lisent le disque comme
// le cœur de Mire (`src/main/plugins/context.ts`) : seulement sous les dossiers accordés, sans suivre les liens,
// dossiers et fichiers cachés écartés avec `skipHidden`, chemins seuls avec `details: false`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const inside = (p, roots) => roots.some((r) => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep));

export function fakeContext({ granted = [], locale = 'fr' } = {}) {
  const walks = [];
  const check = (p) => {
    if (!inside(path.resolve(p), granted)) throw new Error('This folder has not been granted to the plugin.');
  };
  const files = {
    async exists(p) {
      check(p);
      return fs.existsSync(p);
    },
    async walk(root, o = {}) {
      check(root);
      walks.push({ root, options: o });
      const exts = o.extensions ? new Set(o.extensions.map((e) => `.${e.toLowerCase()}`)) : null;
      const out = [];
      const go = (dir, level) => {
        for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
          if (out.length >= (o.limit ?? 10000)) return;
          const full = path.join(dir, d.name);
          const hidden = o.skipHidden && (d.name.startsWith('.') || (d.isDirectory() && d.name.startsWith('$')));
          if (hidden) continue;
          if (d.isDirectory()) {
            if (level < (o.depth ?? Infinity)) go(full, level + 1);
          } else if (d.isFile() && (!exts || exts.has(path.extname(d.name).toLowerCase()))) {
            if (o.details === false) out.push({ path: full });
            else {
              const st = fs.statSync(full);
              out.push({ path: full, size: st.size, modified: st.mtimeMs });
            }
          }
        }
      };
      go(path.resolve(root), 0);
      return out;
    },
  };
  const ctx = { id: 'mire.source.network', version: '1.0.0', locale, files, log: { info() {}, warn() {}, error() {} }, events: { on: () => () => {} } };
  return { ctx, walks };
}

/** Arborescence de test dans un dossier temporaire (fichiers vides). */
export function tree(rels) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-source-network-'));
  for (const rel of rels) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
  }
  return { root, remove: () => fs.rmSync(root, { recursive: true, force: true }) };
}
