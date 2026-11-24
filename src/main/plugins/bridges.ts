/**
 * Branchements des contributions de code qui ont besoin du contexte (P3-04, reportés de P3-03) :
 *
 * - `sources` → catalogue. Emplacements de la bibliothèque (P5-11a) : ils restent dans la configuration de Mire
 *   (`library.sources`) ; le cœur demande à chaque source active (`handles`) si elle sait lire un emplacement, la
 *   première qui l'accepte l'analyse (`scan(location)`) et ses éléments vont au catalogue sous
 *   `{ plugin: <id du plugin>, instance: <chemin ou adresse normalisés> }`. Un dossier accepté est accordé à ce plugin
 *   tant qu'il reste dans la bibliothèque (`assignedFolders`) : l'accord suit la configuration, sans rien mémoriser.
 *   Seuls les plugins inclus ou du dépôt officiel reçoivent ces emplacements, et un dossier seulement s'ils déclarent
 *   `folders`. Une source qui n'en accepte aucun est analysée une fois sans emplacement (`scan(null)`), sous
 *   l'identifiant de sa contribution. Tout est retiré du catalogue à la désactivation.
 * - `metadata` → moteur d'infos en ligne (`scrape/engine.ts`, `extraProviders`), après les fournisseurs du cœur. Les
 *   images d'une fiche (`image`, `backdrop`) arrivent par leur adresse : elles sont copiées dans le dossier d'images,
 *   seulement depuis un hôte `https:` déclaré par le plugin ; ce qu'il manque pour interroger la source (`requires`)
 *   est fait de textes du plugin, montrés tels quels. Une erreur levée par un plugin le désactive (service) : un
 *   échec attendu (clé refusée, service injoignable) se rend comme résultat, `{ failure: "<message du plugin>" }`,
 *   que l'utilisateur voit comme l'erreur d'une recherche de fiches.
 * - `search` → `search(query)` : interroge les fournisseurs actifs en parallèle (l'écran Recherche, P4-12, les
 *   affichera).
 * - `subtitles` → `subtitles(videoPath)` (P5-11b) : à l'ouverture d'une vidéo locale que la politique d'accès de
 *   l'interface autorise déjà (`library/subtitles.ts`), chaque fournisseur actif d'un plugin inclus ou du dépôt
 *   officiel reçoit son chemin ; le dossier de la vidéo lui est prêté pendant l'appel s'il déclare `folders`
 *   (`lentFolders`), rien de plus. Le cœur lit lui-même ce qu'il rend : un `.srt` ou `.vtt` sous ses dossiers accordés
 *   (vérifié aussi sur le chemin réel), ou une adresse `https:` d'un hôte qu'il déclare, sans redirection ; taille,
 *   nombre, libellé et langue bornés ; le texte rendu à l'interface n'est jamais interprété comme du HTML.
 *
 * Ce qu'un plugin rend est vérifié ici, d'après son niveau et ses permissions (jamais d'après ce que dit le
 * résultat) : un élément qui lance un programme demande le code sensible et la permission `launch` ; un plugin de code
 * limité ne peut fournir ni un fichier ou une image locale hors des dossiers qui lui sont accordés, vérifiés une
 * seconde fois sur le chemin réel (liens symboliques), ni un jeu de console (P5-14a) autre qu'un fichier local de ces
 * dossiers, d'une console connue (celle d'un dossier de jeux proposé) : le cœur lance alors l'émulateur par la clé de
 * l'élément, le plugin ne lance rien. Ses clés sont préfixées par `plugin:<id>|` pour ne jamais prendre la place d'un
 * élément du cœur ou d'un autre plugin, sauf la clé d'un fichier local (`local:<chemin>`) ou d'un jeu de console
 * (`rom:<console>|<chemin>`) qui désigne exactement son `open` vérifié : un fichier ou un jeu garde ainsi la clé
 * qu'il avait quand le cœur le trouvait (listes, reprise, fiches, favoris).
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ContributionKind, ElementInput, InfoValue, MetadataFacts, MetadataKind, OpenSpec, PluginLevel, SourceLocation } from '@mire/plugin-sdk';
import { fold, guessSystem, type ElementSourceRef } from '@mire/shared';
import { localFileKey, romKey } from '../catalog/keys.ts';
import type { KeyedLocation } from '../library/locations.ts';
import { isInside } from '../lib/paths.ts';
import { decodeText, srtToVtt } from '../lib/text.ts';
import { request, type FetchLike } from '../net/http.ts';
import { ScrapeRefusal } from '../scrape/refusal.ts';
import type { JobContext, MetadataProvider, ProviderContext, RunOptions, ScrapeConfig, ScrapeGroup, ScrapeItem } from '../scrape/types.ts';
import { hostDeclared, isLocalHost } from './permissions.ts';
import type { ContributionEntry } from './registry.ts';

/** Bornes des résultats rendus par un plugin. */
export const BRIDGE_LIMITS = Object.freeze({
  /** Éléments d'une analyse : le nombre maximal de la bibliothèque (`MAX_ITEMS`). */
  elements: 150000,
  /** Texte (clé, nom, adresse, info). */
  text: 4096,
  /** Résultat d'une recherche, en JSON. */
  searchBytes: 1024 * 1024,
  /**
   * Délais (ms) : analyse d'une source sans emplacement, d'un emplacement de la bibliothèque (un partage réseau lent
   * peut demander plusieurs minutes), question `handles`, recherche, infos en ligne.
   */
  scanTimeout: 60000,
  locationScanTimeout: 10 * 60000,
  handlesTimeout: 5000,
  searchTimeout: 10000,
  metadataTimeout: 30000,
});

export interface BridgeService {
  contributions(kind: ContributionKind): ContributionEntry[];
  onContributionsChange(listener: (kinds: ContributionKind[]) => void): () => void;
  call(pluginId: string, kind: ContributionKind, contributionId: string, method: string, args?: unknown[], options?: { timeout?: number }): Promise<unknown>;
  levelOf(id: string): PluginLevel | null;
  folders(id: string): string[];
  /** Hôtes Internet déclarés par un plugin actif (`permissions.hosts`). */
  hosts(id: string): string[];
  /**
   * Ce qu'un plugin actif peut recevoir ou rendre : inclus ou du dépôt officiel (`trusted`), permissions `folders` et
   * `launch` déclarées (et permises par son niveau).
   */
  sourceRights(id: string): { trusted: boolean; folders: boolean; launch?: boolean };
}

export interface BridgeCatalog {
  setSource(source: ElementSourceRef, inputs: Iterable<ElementInput>): unknown;
  removeSource(source: ElementSourceRef): unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= BRIDGE_LIMITS.text;
const isWebUrl = (v: unknown): v is string => text(v) && /^https?:\/\//i.test(v);

function infoValue(v: unknown): InfoValue | undefined {
  if (typeof v === 'string') return v.slice(0, BRIDGE_LIMITS.text);
  if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return v;
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, BRIDGE_LIMITS.text));
  return undefined;
}

/** Fichier local qu'un plugin a le droit de désigner : n'importe lequel en code sensible, sinon sous ses dossiers accordés. */
function localAllowed(p: unknown, level: PluginLevel, granted: readonly string[]): p is string {
  if (!text(p) || !path.isAbsolute(p)) return false;
  return level === 'privileged' || insideGranted(granted)(p);
}

/**
 * Test « dans un dossier accordé ou ce dossier lui-même » (même règle que `isInside`, chemin résolu, aucun segment
 * `..`, casse ignorée sous Windows), avec les dossiers résolus une fois par liste : une analyse vérifie des dizaines
 * de milliers de chemins contre la même liste.
 */
/** Segment `..` dans un chemin (sans découper le chemin : des dizaines de milliers par analyse). */
const POSIX_DOTS = /(^|\/)\.\.(\/|$)/;
const WIN_DOTS = /(^|[\\/])\.\.([\\/]|$)/;
/**
 * `path.resolve` d'un chemin, sans le recalculer pour un chemin POSIX absolu déjà normalisé (ni `//`, ni segment `.`
 * ou `..`, ni `/` final) : `resolve` le rendrait tel quel.
 */
const NOT_NORMAL = /\/\/|\/\.\.?(\/|$)|.\/$/;
const resolvePath = (p: string): string => (process.platform !== 'win32' && p.startsWith('/') && !NOT_NORMAL.test(p) ? p : path.resolve(p));
const grantedTests = new WeakMap<readonly string[], (p: string) => boolean>();
function insideGranted(granted: readonly string[]): (p: string) => boolean {
  let test = grantedTests.get(granted);
  if (test) return test;
  const win = process.platform === 'win32';
  const key = (x: string) => (win ? path.resolve(x).toLowerCase() : path.resolve(x));
  const roots = granted
    .filter((g) => typeof g === 'string' && path.isAbsolute(g))
    .map((g) => ({ exact: path.resolve(g), prefix: key(g).endsWith(path.sep) ? key(g) : key(g) + path.sep }));
  test = (p: string) => {
    const exact = resolvePath(p);
    const t = win ? exact.toLowerCase() : exact;
    const dots = (win ? WIN_DOTS : POSIX_DOTS).test(p);
    return roots.some((r) => exact === r.exact || (!dots && t.startsWith(r.prefix)));
  };
  grantedTests.set(granted, test);
  return test;
}

/** Ce qui, en plus du niveau et des dossiers accordés, décide de ce qu'un plugin peut rendre. */
export interface ElementRights {
  /** Permission `launch` déclarée (et permise par le niveau) : élément « programme ». */
  launch?: boolean;
  /** Consoles connues (celles des dossiers de jeux proposés) : élément « jeu » d'un plugin de code limité. */
  consoles?: ReadonlySet<string>;
}

/** Comment ouvrir un élément d'un plugin, s'il en a le droit ; `null` sinon. */
function openSpec(raw: unknown, level: PluginLevel, granted: readonly string[], rights: ElementRights): OpenSpec | null {
  if (!isObject(raw)) return null;
  const sensitive = level === 'privileged';
  switch (raw.kind) {
    case 'site':
      return isWebUrl(raw.url) ? { kind: 'site', url: raw.url, ...(text(raw.site) ? { site: raw.site } : {}) } : null;
    case 'stream': {
      if (!isWebUrl(raw.url)) return null;
      const variants = Array.isArray(raw.variants)
        ? raw.variants
            .filter((v): v is { label: string; url: string } => isObject(v) && text(v.label) && isWebUrl(v.url))
            .map((v) => ({ label: v.label, url: v.url }))
        : [];
      return { kind: 'stream', url: raw.url, ...(variants.length ? { variants } : {}) };
    }
    case 'file':
      if (isWebUrl(raw.path)) return { kind: 'file', path: raw.path };
      return localAllowed(raw.path, level, granted) ? { kind: 'file', path: raw.path } : null;
    case 'game':
      // Jeu de console : le cœur lance l'émulateur de la console par la clé de l'élément. Un plugin de code limité ne
      // désigne qu'un fichier local de ses dossiers accordés, d'une console connue ; une adresse lui reste refusée.
      if (!text(raw.path) || !text(raw.console)) return null;
      if (!sensitive && !(rights.consoles?.has(raw.console) && localAllowed(raw.path, level, granted))) return null;
      return { kind: 'game', console: raw.console, path: raw.path };
    case 'program':
      // Lancer un programme : permission sensible `launch`, code sensible seulement.
      if (!sensitive || rights.launch !== true || !text(raw.path)) return null;
      return { kind: 'program', path: raw.path, ...(Array.isArray(raw.args) ? { args: raw.args.filter((a): a is string => typeof a === 'string') } : {}) };
    default:
      return null;
  }
}

/** Image d'un élément : adresse web, ou fichier local que le plugin a le droit de désigner. */
const elementImageAllowed = (v: unknown, level: PluginLevel, granted: readonly string[]): v is string => isWebUrl(v) || localAllowed(v, level, granted);

/** Fichier local de l'élément (`open.path` d'un fichier ou d'un jeu qui n'est pas une adresse), s'il y en a un. */
const localPathOf = (open: OpenSpec): string | null => ((open.kind === 'file' || open.kind === 'game') && !isWebUrl(open.path) ? open.path : null);

/** Clé que le cœur donnerait au fichier ou au jeu local de l'élément (`local:` ou `rom:`), s'il y en a un. */
function coreKeyOf(open: OpenSpec, platform: NodeJS.Platform): string | null {
  const local = localPathOf(open);
  if (local === null) return null;
  return open.kind === 'game' ? romKey(open.console, local, platform) : localFileKey(local, platform);
}

/**
 * Éléments rendus par la source d'un plugin, vérifiés ; ceux qui ne passent pas sont écartés. Vérification écrite
 * seulement : le chemin réel des fichiers locaux est vérifié ensuite (`keepReal`).
 */
export function checkElements(
  pluginId: string,
  level: PluginLevel,
  granted: readonly string[],
  raw: unknown,
  platform: NodeJS.Platform = process.platform,
  rights: ElementRights = {},
): { elements: ElementInput[]; dropped: number } {
  if (!Array.isArray(raw)) throw new Error('scan() must return an array of elements.');
  if (raw.length > BRIDGE_LIMITS.elements) throw new Error(`scan() returned more than ${BRIDGE_LIMITS.elements} elements.`);
  const prefix = level === 'privileged' ? '' : `plugin:${pluginId}|`;
  const elements: ElementInput[] = [];
  for (const e of raw) {
    const open = isObject(e) ? openSpec(e.open, level, granted, rights) : null;
    if (!isObject(e) || !text(e.key) || !text(e.name) || !open) continue;
    const infos: Record<string, InfoValue> = {};
    if (isObject(e.infos)) {
      for (const [k, v] of Object.entries(e.infos)) {
        const iv = infoValue(v);
        if (iv !== undefined && text(k)) infos[k] = iv;
      }
    }
    const images: ElementInput['images'] = {};
    if (isObject(e.images))
      for (const k of ['poster', 'background', 'logo'] as const) if (elementImageAllowed(e.images[k], level, granted)) images[k] = e.images[k];
    // Clé d'un fichier ou d'un jeu local, gardée telle quelle si elle désigne exactement le fichier vérifié.
    const ownKey = e.key === coreKeyOf(open, platform);
    elements.push({
      key: ownKey ? e.key : `${prefix}${e.key}`,
      name: e.name,
      open,
      tags: Array.isArray(e.tags) ? e.tags.filter(text) : [],
      infos,
      images,
    });
  }
  return { elements, dropped: raw.length - elements.length };
}

/** Lecture du chemin réel (tests). */
export type Realpath = (p: string) => Promise<string>;

/** Lecture d'un dossier, avec le type de chaque entrée (tests). */
export type Readdir = (dir: string) => Promise<{ name: string; isSymbolicLink(): boolean }[]>;

/** Vérifications de fichiers en même temps. */
const REAL_CONCURRENCY = 64;

/** Fait `fn` pour chaque valeur, `REAL_CONCURRENCY` à la fois. */
async function eachLimited<T>(values: readonly T[], fn: (v: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < values.length) await fn(values[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(REAL_CONCURRENCY, values.length) }, worker));
}

/**
 * Chemins réels d'une liste de fichiers (`null` : n'existe pas). Chaque dossier n'est lu qu'une fois pour tous ses
 * fichiers (une bibliothèque compte des dizaines de milliers de fichiers pour quelques milliers de dossiers) : son
 * chemin réel, et le type de ses entrées. Un fichier qui n'est pas un lien a pour chemin réel celui de son dossier
 * suivi de son nom ; un lien est résolu en entier. Les dossiers sont lus d'abord, tous ensemble : les fichiers se
 * vérifient ensuite sans attente, sauf les liens.
 */
async function realPaths(files: readonly string[], realpath: Realpath, readdir: Readdir): Promise<Map<string, string | null>> {
  const dirs = new Map<string, { real: string; entries: Map<string, boolean> } | null>();
  for (const f of files) dirs.set(path.dirname(f), null);
  await eachLimited([...dirs.keys()], async (dir) => {
    try {
      const [real, list] = await Promise.all([realpath(dir), readdir(dir)]);
      dirs.set(dir, { real, entries: new Map(list.map((e) => [e.name, e.isSymbolicLink()])) });
    } catch {
      // Dossier introuvable ou illisible : ses fichiers n'existent pas.
    }
  });
  const out = new Map<string, string | null>();
  const links: string[] = [];
  for (const f of files) {
    const name = path.basename(f);
    const d = dirs.get(path.dirname(f));
    const link = d?.entries.get(name);
    if (!d || link === undefined) out.set(f, null);
    else if (link) links.push(f);
    // Nom d'une entrée du dossier : ni séparateur, ni `.`, ni `..` ; seule la racine finit déjà par un séparateur.
    else out.set(f, d.real.endsWith(path.sep) ? d.real + name : d.real + path.sep + name);
  }
  await eachLimited(links, async (f) => {
    out.set(f, await realpath(f).catch(() => null));
  });
  return out;
}

/**
 * Seconde vérification des fichiers locaux d'un plugin de code limité, sur le chemin réel (liens symboliques résolus,
 * dossiers accordés compris) : un élément dont le fichier mène ailleurs est écarté, une image qui mène ailleurs est
 * retirée. Le code sensible n'est pas revérifié (il a déjà Node).
 */
export async function keepReal(
  elements: ElementInput[],
  level: PluginLevel,
  granted: readonly string[],
  realpath: Realpath = (p) => fsp.realpath(p),
  readdir: Readdir = (dir) => fsp.readdir(dir, { withFileTypes: true }),
): Promise<{ elements: ElementInput[]; dropped: number }> {
  if (level === 'privileged') return { elements, dropped: 0 };
  const IMAGES = ['poster', 'background', 'logo'] as const;
  // Une même image (affiche d'un dossier) sert à plusieurs éléments : vérifiée une fois.
  const files = new Set<string>();
  for (const e of elements) {
    const local = localPathOf(e.open);
    if (local !== null) files.add(local);
    for (const k of IMAGES) {
      const v = e.images[k];
      if (v && !isWebUrl(v)) files.add(v);
    }
  }
  const real = await realPaths([...files], realpath, readdir);
  // Dossiers accordés : d'abord ceux qui contiennent les fichiers, puis tous seulement si un fichier mène ailleurs (un
  // partage réseau absent, parmi les dossiers du plugin, ne fait pas attendre l'analyse des autres).
  const realRoots = async (list: readonly string[]) => (await Promise.all(list.map((g) => realpath(g).catch(() => null)))).filter((r): r is string => !!r);
  const dirs = new Set([...files].map((f) => path.dirname(f)));
  const holds = (g: string) => {
    const inside = insideGranted([g]);
    for (const d of dirs) if (inside(d)) return true;
    return false;
  };
  const checked = new Map<string, boolean>();
  const check = (inRoots: (p: string) => boolean) => {
    for (const [f, to] of real) if (!checked.get(f)) checked.set(f, !!to && inRoots(to));
  };
  check(insideGranted(await realRoots(granted.filter(holds))));
  if ([...checked.values()].includes(false)) check(insideGranted(await realRoots(granted)));
  const ok = (p: string): boolean => checked.get(p) === true;
  const out: ElementInput[] = [];
  for (const e of elements) {
    const local = localPathOf(e.open);
    if (local !== null && !ok(local)) continue;
    const images = { ...e.images };
    for (const k of IMAGES) {
      const v = images[k];
      if (v && !isWebUrl(v) && !ok(v)) delete images[k];
    }
    out.push({ ...e, images });
  }
  return { elements: out, dropped: elements.length - out.length };
}

/** Message d'un plugin (texte de son catalogue, montré tel quel), borné ; à défaut, celui de l'erreur. */
const pluginMessage = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null);

/** Ce qu'il manque pour interroger la source d'un plugin : deux textes, ou `null`. */
export function checkMissing(raw: unknown): { skipped: string; error: string } | null {
  if (!isObject(raw)) return null;
  const skipped = pluginMessage(raw.skipped);
  const error = pluginMessage(raw.error);
  return skipped && error ? { skipped, error } : null;
}

/** Adresse d'image qu'un plugin peut faire copier : `https:`, vers un hôte qu'il a déclaré. */
export function imageAllowed(url: string, hosts: readonly string[]): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && hostDeclared(hosts, u.hostname);
  } catch {
    return false;
  }
}

/** Nombre d'images copiées gardées en mémoire (une même affiche pour tous les épisodes d'une série). */
const IMAGE_MEMORY = 500;

const field = (item: unknown, k: string): string => {
  const v = isObject(item) ? item[k] : undefined;
  return typeof v === 'string' ? v : '';
};

/**
 * Clé d'une fiche, la même que celle des fournisseurs du cœur pour cette nature (`v:<chemin>` pour une vidéo…) : la
 * fiche rejoint ainsi son élément (`catalog/legacy-meta.ts`), et celle d'un fournisseur du cœur devenu un plugin
 * (TMDB, P5-15) est reprise sans nouvelle récupération. `null` si l'élément n'a pas ce qu'il faut.
 */
export function factsKey(kind: MetadataKind, item: unknown): string | null {
  const v = kind === 'album' ? field(item, 'dir') : kind === 'pc' ? fold(field(item, 'name')) : field(item, 'path');
  if (!v) return null;
  return `${{ video: 'v', album: 'a', rom: 'r', pc: 'g' }[kind]}:${v}`;
}

const GROUPS: Record<MetadataKind, ScrapeGroup> = { video: 'videos', album: 'music', rom: 'games', pc: 'games' };

/**
 * Jeux que le cœur rassemble lui-même pour un fournisseur d'infos (P5-16) : jeux PC de l'interface, sinon ceux de la
 * configuration (un même nom une fois) ; jeux des consoles dont le système est reconnu, chacun avec sa console.
 * `null` pour les autres natures (vidéos, albums : le plugin les rassemble d'après ce qu'envoie l'interface). Le cœur
 * garde ces éléments complets (clés des fiches) ; le plugin n'en reçoit que `gameForPlugin`.
 */
export async function coreGames(kind: MetadataKind, opts: RunOptions, ctx: ProviderContext): Promise<ScrapeItem[] | null> {
  if (kind === 'pc') {
    const seen = new Set<string>();
    return (opts.pcGames ?? ctx.getConfig().games).filter((g) => {
      const k = factsKey('pc', g);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (kind !== 'rom') return null;
  const items: ScrapeItem[] = [];
  for (const emu of ctx.getConfig().emulators) {
    if (!guessSystem(emu)) continue;
    const r = await ctx.listRoms(emu.id);
    if (!r?.ok) continue;
    for (const rom of r.roms || []) items.push({ ...rom, emu: emu.id });
  }
  return items;
}

const STEAM_APP = /^steam:\/\/rungameid\/(\d+)/i;

/**
 * Ce qu'un plugin reçoit d'un jeu (P5-16) : son nom (sans dossier), sa console et le système libretro de celle-ci, ou
 * l'identifiant Steam d'un jeu PC ; jamais son chemin (la clé de la fiche, qui le contient, est calculée par le cœur).
 * Les vidéos et les albums passent tels quels.
 */
export function gameForPlugin(kind: MetadataKind, item: unknown, config: ScrapeConfig): unknown {
  if (kind !== 'pc' && kind !== 'rom') return item;
  const name = path.win32.basename(field(item, 'name')).slice(0, BRIDGE_LIMITS.text);
  if (kind === 'pc') {
    const appid = STEAM_APP.exec(field(item, 'path'))?.[1];
    return { name, ...(appid ? { appid } : {}) };
  }
  const emu = field(item, 'emu');
  const owner = config.emulators.find((e) => e.id === emu);
  const displayName = field(item, 'displayName');
  return { name, ...(displayName ? { displayName: path.win32.basename(displayName) } : {}), emu, system: owner ? guessSystem(owner) : '' };
}

/** Fiche rendue par un plugin : les champs connus, d'un type attendu ; `source` est celle du plugin. */
export function checkFacts(source: string, raw: unknown): MetadataFacts | null | undefined {
  if (raw === null) return null;
  if (!isObject(raw) || !text(raw.title)) return undefined;
  const out: MetadataFacts = { title: raw.title, image: isWebUrl(raw.image) ? raw.image : null, source };
  for (const k of ['year', 'overview', 'genre', 'artist'] as const)
    if (typeof raw[k] === 'string') out[k] = (raw[k] as string).slice(0, BRIDGE_LIMITS.text * 4);
  if (isWebUrl(raw.backdrop)) out.backdrop = raw.backdrop;
  if (typeof raw.series === 'boolean') out.series = raw.series;
  if (raw.picked === true) out.picked = true;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Sous-titres (`subtitles`, P5-11b)

/** Bornes des sous-titres rendus par un plugin. */
export const SUBTITLE_LIMITS = Object.freeze({
  /** Sous-titres gardés par fournisseur. */
  results: 32,
  /** Libellé montré dans le choix des sous-titres. */
  label: 200,
  /** Taille d'un fichier de sous-titres, lu sur le disque ou téléchargé. */
  bytes: 4 * 1024 * 1024,
  /** Délais (ms) : recherche par le plugin, téléchargement d'une adresse. */
  findTimeout: 10000,
  downloadTimeout: 15000,
});

/** Sous-titre lu par le cœur : texte WebVTT, libellé (vide : « Sous-titres », écrit par la bibliothèque) et langue. */
export interface SubtitleText {
  label: string;
  lang: string;
  vtt: string;
}

/** Sous-titre rendu par un plugin, vérifié dans sa forme : un fichier local ou une adresse, jamais les deux. */
export type CheckedSubtitle = ({ path: string } | { url: string }) & { lang: string; label: string };

const SUBTITLE_EXTS = new Set(['.srt', '.vtt']);
const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

/** Libellé : une ligne de texte simple, sans caractères de contrôle, bornée. */
const plainLabel = (v: unknown): string =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
        .trim()
        .slice(0, SUBTITLE_LIMITS.label)
    : '';

/** Adresse de sous-titres qu'un plugin peut faire télécharger : `https:`, hôte déclaré, jamais le réseau local. */
export function subtitleUrlAllowed(url: unknown, hosts: readonly string[]): url is string {
  if (!text(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && !isLocalHost(u.hostname) && hostDeclared(hosts, u.hostname);
  } catch {
    return false;
  }
}

/**
 * Sous-titres rendus par un plugin, vérifiés dans leur forme : fichier `.srt` ou `.vtt` (chemin absolu) sous l'un des
 * dossiers `roots`, ou adresse permise (`subtitleUrlAllowed`) ; les autres sont écartés. Le chemin réel est vérifié
 * ensuite, à la lecture (`readSubtitle`).
 */
export function checkSubtitles(raw: unknown, roots: readonly string[], hosts: readonly string[]): CheckedSubtitle[] {
  if (!Array.isArray(raw)) throw new Error('find() must return an array of subtitles.');
  const out: CheckedSubtitle[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    if (out.length >= SUBTITLE_LIMITS.results) break;
    if (!isObject(s) || (s.path !== undefined && s.url !== undefined)) continue;
    const lang = typeof s.lang === 'string' && s.lang.length <= 35 && LANG_RE.test(s.lang) ? s.lang : '';
    const label = plainLabel(s.label);
    if (s.path !== undefined) {
      if (!text(s.path) || !path.isAbsolute(s.path) || !SUBTITLE_EXTS.has(path.extname(s.path).toLowerCase())) continue;
      const file = path.resolve(s.path);
      if (!roots.some((r) => isInside(file, [r])) || seen.has(file)) continue;
      seen.add(file);
      out.push({ path: file, lang, label });
    } else if (subtitleUrlAllowed(s.url, hosts) && !seen.has(s.url)) {
      seen.add(s.url);
      out.push({ url: s.url, lang, label });
    }
  }
  return out;
}

/** Texte WebVTT d'un fichier de sous-titres : `.vtt` tel quel, `.srt` converti ; sans extension connue, d'après son début. */
function toVtt(raw: Buffer, name: string): string {
  const text = decodeText(raw);
  const ext = path.extname(name).toLowerCase();
  if (ext === '.vtt' || (ext !== '.srt' && /^\uFEFF?WEBVTT/.test(text))) return text;
  return srtToVtt(text);
}

/** Corps d'une réponse, borné. */
async function readBody(res: Response, max: number): Promise<Buffer> {
  if (Number(res.headers.get('content-length')) > max || !res.body) {
    await res.body?.cancel().catch(() => {});
    throw new Error('subtitle file too large or empty');
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error('subtitle file too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Lit un sous-titre vérifié : le fichier doit rester sous les dossiers `roots` une fois les liens résolus ; une adresse
 * est téléchargée sans suivre de redirection (elle pourrait mener à un hôte non déclaré). `null` s'il est illisible.
 */
export async function readSubtitle(
  s: CheckedSubtitle,
  roots: readonly string[],
  { realpath = (p: string) => fsp.realpath(p), fetch }: { realpath?: Realpath; fetch?: FetchLike } = {},
): Promise<SubtitleText | null> {
  try {
    let raw: Buffer;
    let name: string;
    if ('path' in s) {
      const real = await realpath(s.path);
      const realRoots = (await Promise.all(roots.map((r) => realpath(r).catch(() => null)))).filter((r): r is string => !!r);
      if (!realRoots.some((r) => isInside(real, [r]))) return null;
      const st = await fsp.stat(real);
      if (!st.isFile() || st.size > SUBTITLE_LIMITS.bytes) return null;
      raw = await fsp.readFile(real);
      name = real;
    } else {
      const res = await request(s.url, { timeout: SUBTITLE_LIMITS.downloadTimeout, redirect: 'error', fetch });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      raw = await readBody(res, SUBTITLE_LIMITS.bytes);
      name = new URL(s.url).pathname;
    }
    return { label: s.label, lang: s.lang, vtt: toVtt(raw, name) };
  } catch {
    return null;
  }
}

/** Une analyse voulue : source, emplacement (`null` : sans emplacement) et référence au catalogue. */
interface Target {
  entry: ContributionEntry;
  location: SourceLocation | null;
  ref: ElementSourceRef;
}

const refId = (ref: ElementSourceRef) => JSON.stringify([ref.plugin, ref.instance]);
const entryId = (e: ContributionEntry) => JSON.stringify([e.pluginId, e.id]);
const print = (t: Target) => JSON.stringify([entryId(t.entry), t.location]);

export function createPluginBridges({
  service,
  catalog,
  log = (m) => console.error(m),
  platform = process.platform,
  realpath,
  fetch,
  onClaimsChange,
}: {
  service: BridgeService;
  catalog: BridgeCatalog;
  log?: (m: string) => void;
  platform?: NodeJS.Platform;
  realpath?: Realpath;
  /** fetch des sous-titres téléchargés (tests) ; par défaut le fetch global. */
  fetch?: FetchLike;
  /** Les emplacements de la bibliothèque pris par un plugin ont changé (la bibliothèque du cœur les laisse). */
  onClaimsChange?: () => void;
}) {
  let locations: KeyedLocation[] = [];
  /** Emplacement de la bibliothèque (clé) → source de plugin qui l'a accepté. */
  let assigned = new Map<string, { entry: ContributionEntry; location: SourceLocation }>();
  /** Analyses voulues à cet instant, par référence au catalogue. */
  let wanted = new Map<string, Target>();
  /** Analyses arrivées au catalogue : référence → empreinte (source et emplacement) de la dernière analyse. */
  const scanned = new Map<string, { ref: ElementSourceRef; print: string }>();
  /** Analyses en cours : référence → empreinte et fin de l'analyse. */
  const running = new Map<string, { print: string; done: Promise<void> }>();
  let queue: Promise<void> = Promise.resolve();

  /**
   * Dossiers d'un plugin : accordés par l'utilisateur (`ctx.files.requestFolder`), et ceux de la bibliothèque ou des
   * jeux qu'il lit (avec le dossier des jaquettes d'une console).
   */
  const assignedFolders = (pluginId: string): string[] =>
    [...assigned.values()].flatMap((a) => (a.entry.pluginId === pluginId ? [a.location.path, a.location.console?.images].filter((d): d is string => !!d) : []));
  const granted = (pluginId: string): string[] => [...new Set([...service.folders(pluginId), ...assignedFolders(pluginId)])];
  /** Consoles des dossiers de jeux proposés : les seules qu'un jeu d'un plugin de code limité peut désigner. */
  const knownConsoles = (): Set<string> => new Set(locations.flatMap((l) => (l.location.console ? [l.location.console.id] : [])));

  /** Dossiers prêtés le temps d'une recherche de sous-titres : plugin → un dossier par appel en cours. */
  const lent = new Map<string, string[]>();
  const lentFolders = (pluginId: string): string[] => [...new Set(lent.get(pluginId) ?? [])];
  function lend(pluginId: string, dir: string): () => void {
    lent.set(pluginId, [...(lent.get(pluginId) ?? []), dir]);
    return () => {
      const list = lent.get(pluginId) ?? [];
      list.splice(list.indexOf(dir), 1);
      if (!list.length) lent.delete(pluginId);
    };
  }

  /** Sous-titres d'un fournisseur pour une vidéo autorisée ; son dossier est prêté pendant l'appel (`folders`). */
  async function subtitlesOf(e: ContributionEntry, videoPath: string): Promise<SubtitleText[]> {
    const rights = service.sourceRights(e.pluginId);
    const dir = path.dirname(videoPath);
    const release = rights.folders ? lend(e.pluginId, dir) : () => {};
    let found: CheckedSubtitle[];
    let roots: string[] = [];
    try {
      const raw = await service.call(e.pluginId, 'subtitles', e.id, 'find', [videoPath], { timeout: SUBTITLE_LIMITS.findTimeout });
      roots = rights.folders ? [...new Set([...granted(e.pluginId), dir])] : [];
      found = checkSubtitles(raw, roots, service.hosts(e.pluginId));
    } finally {
      release();
    }
    const read = await Promise.all(found.map((s) => readSubtitle(s, roots, { realpath, fetch })));
    return read.filter((s): s is SubtitleText => s !== null);
  }

  /** Un dossier ne va qu'à un plugin de confiance qui déclare `folders` ; une adresse, à un plugin de confiance. */
  function mayReceive(e: ContributionEntry, location: SourceLocation): boolean {
    const rights = service.sourceRights(e.pluginId);
    return rights.trusted && (!location.path || rights.folders);
  }

  async function accepts(e: ContributionEntry, location: SourceLocation): Promise<boolean> {
    try {
      return (await service.call(e.pluginId, 'sources', e.id, 'handles', [location], { timeout: BRIDGE_LIMITS.handlesTimeout })) === true;
    } catch {
      return false;
    }
  }

  /** Attribue chaque emplacement à la première source qui l'accepte ; une attribution encore valable est gardée. */
  async function assign(current: ContributionEntry[]): Promise<boolean> {
    const active = new Map(current.map((e) => [entryId(e), e]));
    const next = new Map<string, { entry: ContributionEntry; location: SourceLocation }>();
    for (const { key, location } of locations) {
      const prev = assigned.get(key);
      const still = prev && active.get(entryId(prev.entry));
      if (still && mayReceive(still, location)) {
        next.set(key, { entry: still, location });
        continue;
      }
      for (const e of current) {
        if (!mayReceive(e, location) || !(await accepts(e, location))) continue;
        next.set(key, { entry: e, location });
        break;
      }
    }
    const owners = (m: typeof next) => JSON.stringify([...m].map(([k, a]) => [k, entryId(a.entry)]));
    const changed = owners(next) !== owners(assigned);
    assigned = next;
    return changed;
  }

  /** L'analyse `t` est-elle encore voulue (source active, même emplacement) ? */
  const current = (t: Target): boolean => {
    const w = wanted.get(refId(t.ref));
    return !!w && print(w) === print(t);
  };

  /**
   * Lance l'analyse `t` ; une analyse déjà en cours pour le même emplacement est attendue plutôt que relancée, même
   * pour `rescan` (elle a commencé après les changements qui l'ont demandée, ou en même temps : deux parcours du même
   * dossier ne verraient rien de plus).
   */
  function scan(t: Target): Promise<void> {
    const k = refId(t.ref);
    const now = running.get(k);
    if (now && now.print === print(t)) return now.done;
    const done = runScan(t).finally(() => {
      if (running.get(k)?.done === done) running.delete(k);
    });
    running.set(k, { print: print(t), done });
    return done;
  }

  async function runScan(t: Target): Promise<void> {
    const { entry: e, ref } = t;
    const level = service.levelOf(e.pluginId);
    if (!level) return;
    const where = `${e.pluginId} (sources/${e.id}${t.location ? ` : ${t.location.location}` : ''})`;
    try {
      const timeout = t.location ? BRIDGE_LIMITS.locationScanTimeout : BRIDGE_LIMITS.scanTimeout;
      const raw = await service.call(e.pluginId, 'sources', e.id, 'scan', [t.location], { timeout });
      // Désactivé ou emplacement retiré pendant l'analyse : rien n'est ajouté.
      if (!current(t)) return;
      const folders = granted(e.pluginId);
      const rights = { launch: service.sourceRights(e.pluginId).launch === true, consoles: knownConsoles() };
      const written = checkElements(e.pluginId, level, folders, raw, platform, rights);
      const real = await keepReal(written.elements, level, folders, realpath);
      if (!current(t)) return;
      const dropped = written.dropped + real.dropped;
      if (dropped) log(`Plugins : ${where} : ${dropped} élément(s) écarté(s) (invalides ou non permis).`);
      catalog.setSource(ref, real.elements);
      scanned.set(refId(ref), { ref, print: print(t) });
    } catch (err) {
      // Le catalogue garde la dernière analyse ; une panne du plugin le désactive (service).
      log(`Plugins : analyse de ${where} impossible : ${(err as Error)?.message ?? err}`);
    }
  }

  /** Attribution et catalogue à jour ; rend les analyses lancées (elles ne bloquent pas la synchronisation suivante). */
  async function syncSources(force: boolean): Promise<Promise<void>[]> {
    const active = service.contributions('sources');
    const claimsChanged = await assign(active);
    const next = new Map<string, Target>();
    for (const [key, a] of assigned)
      next.set(refId({ plugin: a.entry.pluginId, instance: key }), { entry: a.entry, location: a.location, ref: { plugin: a.entry.pluginId, instance: key } });
    const withLocation = new Set([...assigned.values()].map((a) => entryId(a.entry)));
    for (const e of active) {
      if (withLocation.has(entryId(e))) continue;
      const ref = { plugin: e.pluginId, instance: e.id };
      next.set(refId(ref), { entry: e, location: null, ref });
    }
    wanted = next;
    for (const [k, { ref }] of [...scanned]) {
      if (next.has(k)) continue;
      scanned.delete(k);
      catalog.removeSource(ref);
    }
    if (claimsChanged) onClaimsChange?.();
    // Nouvelles analyses, ou celles déjà en cours : la promesse de `sync` ne se résout qu'une fois tout arrivé.
    const due = ([k, t]: [string, Target]) => force || scanned.get(k)?.print !== print(t);
    return [...next].filter(due).map(([, t]) => scan(t));
  }

  /**
   * Les synchronisations se suivent : une attribution ne se calcule jamais pendant une autre. La promesse rendue se
   * résout quand les analyses lancées sont finies.
   */
  function sync(force = false): Promise<void> {
    const step = queue.then(() => syncSources(force));
    queue = step.then(
      () => {},
      (err) => log(`Plugins : sources : ${(err as Error)?.message ?? err}`),
    );
    return step.then(
      (scans) => Promise.all(scans).then(() => {}),
      () => {},
    );
  }

  // Images copiées, par adresse : la même image n'est téléchargée qu'une fois, et garde le même fichier.
  const images = new Map<string, Promise<string | null>>();
  function saveImage(url: string, job: JobContext): Promise<string | null> {
    let saved = images.get(url);
    if (!saved) {
      if (images.size >= IMAGE_MEMORY) images.clear();
      saved = job.io.saveImage(url, `plugin-image|${url}`).catch(() => null);
      images.set(url, saved);
      // Échec : un nouvel essai à la prochaine fiche.
      void saved.then((file) => (file ? undefined : images.delete(url)));
    }
    return saved;
  }

  /** Fiche d'un plugin, avec ses images copiées (celles d'un hôte non déclaré sont écartées). */
  async function withImages(pluginId: string, facts: MetadataFacts | null | undefined, job: JobContext): Promise<MetadataFacts | null | undefined> {
    if (!facts) return facts;
    const hosts = service.hosts(pluginId);
    const copy = (url: string | null | undefined) => (url && imageAllowed(url, hosts) ? saveImage(url, job) : Promise.resolve(null));
    const [image, backdrop] = await Promise.all([copy(facts.image), copy(facts.backdrop)]);
    return { ...facts, image, ...(facts.backdrop !== undefined ? { backdrop } : {}) };
  }

  /** Adaptateur d'une contribution `metadata` pour le moteur d'infos en ligne. */
  function metadataProvider(e: ContributionEntry): MetadataProvider {
    const kinds = ((e.declaration.kinds as MetadataKind[] | undefined) ?? []).filter((k) => Object.hasOwn(GROUPS, k));
    const source = `${e.pluginId}/${e.id}`;
    const kind = kinds[0] ?? 'video';
    const forPlugin = (item: unknown, ctx: ProviderContext) => (kind === 'pc' || kind === 'rom' ? gameForPlugin(kind, item, ctx.getConfig()) : item);
    const call = (method: string, args: unknown[]) => service.call(e.pluginId, 'metadata', e.id, method, args, { timeout: BRIDGE_LIMITS.metadataTimeout });
    // Échec rendu par le plugin (clé refusée, service injoignable) : un message pour l'utilisateur.
    const ask = async (method: string, args: unknown[]): Promise<unknown> => {
      const raw = await call(method, args);
      const failure = isObject(raw) ? pluginMessage(raw.failure) : null;
      if (failure) throw new ScrapeRefusal(failure);
      return raw;
    };
    return {
      id: source,
      kinds,
      group: GROUPS[kinds[0] ?? 'video'],
      concurrency: 2,
      // Sans `requires` (ou en panne), le plugin est interrogé : ses erreurs diront ce qui ne va pas.
      requires: async () => checkMissing(await call('requires', []).catch(() => null)),
      // Clé de la fiche : celle du cœur pour la nature décrite ; à défaut, propre au plugin (elle ne rejoint alors
      // aucun élément, mais reste gardée).
      key: (item) =>
        factsKey(kinds[0] ?? 'video', item) ?? `plugin:${source}|${String((item as { key?: unknown })?.key ?? (item as { path?: unknown })?.path ?? '')}`,
      // Jeux : rassemblés par le cœur (`coreGames`) ; le reste, par le plugin.
      collect: async (opts, ctx) => {
        const games = await coreGames(kind, opts ?? {}, ctx);
        if (games) return games.slice(0, BRIDGE_LIMITS.elements);
        const items = await call('collect', [opts ?? {}]);
        return Array.isArray(items) ? items.slice(0, BRIDGE_LIMITS.elements) : [];
      },
      scrape: async (item, override, job) => withImages(e.pluginId, checkFacts(source, await ask('scrape', [forPlugin(item, job), override ?? null])), job),
      byId: async (pick, item, job) => withImages(e.pluginId, checkFacts(source, await ask('byId', [pick, forPlugin(item, job)])), job),
      candidates: async (q, ctx) => {
        const list = await ask('candidates', [q?.item === undefined ? q : { ...q, item: forPlugin(q.item, ctx) }]);
        return Array.isArray(list)
          ? list
              .filter((c) => isObject(c) && text(c.id) && text(c.title))
              .slice(0, 100)
              .map((c) => ({
                id: c.id as string,
                title: c.title as string,
                year: typeof c.year === 'string' ? c.year : '',
                sub: typeof c.sub === 'string' ? c.sub : '',
                image: isWebUrl(c.image) ? c.image : null,
                // Vignette de secours si l'image manque (Steam), comme `image` : une adresse web montrée telle quelle.
                ...(isWebUrl(c.fallback) ? { fallback: c.fallback } : {}),
              }))
          : [];
      },
    } as MetadataProvider;
  }

  const unsubscribe = service.onContributionsChange((kinds) => {
    if (kinds.includes('sources')) void sync();
  });
  void sync();

  return {
    /** Fournisseurs d'infos en ligne des plugins actifs (`extraProviders` du moteur). */
    metadataProviders: (): MetadataProvider[] => service.contributions('metadata').map(metadataProvider),

    /** Interroge les fournisseurs de recherche actifs ; un fournisseur en échec est omis. */
    async search(query: string): Promise<{ pluginId: string; id: string; result: unknown }[]> {
      const q = String(query ?? '')
        .trim()
        .slice(0, BRIDGE_LIMITS.text);
      if (!q) return [];
      const runs = service.contributions('search').map(async (e) => {
        const result = await service.call(e.pluginId, 'search', e.id, 'search', [q], { timeout: BRIDGE_LIMITS.searchTimeout });
        if (Buffer.byteLength(JSON.stringify(result) ?? '') > BRIDGE_LIMITS.searchBytes) throw new Error('search result too large');
        return { pluginId: e.pluginId, id: e.id, result };
      });
      const settled = await Promise.allSettled(runs);
      return settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    },

    /**
     * Sous-titres d'une vidéo locale, que l'appelant a déjà vérifiée avec la politique d'accès de l'interface (chemin
     * absolu) : ceux des fournisseurs actifs des plugins inclus ou du dépôt officiel ; un fournisseur en échec est omis.
     */
    async subtitles(videoPath: string): Promise<SubtitleText[]> {
      if (!text(videoPath) || !path.isAbsolute(videoPath)) return [];
      const runs = service
        .contributions('subtitles')
        .filter((e) => service.sourceRights(e.pluginId).trusted)
        .map((e) =>
          subtitlesOf(e, videoPath).catch((err) => {
            log(`Plugins : sous-titres de ${e.pluginId} (subtitles/${e.id}) impossibles : ${(err as Error)?.message ?? err}`);
            return [];
          }),
        );
      return (await Promise.all(runs)).flat();
    },
    /** Dossiers prêtés à ce plugin le temps d'une recherche de sous-titres. */
    lentFolders,

    /** Analyse de nouveau les sources des plugins actifs. */
    rescan: (): Promise<void> => sync(true),
    /**
     * Analyse de nouveau ces emplacements seulement (clés), avec la source qui les a pris, après les synchronisations
     * en cours (liste des jeux d'une console, P5-14a) ; un emplacement qu'aucune source n'a pris est ignoré.
     */
    async rescanLocations(keys: readonly string[]): Promise<void> {
      await queue;
      const set = new Set(keys);
      await Promise.all([...wanted.values()].filter((t) => t.location && set.has(t.ref.instance)).map((t) => scan(t)));
    },

    /** Emplacements de la bibliothèque (configuration) : redistribués aux sources ; seuls les nouveaux ou changés sont analysés. */
    setLocations(list: readonly KeyedLocation[]): Promise<void> {
      locations = list.map((l) => ({ key: l.key, location: structuredClone(l.location) }));
      return sync();
    },
    /** Vrai si un plugin lit cet emplacement de la bibliothèque (instance du cœur) : la bibliothèque du cœur le laisse. */
    claimed: (key: string): boolean => assigned.has(key),
    /** Dossiers de la bibliothèque lus par ce plugin : accordés tant qu'ils restent dans la configuration. */
    assignedFolders,
    /** Fin des synchronisations en cours (tests, et la liste des jeux d'une console au démarrage). */
    idle: (): Promise<void> => queue,

    stop: unsubscribe,
  };
}

export type PluginBridges = ReturnType<typeof createPluginBridges>;
