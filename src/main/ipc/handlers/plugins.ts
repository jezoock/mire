/**
 * Plugins (P3-03) : liste et activation (Centre, P4-18) ; réglages déclarés par les manifestes (Réglages, P4-20) ;
 * dépôts, installation, mise à jour et désinstallation (P3-07) ; dépôts tiers et accords (P3-08). Les arguments
 * venus de l'interface sont vérifiés ici : identifiant de plugin bien formé et connu (des dépôts pour installer, des
 * plugins présents pour désinstaller), version semver, booléen, dépôt configuré, adresse `https:` et clé PEM ed25519
 * de taille bornée, empreinte de 64 caractères hexadécimaux. Continuité (P5-01) : récapitulatif, sans argument.
 */
import { isVersion } from '../../../../packages/plugin-sdk/src/semver.ts';
import { PLUGIN_ID_RE } from '../../../../packages/plugin-sdk/src/validate.ts';
import { t } from '../../i18n/current.ts';
import { checkIndexUrl, keyFingerprint } from '../../repos/trust.ts';
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

const isId = (v: unknown): v is string => typeof v === 'string' && v.length <= 128 && PLUGIN_ID_RE.test(v);
const isFingerprint = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const isRepoId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
/** Adresse et clé d'un dépôt tiers : vérifiées ici, puis de nouveau par le client des dépôts. */
const isRepoSource = (index: unknown, key: unknown): index is string => checkIndexUrl(index) !== null && keyFingerprint(key) !== null;

export function pluginsHandlers(ctx: MainContext) {
  const known = (id: unknown): id is string => isId(id) && ctx.repos.knows(id);
  const configured = (id: unknown): id is string => isRepoId(id) && ctx.repos.hasRepository(id);
  return {
    reposList: () => ctx.repos.repositories(),
    reposRefresh: async () => {
      const status = await ctx.repos.refresh();
      // Installations de la continuité en attente (P5-01) : retentées avec ces index, sans retarder la réponse.
      void ctx.continuity.afterRefresh(status);
      return status;
    },
    reposPlugins: () => ctx.repos.available(),
    reposInspect: (index, key) => (isRepoSource(index, key) ? ctx.repos.inspectRepository(index, key) : null),
    reposAdd: (index, key, fingerprint) => (isRepoSource(index, key) && isFingerprint(fingerprint) ? ctx.repos.addRepository(index, key, fingerprint) : null),
    reposRemove: (id, uninstall, keepData) =>
      configured(id) && typeof uninstall === 'boolean' && typeof keepData === 'boolean' ? ctx.repos.removeRepository(id, { uninstall, keepData }) : null,
    pluginsInstall: (id, version?: string, repository?: string) =>
      known(id) && (version === undefined || isVersion(version)) && (repository === undefined || configured(repository))
        ? ctx.repos.install(id, version, repository)
        : null,
    pluginsConsent: (id, repository, version) =>
      known(id) && configured(repository) && isVersion(version) ? ctx.repos.consent(id, repository, version) : null,
    pluginsUpdate: (id) => (known(id) ? ctx.repos.update(id) : null),
    pluginsUninstall: (id, keepData) => (isId(id) && typeof keepData === 'boolean' ? ctx.plugins.uninstall(id, { keepData }) : null),
    pluginsList: () => ctx.plugins.list(),
    // Sans argument : rien à vérifier.
    pluginsContinuity: () => ctx.continuity.summary(),
    pluginsContinuitySeen: () => ctx.continuity.seen(),
    pluginsSetEnabled: (id, enabled) => ctx.plugins.setEnabled(id, enabled),
    pluginsSettings: () => ctx.plugins.settingsList(),
    pluginsMetadataProviders: () => ctx.plugins.metadataProviders(),
    // Sans argument ; les données des plugins sont vérifiées par le lecteur des profils (`plugins/gamepads.ts`).
    gamepadsProfiles: () => ctx.plugins.gamepadProfiles(),
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
