/**
 * Émulateurs des plugins actifs (contribution de données `apps` de genre `emulator`, P5-19). Le plugin décrit
 * l'émulateur (site, source, programme, arguments, consoles, BIOS : forme dans `src/main/store/catalog/read.ts`) ; le
 * cœur garde tout ce qui télécharge, installe, lance et lit les BIOS (`src/main/store/`).
 *
 * - l'identifiant de l'émulateur est celui de la contribution (`retroarch`) : c'est lui qui désigne les consoles
 *   installées (`store` = `<émulateur>:<console>`) et le dossier d'installation ;
 * - textes du plugin : `apps.<contribution>.name` (nom affiché), `.description` (présentation dans la boutique) et
 *   `.bios` (rappel des fichiers de BIOS attendus, quand l'émulateur en a) ;
 * - un émulateur fait télécharger et lancer un programme : seuls ceux des plugins inclus ou du dépôt officiel
 *   comptent (filtrés par le service des plugins) ;
 * - deux émulateurs du même identifiant : le premier l'emporte (ceux du cœur, puis par identifiant de plugin).
 */
import { readEmulatorData, type StoreEmulator } from '../store/catalog/index.ts';
import type { ContributionEntry } from './registry.ts';
import { pluginTextPrefix } from './service.ts';
import { t } from '../i18n/current.ts';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** La contribution est-elle un émulateur (quelle que soit la validité de ses données) ? */
export const isEmulatorEntry = (e: ContributionEntry): boolean => e.kind === 'apps' && isRecord(e.data) && e.data.kind === 'emulator';

/** Émulateur d'une contribution `apps`, ou `null` si ce n'en est pas un ou si ses données ne conviennent pas. */
export function readPluginEmulator(entry: ContributionEntry, translate: (key: string) => string = t): StoreEmulator | null {
  if (!isEmulatorEntry(entry)) return null;
  const prefix = `${pluginTextPrefix(entry.pluginId)}apps.${entry.id}.`;
  const nameKey = `${prefix}name`;
  const name = translate(nameKey);
  return readEmulatorData(
    { id: entry.id, name: name && name !== nameKey ? name : entry.id, plugin: entry.pluginId, texts: { desc: `${prefix}description`, bios: `${prefix}bios` } },
    entry.data,
  );
}

/** Émulateurs des contributions données, après ceux déjà connus (`before`), sans identifiant en double. */
export function readPluginEmulators(
  entries: readonly ContributionEntry[],
  before: readonly StoreEmulator[] = [],
  translate?: (key: string) => string,
): StoreEmulator[] {
  const ids = new Set(before.map((e) => e.id));
  const sorted = [...entries].sort((a, b) => (a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : 0));
  const out: StoreEmulator[] = [];
  for (const entry of sorted) {
    const emu = readPluginEmulator(entry, translate);
    if (!emu || ids.has(emu.id)) continue;
    ids.add(emu.id);
    out.push(emu);
  }
  return out;
}
