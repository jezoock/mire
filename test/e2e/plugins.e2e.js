'use strict';
/**
 * Hôte de plugins (P3-03), de bout en bout : des plugins posés à la main dans userData/plugins (MIRE_USER_DATA) sont
 * découverts, vérifiés, activés, utilisés et désactivés ; un plugin qui boucle et un plugin qui lève une exception
 * sont désactivés, et Mire continue. Plugins d'essai : test/e2e/plugins/.
 * Lancement : npm run test:e2e (après le test de fumée), ou seul : node --test test/e2e/plugins.e2e.js après
 * npm run build (sous Linux sans écran : xvfb-run -a -s "-screen 0 1920x1080x24" …).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const PLUGINS = path.join(__dirname, 'plugins');

let tmp;
let data;
let app;
let page;
let proxy;
const chromiumRequests = [];
let started;

// Proxy de Chromium : note chaque requête et la refuse, pour qu'aucune ne sorte réellement.
function startProxy() {
  const server = http.createServer((req, res) => {
    chromiumRequests.push(req.url);
    res.writeHead(403).end();
  });
  server.on('connect', (req, socket) => {
    chromiumRequests.push(`https://${req.url}`);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function prepareData() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-e2e-plugins-'));
  const fixtures = path.join(tmp, 'fixtures');
  data = path.join(tmp, 'data');
  fs.cpSync(FIXTURES, fixtures, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  const prefix = JSON.stringify(fixtures).slice(1, -1);
  fs.writeFileSync(path.join(data, 'config.json'), fs.readFileSync(path.join(FIXTURES, 'config.json'), 'utf8').replaceAll('@FIXTURES@', prefix));
  // Plugins posés à la main : userData/plugins/<id>/<version>/.
  for (const id of fs.readdirSync(PLUGINS)) {
    const { version } = JSON.parse(fs.readFileSync(path.join(PLUGINS, id, 'mire-plugin.json'), 'utf8'));
    fs.cpSync(path.join(PLUGINS, id), path.join(data, 'plugins', id, version), { recursive: true });
  }
}

const list = () => page.evaluate(() => window.api.pluginsList());
const byId = async () => Object.fromEntries((await list()).map((p) => [p.id, p]));
const search = (q) => page.evaluate((query) => window.api.catalogSearch(query), q);
const journal = (id) => {
  try {
    return fs.readFileSync(path.join(data, 'plugins', 'logs', `${id}.log`), 'utf8');
  } catch {
    return '';
  }
};

/** Attend qu'une condition soit vraie (états asynchrones : démarrage des plugins, lots de tags, chien de garde). */
async function until(what, check, timeout = 20000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await check();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`${what} : délai dépassé`);
}

describe('Hôte de plugins', () => {
  before(async () => {
    prepareData();
    proxy = await startProxy();
    started = Date.now();
    app = await electron.launch({
      cwd: ROOT,
      // --no-sandbox : le bac à sable de Chromium n'est pas disponible sous root ni dans les conteneurs de CI.
      args: [ROOT, '--no-sandbox', `--proxy-server=http://127.0.0.1:${proxy.address().port}`],
      env: { ...process.env, MIRE_USER_DATA: data, TZ: 'Europe/Paris' },
      timeout: 60000,
    });
    app.process().stderr.on('data', (d) => process.stderr.write(d));
    page = await app.firstWindow();
    await page.waitForFunction(() => !!window.api);
  });

  after(async () => {
    await app?.close();
    proxy?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('découvre les plugins, active les valides, refuse les autres avec un message clair', async () => {
    const p = await until('plugins activés', async () => {
      const all = await byId();
      return all['org.exemple.palette']?.status === 'active' && all['org.exemple.annees']?.status === 'active' ? all : null;
    });
    console.log(`Plugins actifs ${Date.now() - started} ms après le lancement de Mire.`);
    assert.equal(p['org.exemple.palette'].level, 'data');
    assert.equal(p['org.exemple.palette'].name, 'Palette de nuit');
    assert.deepEqual(p['org.exemple.palette'].contributions, [{ kind: 'palettes', id: 'nuit' }]);
    assert.equal(p['org.exemple.annees'].level, 'code');
    assert.equal(p['org.exemple.futur'].status, 'refused');
    assert.match(p['org.exemple.futur'].message, /autre version de Mire \(\^9\.0\.0\)/);
    assert.equal(p['org.exemple.sensible'].status, 'refused');
    assert.match(p['org.exemple.sensible'].message, /seuls les plugins livrés avec Mire/);
  });

  it('charge les textes des plugins dans le moteur de traduction', async () => {
    const info = await page.evaluate(() => window.api.i18nGet());
    const texts = info.catalogs.fr.messages.pluginTexts;
    assert.equal(texts.org_exemple_palette.plugin.name, 'Palette de nuit');
    assert.equal(texts.org_exemple_annees.tags.date, 'Daté');
  });

  it('un plugin de code limité tague les éléments ; ses infos sont cherchables', async () => {
    await page.evaluate(() => window.api.scanLibrary());
    const found = await until('éléments tagués', async () => {
      const r = await search('millesime1902');
      return r.total > 0 ? r : null;
    });
    const key = found.groups[0].elements[0].key;
    const element = await page.evaluate((k) => window.api.catalogElement(k), key);
    assert.ok(element.tags.includes('date'));
    // Seuls les tags déclarés par la contribution sont gardés.
    assert.ok(!element.tags.includes('non-declare'));
    assert.equal(element.infos.millesime, 'millesime1902');
    // Le réseau est refusé dans l'hôte isolé.
    assert.match(journal('org.exemple.annees'), /INFO réseau refusé/);
  });

  it('un plugin qui boucle ou lève une exception est désactivé, Mire continue', async () => {
    const p = await until('plugins fautifs désactivés', async () => {
      const all = await byId();
      return all['org.exemple.boucle']?.status === 'fault' && all['org.exemple.erreur']?.status === 'fault' ? all : null;
    });
    assert.equal(p['org.exemple.boucle'].enabled, false);
    assert.match(p['org.exemple.boucle'].message, /ne répondait plus/);
    assert.match(p['org.exemple.erreur'].message, /panne voulue/);
    assert.match(journal('org.exemple.boucle'), /ERROR/);
    // L'état est mémorisé avec l'erreur (pour le futur Centre).
    const state = JSON.parse(fs.readFileSync(path.join(data, 'plugins', 'state.json'), 'utf8'));
    assert.equal(state.plugins['org.exemple.boucle'].fault.code, 'timeout');
    assert.equal(state.plugins['org.exemple.erreur'].fault.code, 'exception');
    // Les autres plugins et Mire continuent.
    assert.equal(p['org.exemple.annees'].status, 'active');
    assert.ok((await search('millesime2001')).total > 0);
  });

  it('désactive et réactive un plugin sans redémarrer', async () => {
    const off = await page.evaluate(() => window.api.pluginsSetEnabled('org.exemple.annees', false));
    assert.equal(off.status, 'disabled');
    await until('tags retirés', async () => (await search('millesime1902')).total === 0);
    const on = await page.evaluate(() => window.api.pluginsSetEnabled('org.exemple.annees', true));
    assert.equal(on.status, 'active');
    await until('tags revenus', async () => (await search('millesime1902')).total > 0);
    const dataOff = await page.evaluate(() => window.api.pluginsSetEnabled('org.exemple.palette', false));
    assert.equal(dataOff.status, 'disabled');
    const info = await page.evaluate(() => window.api.i18nGet());
    assert.equal(info.catalogs.fr.messages.pluginTexts.org_exemple_palette, undefined);
  });
});
