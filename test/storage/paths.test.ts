// Arborescence du dossier de données : mêmes chemins que ceux construits auparavant dans chaque module.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { dataPaths } from '../../src/main/storage/paths.ts';

it('dataPaths : chemins historiques du dossier de données', () => {
  const root = path.join('donnees', 'Mire');
  const p = dataPaths(root);
  const at = (...parts: string[]) => path.join(root, ...parts);
  assert.deepEqual(p, {
    root,
    config: at('config.json'),
    usage: at('usage.json'),
    catalogDir: at('catalog'),
    catalogSources: at('catalog', 'sources'),
    catalogOverrides: at('catalog', 'overrides.json'),
    catalogMetadata: at('catalog', 'metadata.json'),
    catalogPages: at('catalog', 'pages.json'),
    catalogLists: at('catalog', 'lists.json'),
    metaDir: at('meta'),
    meta: at('meta', 'meta.json'),
    metaImg: at('meta', 'img'),
    scrapeDir: at('scrape'),
    scrapeDb: at('scrape', 'db.json'),
    scrapeImg: at('scrape', 'img'),
    scrapeCache: at('scrape', 'cache'),
    downloads: at('telechargements.json'),
    torrents: at('torrents'),
    emulatorsDir: at('emulators'),
    emulatorsInstalled: at('emulators', 'installed.json'),
    adblockDir: at('adblock'),
    adblockEngine: at('adblock', 'moteur.bin'),
    adblockLists: at('adblock', 'listes.json'),
    romCache: at('cache', 'roms'),
    binDir: at('bin'),
    sevenZip: at('bin', '7za'),
    plugins: at('plugins'),
    pluginState: at('plugins', 'state.json'),
    pluginLogs: at('plugins', 'logs'),
    pluginData: at('plugin-data'),
    repoCache: at('repos'),
  });
});
