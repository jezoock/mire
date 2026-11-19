/** Plugins (P3-03) : liste et activation (Centre, P4-18) ; réglages déclarés par les manifestes (Réglages, P4-20). */
import { t } from '../../i18n/current.ts';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function pluginsHandlers(ctx: MainContext) {
  return {
    pluginsList: () => ctx.plugins.list(),
    pluginsSetEnabled: (id, enabled) => ctx.plugins.setEnabled(id, enabled),
    pluginsSettings: () => ctx.plugins.settingsList(),
    pluginsMetadataProviders: () => ctx.plugins.metadataProviders(),
    pluginsSetSetting: (id, key, value) => {
      const name = () => ctx.plugins.settingsList().find((p) => p.id === id)?.name ?? id;
      try {
        ctx.plugins.setSetting(id, key, value);
      } catch {
        // L'erreur du service ne cite jamais la valeur ; le message affiché non plus.
        return { ok: false as const, error: t('plugins.settings.refused', { name: name() }) };
      }
      const plugin = ctx.plugins.settingsList().find((p) => p.id === id);
      return plugin ? { ok: true as const, plugin } : { ok: false as const, error: t('plugins.settings.refused', { name: name() }) };
    },
  } satisfies Partial<IpcImplementations>;
}
