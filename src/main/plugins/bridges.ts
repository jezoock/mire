/**
 * Branchements des contributions de code qui ont besoin du contexte (P3-04, reportés de P3-03) :
 *
 * - `sources` → catalogue : chaque source active est analysée à son activation (et sur demande, `rescan`), ses
 *   éléments vont au catalogue sous `{ plugin: <id du plugin>, instance: <id de la contribution> }`, et le quittent à
 *   sa désactivation. Les emplacements configurés par l'utilisateur viendront avec les réglages des plugins (P4-20) :
 *   la source reçoit `null` en attendant.
 * - `metadata` → moteur d'infos en ligne (`scrape/engine.ts`, `extraProviders`), après les quatre fournisseurs du cœur.
 * - `search` → `search(query)` : interroge les fournisseurs actifs en parallèle (l'écran Recherche, P4-12, les
 *   affichera).
 *
 * Ce qu'un plugin rend est vérifié ici, d'après son niveau (jamais d'après ce que dit le résultat) : un plugin de code
 * limité ne peut pas fournir un élément qui lance un programme ou un jeu (permission « programmes », code sensible),
 * ni un fichier local hors des dossiers que l'utilisateur lui a accordés ; ses clés sont préfixées par `plugin:<id>|`
 * pour ne jamais prendre la place d'un élément du cœur ou d'un autre plugin.
 */
import path from 'node:path';
import type { ContributionKind, ElementInput, InfoValue, MetadataFacts, MetadataKind, OpenSpec, PluginLevel } from '@mire/plugin-sdk';
import type { ElementSourceRef } from '@mire/shared';
import { isInside } from '../lib/paths.ts';
import type { MetadataProvider, ScrapeGroup } from '../scrape/types.ts';
import type { ContributionEntry } from './registry.ts';

/** Bornes des résultats rendus par un plugin. */
export const BRIDGE_LIMITS = Object.freeze({
  /** Éléments d'une analyse. */
  elements: 50000,
  /** Texte (clé, nom, adresse, info). */
  text: 4096,
  /** Résultat d'une recherche, en JSON. */
  searchBytes: 1024 * 1024,
  /** Délais (ms) : analyse d'une source, recherche, infos en ligne. */
  scanTimeout: 60000,
  searchTimeout: 10000,
  metadataTimeout: 30000,
});

export interface BridgeService {
  contributions(kind: ContributionKind): ContributionEntry[];
  onContributionsChange(listener: (kinds: ContributionKind[]) => void): () => void;
  call(pluginId: string, kind: ContributionKind, contributionId: string, method: string, args?: unknown[], options?: { timeout?: number }): Promise<unknown>;
  levelOf(id: string): PluginLevel | null;
  folders(id: string): string[];
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

/** Comment ouvrir un élément d'un plugin, s'il en a le droit ; `null` sinon. */
function openSpec(raw: unknown, level: PluginLevel, granted: string[]): OpenSpec | null {
  if (!isObject(raw)) return null;
  const sensitive = level === 'privileged';
  switch (raw.kind) {
    case 'site':
      return isWebUrl(raw.url) ? { kind: 'site', url: raw.url, ...(text(raw.site) ? { site: raw.site } : {}) } : null;
    case 'stream': {
      if (!isWebUrl(raw.url)) return null;
      const variants = Array.isArray(raw.variants)
        ? raw.variants.filter((v): v is { label: string; url: string } => isObject(v) && text(v.label) && isWebUrl(v.url)).map((v) => ({ label: v.label, url: v.url }))
        : [];
      return { kind: 'stream', url: raw.url, ...(variants.length ? { variants } : {}) };
    }
    case 'file':
      if (isWebUrl(raw.path)) return { kind: 'file', path: raw.path };
      if (!text(raw.path) || !path.isAbsolute(raw.path)) return null;
      return sensitive || granted.some((g) => path.resolve(raw.path as string) === path.resolve(g) || isInside(raw.path, [g])) ? { kind: 'file', path: raw.path } : null;
    case 'game':
    case 'program':
      // Lancer un programme ou un émulateur : permission sensible, code sensible seulement.
      if (!sensitive || !text(raw.path)) return null;
      if (raw.kind === 'game') return text(raw.console) ? { kind: 'game', console: raw.console, path: raw.path } : null;
      return { kind: 'program', path: raw.path, ...(Array.isArray(raw.args) ? { args: raw.args.filter((a): a is string => typeof a === 'string') } : {}) };
    default:
      return null;
  }
}

/** Éléments rendus par la source d'un plugin, vérifiés ; ceux qui ne passent pas sont écartés. */
export function checkElements(pluginId: string, level: PluginLevel, granted: string[], raw: unknown): { elements: ElementInput[]; dropped: number } {
  if (!Array.isArray(raw)) throw new Error('scan() must return an array of elements.');
  if (raw.length > BRIDGE_LIMITS.elements) throw new Error(`scan() returned more than ${BRIDGE_LIMITS.elements} elements.`);
  const prefix = level === 'privileged' ? '' : `plugin:${pluginId}|`;
  const elements: ElementInput[] = [];
  for (const e of raw) {
    const open = isObject(e) ? openSpec(e.open, level, granted) : null;
    if (!isObject(e) || !text(e.key) || !text(e.name) || !open) continue;
    const infos: Record<string, InfoValue> = {};
    if (isObject(e.infos)) {
      for (const [k, v] of Object.entries(e.infos)) {
        const iv = infoValue(v);
        if (iv !== undefined && text(k)) infos[k] = iv;
      }
    }
    const images: ElementInput['images'] = {};
    if (isObject(e.images)) for (const k of ['poster', 'background', 'logo'] as const) if (isWebUrl(e.images[k])) images[k] = e.images[k] as string;
    elements.push({
      key: `${prefix}${e.key}`,
      name: e.name,
      open,
      tags: Array.isArray(e.tags) ? e.tags.filter(text) : [],
      infos,
      images,
    });
  }
  return { elements, dropped: raw.length - elements.length };
}

const GROUPS: Record<MetadataKind, ScrapeGroup> = { video: 'videos', album: 'music', rom: 'games', pc: 'games' };

/** Fiche rendue par un plugin : les champs connus, d'un type attendu ; `source` est celle du plugin. */
export function checkFacts(source: string, raw: unknown): MetadataFacts | null | undefined {
  if (raw === null) return null;
  if (!isObject(raw) || !text(raw.title)) return undefined;
  const out: MetadataFacts = { title: raw.title, image: isWebUrl(raw.image) ? raw.image : null, source };
  for (const k of ['year', 'overview', 'genre', 'artist'] as const) if (typeof raw[k] === 'string') out[k] = (raw[k] as string).slice(0, BRIDGE_LIMITS.text * 4);
  if (isWebUrl(raw.backdrop)) out.backdrop = raw.backdrop;
  if (typeof raw.series === 'boolean') out.series = raw.series;
  return out;
}

export function createPluginBridges({ service, catalog, log = (m) => console.error(m) }: { service: BridgeService; catalog: BridgeCatalog; log?: (m: string) => void }) {
  const scanned = new Map<string, ElementSourceRef>();
  const refKey = (e: ContributionEntry) => `${e.pluginId}\u0000${e.id}`;

  async function scan(e: ContributionEntry): Promise<void> {
    const ref: ElementSourceRef = { plugin: e.pluginId, instance: e.id };
    const level = service.levelOf(e.pluginId);
    if (!level) return;
    try {
      const raw = await service.call(e.pluginId, 'sources', e.id, 'scan', [null], { timeout: BRIDGE_LIMITS.scanTimeout });
      // Désactivé pendant l'analyse : rien n'est ajouté.
      if (!service.contributions('sources').some((x) => refKey(x) === refKey(e))) return;
      const { elements, dropped } = checkElements(e.pluginId, level, service.folders(e.pluginId), raw);
      if (dropped) log(`Plugins : ${e.pluginId} (sources/${e.id}) : ${dropped} élément(s) écarté(s) (invalides ou non permis).`);
      catalog.setSource(ref, elements);
      scanned.set(refKey(e), ref);
    } catch (err) {
      // Le catalogue garde la dernière analyse ; une panne du plugin le désactive (service).
      log(`Plugins : analyse de ${e.pluginId} (sources/${e.id}) impossible : ${(err as Error)?.message ?? err}`);
    }
  }

  function syncSources(): void {
    const current = service.contributions('sources');
    const keys = new Set(current.map(refKey));
    for (const [k, ref] of [...scanned]) {
      if (keys.has(k)) continue;
      scanned.delete(k);
      catalog.removeSource(ref);
    }
    for (const e of current) if (!scanned.has(refKey(e))) void scan(e);
  }

  /** Adaptateur d'une contribution `metadata` pour le moteur d'infos en ligne. */
  function metadataProvider(e: ContributionEntry): MetadataProvider {
    const kinds = ((e.declaration.kinds as MetadataKind[] | undefined) ?? []).filter((k) => Object.hasOwn(GROUPS, k));
    const source = `${e.pluginId}/${e.id}`;
    const call = (method: string, args: unknown[]) => service.call(e.pluginId, 'metadata', e.id, method, args, { timeout: BRIDGE_LIMITS.metadataTimeout });
    return {
      id: source,
      kinds,
      group: GROUPS[kinds[0] ?? 'video'],
      concurrency: 2,
      // Clé de la fiche : propre au plugin, d'après la clé de l'élément.
      key: (item) => `plugin:${source}|${String((item as { key?: unknown })?.key ?? (item as { path?: unknown })?.path ?? '')}`,
      collect: async (opts) => {
        const items = await call('collect', [opts ?? {}]);
        return Array.isArray(items) ? items.slice(0, BRIDGE_LIMITS.elements) : [];
      },
      scrape: async (item, override) => checkFacts(source, await call('scrape', [item, override ?? null])),
      byId: async (pick, item) => checkFacts(source, await call('byId', [pick, item])),
      candidates: async (q) => {
        const list = await call('candidates', [q]);
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
              }))
          : [];
      },
    } as MetadataProvider;
  }

  const unsubscribe = service.onContributionsChange((kinds) => {
    if (kinds.includes('sources')) syncSources();
  });
  syncSources();

  return {
    /** Fournisseurs d'infos en ligne des plugins actifs (`extraProviders` du moteur). */
    metadataProviders: (): MetadataProvider[] => service.contributions('metadata').map(metadataProvider),

    /** Interroge les fournisseurs de recherche actifs ; un fournisseur en échec est omis. */
    async search(query: string): Promise<{ pluginId: string; id: string; result: unknown }[]> {
      const q = String(query ?? '').trim().slice(0, BRIDGE_LIMITS.text);
      if (!q) return [];
      const runs = service.contributions('search').map(async (e) => {
        const result = await service.call(e.pluginId, 'search', e.id, 'search', [q], { timeout: BRIDGE_LIMITS.searchTimeout });
        if (Buffer.byteLength(JSON.stringify(result) ?? '') > BRIDGE_LIMITS.searchBytes) throw new Error('search result too large');
        return { pluginId: e.pluginId, id: e.id, result };
      });
      const settled = await Promise.allSettled(runs);
      return settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    },

    /** Analyse de nouveau les sources des plugins actifs. */
    rescan: (): Promise<void> => Promise.all(service.contributions('sources').map(scan)).then(() => {}),

    stop: unsubscribe,
  };
}

export type PluginBridges = ReturnType<typeof createPluginBridges>;
