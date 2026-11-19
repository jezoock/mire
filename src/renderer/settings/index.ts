/**
 * Réglages de la coquille (P4-20), côté page : l'hôte `<mire-settings>` et sa vue (`mire-settings-view`), rendue
 * d'après le schéma des réglages et les manifestes des plugins (`model.ts`). Chaque champ changé est enregistré aussitôt
 * (`onChange`) ; le texte à ajouter à une liste et celui de l'éditeur JSON sont gardés ici (`draft`) jusqu'au bouton.
 */
import type { PluginSettingsInfo } from '@mire/shared/ipc';
import { settingsDomId } from '@mire/ui/utils';
import { settingsLabels, settingsPanels } from './model.ts';
import type { PanelSources } from './model.ts';

export {
  METADATA_PROVIDERS,
  PALETTES,
  adblockStatusText,
  advancedJson,
  drmStatusText,
  fieldView,
  pluginPanels,
  providerOrder,
  schemaPanels,
  settingsLabels,
  settingsPanels,
} from './model.ts';
export type { AdblockState, PanelSources } from './model.ts';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface SettingsOptions {
  t: Translate;
  /** Ce que les panneaux affichent (configuration, langues, listes de l'accueil, informations) ; les plugins à part. */
  sources(): Omit<PanelSources, 't' | 'plugins'>;
  plugins(): Promise<PluginSettingsInfo[]>;
  /** Un champ a changé (clé : chemin de la configuration ou `plugin:<id>:<réglage>`). */
  onChange(key: string, value: string | boolean): Promise<unknown>;
  /** Nouvel ordre d'une liste (`rows`, `bars`, `sites`, `providers`). */
  onOrder(kind: string, keys: string[]): Promise<unknown>;
  onLanguageChange(listener: () => void): unknown;
  /** La vue est rendue (focus à rendre au contenu s'il s'est perdu). */
  onRendered(): void;
}

export interface Settings {
  readonly host: HTMLElement;
  /** Relit tout (affichage de l'écran, configuration changée, langue) ; `plugins` : relit aussi leurs réglages. */
  refresh(opts?: { plugins?: boolean }): Promise<void>;
  /** Brouillon d'un champ (texte à ajouter à une liste, `advanced` : éditeur JSON), et l'effacer. */
  draft(key: string): string | undefined;
  clearDraft(key: string): void;
  /** Donne le focus au champ d'une clé (`search.tmdbToken`), ou au premier élément d'un panneau ; faux s'il manque. */
  focus(key: string): Promise<boolean>;
}

type ViewEl = HTMLElement & Record<string, unknown> & { componentOnReady?: () => Promise<unknown> };

export function createSettings(opts: SettingsOptions, doc: Document = document): Settings {
  const host = doc.createElement('mire-settings');
  const view = doc.createElement('mire-settings-view') as ViewEl;
  host.append(view);
  const drafts = new Map<string, string>();
  let plugins: PluginSettingsInfo[] = [];
  let seq = 0;

  async function refresh({ plugins: reload = false } = {}) {
    const id = ++seq;
    if (reload || !plugins.length) plugins = await opts.plugins().catch(() => plugins);
    if (id !== seq) return;
    const panels = settingsPanels({ ...opts.sources(), t: opts.t, plugins });
    Object.assign(view, { panels, labels: JSON.stringify(settingsLabels(opts.t)) });
    // Le texte de l'éditeur JSON suit la configuration enregistrée.
    drafts.delete('advanced');
  }

  view.addEventListener('mireSettingChange', (e) => {
    const { key, value } = (e as CustomEvent<{ key: string; value: string | boolean }>).detail;
    void opts.onChange(key, value);
  });
  view.addEventListener('mireSettingDraft', (e) => {
    const { key, value } = (e as CustomEvent<{ key: string; value: string }>).detail;
    drafts.set(key, value);
  });
  view.addEventListener('mireSettingOrder', (e) => {
    const { kind, keys } = (e as CustomEvent<{ kind: string; keys: string[] }>).detail;
    void opts.onOrder(kind, keys);
  });
  view.addEventListener('mireSettingsRender', () => opts.onRendered());
  opts.onLanguageChange(() => void refresh());

  return {
    host,
    refresh,
    draft: (key) => drafts.get(key),
    clearDraft: (key) => {
      drafts.delete(key);
      const input = view.querySelector<HTMLInputElement>(`#${CSS.escape(settingsDomId(key))}`);
      if (input && input.localName === 'input') input.value = '';
    },
    async focus(key) {
      await view.componentOnReady?.();
      await new Promise((r) => requestAnimationFrame(r));
      const field = view.querySelector<HTMLElement>(`#${CSS.escape(settingsDomId(key))}`);
      const target = field?.matches('section') ? field.querySelector<HTMLElement>('input, select, textarea, ds-trigger, ds-toggle, [tabindex="0"]') : field;
      if (!target) return false;
      target.scrollIntoView({ block: 'center' });
      target.focus({ preventScroll: true });
      return true;
    },
  };
}
