/**
 * Vue web (P4-16), sans DOM : la barre d'un site rédigée d'après l'état publié par le processus principal
 * (`web-state`) et la page d'où vient une vue. Testé sous `node:test` (`test/renderer/web.test.ts`).
 */
import type { WebBarView, WebViewKind } from '@mire/ui/utils';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const KINDS: readonly WebViewKind[] = ['site', 'rom', 'bookmark', 'tv'];

/** Genre publié, sinon déduit du préfixe de l'identifiant (état d'une version précédente). */
export function kindOf(id: string, published: unknown): WebViewKind {
  if (KINDS.includes(published as WebViewKind)) return published as WebViewKind;
  if (id.startsWith('rom:')) return 'rom';
  if (id.startsWith('bm:')) return 'bookmark';
  if (id.startsWith('tv:')) return 'tv';
  return 'site';
}

/** Page d'où vient une vue web : Jeux pour les sites de jeux, Télévision pour les portails TV, sinon Streaming. */
export function webHome(id: unknown): 'games' | 'tv' | 'streaming' {
  const kind = kindOf(String(id ?? ''), null);
  return kind === 'rom' ? 'games' : kind === 'tv' ? 'tv' : 'streaming';
}

/** Libellé du bouclier : désactivé sur ce site, ou nombre d'éléments bloqués. */
export function adLabel(t: Translate, on: boolean, blocked: number): string {
  return on ? t('webView.bar.adBlocked', { count: blocked }) : t('webView.bar.adOff');
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Barre d'un site d'après son état publié. Nom et couleur viennent du processus principal (entrée résolue, couleur
 * contrôlée) : l'interface ne relit pas la configuration. `adblock` : bloqueur allumé dans les réglages.
 */
export function webBarView(state: Record<string, unknown> | null | undefined, opts: { t: Translate; adblock: boolean }): WebBarView | null {
  if (!state || typeof state.id !== 'string') return null;
  const { t } = opts;
  const id = state.id;
  const kind = kindOf(id, state.kind);
  const rom = kind === 'rom' && state.rom && typeof state.rom === 'object' ? (state.rom as Record<string, unknown>) : null;
  const sites = rom && Array.isArray(rom.sites) ? (rom.sites as { name?: unknown }[]).map((s) => text(s?.name)) : [];
  const on = state.adOn !== false;
  const blocked = num(state.blocked);
  const label = adLabel(t, on, blocked);
  return {
    id,
    kind,
    name: text(state.name),
    color: text(state.color),
    title: rom ? '' : text(state.title),
    loading: !!state.loading,
    canGoBack: !!state.canGoBack,
    canGoForward: !!state.canGoForward,
    hasSearch: !!state.hasSearch,
    adblock: opts.adblock ? { on, blocked, label, title: t('webView.bar.adHint', { state: label }) } : null,
    rom: rom ? { sites, site: num(rom.site) } : null,
  };
}
