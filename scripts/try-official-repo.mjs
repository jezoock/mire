#!/usr/bin/env node
/**
 * Essai réel du client des dépôts (P3-07), hors des tests automatiques (il demande le réseau) : lit l'index officiel
 * publié, le vérifie avec la clé intégrée à Mire, installe un plugin avec l'installateur et l'hôte de plugins de Mire
 * dans un dossier de données temporaire, puis vérifie qu'il est actif, et qu'il le reste hors ligne au lancement
 * suivant.
 *
 * Usage : node scripts/try-official-repo.mjs [identifiant du plugin, par défaut mire.exemple.donnees]
 * Derrière un proxy (Node 22.21 ou plus récent) : NODE_USE_ENV_PROXY=1 node scripts/try-official-repo.mjs
 * Code de sortie : 0 si tout est bon, 1 sinon.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRegistry } from '../src/main/catalog/tags/registry.ts';
import { createJournal } from '../src/main/plugins/journal.ts';
import { createPluginService } from '../src/main/plugins/service.ts';
import { createPluginState } from '../src/main/plugins/state.ts';
import { createRepoClient } from '../src/main/repos/client.ts';
import { createInstaller } from '../src/main/repos/installer.ts';
import { OFFICIAL_REPOSITORY } from '../src/main/repos/official.ts';
import { createRepositories } from '../src/main/repos/repositories.ts';

const id = process.argv[2] ?? 'mire.exemple.donnees';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-essai-depot-'));
const installed = path.join(userData, 'plugins');
fs.mkdirSync(installed, { recursive: true });
const translate = (key, vars) => `${key} ${JSON.stringify(vars ?? {})}`;

/** Hôte de plugins et client des dépôts de Mire sur `userData` (plugins de données seulement : pas d'hôte isolé ici). */
function mire(fetchImpl) {
  const service = createPluginService({
    roots: { bundled: null, installed },
    appVersion: JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
    languages: ['fr', 'en'],
    state: createPluginState(path.join(installed, 'state.json')),
    journal: createJournal({ dir: path.join(installed, 'logs') }),
    tagRegistry: createRegistry((k) => k),
    setTexts: () => {},
    translate,
    locale: () => 'fr',
    runners: () => ({
      isolated: () => Promise.reject(new Error('no isolated host in this script')),
      inProcess: () => Promise.reject(new Error('no in-process code in this script')),
      base: () => '',
      shutdown: () => {},
    }),
    onTaggersChange: () => {},
    refresh: () => {},
    watchdog: { interval: 0, timeout: 0 },
  });
  const client = createRepoClient({
    repositories: createRepositories({ cacheDir: path.join(userData, 'repos'), repositories: () => [OFFICIAL_REPOSITORY], fetch: fetchImpl, log: console.log }),
    installer: createInstaller({ pluginsDir: installed, fetch: fetchImpl }),
    plugins: service,
    appVersion: '1.0.0',
    locale: () => 'fr',
    translate,
    onProgress: (p) => console.log('  progression :', JSON.stringify(p)),
    log: console.log,
  });
  return { service, client };
}

function check(ok, message) {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

try {
  const online = mire(undefined);
  await online.service.start();
  const [status] = await online.client.refresh();
  check(status.error === null, `index officiel lu et vérifié avec la clé intégrée (publié le ${status.generated}, erreur : ${status.error})`);
  const offer = online.client.available().find((p) => p.id === id);
  if (check(!!offer, `${id} proposé par le dépôt officiel (${offer?.version}, niveau ${offer?.level}, ${offer?.size} octets)`)) {
    const r = await online.client.install(id);
    check(r.ok, `installation : ${r.ok ? 'réussie' : `${r.code} — ${r.error}`}`);
    const info = online.service.list().find((p) => p.id === id);
    check(info?.status === 'active' && info.repository === 'official', `plugin actif, origine « ${info?.repository} », version ${info?.version}`);
    console.log(`  fichiers : ${fs.readdirSync(path.join(installed, id), { recursive: true }).sort().join(', ')}`);
  }
  await online.service.stop();

  const offline = mire(() => Promise.reject(new TypeError('offline')));
  await offline.service.start();
  check(offline.service.list().find((p) => p.id === id)?.status === 'active', 'hors ligne au lancement suivant : le plugin installé reste actif');
  const [cached] = await offline.client.refresh();
  check(cached.error === 'network' && offline.client.available().some((p) => p.id === id), 'hors ligne : l’index en cache sert toujours');
  await offline.service.stop();
} catch (err) {
  check(false, err.stack ?? String(err));
} finally {
  fs.rmSync(userData, { recursive: true, force: true });
}
