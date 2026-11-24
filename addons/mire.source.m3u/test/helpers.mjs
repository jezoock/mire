// Contexte de plugin simulé (forme de `PluginContext` du SDK) : `http.getText` rend les listes prévues, et refuse comme
// Mire (`src/main/plugins/context.ts`, P5-12) toute adresse hors de celle accordée ; `files.readText` ne lit que sous
// les dossiers accordés (la liste et son dossier).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function under(url, granted) {
  const u = new URL(url);
  const g = new URL(granted);
  const p = g.pathname;
  return u.origin === g.origin && (u.pathname === p || u.pathname.startsWith(p.endsWith('/') ? p : `${p}/`));
}

const refused = (message) => Object.assign(new Error(message), { code: 'refused' });
const inside = (p, roots) => roots.some((r) => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep));

export function fakeContext({ urls = [], folders = [], lists = {}, locale = 'fr', down = false } = {}) {
  const asked = [];
  const http = {
    async getText(url, options = {}) {
      if (!urls.some((g) => under(url, g))) throw refused(`${new URL(url).hostname} is not declared in permissions.hosts.`);
      asked.push({ url, options });
      if (down) throw Object.assign(new Error('HTTP request failed.'), { code: 'http' });
      return Object.hasOwn(lists, url) ? lists[url] : null;
    },
  };
  const files = {
    async readText(p) {
      if (!inside(path.resolve(p), folders)) throw refused('This folder has not been granted to the plugin.');
      return fs.readFileSync(p, 'utf8');
    },
  };
  return { ctx: { id: 'mire.source.m3u', version: '1.0.0', locale, http, files, log: { info() {}, warn() {}, error() {} } }, asked };
}

export const online = (url, kinds = ['video']) => ({ location: url, url, network: false, kinds });
export const local = (p, kinds = ['video'], network = false) => ({ location: p, path: p, network, kinds });

/** Dossier temporaire avec des fichiers (contenus donnés). */
export function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-m3u-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return { root, at: (rel) => path.join(root, rel), remove: () => fs.rmSync(root, { recursive: true, force: true }) };
}
