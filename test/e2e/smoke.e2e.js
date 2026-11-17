'use strict';
/**
 * Test de fumée : Mire démarre avec une configuration de démonstration, chaque section s'affiche,
 * et des captures de référence sont enregistrées dans test/e2e/__screenshots__/.
 * Lancement : npm run test:e2e, qui construit d'abord dist/ (sous Linux sans écran : xvfb-run -a -s "-screen 0 1920x1080x24" npm run test:e2e).
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
const SHOTS = path.join(__dirname, '__screenshots__');
const THEMES = ['ecran', 'jour', 'minuit', 'velours', 'contraste'];
// Ordre des entrées du menu principal, de haut en bas : on s'y déplace aux flèches.
const RAIL = ['search', 'home', 'videos', 'music', 'images', 'streaming', 'tv', 'games', 'downloads', 'settings'];
// Sections visitées par le test, avec leur titre.
const SECTIONS = [
  ['search', 'Rechercher'],
  ['videos', 'Vidéos'],
  ['music', 'Musique'],
  ['images', 'Images'],
  ['streaming', 'Streaming'],
  ['tv', 'Télévision'],
  ['games', 'Jeux'],
  ['downloads', 'Téléchargements'],
  ['settings', 'Réglages'],
];
// Contenu attendu dans chaque section : la capture ne doit pas montrer un état vide.
const FILLED = {
  search: 'Amélie',
  videos: 'Voyage dans la Lune',
  music: 'Premier album',
  images: 'Vacances',
  streaming: 'Arte',
  tv: 'Chaîne Deux',
  games: 'Super Nintendo',
  downloads: 'Manuel de démonstration',
  settings: 'Thème',
};

// Téléchargement de Widevine par castLabs Electron (composant Google) : seule requête attendue.
const isWidevine = (u) => /^https?:\/\/([^/]+\.)?(gvt1\.com|dl\.google\.com)(:\d+)?(\/|$)/.test(u);

let tmp;
let app;
let page;
let proxy;
const chromiumRequests = [];

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
  // Nom fixe : le chemin des sources apparaît dans les réglages, il doit rester le même d'une capture à l'autre.
  tmp = path.join(os.tmpdir(), 'mire-e2e');
  fs.rmSync(tmp, { recursive: true, force: true });
  const fixtures = path.join(tmp, 'fixtures');
  const data = path.join(tmp, 'data');
  fs.cpSync(FIXTURES, fixtures, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  // Chemins de la configuration de démonstration réécrits vers le dossier temporaire.
  const prefix = JSON.stringify(fixtures).slice(1, -1);
  for (const file of ['config.json', 'telechargements.json']) {
    fs.writeFileSync(path.join(data, file), fs.readFileSync(path.join(FIXTURES, file), 'utf8').replaceAll('@FIXTURES@', prefix));
  }
  return data;
}

// #RRGGBB → rgb(r, g, b), comme le rend getComputedStyle.
const hexToRgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

async function shot(name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function settle() {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(400);
}

const focused = () => page.evaluate(() => document.activeElement?.dataset?.go || null);

// Où est le focus : dans le menu, sur une barre de l'accueil, dans un champ de saisie, ailleurs.
const focusPlace = () =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (a?.closest('#rail')) return 'menu';
    if (a?.matches('input[type="search"], input[type="text"]')) return 'champ';
    if (document.body.dataset.section !== 'home') return 'ailleurs';
    return a?.closest('.mire-bar') ? 'barres' : 'accueil';
  });
// Champ : on en sort vers le bas ; ailleurs : Échap ramène à l'accueil ; accueil : on descend vers les barres
// de la mire ; barres : la flèche gauche les parcourt jusqu'au menu.
const KEY_TO_MENU = { champ: 'ArrowDown', ailleurs: 'Escape', accueil: 'ArrowDown', barres: 'ArrowLeft' };

// Revient au menu principal comme au clavier (flèche bas pour sortir d'un champ, Échap pour l'accueil,
// flèche gauche vers le menu), y déplace le focus jusqu'à la section voulue, puis valide avec Entrée.
async function goByKeyboard(section) {
  for (let i = 0, place; i < 15 && (place = await focusPlace()) !== 'menu'; i++) await page.keyboard.press(KEY_TO_MENU[place]);
  const key = RAIL.indexOf(await focused()) > RAIL.indexOf(section) ? 'ArrowUp' : 'ArrowDown';
  for (let i = 0; i < 20 && (await focused()) !== section; i++) await page.keyboard.press(key);
  assert.equal(await focused(), section, `le menu n'atteint pas la section ${section}`);
  await page.keyboard.press('Enter');
}

async function expectSection(section, title) {
  await page.waitForFunction((s) => document.body.dataset.section === s, section);
  assert.equal(await page.locator('#title').textContent(), title);
  await page.locator('#view').getByText(FILLED[section]).first().waitFor({ timeout: 15000 });
}

describe('Test de fumée de Mire', () => {
  before(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    const data = prepareData();
    proxy = await startProxy();
    const netlog = path.join(tmp, 'reseau.log');
    fs.writeFileSync(netlog, '');
    app = await electron.launch({
      cwd: ROOT,
      // --no-sandbox : le bac à sable de Chromium n'est pas disponible sous root ni dans les conteneurs de CI.
      // -r : le journal réseau est chargé avant le processus principal (dist/main/index.js), comme le chargeur de Playwright.
      args: ['-r', path.join(__dirname, 'net-guard.js'), ROOT, '--no-sandbox', `--proxy-server=http://127.0.0.1:${proxy.address().port}`],
      env: {
        ...process.env,
        MIRE_USER_DATA: data,
        TZ: 'Europe/Paris',
        MIRE_E2E_NETLOG: netlog,
      },
      timeout: 60000,
    });
    app.process().stderr.on('data', (d) => process.stderr.write(d));
    page = await app.firstWindow();
    // Taille fixe, quel que soit l'écran : les captures restent comparables d'une machine à l'autre.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setFullScreen(false);
      win.setContentSize(1600, 900);
    });
    // Heure figée (celle des aperçus de thèmes) : l'horloge de l'accueil ne change plus d'une capture à l'autre.
    await page.clock.setFixedTime(new Date('2026-10-30T20:45:00+01:00'));
    await page.waitForFunction(() => document.getElementById('clock').textContent === '20:45', null, { timeout: 10000 });
  });

  after(async () => {
    await app?.close();
    proxy?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("l'accueil s'affiche", async () => {
    await page.locator('.mire-bar').first().waitFor();
    assert.equal(await page.locator('#title').textContent(), 'Accueil');
    await settle();
    await shot('accueil-ecran');
  });

  it('chaque section s’affiche, atteinte au clavier', async () => {
    await page.locator('.mire-bar').first().focus();
    await page.keyboard.press('ArrowLeft');
    for (const [section, title] of SECTIONS) {
      await goByKeyboard(section);
      if (section === 'search') await page.keyboard.type('Amélie');
      await expectSection(section, title);
      await settle();
      await shot(`section-${section}`);
    }
  });

  it("le rouage ouvre les réglages d'une page", async () => {
    await goByKeyboard('videos');
    await expectSection('videos', 'Vidéos');
    await page.locator('#page-gear').click();
    await page.locator('#panel[open]').waitFor();
    await settle();
    await shot('rouage-videos');
    await page.keyboard.press('Escape');
    await page.locator('#panel:not([open])').waitFor({ state: 'attached' });
    await settle();
  });

  // Composants de l'interface (P4-01) : chargeur de dot-stash sous la CSP, composants mire-* de @mire/ui, ds-trigger.
  // Tests de composants dans Electron, le moteur de Mire, sans autre outil que Playwright (docs/adr/0001-dot-stash.md).
  it("la page de démonstration de l'interface affiche les composants ds-* et mire-demo", async () => {
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    page.on('pageerror', onError);
    page.on('console', onConsole);
    try {
      // Textes attendus : ceux des catalogues, dans la langue retenue par Mire.
      const texts = await page.evaluate(async () => {
        const info = await window.api.i18nGet();
        const demo = info.catalogs[info.language].messages.demo;
        return { lang: info.language, title: demo.title, count: demo.component.count };
      });
      const countText = (n) => (new Intl.PluralRules(texts.lang).select(n) === 'one' ? texts.count.one : texts.count.other).replace('{count}', n);

      await page.evaluate(() => (location.hash = 'demo'));
      await page.waitForFunction(() => document.body.dataset.section === 'demo');
      assert.equal(await page.locator('#title').textContent(), texts.title);
      const trigger = page.locator('mire-demo .mire-demo__action');
      await trigger.and(page.locator('.hydrated')).waitFor();
      // Chaque composant ds-* de la page a été chargé par le chargeur paresseux (classe hydrated).
      await page.waitForFunction(() =>
        [...document.querySelectorAll('#view *')].filter((e) => e.localName.startsWith('ds-')).every((e) => e.classList.contains('hydrated')),
      );
      assert.equal(await page.locator('.mire-ui-demo__palette').count(), 5);
      // Chaque cadre affiche sa palette : son fond est celui de palette.json.
      const frames = await page.$$eval('.mire-ui-demo__palette', (els) => els.map((e) => [e.dataset.palette, getComputedStyle(e).backgroundColor]));
      assert.deepEqual(
        frames,
        THEMES.map((id) => [id, hexToRgb(JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'palettes', id, 'palette.json'), 'utf8')).background)]),
      );
      assert.equal(await page.locator('mire-demo .mire-demo__count').textContent(), countText(0));

      // ds-trigger appelle la méthode publique du composant : au clic, puis à la touche Entrée (une seule fois).
      await page.evaluate(() => {
        window.__mireDemo = [];
        document.querySelector('mire-demo').addEventListener('mireDemoChange', (e) => window.__mireDemo.push(e.detail.count));
      });
      await trigger.click();
      await page.locator('mire-demo .mire-demo__count', { hasText: countText(1) }).waitFor();
      // Dernière action au clavier : le focus donné ensuite est visible (:focus-visible), comme à la manette.
      await page.keyboard.press('Shift');
      await trigger.focus();
      // Anneau de focus de Mire (accent de la section, épaisseur de la palette), pas celui du navigateur.
      const ring = await trigger.evaluate((e) => {
        const s = getComputedStyle(e);
        const probe = document.createElement('span');
        probe.style.color = getComputedStyle(document.body).getPropertyValue('--ring');
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor, expected: color };
      });
      assert.deepEqual(ring, { style: 'solid', width: '3px', color: ring.expected, expected: ring.expected });
      await page.keyboard.press('Enter');
      await page.locator('mire-demo .mire-demo__count', { hasText: countText(2) }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.__mireDemo), [1, 2]);

      // La CSP de la fenêtre principale est inchangée.
      const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
      assert.equal(
        csp,
        "default-src 'self'; img-src 'self' media: data: blob: https: http:; media-src 'self' media: blob: http: https:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self' media:",
      );
      await settle();
      await shot('demo-interface');
      assert.deepEqual(errors, []);
    } finally {
      page.off('pageerror', onError);
      page.off('console', onConsole);
      await page.evaluate(() => (location.hash = ''));
    }
  });

  // Contrôleurs et traduction (P4-04) : un ds-trigger appelle une action de mire-app ; le document porte la langue de
  // l'interface, les vues historiques restent marquées en français.
  it('un ds-trigger appelle les actions des contrôleurs, et le document porte la langue de l’interface', async () => {
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    page.on('pageerror', onError);
    page.on('console', onConsole);
    try {
      const lang = await page.evaluate(async () => (await window.api.i18nGet()).language);
      await page.waitForFunction((l) => document.documentElement.lang === l, lang);
      assert.equal(await page.evaluate(() => document.body.lang), 'fr');

      await page.evaluate(() => {
        const t = document.createElement('ds-trigger');
        t.id = 'e2e-trigger';
        t.setAttribute('target', 'mire-app');
        t.setAttribute('action', 'go:[{"section":"settings"}]');
        t.style.cssText = 'position: fixed; top: 0; left: 50%; z-index: 9999';
        t.textContent = 'Réglages';
        document.body.append(t);
      });
      const trigger = page.locator('#e2e-trigger');
      await trigger.and(page.locator('.hydrated')).waitFor();
      await trigger.click();
      await page.waitForFunction(() => document.body.dataset.section === 'settings');
      assert.equal(await trigger.getAttribute('aria-busy'), null);
      assert.deepEqual(errors, []);
    } finally {
      page.off('pageerror', onError);
      page.off('console', onConsole);
      await page.evaluate(() => document.getElementById('e2e-trigger')?.remove());
      await goByKeyboard('home');
    }
  });

  it("l'accueil s'affiche dans chaque thème", async () => {
    // Changer de palette ne recharge pas la page : le marqueur posé ici doit survivre aux changements.
    await page.evaluate(() => (window.__sansRechargement = true));
    for (const theme of THEMES.slice(1)) {
      await goByKeyboard('settings');
      await page.locator(`.theme-card[data-id="${theme}"]`).click();
      await page.waitForFunction((t) => document.documentElement.dataset.palette === t, theme);
      // Couleur de fond de la palette (palette.json), appliquée tout de suite.
      const bg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'palettes', theme, 'palette.json'), 'utf8')).background;
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), hexToRgb(bg));
      await goByKeyboard('home');
      await page.waitForFunction(() => document.body.dataset.section === 'home');
      await settle();
      await shot(`accueil-${theme}`);
    }
    assert.equal(await page.evaluate(() => window.__sansRechargement), true);
  });

  it('aucune requête réseau sortante, hors Widevine', () => {
    const log = fs
      .readFileSync(path.join(tmp, 'reseau.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert.ok(
      log.some((e) => e.kind === 'pret'),
      'le journal réseau du processus principal est inactif',
    );
    const node = log.filter((e) => e.kind !== 'pret');
    const widevine = chromiumRequests.filter(isWidevine);
    if (widevine.length) console.log(`Widevine (refusé par le proxy du test) : ${[...new Set(widevine)].join(', ')}`);
    assert.deepEqual({ chromium: chromiumRequests.filter((u) => !isWidevine(u)), node }, { chromium: [], node: [] });
  });
});
