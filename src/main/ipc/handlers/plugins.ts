/**
 * Plugins (P3-03) : liste et activation (Centre, P4-18) ; réglages déclarés par les manifestes (Réglages, P4-20) ;
 * dépôts, installation, mise à jour et désinstallation (P3-07). Les arguments venus de l'interface sont vérifiés ici :
 * identifiant de plugin bien formé et connu (des dépôts pour installer, des plugins présents pour désinstaller),
 * version semver, booléen.
 */
import { isVersion } from '../../../../packages/plugin-sdk/src/semver.ts';
import { PLUGIN_ID_RE } from '../../../../packages/plugin-sdk/src/validate.ts';
import { t } from '../../i18n/current.ts';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

const isId = (v: unknown): v is string => typeof v === 'string' && v.length <= 128 && PLUGIN_ID_RE.test(v);

export function pluginsHandlers(ctx: MainContext) {
  const known = (id: unknown): id is string => isId(id) && ctx.repos.knows(id);
  return {
    reposList: () => ctx.repos.repositories(),
    reposRefresh: () => ctx.repos.refresh(),
    reposPlugins: () => ctx.repos.available(),
    pluginsInstall: (id, version?: string) => (known(id) && (version === undefined || isVersion(version)) ? ctx.repos.install(id, version) : null),
    pluginsUpdate: (id) => (known(id) ? ctx.repos.update(id) : null),
    pluginsUninstall: (id, keepData) => (isId(id) && typeof keepData === 'boolean' ? ctx.plugins.uninstall(id, { keepData }) : null),
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
