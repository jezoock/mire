// Plugins d'émulateurs de la boutique (P5-19a), copiés tels qu'ils sont publiés (`test/fixtures/plugins/`) : ils
// servent à vérifier que la boutique propose et installe les mêmes consoles qu'avant leur extraction.
import fs from 'node:fs';
import path from 'node:path';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';
import { readPluginEmulators } from '../../src/main/plugins/emulators.ts';
import { EMULATORS, type StoreEmulator } from '../../src/main/store/catalog/index.ts';

const PLUGINS = path.join(import.meta.dirname, '..', 'fixtures', 'plugins');

/** Contribution `apps` d'un plugin d'émulateur des fixtures (`retroarch`, `duckstation`). */
export function emulatorEntry(id: string): ContributionEntry {
  const pluginId = `mire.emulator.${id}`;
  const file = `apps/${id}.json`;
  return {
    pluginId,
    kind: 'apps',
    id,
    declaration: { id, file },
    data: JSON.parse(fs.readFileSync(path.join(PLUGINS, pluginId, file), 'utf8')),
    file,
  };
}

/** Textes français d'un plugin des fixtures, sous `pluginTexts.<plugin>.` comme les range Mire. */
export function fixtureTranslate(key: string): string {
  const m = /^pluginTexts\.mire_emulator_([a-z]+)\.(.+)$/.exec(key);
  if (!m) return key;
  const cat = JSON.parse(fs.readFileSync(path.join(PLUGINS, `mire.emulator.${m[1]}`, 'i18n', 'fr.json'), 'utf8')).messages;
  const v = m[2].split('.').reduce((o: any, k) => o?.[k], cat);
  return typeof v === 'string' ? v : key;
}

/** Émulateurs des deux plugins, lus comme le fait le cœur. */
export const pluginEmulators = (): StoreEmulator[] =>
  readPluginEmulators([emulatorEntry('retroarch'), emulatorEntry('duckstation')], EMULATORS, fixtureTranslate);

/** Tout ce que la boutique propose une fois les plugins installés (plugins, puis émulateurs du cœur). */
export const allEmulators = (): StoreEmulator[] => [...pluginEmulators(), ...EMULATORS];
