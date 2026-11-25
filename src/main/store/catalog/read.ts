/**
 * Lecture d'un émulateur décrit par des données (P5-19) : celles d'une contribution `apps` de genre `emulator` d'un
 * plugin, et celles des émulateurs encore dans le cœur (`EMULATORS`), lues de la même façon. Forme :
 *
 *   { "kind": "emulator",
 *     "site": "https://www.duckstation.org",
 *     "source": { "github": "stenzek/duckstation",
 *                 "files": { "windows": "duckstation-windows-x64-release.zip", "linux": "DuckStation-x64.AppImage" } },
 *     "program": { "windows": "duckstation-qt-x64-ReleaseLTCG.exe", "linux": "DuckStation-x64.AppImage" },
 *     "args": ["-batch", "-fullscreen", "{rom}"],
 *     "consoles": [ { "id": "ps1", "libretro": "Sony - PlayStation", "folder": "Sony - PlayStation",
 *                     "extensions": [".cue", ".chd"] } ],
 *     "bios": { "portable": { "markers": ["portable.txt"], "dir": ["bios"] },
 *               "windows": ["documents", "DuckStation", "bios"], "linux": ["xdgData", "duckstation", "bios"] } }
 *
 * - `site` : adresse `https:` du site de l'émulateur ;
 * - `source` : d'où le cœur le télécharge, l'un de :
 *   - `{ "github": "<propriétaire>/<dépôt>", "files": { "windows": <motif>, "linux": <motif> } }` : dernière version
 *     publiée du dépôt GitHub, fichier dont le nom correspond au motif ;
 *   - `{ "page": "https://…", "links": { "windows": <motif>, … } }` : premier lien de la page qui correspond au motif ;
 *     le motif commence par `https://` suivi de l'hôte de la page ou d'un de ses sous-domaines, écrit en entier ;
 *   - `{ "buildbot": "retroarch" }` : l'installateur de RetroArch du cœur (programme et cœurs du buildbot de libretro,
 *     un cœur par console choisie : chaque console donne son `core`, et le cœur fabrique la ligne de commande) ;
 * - `program` : nom du programme à lancer, cherché dans le dossier d'installation (motif ; sous Windows, sans
 *   distinction de casse) ;
 * - `args` : arguments de lancement ; `{rom}` (le jeu) est la seule variable, présente une fois ; une console peut
 *   avoir les siens (`args` de la console) ;
 * - `consoles` : consoles gérées. `libretro` est un système du référentiel (`SYSTEMS`, `@mire/shared`), qui donne le
 *   nom de la console ; `folder` est le dossier de ses jeux sous le dossier des ROMs (un seul nom, sans séparateur) ;
 *   `extensions` (`.nes`…) ; `core` : cœur RetroArch (`buildbot` seulement) ;
 * - `bios` : dossier où l'émulateur cherche ses BIOS : chemin sous un point de départ (`emulators`, `install`,
 *   `documents`, `appData`, `xdgConfig`, `xdgData`) par système, et mode portable facultatif. Mire ne fournit jamais
 *   de BIOS (D-21) : il montre ce dossier et un rappel des fichiers attendus (texte).
 *
 * Motifs : `*` (n'importe quelle suite de caractères) et `?` (un caractère) seulement, jamais une expression
 * régulière ; bornés en longueur, comparés au nom entier (ancrés). Un motif mal formé est ignoré, une console mal
 * formée aussi ; sans programme, sans source ou sans console utilisable, l'émulateur est ignoré.
 */
import { systemById } from '@mire/shared';
import type { BiosBase, BiosLocation, BiosPath, EmulatorSource, InstallPlatform, StoreEmulator, StoreSystem } from './types.ts';

/** Bornes des données d'un émulateur. */
export const MAX_FILE_PATTERN = 100;
export const MAX_LINK_PATTERN = 200;
export const MAX_URL = 300;
export const MAX_CONSOLES = 32;
export const MAX_EXTENSIONS = 16;
export const MAX_ARGS = 8;
export const MAX_ARG_LENGTH = 64;
export const MAX_SEGMENTS = 6;
/** Jokers `*` au plus par motif (borne le retour arrière de la recherche). */
export const MAX_STARS = 4;

export const EMULATOR_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const CONSOLE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const CORE_RE = /^[a-z0-9_]{1,48}$/;
const EXT_RE = /^\.[a-z0-9]{1,8}$/;
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
// Caractères refusés dans un nom de fichier ou de dossier (Windows en refuse le plus).
const BAD_NAME_CHARS = /[<>:"/\\|]/;
const BASES: readonly BiosBase[] = ['emulators', 'install', 'documents', 'appData', 'xdgConfig', 'xdgData'];
/** Clés des systèmes dans les données → plateformes de la boutique. */
const PLATFORMS = { windows: 'win32', linux: 'linux' } as const satisfies Record<string, InstallPlatform>;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);
const escape = (s: string) => s.replace(/[.+^${}()|[\]\\/-]/g, '\\$&');

/** Motif simple en expression régulière ancrée ; `star` et `one` : ce que `*` et `?` acceptent. */
function compile(p: string, star: string, one: string, flags: string): RegExp | null {
  if (p.split('*').length - 1 > MAX_STARS) return null;
  const body = [...p].map((c) => (c === '*' ? `${star}*` : c === '?' ? one : escape(c))).join('');
  return new RegExp(`^${body}$`, flags);
}

/** Motif d'un nom de fichier (programme, fichier d'une version GitHub), ou `null` s'il est mal formé. */
export function filePattern(v: unknown, ignoreCase = false): RegExp | null {
  if (typeof v !== 'string' || !v || v.length > MAX_FILE_PATTERN || CONTROL.test(v) || BAD_NAME_CHARS.test(v)) return null;
  if (v === '.' || v === '..' || !/[^*?]/.test(v)) return null;
  return compile(v, '[^/\\\\]', '[^/\\\\]', ignoreCase ? 'i' : '');
}

/**
 * Motif d'un lien d'une page de téléchargement, ou `null` : `https://`, puis l'hôte de la page (ou un de ses
 * sous-domaines) écrit en entier, sans motif ; `*` et `?` ne franchissent ni `/`, ni guillemet, ni espace. Il est
 * cherché dans le HTML (non ancré au début de la page, mais un lien entier : il ne s'arrête pas au milieu d'un nom).
 */
export function linkPattern(v: unknown, pageHost: string): RegExp | null {
  if (typeof v !== 'string' || v.length > MAX_LINK_PATTERN || CONTROL.test(v) || /[\s"'<>\\]/.test(v)) return null;
  const m = /^https:\/\/([a-z0-9.-]+)(\/[^?#]*)$/.exec(v);
  if (!m) return null;
  const host = m[1];
  if (host !== pageHost && !host.endsWith(`.${pageHost}`)) return null;
  const re = compile(v, `[^/\\s"'<>]`, `[^/\\s"'<>]`, '');
  if (!re) return null;
  // Expression ancrée sur le lien entier, retirée de ses ancres pour la recherche dans la page.
  return new RegExp(`${re.source.slice(1, -1)}(?=["'\\s<>]|$)`);
}

/** Adresse `https:` bornée, sans identifiants, telle qu'écrite ; `null` sinon. */
export function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > MAX_URL || CONTROL.test(v) || /\s/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname ? v : null;
  } catch {
    return null;
  }
}

/** Un nom de fichier ou de dossier sûr : ni vide, ni `.`/`..`, ni séparateur, ni caractère interdit. */
export function safeSegment(v: unknown, max = 64): v is string {
  return typeof v === 'string' && !!v.trim() && v.length <= max && v !== '.' && v !== '..' && !CONTROL.test(v) && !/[<>:"/\\|?*]/.test(v);
}

/** Arguments de lancement : `{rom}` une fois exactement, aucune autre variable ; `null` s'ils ne conviennent pas. */
export function readArgs(v: unknown): string[] | null {
  if (!Array.isArray(v) || !v.length || v.length > MAX_ARGS) return null;
  if (!v.every((a) => typeof a === 'string' && a.length <= MAX_ARG_LENGTH && !CONTROL.test(a) && !/[{}]/.test(a.replaceAll('{rom}', '')))) return null;
  const count = v.reduce((n: number, a: string) => n + a.split('{rom}').length - 1, 0);
  return count === 1 ? [...v] : null;
}

function readPerPlatform<T>(v: unknown, read: (x: unknown) => T | null): Partial<Record<InstallPlatform, T>> {
  const out: Partial<Record<InstallPlatform, T>> = {};
  if (!isRecord(v)) return out;
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    const r = read(own(v, key));
    if (r !== null) out[platform] = r;
  }
  return out;
}

function readSource(v: unknown): { source?: EmulatorSource; retroarch?: true } | null {
  if (!isRecord(v)) return null;
  if (own(v, 'buildbot') === 'retroarch') return { retroarch: true };
  const repo = own(v, 'github');
  if (typeof repo === 'string') {
    if (!REPO_RE.test(repo) || repo.includes('..')) return null;
    const files = readPerPlatform(own(v, 'files'), (x) => filePattern(x));
    return Object.keys(files).length ? { source: { github: repo, ...files } } : null;
  }
  const page = httpsUrl(own(v, 'page'));
  if (page) {
    const host = new URL(page).hostname;
    const links = readPerPlatform(own(v, 'links'), (x) => linkPattern(x, host));
    return Object.keys(links).length ? { source: { page, ...links } } : null;
  }
  return null;
}

function readConsole(v: unknown, buildbot: boolean): StoreSystem | null {
  if (!isRecord(v)) return null;
  const id = own(v, 'id');
  const sys = systemById(own(v, 'libretro'));
  const folder = own(v, 'folder');
  if (typeof id !== 'string' || !CONSOLE_ID_RE.test(id) || !sys || !safeSegment(folder)) return null;
  const rawExt = own(v, 'extensions');
  const ext = Array.isArray(rawExt) ? [...new Set(rawExt.slice(0, MAX_EXTENSIONS).filter((e): e is string => typeof e === 'string' && EXT_RE.test(e)))] : [];
  if (!ext.length) return null;
  const out: StoreSystem = { id, name: sys.name, folder, libretro: sys.id, ext };
  if (buildbot) {
    const core = own(v, 'core');
    if (typeof core !== 'string' || !CORE_RE.test(core)) return null;
    out.core = core;
  } else if (own(v, 'args') !== undefined) {
    const args = readArgs(own(v, 'args'));
    if (!args) return null;
    out.args = args;
  }
  return out;
}

function readBiosPath(v: unknown): BiosPath | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_SEGMENTS) return null;
  const [base, ...rest] = v;
  if (!BASES.includes(base) || !rest.every((s) => safeSegment(s))) return null;
  return [base as BiosBase, ...(rest as string[])];
}

function readBios(v: unknown): BiosLocation | null {
  if (!isRecord(v)) return null;
  const win32 = readBiosPath(own(v, 'windows'));
  const linux = readBiosPath(own(v, 'linux'));
  if (!win32 || !linux) return null;
  const out: BiosLocation = { win32, linux };
  const p = own(v, 'portable');
  if (isRecord(p)) {
    const markers = own(p, 'markers');
    const dir = own(p, 'dir');
    if (
      Array.isArray(markers) &&
      markers.length &&
      markers.length <= 4 &&
      markers.every((m) => safeSegment(m)) &&
      Array.isArray(dir) &&
      dir.length &&
      dir.length <= MAX_SEGMENTS &&
      dir.every((s) => safeSegment(s))
    )
      out.portable = { markers: [...markers], dir: [...dir] };
  }
  return out;
}

/** Ce que le lecteur ne trouve pas dans les données : identité, nom affiché, clés des textes. */
export interface EmulatorIdentity {
  id: string;
  name: string;
  plugin?: string;
  texts: StoreEmulator['texts'];
}

/** Émulateur décrit par des données, ou `null` si elles ne conviennent pas. */
export function readEmulatorData(identity: EmulatorIdentity, d: unknown): StoreEmulator | null {
  if (!EMULATOR_ID_RE.test(identity.id) || !isRecord(d) || own(d, 'kind') !== 'emulator') return null;
  const site = httpsUrl(own(d, 'site'));
  const src = readSource(own(d, 'source'));
  if (!site || !src) return null;
  const buildbot = !!src.retroarch;
  const program = own(d, 'program');
  const exe: StoreEmulator['exe'] = {};
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    const p = isRecord(program) ? filePattern(own(program, key), platform === 'win32') : null;
    if (p) exe[platform] = p;
  }
  if (!Object.keys(exe).length) return null;
  // Avec le buildbot, le cœur fabrique toute la ligne de commande (cœur de la console, puis le jeu).
  const args = buildbot ? undefined : readArgs(own(d, 'args'));
  if (!buildbot && !args) return null;
  const rawConsoles = own(d, 'consoles');
  const seen = new Set<string>();
  const systems = (Array.isArray(rawConsoles) ? rawConsoles.slice(0, MAX_CONSOLES) : [])
    .map((c) => readConsole(c, buildbot))
    .filter((c): c is StoreSystem => !!c && !seen.has(c.id) && !!seen.add(c.id));
  if (!systems.length) return null;
  const emu: StoreEmulator = { id: identity.id, name: identity.name, site, exe, systems, texts: identity.texts };
  if (identity.plugin) emu.plugin = identity.plugin;
  if (buildbot) emu.retroarch = true;
  if (src.source) emu.source = src.source;
  if (args) emu.args = args;
  const bios = readBios(own(d, 'bios'));
  if (bios) emu.bios = bios;
  return emu;
}
