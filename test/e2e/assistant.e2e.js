'use strict';
/**
 * Assistant du premier lancement (P4-23), de bout en bout et sans réseau :
 * - dossier de données vide (sans configuration) : l'assistant s'ouvre et se parcourt au clavier jusqu'au récapitulatif,
 *   avec les choix tirés des catégories d'un index local (dépôt tiers factice, signé par une clé générée ici, gardé en
 *   cache dans userData/repos) ; « Ne rien installer » ramène à l'accueil sans rien installer ;
 * - configuration existante : l'assistant ne s'ouvre pas.
 * Le `fetch` de Node est coupé par `offline.js` (option -r) : la lecture en ligne des dépôts échoue, le cache sert.
 * Lancement : npm run test:e2e (après les autres tests), ou seul : node --test test/e2e/assistant.e2e.js après
 * npm run build (sous Linux sans écran : xvfb-run -a -s "-screen 0 1920x1080x24" …).
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const SHOTS = path.join(__dirname, '__screenshots__');
const INDEX_URL = 'https://depot.invalid/index.json';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-e2e-assistant-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Forme canonique de l'index (clés triées, sans espace), comme `canonicalJson` de src/main/repos/index-file.ts.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

const version = (name, categories, dependencies = {}) => ({
  version: '1.0.0',
  engines: { mire: '>=0.0.0' },
  level: 'data',
  contributes: ['packs'],
  permissions: {},
  dependencies,
  name: { en: name, fr: name },
  categories,
  package: { url: 'https://depot.invalid/p.tgz', sha256: '0'.repeat(64), size: 10 },
});

// Dépôt tiers factice : sa déclaration (trust.json) et son index signé, en cache comme après une lecture en ligne.
function fakeRepository(data) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const fingerprint = crypto.createHash('sha256').update(raw).digest('hex');
  const id = `repo-${fingerprint.slice(0, 16)}`;
  const body = {
    format: 1,
    repository: { name: { en: 'Test repository', fr: 'Dépôt d’essai' }, index: INDEX_URL },
    generated: '2026-11-20T12:00:00.000Z',
    plugins: [
      { id: 'org.essai.box', versions: [version('Box d’essai', ['tv-box'], { 'org.essai.chaines': '^1.0.0' })] },
      { id: 'org.essai.chaines', versions: [version('Chaînes d’essai', ['tv'])] },
      { id: 'org.essai.films', versions: [version('Films d’essai', ['movies'], { 'org.essai.infos': '^1.0.0' })] },
      { id: 'org.essai.infos', versions: [version('Infos d’essai', [])] },
      { id: 'org.essai.service', versions: [version('Service d’essai', ['streaming-service'])] },
    ],
  };
  const value = crypto.sign(null, Buffer.from(`mire-addons-index:1\n${canonical(body)}`), privateKey).toString('base64');
  const index = { ...body, signature: { algorithm: 'ed25519', keyId: fingerprint, value } };
  fs.mkdirSync(path.join(data, 'repos', id), { recursive: true });
  fs.writeFileSync(path.join(data, 'repos', id, 'index.json'), JSON.stringify(index));
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const trust = { repositories: [{ id, index: INDEX_URL, publicKey: pem, fingerprint, addedAt: 1 }], consents: [] };
  fs.writeFileSync(path.join(data, 'repos', 'trust.json'), JSON.stringify(trust));
}

async function launch(data) {
  const app = await electron.launch({
    cwd: ROOT,
    args: ['-r', path.join(__dirname, 'offline.js'), ROOT, '--no-sandbox'],
    env: { ...process.env, MIRE_USER_DATA: data, TZ: 'Europe/Paris' },
    timeout: 60000,
  });
  app.process().stderr.on('data', (d) => process.stderr.write(d));
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setFullScreen(false);
    win.setContentSize(1600, 900);
  });
  // Heure figée, comme le test de fumée : la capture ne change pas d'une exécution à l'autre.
  await page.clock.setFixedTime(new Date('2026-10-30T20:45:00+01:00'));
  return { app, page };
}

const waitStep = (page, name) =>
  page.waitForFunction((n) => document.querySelector('#view mire-assistant-view.hydrated')?.classList.contains(`--${n}`), name, { timeout: 15000 });
// Élément qui a le focus : la clé d'un choix (`choix:movies`), ou l'action du bouton (`next`, `start`…).
const focusedKey = (page) =>
  page.evaluate(() => {
    const t = document.activeElement?.closest('ds-trigger');
    if (!t) return null;
    if (t.dataset.key !== undefined) return `choix:${t.dataset.key}`;
    return t.getAttribute('action')?.split(':')[0] ?? null;
  });

/** Attend que le focus de l'étape soit posé (après le rendu des composants de l'étape). */
async function waitFocus(page, key) {
  for (let i = 0; i < 50 && (await focusedKey(page)) !== key; i++) await page.waitForTimeout(50);
  assert.equal(await focusedKey(page), key);
}

/**
 * Déplace le focus aux flèches jusqu'à `key`, puis valide avec Entrée : d'abord les touches de `first` (une fois
 * chacune, tant que `key` n'est pas atteint), puis `then` répétée (au plus `max` fois).
 */
async function reach(page, key, first, then, max = 8) {
  for (const k of first) if ((await focusedKey(page)) !== key) await page.keyboard.press(k);
  for (let i = 0; i < max && (await focusedKey(page)) !== key; i++) await page.keyboard.press(then);
  assert.equal(await focusedKey(page), key, `le clavier n'atteint pas ${key}`);
  await page.keyboard.press('Enter');
}

describe('Assistant du premier lancement', () => {
  it('s’ouvre avec un dossier de données vide et se parcourt au clavier jusqu’au récapitulatif', async () => {
    const data = path.join(tmp, 'neuf');
    fakeRepository(data);
    const { app, page } = await launch(data);
    try {
      await waitStep(page, 'welcome');
      assert.equal(await page.evaluate(() => document.body.dataset.section), 'assistant');
      // Bienvenue : le focus est sur « Commencer ».
      await waitFocus(page, 'start');
      await page.keyboard.press('Enter');
      await waitStep(page, 'language');
      await waitFocus(page, 'next');
      await page.keyboard.press('Enter');

      // Ce qu'on veut faire : seules les familles de l'index (films, télévision, streaming).
      await waitStep(page, 'uses');
      const families = await page.$$eval('.mire-assistant-view__choice', (els) => els.map((e) => e.dataset.key));
      assert.deepEqual(families, ['movies', 'tv', 'streaming']);
      await waitFocus(page, 'choix:movies');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.mire-assistant-view__choice[data-key="movies"][aria-pressed="true"]');
      await reach(page, 'choix:tv', [], 'ArrowRight');
      await page.waitForSelector('.mire-assistant-view__choice[data-key="tv"][aria-pressed="true"]');
      await reach(page, 'next', ['ArrowDown'], 'ArrowRight');

      // La box : celle de l'index, ou aucune.
      await waitStep(page, 'box');
      assert.deepEqual(await page.$$eval('.mire-assistant-view__choice', (els) => els.map((e) => e.dataset.key)), ['org.essai.box', '']);
      await waitFocus(page, 'choix:org.essai.box');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.mire-assistant-view__choice[data-key="org.essai.box"][aria-pressed="true"]');
      await reach(page, 'next', ['ArrowDown'], 'ArrowRight');

      // Récapitulatif : les plugins des choix et leurs dépendances ; rien n'est encore installé.
      await waitStep(page, 'summary');
      const items = await page.$$eval('.mire-assistant-view__item', (els) => els.map((e) => e.dataset.key));
      assert.deepEqual(items, ['org.essai.films', 'org.essai.chaines', 'org.essai.box', 'org.essai.infos']);
      assert.match(await page.locator('.mire-assistant-view__item[data-key="org.essai.infos"]').textContent(), /Films d’essai/);
      assert.equal(await page.locator('.mire-assistant-view__primary.--install').count(), 1);
      assert.ok(!(await page.evaluate(() => window.api.pluginsList())).some((p) => p.id.startsWith('org.essai.')));
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: path.join(SHOTS, 'assistant-recapitulatif.png') });

      // « Ne rien installer » : retour à l'accueil, l'assistant ne reviendra plus au démarrage.
      await reach(page, 'skip', [], 'ArrowLeft');
      await page.waitForFunction(() => document.body.dataset.section === 'home');
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'assistant.json'), 'utf8')), { pending: false });
      assert.ok(!(await page.evaluate(() => window.api.pluginsList())).some((p) => p.id.startsWith('org.essai.')));
    } finally {
      await app.close();
    }
  });

  it('ne s’ouvre pas avec une configuration existante', async () => {
    const data = path.join(tmp, 'existante');
    fs.mkdirSync(data, { recursive: true });
    const prefix = JSON.stringify(FIXTURES).slice(1, -1);
    fs.writeFileSync(path.join(data, 'config.json'), fs.readFileSync(path.join(FIXTURES, 'config.json'), 'utf8').replaceAll('@FIXTURES@', prefix));
    const { app, page } = await launch(data);
    try {
      // Fin du démarrage : l'horloge est remplie, puis la demande de l'assistant a eu le temps d'aboutir.
      await page.waitForFunction(() => /\d/.test(document.getElementById('clock')?.textContent ?? ''), null, { timeout: 15000 });
      await page.waitForTimeout(1000);
      assert.equal(await page.evaluate(() => document.body.dataset.section), 'home');
      assert.equal(await page.locator('mire-assistant-view').count(), 0);
      assert.equal(fs.existsSync(path.join(data, 'assistant.json')), false);
      assert.equal((await page.evaluate(() => window.api.assistantState())).open, false);
    } finally {
      await app.close();
    }
  });
});
