/**
 * Réglages des plugins (`ctx.settings`, P3-04) : rangés sous `plugins.<id>` dans la configuration, décrits par le
 * `settings` du manifeste (mêmes types que le schéma des réglages de P1-26 : `text`, `secret`, `choice`, `toggle`,
 * `path`, `list`). La section est absente tant qu'aucun plugin n'a de réglage changé : la version de la configuration
 * ne change pas (comme `catalog`, P2-04), et aucune migration n'est nécessaire.
 *
 * Réglage `secret` : rangé sous la forme `{ "$secret": "…", "encrypted": true }`, chiffré par `safeStorage` quand le
 * système le permet ; sinon gardé tel quel avec `encrypted: false`. Dans les deux cas, il n'est jamais rendu à
 * l'interface ni exporté (`withoutSecrets`), un import ne l'efface pas (`keepSecrets`), et il n'apparaît dans aucun
 * journal ni message d'erreur. Seul le plugin le reçoit, dans son contexte.
 */
import type { PluginSetting, SettingValue } from '@mire/plugin-sdk';
import type { Config, PluginSettingsSection, StoredPluginSetting, StoredSecret } from '@mire/shared';
import { CHANNEL_ERRORS, ChannelError } from './channel.ts';

/** Chiffrement des secrets (`safeStorage` d'Electron ; un faux dans les tests). */
export interface SecretBox {
  available(): boolean;
  /** Texte chiffré, en base 64. */
  encrypt(text: string): string;
  decrypt(base64: string): string;
}

export const SETTING_LIMITS = Object.freeze({ text: 4096, list: 1000 });

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isStoredSecret = (v: unknown): v is StoredSecret => isObject(v) && typeof v.$secret === 'string';

const isValue = (v: unknown): v is StoredPluginSetting =>
  typeof v === 'string' ||
  typeof v === 'boolean' ||
  (typeof v === 'number' && Number.isFinite(v)) ||
  (Array.isArray(v) && v.every((x) => typeof x === 'string')) ||
  isStoredSecret(v);

/** Normalisation de `plugins` dans la configuration : un objet par plugin, des valeurs de réglage reconnues. */
export function normalizePluginSettings(raw: unknown): PluginSettingsSection {
  const out: PluginSettingsSection = {};
  if (!isObject(raw)) return out;
  for (const [id, values] of Object.entries(raw)) {
    if (!isObject(values)) continue;
    const kept: Record<string, StoredPluginSetting> = {};
    for (const [key, v] of Object.entries(values)) {
      if (!isValue(v)) continue;
      kept[key] = isStoredSecret(v) ? { $secret: v.$secret, encrypted: v.encrypted === true } : v;
    }
    out[id] = kept;
  }
  return out;
}

/** Configuration sans les réglages secrets des plugins (export, interface). */
export function withoutSecrets<T extends Partial<Pick<Config, 'plugins'>>>(config: T): T {
  if (!config.plugins) return config;
  const plugins: PluginSettingsSection = {};
  for (const [id, values] of Object.entries(config.plugins)) {
    plugins[id] = Object.fromEntries(Object.entries(values).filter(([, v]) => !isStoredSecret(v)));
  }
  return { ...config, plugins };
}

/** Section `plugins` d'un import : les secrets en place sont gardés (un export n'en contient jamais). */
export function keepSecrets(imported: unknown, current: PluginSettingsSection | undefined): PluginSettingsSection | undefined {
  const next = imported === undefined ? undefined : normalizePluginSettings(imported);
  if (!current) return next;
  const out: PluginSettingsSection = { ...(next ?? {}) };
  for (const [id, values] of Object.entries(current)) {
    for (const [key, v] of Object.entries(values)) {
      if (!isStoredSecret(v)) continue;
      out[id] = { ...(out[id] ?? {}), [key]: v };
    }
  }
  return Object.keys(out).length || next ? out : undefined;
}

/** Réunit deux sections `plugins` : pour un même réglage, `kept` l'emporte. */
export function mergePluginSettings(added: PluginSettingsSection, kept: PluginSettingsSection | undefined): PluginSettingsSection {
  const out: PluginSettingsSection = { ...added };
  for (const [id, values] of Object.entries(kept ?? {})) out[id] = { ...(out[id] ?? {}), ...values };
  return out;
}

const invalid = (key: string, why: string) => new ChannelError(CHANNEL_ERRORS.plugin, `Setting "${key}": ${why}`);

/** Valeur d'un réglage vérifiée d'après sa déclaration ; lève une erreur qui ne cite jamais la valeur. */
export function checkSettingValue(decl: PluginSetting, value: unknown): SettingValue {
  const text = () => {
    if (typeof value !== 'string' || value.length > SETTING_LIMITS.text)
      throw invalid(decl.key, `a text of at most ${SETTING_LIMITS.text} characters is expected.`);
    return value;
  };
  switch (decl.type) {
    case 'toggle':
      if (typeof value !== 'boolean') throw invalid(decl.key, 'true or false is expected.');
      return value;
    case 'choice':
      if (typeof value !== 'string' || !(decl.options ?? []).includes(value)) throw invalid(decl.key, 'one of the declared options is expected.');
      return value;
    case 'list':
      if (!Array.isArray(value) || value.length > SETTING_LIMITS.list || !value.every((x) => typeof x === 'string' && x.length <= SETTING_LIMITS.text))
        throw invalid(decl.key, 'a list of texts is expected.');
      return [...value];
    default:
      return text();
  }
}

export interface PluginSettingsOptions {
  /** Section `plugins` de la configuration en cours. */
  read(): PluginSettingsSection | undefined;
  /** Change les réglages d'un plugin dans la configuration (enregistrée aussitôt). */
  write(id: string, values: Record<string, StoredPluginSetting>): void;
  box: SecretBox;
  log?: (message: string) => void;
}

export function createPluginSettings({ read, write, box, log = (m) => console.error(m) }: PluginSettingsOptions) {
  function reveal(id: string, key: string, v: StoredSecret): string | undefined {
    if (!v.encrypted) return v.$secret;
    try {
      return box.available() ? box.decrypt(v.$secret) : undefined;
    } catch {
      // Chiffré sur une autre machine ou par un autre compte : à saisir de nouveau. Ni la valeur ni l'erreur ne sont écrites.
      log(`Plugins : réglage secret « ${key} » de ${id} illisible ; il faudra le saisir de nouveau.`);
      return undefined;
    }
  }

  return {
    /** Réglages d'un plugin pour son contexte : valeurs changées, sinon celles par défaut ; secrets en clair. */
    values(id: string, declared: readonly PluginSetting[] = []): Record<string, SettingValue> {
      const stored = read()?.[id] ?? {};
      const out: Record<string, SettingValue> = {};
      for (const decl of declared) {
        const v = Object.hasOwn(stored, decl.key) ? stored[decl.key] : undefined;
        if (decl.type === 'secret') {
          const s = isStoredSecret(v) ? reveal(id, decl.key, v) : undefined;
          if (s !== undefined) out[decl.key] = s;
          continue;
        }
        if (v !== undefined && !isStoredSecret(v)) {
          try {
            out[decl.key] = checkSettingValue(decl, v);
            continue;
          } catch {
            // Valeur qui ne correspond plus au manifeste (mise à jour du plugin) : celle par défaut.
          }
        }
        if (decl.default !== undefined) out[decl.key] = structuredClone(decl.default);
      }
      return out;
    },

    /** Change un réglage déclaré ; `null` le remet à sa valeur par défaut. Rend la valeur vue par le plugin. */
    set(id: string, declared: readonly PluginSetting[], key: string, value: unknown): SettingValue | undefined {
      const decl = declared.find((d) => d.key === key);
      if (!decl) throw invalid(key, 'not declared in the manifest.');
      const next: Record<string, StoredPluginSetting> = { ...(read()?.[id] ?? {}) };
      if (value === null || value === undefined) {
        delete next[key];
        write(id, next);
        return decl.type === 'secret' ? undefined : structuredClone(decl.default);
      }
      const checked = checkSettingValue(decl, value);
      if (decl.type === 'secret') {
        const plain = checked as string;
        next[key] = box.available() ? { $secret: box.encrypt(plain), encrypted: true } : { $secret: plain, encrypted: false };
      } else next[key] = checked;
      write(id, next);
      return checked;
    },
  };
}

export type PluginSettingsStore = ReturnType<typeof createPluginSettings>;
