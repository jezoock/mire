/**
 * Jeux PC trouvés dans un dossier de jeux (reprise de `src/main/games/pc/scanner.ts` de Mire, avant P5-13) : un jeu
 * par raccourci ou exécutable posé dans le dossier, ou par sous-dossier (on y choisit le bon exécutable, en écartant
 * les utilitaires : désinstalleur, redistribuables…). Sous macOS, un jeu par application (`.app`) posée dans le
 * dossier. Le dossier est parcouru par `ctx.files.walk`, dans les seuls dossiers accordés par Mire.
 */

/** Utilitaires livrés avec les jeux, jamais proposés comme jeu. */
export const JUNK_EXE =
  /unins|setup|install|crash|report|redist|vcredist|vc_redist|dxsetup|directx|dotnet|update|patch|helper|prereq|easyanticheat|battleye|cleanup|config|launcherhelper|cefprocess|webhelper|unitycrash/i;

/** Sous-dossiers d'un jeu qui ne contiennent pas son exécutable. */
const SKIP_DIRS = /^(redist|_commonredist|directx|support|tools|engine)$/i;

/** Fichiers qui lancent un jeu, selon le système. */
export function gameFileExtensions(platform) {
  if (platform === 'win32') return ['.exe', '.lnk', '.url', '.bat'];
  if (platform === 'darwin') return ['.app'];
  return ['.desktop', '.sh', '.appimage', '.x86_64'];
}

const SHORTCUTS = ['.lnk', '.url', '.desktop'];

/** Fichiers rendus au plus par un parcours (borne de Mire). */
const WALK_LIMIT = 150000;

/** Minuscules sans accents. */
const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Ressemblance de deux noms : 1 identiques, 0,8 si l'un contient l'autre, sinon 0. */
export function similarity(a, b) {
  const x = fold(a).replace(/[^a-z0-9]/g, '');
  const y = fold(b).replace(/[^a-z0-9]/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.8;
  return 0;
}

const sepOf = (platform) => (platform === 'win32' ? '\\' : '/');
const extOf = (name) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
};
const baseOf = (name, ext) => (ext ? name.slice(0, -ext.length) : name);

/** Morceaux du chemin `file` sous `root` ; `null` s'il n'est pas dessous. */
function relativeParts(root, file, platform) {
  const split = (p) => p.split(platform === 'win32' ? /[\\/]+/ : /\/+/).filter(Boolean);
  const r = split(root);
  const f = split(file);
  const same = (a, b) => (platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (f.length <= r.length || !r.every((p, i) => same(p, f[i]))) return null;
  return f.slice(r.length);
}

const joinPath = (root, parts, platform) => {
  const sep = sepOf(platform);
  return root.endsWith(sep) ? root + parts.join(sep) : [root, ...parts].join(sep);
};

/**
 * Jeux d'un dossier, à partir des fichiers trouvés dessous (`{ path, size }`, trois niveaux de sous-dossiers au plus) :
 * `[{ name, path }]`, dans l'ordre des noms.
 */
export function gamesIn(root, files, platform) {
  const exts = gameFileExtensions(platform);
  const games = [];
  if (platform === 'darwin') {
    // Une application est un dossier : on la reconnaît à son `Contents/Info.plist`.
    const apps = new Set();
    for (const f of files) {
      const parts = relativeParts(root, f.path, platform);
      if (parts?.length === 3 && extOf(parts[0]) === '.app' && !parts[0].startsWith('.') && parts[1] === 'Contents' && parts[2] === 'Info.plist')
        apps.add(parts[0]);
    }
    for (const app of apps) games.push({ name: baseOf(app, '.app'), path: joinPath(root, [app], platform) });
    return sortByName(games);
  }
  /** Meilleur exécutable de chaque sous-dossier : nom proche de celui du dossier, puis le plus gros, puis le moins profond. */
  const best = new Map();
  for (const f of files) {
    const parts = relativeParts(root, f.path, platform);
    if (!parts || parts[0].startsWith('.')) continue;
    const name = parts[parts.length - 1];
    const ext = extOf(name);
    if (!exts.includes(ext) || JUNK_EXE.test(name)) continue;
    if (parts.length === 1) {
      games.push({ name: baseOf(name, ext).replace(/[._]+/g, ' ').trim(), path: f.path });
      continue;
    }
    if (parts.length > 4 || SHORTCUTS.includes(ext) || parts.slice(1, -1).some((d) => SKIP_DIRS.test(d))) continue;
    const level = parts.length - 2;
    const score = similarity(baseOf(name, ext), parts[0]) * 1e12 + (Number(f.size) || 0) - level * 1e6;
    const prev = best.get(parts[0]);
    if (!prev || score > prev.score) best.set(parts[0], { score, path: f.path });
  }
  for (const [dir, b] of best) games.push({ name: dir, path: b.path });
  return sortByName(games);
}

const sortByName = (games) => games.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));

/** Parcourt un dossier de jeux par le contexte du plugin. */
export async function scanFolder(files, root, platform) {
  const options =
    platform === 'darwin'
      ? { extensions: ['plist'], depth: 2, limit: WALK_LIMIT }
      : { extensions: gameFileExtensions(platform).map((e) => e.slice(1)), depth: 3, limit: WALK_LIMIT };
  return gamesIn(root, await files.walk(root, options), platform);
}
