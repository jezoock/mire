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
// Palettes du cœur (P5-02) ; Plein jour, Minuit et Velours viennent d'un plugin factice (test/e2e/palettes/), posé dans
// le dossier de données comme un plugin installé.
const CORE_PALETTES = ['ecran', 'contraste'];
const PALETTE_PLUGIN = path.join(__dirname, 'palettes', 'org.exemple.palettes');
// Service de streaming d'un plugin factice (P5-05), installé à la main comme le plugin de palettes.
const SERVICE_PLUGIN = path.join(__dirname, 'webapps', 'org.exemple.service');
// Fond d'une palette : palette.json pour celles du cœur, jeton `bg` du plugin factice pour les autres.
const paletteBackground = (id) =>
  CORE_PALETTES.includes(id)
    ? JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'palettes', id, 'palette.json'), 'utf8')).background
    : JSON.parse(fs.readFileSync(path.join(PALETTE_PLUGIN, 'palettes', `${id}.json`), 'utf8')).tokens.bg;
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
  ['downloads', 'Centre'],
  ['settings', 'Réglages'],
];
// Sections historiques des pages (P4-11) : le menu ouvre la vue de page, « Ancienne vue » la section historique.
const LEGACY_PAGES = new Set(['videos', 'music', 'images', 'streaming', 'tv', 'games']);
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
  settings: 'Apparence',
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
  // Plugin de palettes factice, installé à la main : userData/plugins/<id>/<version>/ (P5-02).
  fs.cpSync(PALETTE_PLUGIN, path.join(data, 'plugins', 'org.exemple.palettes', '1.0.0'), { recursive: true });
  fs.cpSync(SERVICE_PLUGIN, path.join(data, 'plugins', 'org.exemple.service', '1.0.0'), { recursive: true });
  return data;
}

// #RRGGBB → rgb(r, g, b), comme le rend getComputedStyle.
const hexToRgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

async function shot(name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

// Attend qu'une vérification (fonction de Node, qui peut lire la page) soit vraie. waitForFunction ne convient pas
// quand la condition passe par window.api : il ne résout pas la promesse renvoyée, toujours « vraie ».
async function until(check, { timeout = 30000 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Attente dépassée (${timeout} ms) : ${check.toString().slice(0, 160)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
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
    return a?.closest('.mire-home-view__bar') ? 'barres' : 'accueil';
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

// Depuis la vue de page qu'ouvre le menu, passe à la section historique de la page (« Ancienne vue »).
async function openLegacy(section) {
  if (!LEGACY_PAGES.has(section)) return;
  await page.waitForFunction(() => document.body.dataset.section === 'page');
  const link = page.locator('#view mire-page-view .mire-page-view__legacy.hydrated');
  await link.waitFor();
  await link.click();
}

async function expectSection(section, title) {
  await page.waitForFunction((s) => document.body.dataset.section === s, section);
  // Le titre est rendu par mire-header (P4-07), à l'image suivante : on l'attend un peu avant de le comparer.
  await page.waitForFunction((t) => document.getElementById('title')?.textContent === t, title, { timeout: 2000 }).catch(() => {});
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
      // Fenêtre de Mire : pas celle, cachée, de l'hôte isolé des plugins de code (`mire-plugin://host`, P5-09).
      const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith('mire-plugin:'));
      win.setFullScreen(false);
      win.setContentSize(1600, 900);
    });
    // Heure figée (celle des aperçus de thèmes) : l'horloge de l'accueil ne change plus d'une capture à l'autre.
    await page.clock.setFixedTime(new Date('2026-10-30T20:45:00+01:00'));
    // L'horloge est rendue par mire-header : elle peut manquer aux premières images (?. : l'attente continue).
    await page.waitForFunction(() => document.getElementById('clock')?.textContent === '20:45', null, { timeout: 10000 });
    // Plugins démarrés, palettes du plugin factice connues de l'interface (P5-02).
    await until(() => page.evaluate(() => window.api.palettesList().then((p) => p.ready && p.palettes.length === 3)), { timeout: 20000 });
    // Pages prêtes à l'emploi des plugins (P5-03) : le menu les montre, quel que soit le moment où elles sont arrivées.
    await page.locator('#rail .rail-item[data-key="movies"]').waitFor();
  });

  after(async () => {
    await app?.close();
    proxy?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("l'accueil s'affiche", async () => {
    await page.locator('.mire-home-view__bar.hydrated').first().waitFor();
    assert.equal(await page.locator('#title').textContent(), 'Accueil');
    await settle();
    await shot('accueil-ecran');
  });

  it('chaque section s’affiche, atteinte au clavier', async () => {
    await page.locator('.mire-home-view__bar.hydrated').first().focus();
    await page.keyboard.press('ArrowLeft');
    for (const [section, title] of SECTIONS) {
      await goByKeyboard(section);
      await openLegacy(section);
      if (section === 'search') {
        // La Recherche (P4-13) est rendue à son premier affichage : on tape une fois le champ prêt.
        await page.waitForFunction(() => document.activeElement?.classList.contains('mire-search-view__input'));
        await page.keyboard.type('Amélie');
      }
      await expectSection(section, title);
      await settle();
      await shot(`section-${section}`);
    }
  });

  it("le rouage ouvre les réglages d'une page", async () => {
    await goByKeyboard('videos');
    await openLegacy('videos');
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
      // Les palettes du cœur (celles des plugins n'y figurent pas, P5-02).
      assert.equal(await page.locator('.mire-ui-demo__palette').count(), CORE_PALETTES.length);
      // Chaque cadre affiche sa palette : son fond est celui de palette.json.
      const frames = await page.$$eval('.mire-ui-demo__palette', (els) => els.map((e) => [e.dataset.palette, getComputedStyle(e).backgroundColor]));
      assert.deepEqual(
        frames,
        CORE_PALETTES.map((id) => [id, hexToRgb(paletteBackground(id))]),
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
  // l'interface, les vues historiques restent marquées en français (sur leurs hôtes dans la coquille depuis P4-07).
  it('un ds-trigger appelle les actions des contrôleurs, et le document porte la langue de l’interface', async () => {
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    page.on('pageerror', onError);
    page.on('console', onConsole);
    try {
      const lang = await page.evaluate(async () => (await window.api.i18nGet()).language);
      await page.waitForFunction((l) => document.documentElement.lang === l, lang);
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('mire-legacy-view')].map((v) => v.lang)), ['fr', 'fr']);

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
      await page.locator(`#view .mire-settings-view__palette.hydrated[data-key="${theme}"]`).click();
      await page.waitForFunction((t) => document.documentElement.dataset.palette === t, theme);
      // Couleur de fond de la palette (palette.json, ou jeton du plugin factice), appliquée tout de suite.
      const bg = paletteBackground(theme);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), hexToRgb(bg));
      await goByKeyboard('home');
      await page.waitForFunction(() => document.body.dataset.section === 'home');
      await settle();
      await shot(`accueil-${theme}`);
    }
    assert.equal(await page.evaluate(() => window.__sansRechargement), true);
  });

  // Service de focus (P4-03) : banc d'essai de composants inséré dans la vue de la page de démonstration.
  describe('navigation sur les composants (P4-03)', () => {
    const FIXTURE = `<div id="e2e-nav" style="display: grid; gap: 24px; padding: 16px">
      <div style="display: flex; gap: 24px">
        <button class="focusable" id="n-start">Départ</button>
        <ds-trigger id="n-a" type="button">A</ds-trigger>
        <ds-trigger id="n-b" type="button" disabled>B</ds-trigger>
        <ds-trigger id="n-c"><button aria-disabled="true">C</button></ds-trigger>
        <ds-trigger id="n-off" disabled><button>Off</button></ds-trigger>
        <ds-trigger id="n-d" type="button">D</ds-trigger>
      </div>
      <div data-nav="columns" id="n-cols" style="display: flex; gap: 24px; align-items: flex-start; margin-top: 160px">
        <div data-nav-column id="n-col1" style="display: grid; gap: 8px; max-height: 120px; overflow-y: auto">
          ${[1, 2, 3, 4, 5, 6].map((i) => `<ds-trigger id="n-r1-${i}" type="button" style="display: block; height: 32px">1.${i}</ds-trigger>`).join('')}
        </div>
        <div data-nav-column id="n-col2" style="display: grid; gap: 8px">
          ${[1, 2, 3].map((i) => `<ds-trigger id="n-r2-${i}" type="button"${i === 3 ? ' aria-current="true"' : ''}>2.${i}</ds-trigger>`).join('')}
        </div>
        <div data-nav-column id="n-col3"></div>
        <div data-nav-column id="n-col4"><ds-trigger id="n-r4-1" type="button">4.1</ds-trigger></div>
      </div>
      <div style="display: flex; gap: 24px; align-items: center">
        <ds-trigger id="n-below" type="button">Dessous</ds-trigger>
        <ds-panel-group id="n-tabs" label="Onglets">
          <ds-panel><span slot="title">Un</span><p>Premier</p></ds-panel>
          <ds-panel><span slot="title">Deux</span><p>Deuxième</p></ds-panel>
        </ds-panel-group>
        <ds-combo id="n-combo" label="Liste" options='[{"name":"Un","value":"1"},{"name":"Deux","value":"2"},{"name":"Trois","value":"3"}]'></ds-combo>
      </div>
      <ds-modal id="n-modal" label="Fenêtre">
        <ds-trigger id="n-m1" type="button">M1</ds-trigger>
        <ds-trigger id="n-m2" type="button">M2</ds-trigger>
      </ds-modal>
    </div>`;
    const active = () => page.evaluate(() => document.activeElement?.closest('[id]')?.id ?? null);
    const press = async (key) => {
      await page.keyboard.press(key);
      await settle();
    };
    const PAD = { a: 0, b: 1, up: 12, down: 13, left: 14, right: 15 };
    // Manette simulée (API Gamepad) : un appui = bouton enfoncé pendant quelques images, puis relâché.
    // Enfoncé moins longtemps que le délai de répétition des directions (REPEAT_DELAY).
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => (window.__pad.buttons[n] = { pressed: false, value: 0 }), PAD[button]);
      await settle();
    };
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());

    before(async () => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
      await page.evaluate(() => (location.hash = ''));
      await page.evaluate(() => (location.hash = 'demo'));
      await page.waitForFunction(() => document.body.dataset.section === 'demo');
      await page.locator('#view mire-demo.hydrated').waitFor();
    });

    after(async () => {
      page.off('pageerror', onError);
      page.off('console', onConsole);
      await page.evaluate(() => {
        document.getElementById('e2e-nav')?.remove();
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
        }
        location.hash = '';
      });
    });

    it('attend le rendu des composants, puis les flèches les parcourent en écartant les désactivés', async () => {
      // Flèche envoyée juste après l'insertion, avant le rendu des ds-* : le choix attend la classe hydrated.
      const first = await page.evaluate((html) => {
        document.getElementById('view').insertAdjacentHTML('beforeend', html);
        const start = document.getElementById('n-start');
        start.focus();
        const hydrated = document.getElementById('n-a').classList.contains('hydrated');
        start.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        return { hydrated, focus: document.activeElement.id };
      }, FIXTURE);
      assert.deepEqual(first, { hydrated: false, focus: 'n-start' });
      await page.waitForFunction(() => document.activeElement?.id === 'n-a');
      // B (disabled), C (aria-disabled) et le bouton d'un ds-trigger désactivé ne sont pas des destinations.
      await press('ArrowRight');
      assert.equal(await active(), 'n-d');
      await press('ArrowLeft');
      assert.equal(await active(), 'n-a');
      await press('ArrowLeft');
      assert.equal(await active(), 'n-start');
    });

    it('Entrée et Espace déclenchent une seule fois un ds-trigger', async () => {
      await page.evaluate(() => {
        window.__clicks = 0;
        document.getElementById('n-a').addEventListener('click', () => window.__clicks++);
        document.getElementById('n-a').focus();
      });
      await press('Enter');
      assert.equal(await page.evaluate(() => window.__clicks), 1);
      await press(' ');
      assert.equal(await page.evaluate(() => window.__clicks), 2);
    });

    it('colonnes : haut et bas dans la colonne, gauche et droite de colonne en colonne', async () => {
      await page.evaluate(() => document.getElementById('n-r1-2').focus());
      await press('ArrowDown');
      assert.equal(await active(), 'n-r1-3');
      await press('ArrowRight');
      assert.equal(await active(), 'n-r2-3', 'la ligne en cours de la colonne voisine');
      await press('ArrowUp');
      assert.equal(await active(), 'n-r2-2', 'haut dans la colonne');
      await press('ArrowRight');
      assert.equal(await active(), 'n-r4-1', 'la colonne vide est sautée');
      await press('ArrowLeft');
      assert.equal(await active(), 'n-r2-2', 'la dernière ligne visitée');
      await press('ArrowLeft');
      assert.equal(await active(), 'n-r1-3', 'la dernière ligne visitée');
      for (let i = 0; i < 3; i++) await press('ArrowDown');
      assert.equal(await active(), 'n-r1-6');
      await press('ArrowDown');
      assert.equal(await active(), 'n-below', 'au bord, on sort du conteneur');
      await press('ArrowUp');
      assert.notEqual(await active(), 'n-below');
    });

    it('onglets et liste déroulante gardent leurs flèches', async () => {
      await page.locator('#n-tabs [role="tab"]').first().focus();
      await press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Deux', 'un seul onglet plus loin');
      await press('ArrowDown');
      assert.notEqual(await page.evaluate(() => document.activeElement.getAttribute('role')), 'tab', 'bas quitte les onglets');

      await page.locator('#n-combo [role="combobox"]').focus();
      await press('Enter');
      await page.waitForFunction(() => document.querySelector('#n-combo [role="combobox"]').getAttribute('aria-expanded') === 'true');
      await press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.closest('ds-combo')?.id), 'n-combo', 'la liste ouverte garde le focus');
      await press('Escape');
      assert.equal(await page.evaluate(() => document.body.dataset.section), 'demo', 'Échap ferme la liste, sans retour');
      assert.equal(await page.locator('#n-combo [role="combobox"]').getAttribute('aria-expanded'), 'false');
    });

    it('ds-modal : les flèches restent dans la fenêtre au premier plan', async () => {
      await page.evaluate(() => document.getElementById('n-a').focus());
      await page.evaluate(() => (document.getElementById('n-modal').shown = true));
      await page.waitForFunction(() => document.activeElement?.id === 'n-m1');
      await press('ArrowRight');
      assert.equal(await active(), 'n-m2');
      await press('ArrowDown');
      await press('ArrowRight');
      assert.equal(await active(), 'n-m2', 'aucune destination hors de la fenêtre');
      await press('Escape');
      await page.waitForFunction(() => document.activeElement?.id === 'n-a');
      assert.equal(await page.evaluate(() => document.body.dataset.section), 'demo');
    });

    it('manette : croix, A une seule fois, B ferme la fenêtre, colonnes et stick droit', async () => {
      await page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
        window.__clicks = 0;
        document.getElementById('n-a').focus();
      });
      await page.waitForFunction(() => !document.getElementById('padbar').hidden);
      await padPress('right');
      assert.equal(await active(), 'n-d');
      await padPress('left');
      await padPress('a');
      assert.equal(await page.evaluate(() => window.__clicks), 1, 'A clique une seule fois');

      await page.evaluate(() => (document.getElementById('n-modal').shown = true));
      await page.waitForFunction(() => document.activeElement?.id === 'n-m1');
      await padPress('right');
      assert.equal(await active(), 'n-m2');
      await padPress('b');
      await page.waitForFunction(() => !document.getElementById('n-modal').shown);
      assert.equal(await active(), 'n-a');

      await page.evaluate(() => document.getElementById('n-r1-1').focus());
      await settle();
      const hints = await page.locator('#padbar').innerHTML();
      await padPress('down');
      assert.equal(await active(), 'n-r1-2');
      await padPress('right');
      assert.equal(await active(), 'n-r2-2', 'la dernière ligne visitée au clavier');
      await padPress('left');
      assert.equal(await page.locator('#padbar').innerHTML(), hints);
      // Stick droit : la colonne qui a le focus défile, pas la vue.
      const before = await page.evaluate(() => [document.getElementById('n-col1').scrollTop, document.getElementById('view').scrollTop]);
      await page.evaluate(() => (window.__pad.axes = [0, 0, 0, 1]));
      await settle();
      await page.evaluate(() => (window.__pad.axes = [0, 0, 0, 0]));
      const after = await page.evaluate(() => [document.getElementById('n-col1').scrollTop, document.getElementById('view').scrollTop]);
      assert.ok(after[0] > before[0], 'la colonne défile');
      assert.equal(after[1], before[1], 'la vue ne défile pas');
      assert.deepEqual(errors, []);
    });
  });

  describe("composants d'éléments (P4-05)", () => {
    const PAD = { a: 0, b: 1, up: 12, down: 13, left: 14, right: 15 };
    const activeKey = () => page.evaluate(() => document.activeElement?.closest('[data-key]')?.getAttribute('data-key') ?? null);
    // Manette simulée (API Gamepad), comme pour la navigation sur les composants (P4-03).
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => (window.__pad.buttons[n] = { pressed: false, value: 0 }), PAD[button]);
      await settle();
    };
    // Cartes rendues : chaque mire-card et ses ds-* ont la classe hydrated (rendu asynchrone des deux moteurs).
    const cardsReady = (selector) =>
      page.waitForFunction((sel) => {
        const cards = [...document.querySelectorAll(`${sel} mire-card, ${sel} mire-group-card`)];
        return (
          cards.length > 0 &&
          cards.every((c) => c.classList.contains('hydrated') && [...c.querySelectorAll('ds-trigger, ds-thumb')].every((d) => d.classList.contains('hydrated')))
        );
      }, selector);
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());

    before(async () => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
      await page.evaluate(() => (location.hash = ''));
      await page.evaluate(() => (location.hash = 'demo'));
      await page.waitForFunction(() => document.body.dataset.section === 'demo');
      await cardsReady('#view .mire-ui-demo__elements');
    });

    after(async () => {
      page.off('pageerror', onError);
      page.off('console', onConsole);
      await page.evaluate(() => {
        document.getElementById('e2e-grid')?.remove();
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
        }
        location.hash = '';
      });
    });

    it('rendu : cartes, regroupements, « Afficher plus », infos et fond ; les actions désignent les éléments par leur clé', async () => {
      const shown = await page.evaluate(() => {
        const row = document.querySelector('.mire-ui-demo mire-row');
        const cards = [...row.querySelectorAll('mire-card ds-trigger')];
        const group = document.querySelector('.mire-ui-demo mire-group-card ds-trigger');
        return {
          row: cards.length,
          inScroller: !!row.querySelector('ds-scroller mire-card'),
          // Posés par le JSX de Stencil en propriétés du ds-trigger (pas en attributs).
          action: cards[0].action,
          label: cards[0].label,
          gauges: row.querySelectorAll('.mire-card__progress').length,
          group: group.action,
          badge: document.querySelector('.mire-ui-demo mire-card[class*="--unavailable"] .mire-card__badge')?.textContent ?? null,
          // Grille virtualisée : seules les cartes proches de l'écran sont rendues ; chaque groupe en annonce 12.
          sizes: [...document.querySelectorAll('.mire-ui-demo mire-grid:not([variant="line"]) .mire-grid__group')].map((g) =>
            g.querySelector('mire-card')?.getAttribute('aria-setsize'),
          ),
          more: [...document.querySelectorAll('.mire-ui-demo mire-grid:not([variant="line"]) .mire-grid__more')].map((b) => b.textContent.trim()),
        };
      });
      const texts = await page.evaluate(async () => {
        const info = await window.api.i18nGet();
        const m = info.catalogs[info.language].messages;
        const rules = new Intl.PluralRules(info.language);
        return {
          unavailable: m.elements.card.unavailable,
          progress: m.elements.card.progress,
          more: m.elements.grid.more[rules.select(18)] ?? m.elements.grid.more.other,
        };
      });
      assert.equal(shown.row, 12);
      assert.ok(shown.inScroller, 'les cartes de la rangée sont dans le ds-scroller');
      assert.equal(shown.action, 'pick:[{"key":"demo:rangee/1"}]');
      assert.match(shown.label, new RegExp(texts.progress.replace('{percent}', '25').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(shown.gauges, 3);
      assert.match(shown.group, /^pick:\[\{"value":/);
      assert.equal(shown.badge, texts.unavailable);
      assert.deepEqual(shown.sizes, ['12', '12', '12'], 'trois groupes de 12 cartes avant « Afficher plus »');
      assert.deepEqual(shown.more, Array(3).fill(texts.more.replace('{count}', '18')));

      // Un clic sur une carte appelle l'action avec la clé de l'élément.
      const picked = page.evaluate(() => new Promise((resolve) => document.addEventListener('mireDemoPick', (e) => resolve(e.detail), { once: true })));
      await page.locator('.mire-ui-demo mire-row mire-card ds-trigger').nth(2).click();
      assert.deepEqual(await picked, { key: 'demo:rangee/3' });

      // « Afficher plus » : 12 cartes de plus dans le premier groupe, le focus va à la première nouvelle carte.
      await page.locator('.mire-ui-demo mire-grid:not([variant="line"]) .mire-grid__more').first().click();
      await page.waitForFunction(() => document.activeElement?.closest('[data-key]')?.getAttribute('data-key') === 'demo:groupe-1/13');
      assert.equal(
        await page.locator('.mire-ui-demo mire-grid:not([variant="line"]) .mire-grid__group').first().locator('mire-card').first().getAttribute('aria-setsize'),
        '24',
      );

      // Panneau d'infos et fond suivent la carte qui a le focus ; le fond passe d'une image à l'autre en fondu.
      await page.locator('.mire-ui-demo mire-row mire-card ds-trigger').first().focus();
      await page.waitForFunction(
        () =>
          document.querySelector('.mire-ui-demo mire-focus-info .mire-focus-info__title')?.textContent ===
          document.querySelector('.mire-ui-demo mire-row mire-card .mire-card__title').textContent,
      );
      const pictures = path.join(tmp, 'fixtures', 'bibliotheque', 'Images', 'Vacances');
      for (const name of ['Montagne.png', 'Plage.png']) {
        await page.evaluate((src) => (document.querySelector('.mire-ui-demo mire-backdrop').src = src), path.join(pictures, name));
        await page.waitForFunction(
          (n) => decodeURIComponent(document.querySelector('.mire-ui-demo mire-backdrop img.--front')?.getAttribute('src') ?? '').endsWith(n),
          name,
        );
      }
      assert.equal(await page.locator('.mire-ui-demo mire-backdrop img').count(), 2, 'deux calques, l’ancien derrière le nouveau');
      assert.deepEqual(errors, []);
    });

    it('manette : la croix parcourt une rangée et une grille, A ouvre la carte par sa clé', async () => {
      await page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
        document.querySelector('.mire-ui-demo mire-row mire-card ds-trigger').focus();
      });
      await page.waitForFunction(() => !document.getElementById('padbar').hidden);
      // Rangée : droite et gauche de carte en carte.
      await padPress('right');
      assert.equal(await activeKey(), 'demo:rangee/2');
      await padPress('right');
      assert.equal(await activeKey(), 'demo:rangee/3');
      await padPress('left');
      assert.equal(await activeKey(), 'demo:rangee/2');

      // Grille : droite passe à la carte suivante, bas à celle de la ligne suivante, même colonne.
      const columns = await page.evaluate(() => {
        const first = document.querySelector('.mire-ui-demo mire-grid:not([variant="line"]) mire-card ds-trigger');
        first.scrollIntoView({ block: 'center' });
        first.focus();
        return getComputedStyle(first.closest('.mire-grid__items')).gridTemplateColumns.split(' ').length;
      });
      await settle();
      assert.ok(columns >= 2, `${columns} colonnes`);
      await padPress('right');
      assert.equal(await activeKey(), 'demo:groupe-1/2');
      await padPress('down');
      assert.equal(await activeKey(), `demo:groupe-1/${2 + columns}`);
      const picked = page.evaluate(() => new Promise((resolve) => document.addEventListener('mireDemoPick', (e) => resolve(e.detail), { once: true })));
      await padPress('a');
      assert.deepEqual(await picked, { key: `demo:groupe-1/${2 + columns}` });
      assert.deepEqual(errors, []);
    });

    it('une grille de 5 000 éléments reste fluide (virtualisée)', async () => {
      const COUNT = 5000;
      // Mémoire du renderer après un ramasse-miettes, par le protocole de Chromium (performance.memory est arrondie).
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const memory = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        const { metrics } = await cdp.send('Performance.getMetrics');
        const get = (name) => metrics.find((m) => m.name === name)?.value ?? 0;
        return { heap: get('JSHeapUsedSize'), nodes: get('Nodes') };
      };
      const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;
      const m0 = await memory();
      const first = await page.evaluate(async (count) => {
        const elements = Array.from({ length: count }, (_, i) => ({
          key: `e2e:${i}`,
          name: `Élément ${i + 1}`,
          images: {},
          infos: { year: 1990 + (i % 30) },
          tags: [],
        }));
        const t0 = performance.now();
        const box = document.createElement('div');
        box.id = 'e2e-grid';
        const grid = document.createElement('mire-grid');
        grid.setAttribute('target', 'mire-demo');
        grid.setAttribute('action', 'pick');
        grid.elements = elements;
        box.append(grid);
        // Vue remise en haut avant l'insertion : insérée au-dessus d'une vue défilée, la grille la décalerait de toute sa
        // hauteur (ancrage du défilement du navigateur).
        document.getElementById('view').scrollTop = 0;
        document.querySelector('.mire-ui-demo').prepend(box);
        const ready = () => {
          const cards = [...grid.querySelectorAll('mire-card')];
          return grid.classList.contains('hydrated') && cards.length > 0 && cards.every((c) => c.querySelector('ds-trigger.hydrated ds-thumb.hydrated'));
        };
        while (!ready() && performance.now() - t0 < 15000) await new Promise((r) => requestAnimationFrame(r));
        // Une image de plus : la mise en page des cartes est faite et affichée.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return {
          firstRender: Math.round(performance.now() - t0),
          cards: grid.querySelectorAll('mire-card').length,
          height: Math.round(grid.getBoundingClientRect().height),
          columns: getComputedStyle(grid.querySelector('.mire-grid__items')).gridTemplateColumns.split(' ').length,
        };
      }, COUNT);
      assert.ok(first.cards < 300, `${first.cards} cartes rendues sur ${COUNT}`);
      // Flèche bas, 20 fois : temps entre la touche et le focus sur la carte de la ligne suivante.
      const m1 = await memory();
      Object.assign(first, { heapMb: mb(m1.heap - m0.heap), nodes: m1.nodes - m0.nodes });
      const start = await page.evaluate(() => {
        const el = document.querySelector('#e2e-grid mire-card ds-trigger');
        el.focus();
        return Number(el.dataset.key.split(':')[1]);
      });
      await settle();
      const times = [];
      for (let i = 0; i < 20; i++) {
        times.push(
          await page.evaluate(async () => {
            const from = document.activeElement;
            const t0 = performance.now();
            from.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
            while (document.activeElement === from && performance.now() - t0 < 3000) await new Promise((r) => requestAnimationFrame(r));
            return performance.now() - t0;
          }),
        );
        // La page défile (en douceur) et la grille rend les lignes suivantes : comme un appui tenu, une touche par 100 ms.
        await page.waitForTimeout(100);
      }
      times.sort((a, b) => a - b);
      const moves = await page.evaluate(() => ({
        key: document.activeElement.closest('[data-key]')?.getAttribute('data-key'),
        cards: document.querySelectorAll('#e2e-grid mire-card').length,
      }));
      const m2 = await memory();
      Object.assign(moves, {
        median: Math.round(times[10] * 10) / 10,
        max: Math.round(times[19] * 10) / 10,
        heapMb: mb(m2.heap - m0.heap),
        nodes: m2.nodes - m0.nodes,
      });
      await cdp.detach();
      console.log(`Grille de ${COUNT} éléments : ${JSON.stringify({ ...first, moves })}`);
      assert.equal(moves.key, `e2e:${start + 20 * first.columns}`, 'vingt lignes plus bas, même colonne');
      assert.ok(moves.cards < 300, `${moves.cards} cartes rendues après le défilement`);
      assert.ok(first.firstRender < 3000, `premier rendu : ${first.firstRender} ms`);
      assert.ok(moves.median < 100, `déplacement du focus : ${moves.median} ms (médiane)`);
      assert.deepEqual(errors, []);
    });
  });

  // Boîtes de dialogue sur les composants (P4-06) : ouvertes depuis la démonstration (#demo), au clavier et à la
  // manette, empilées, depuis une boîte historique ; la vue web native est masquée tant qu'une boîte est ouverte.
  describe('boîtes de dialogue (P4-06)', () => {
    const PAD = { a: 0, b: 1, up: 12, down: 13, left: 14, right: 15 };
    const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => (window.__pad.buttons[n] = { pressed: false, value: 0 }), PAD[button]);
      await frames();
    };
    const press = async (key) => {
      await page.keyboard.press(key);
      await frames();
    };
    // Boîtes rendues et ouvertes : chaque composant et ses ds-* ont la classe hydrated, chaque ds-modal est affiché, et
    // le focus est entré dans la dernière.
    const boxOpen = (tag, count = 1) =>
      page.waitForFunction(
        ({ tag, count }) => {
          const boxes = [...document.querySelectorAll(tag)];
          const ready = (b) =>
            b.classList.contains('hydrated') && [...b.querySelectorAll('ds-modal, ds-trigger')].every((d) => d.classList.contains('hydrated'));
          const focusIn = document.activeElement?.closest(tag) === boxes.at(-1);
          return boxes.length === count && boxes.every(ready) && boxes.every((b) => b.querySelector('ds-modal').shown) && focusIn;
        },
        { tag, count },
      );
    const boxCount = () => page.evaluate(() => document.querySelectorAll('mire-form, mire-pick').length);
    const inBox = () => page.evaluate(() => document.activeElement?.closest('mire-form, mire-pick')?.dialog ?? null);
    const result = () => page.evaluate(() => JSON.parse(document.querySelector('.mire-ui-demo__result')?.dataset.result ?? '"rien"'));
    const demoButton = async (kind) => {
      await page.locator(`[data-demo-dialog="${kind}"].hydrated`).waitFor();
      await page.evaluate((k) => document.querySelector(`[data-demo-dialog="${k}"]`).focus(), kind);
    };
    const errors = [];
    // L'image introuvable de la démonstration du choix d'une fiche (remplacée par la vignette de secours).
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text());

    before(async () => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
      await page.evaluate(() => (location.hash = ''));
      await page.evaluate(() => (location.hash = 'demo'));
      await page.waitForFunction(() => document.body.dataset.section === 'demo');
      await page.locator('#view mire-demo.hydrated').waitFor();
      await page.evaluate(() => {
        window.__dialogsChanges = [];
        document.addEventListener('mireDialogsChange', (e) => window.__dialogsChanges.push(e.detail.open));
      });
    });

    after(async () => {
      page.off('pageerror', onError);
      page.off('console', onConsole);
      await page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
        }
        location.hash = '';
      });
    });

    it('formulaire au clavier : flèches dans la boîte, champ obligatoire, résultat par promesse, Échap rend le focus', async () => {
      await demoButton('form');
      await press('Enter');
      await boxOpen('mire-form');
      const key = await inBox();
      assert.ok(key, 'le focus est entré dans la boîte');
      assert.equal(await page.evaluate(() => document.activeElement.name), 'name', 'premier champ');
      for (let i = 0; i < 12; i++) await press('ArrowDown');
      assert.equal(await inBox(), key, 'les flèches restent dans la boîte');
      // Champ obligatoire vidé : « Enregistrer » laisse la boîte ouverte et y ramène le focus.
      const save = page.locator('mire-form ds-trigger', { hasText: /Enregistrer|Save/ });
      await page.locator('mire-form input[name="name"]').fill('');
      await save.focus();
      await press('Enter');
      await page.waitForFunction(() => document.activeElement?.name === 'name');
      assert.equal(await boxCount(), 1);
      await page.locator('mire-form input[name="name"]').fill('  Le Voyage  ');
      await save.focus();
      await press('Enter');
      await page.waitForFunction(() => !document.querySelector('mire-form'));
      assert.deepEqual(await result(), {
        action: 'save',
        values: { name: 'Le Voyage', year: '1902', kind: 'film', summary: '', program: '', subtitles: true, sources: ['/films'] },
      });
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.demoDialog), 'form', 'le focus revient au bouton');

      // Liste de sources : ajout et retrait par valeur ; Échap ferme (cancel) et rend le focus.
      await press('Enter');
      await boxOpen('mire-form');
      await page.locator('mire-form input[name="sources-new"]').fill('/series');
      await page.locator('mire-form .mire-form__list ds-trigger', { hasText: /^(Ajouter|Add)$/ }).click();
      await page.waitForFunction(() => document.querySelectorAll('mire-form .mire-form__entry .mire-form__value').length === 2);
      await page.locator('mire-form .mire-form__entry', { hasText: '/films' }).locator('ds-trigger').click();
      await page.waitForFunction(() => [...document.querySelectorAll('mire-form .mire-form__value')].map((e) => e.textContent).join() === '/series');
      await page.locator('mire-form input[name="name"]').focus();
      await press('Escape');
      await page.waitForFunction(() => !document.querySelector('mire-form'));
      const res = await result();
      assert.equal(res.action, 'cancel');
      assert.deepEqual(res.values.sources, ['/series']);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.demoDialog), 'form');
      assert.deepEqual(errors, []);
    });

    it('deux boîtes empilées : la dernière reçoit le clavier, Échap ne ferme qu’elle ; la vue web est masquée puis réaffichée', async () => {
      await page.evaluate(() => (window.__dialogsChanges = []));
      await demoButton('form');
      await press('Enter');
      await boxOpen('mire-form');
      const below = await inBox();
      await page.locator('mire-form ds-trigger', { hasText: /autre fenêtre|another window/ }).focus();
      await press('Enter');
      await boxOpen('mire-form', 2);
      const top = await inBox();
      assert.notEqual(top, below, 'la confirmation est au premier plan');
      for (const k of ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown']) await press(k);
      assert.equal(await inBox(), top, 'les flèches restent dans la boîte du dessus');
      await press('Escape');
      await page.waitForFunction(() => document.querySelectorAll('mire-form').length === 1);
      assert.equal(await inBox(), below, 'le focus revient dans la boîte du dessous');
      assert.deepEqual(await result(), { nested: false });
      assert.deepEqual(await page.evaluate(() => window.__dialogsChanges), [true], 'la vue web reste masquée');
      await press('Escape');
      await page.waitForFunction(() => !document.querySelector('mire-form'));
      assert.deepEqual(await page.evaluate(() => window.__dialogsChanges), [true, false], 'masquée une fois, réaffichée une fois');
      assert.deepEqual(errors, []);
    });

    it('manette : A ouvre, la croix parcourt la boîte, A choisit ; B ferme celle du dessus seulement', async () => {
      await page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
      await page.waitForFunction(() => !document.getElementById('padbar').hidden);
      // Confirmation : A sur « Supprimer » rend oui.
      await demoButton('confirm');
      await padPress('a');
      await boxOpen('mire-form');
      assert.ok(await inBox());
      await padPress('a');
      await page.waitForFunction(() => !document.querySelector('mire-form'));
      assert.equal(await result(), true);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.demoDialog), 'confirm');
      // Deux boîtes : B ferme la confirmation, puis le formulaire.
      await demoButton('form');
      await padPress('a');
      await boxOpen('mire-form');
      await page.locator('mire-form ds-trigger', { hasText: /autre fenêtre|another window/ }).focus();
      await padPress('a');
      await boxOpen('mire-form', 2);
      await padPress('right');
      await padPress('b');
      await page.waitForFunction(() => document.querySelectorAll('mire-form').length === 1);
      assert.ok(await inBox(), 'le focus est dans le formulaire');
      await padPress('b');
      await page.waitForFunction(() => !document.querySelector('mire-form'));
      assert.equal((await result()).action, 'cancel', 'formulaire fermé sans choix');
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.demoDialog), 'form');
      assert.deepEqual(errors, []);
    });

    it('choisir la bonne fiche : image de secours, puis l’initiale ; la fiche choisie est rendue', async () => {
      await demoButton('pick');
      await press('Enter');
      await boxOpen('mire-pick');
      // La première image est introuvable : la vignette de secours (une image de la bibliothèque, s'il y en a) la remplace.
      await page.waitForFunction(() => !(document.querySelector('mire-pick ds-thumb').src ?? '').includes('introuvable'));
      assert.equal(await inBox(), await page.evaluate(() => document.querySelector('mire-pick').dialog));
      await press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.closest('[data-key]')?.dataset.key), 'tmdb:2');
      await press('Enter');
      await page.waitForFunction(() => !document.querySelector('mire-pick'));
      assert.deepEqual(await result(), {
        id: 'tmdb:2',
        title: await page.evaluate(() => JSON.parse(document.querySelector('.mire-ui-demo__result').dataset.result).title),
        year: 1903,
      });
      assert.deepEqual(errors, []);
    });

    it('panneau à onglets : les flèches changent d’onglet, les valeurs de tous les onglets sont rendues', async () => {
      await demoButton('tabs');
      await press('Enter');
      await boxOpen('mire-form');
      await page.locator('mire-form [role="tab"]').first().focus();
      await press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-selected')), 'true');
      await page.locator('mire-form ds-toggle[name="subtitles"]').click();
      await page.locator('mire-form ds-trigger', { hasText: /Enregistrer|Save/ }).click();
      await page.waitForFunction(() => !document.querySelector('mire-form'));
      const res = await result();
      assert.equal(res.action, 'save');
      assert.deepEqual(Object.keys(res.values).sort(), ['name', 'quality', 'subtitles']);
      assert.equal(res.values.subtitles, true);
      assert.equal(res.values.quality, 'auto');
      assert.deepEqual(errors, []);
    });

    it('cohabitation : une boîte historique ouvre une boîte sur les composants, qui se ferme seule', async () => {
      await demoButton('legacy');
      await press('Enter');
      await page.locator('#dlg[open]').waitFor();
      await page.locator('#dlg [data-dlg="ask"]').click();
      await boxOpen('mire-form');
      assert.equal(await page.evaluate(() => !!document.querySelector('#dlg mire-form')), true, 'placée dans la boîte historique');
      assert.ok(await inBox(), 'le focus est dans la boîte sur les composants');
      await press('Escape');
      await page.waitForFunction(() => !document.querySelector('mire-form'));
      assert.equal(await page.evaluate(() => document.getElementById('dlg').open), true, 'la boîte historique reste ouverte');
      assert.deepEqual(await result(), { legacy: false });
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.dlg), 'ask');
      await press('Escape');
      await page.waitForFunction(() => !document.getElementById('dlg').open);
      assert.deepEqual(errors, []);
    });

    it('notification : ds-toaster, durée de toast', async () => {
      await demoButton('notify');
      await press('Enter');
      await page.locator('ds-toaster .ds-toaster.--shown').waitFor();
      const toaster = await page.evaluate(() => {
        const t = document.querySelector('mire-dialogs ds-toaster');
        return { delay: t.closingDelay, text: t.querySelector('.ds-toaster__live')?.textContent ?? '' };
      });
      assert.equal(toaster.delay, 3800);
      assert.ok(toaster.text.length > 0);
      assert.deepEqual(errors, []);
    });
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

  // Coquille (P4-07) : le menu (mire-rail) dans les quatre positions, rétractable, et parcouru à la manette.
  describe('coquille : menu dans les quatre positions et à la manette (P4-07)', () => {
    const PAD = { a: 0, select: 8, up: 12, down: 13, left: 14, right: 15 };
    // Entrées du menu, dans l'ordre (data-key) : écrans du cœur, pages épinglées, Centre, outils, Réglages.
    const KEYS = [
      'screen:search',
      'screen:home',
      'movies',
      'series',
      'music',
      'images',
      'streaming',
      'tv',
      'games',
      'screen:center',
      'screen:explorer',
      'openFile',
      'screen:settings',
      'quit',
    ];
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const focusedKey = () => page.evaluate(() => document.activeElement?.closest('#rail [data-key]')?.dataset.key ?? null);
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => (window.__pad.buttons[n] = { pressed: false, value: 0 }), PAD[button]);
      await settle();
    };
    // Place du menu et de l'écran : le menu touche le bon bord, l'écran ne le chevauche pas.
    const layout = () =>
      page.evaluate(() => {
        const r = document.getElementById('rail').getBoundingClientRect();
        const m = document.querySelector('.main').getBoundingClientRect();
        const box = (b) => ({ left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) });
        return { rail: box(r), main: box(m), w: innerWidth, h: innerHeight };
      });
    // L'entrée qui a le focus est entièrement visible dans la zone des entrées (carrousel compris).
    const focusVisible = () =>
      page.evaluate(() => {
        const a = document.activeElement.getBoundingClientRect();
        const z = document.getElementById('rail-items').getBoundingClientRect();
        return a.left >= z.left - 1 && a.right <= z.right + 1 && a.top >= z.top - 1 && a.bottom <= z.bottom + 1;
      });
    async function setMenu(position, autohide = false) {
      // Par l'action du contrôleur (routeur de la coquille) : le menu rétractable peut être caché.
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:settings' }));
      await page.waitForFunction(() => document.body.dataset.section === 'settings');
      // Écran Réglages (P4-20) : choix court en boutons (ds-toggle-group) et interrupteur, enregistrés dès qu'ils changent.
      await page.waitForSelector('#view mire-settings-view.hydrated ds-toggle-group.hydrated#set-ui-menu-position ds-toggle.hydrated');
      if (!(await page.evaluate((p) => document.body.classList.contains(`menu-${p}`), position))) {
        await page.locator(`#view ds-toggle-group#set-ui-menu-position ds-toggle[data-key="${position}"]`).click();
      }
      await page.waitForFunction((p) => document.body.classList.contains(`menu-${p}`), position);
      const box = page.locator('#view ds-toggle.hydrated#set-ui-menu-autohide');
      if ((await box.evaluate((e) => !!e.checked)) !== autohide) await box.click();
      await page.waitForFunction((a) => document.body.classList.contains('menu-auto') === a, autohide);
      await settle();
    }

    before(async () => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
      await page.evaluate(() => (location.hash = ''));
      // Rendu des composants avant toute touche : le menu et ses ds-trigger ont la classe hydrated.
      await page.waitForFunction(() => {
        const rail = document.querySelector('mire-rail');
        return rail?.classList.contains('hydrated') && [...rail.querySelectorAll('ds-trigger')].every((t) => t.classList.contains('hydrated'));
      });
    });

    after(async () => {
      await page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
        }
      });
      await setMenu('left', false);
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('les entrées du menu : écrans du cœur, pages épinglées, Centre et outils', async () => {
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#rail .rail-item')].map((b) => b.dataset.key)), KEYS);
      assert.equal(await page.locator('#rail [data-key="screen:center"] .rail-badge').count(), 0, 'aucun téléchargement en cours');
    });

    it('le menu se place à gauche, à droite, en haut et en bas, sans chevaucher l’écran', async () => {
      for (const position of ['right', 'top', 'bottom', 'left']) {
        await setMenu(position);
        const { rail, main, w, h } = await layout();
        const edge = { left: rail.left === 0, right: rail.right === w, top: rail.top === 0, bottom: rail.bottom === h }[position];
        assert.ok(edge, `${position} : ${JSON.stringify(rail)}`);
        const apart = { left: main.left >= rail.right, right: main.right <= rail.left, top: main.top >= rail.bottom, bottom: main.bottom <= rail.top }[
          position
        ];
        assert.ok(apart, `${position} : l'écran chevauche le menu ${JSON.stringify({ rail, main })}`);
        // Barre latérale sur toute la hauteur, carrousel sur toute la largeur.
        if (position === 'left' || position === 'right') assert.equal(rail.bottom - rail.top, h, position);
        else assert.equal(rail.right - rail.left, w, position);
        assert.equal(await page.locator('#rail .rail-item[aria-current="page"]').getAttribute('data-key'), 'screen:settings');
      }
      assert.deepEqual(errors, []);
    });

    it('rétractable : caché, il s’ouvre quand le focus y arrive et se referme quand il part', async () => {
      await setMenu('left', true);
      await page.locator('#view .mire-settings-view__palette.hydrated').first().focus();
      await page.waitForFunction(() => !document.body.classList.contains('menu-open'));
      await settle();
      assert.ok((await layout()).rail.right <= 0, 'le menu est caché');
      await page.locator('#rail [data-key="screen:home"]').focus();
      await page.waitForFunction(() => document.body.classList.contains('menu-open'));
      await settle();
      assert.equal((await layout()).rail.left, 0, 'le menu est ouvert');
      await page.locator('#view .mire-settings-view__palette.hydrated').first().focus();
      await page.waitForFunction(() => !document.body.classList.contains('menu-open'));
      await setMenu('left', false);
      assert.deepEqual(errors, []);
    });

    it('manette : la croix parcourt le menu (barre latérale et carrousel), A ouvre, Affichage y revient', async () => {
      await page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
      await page.waitForFunction(() => !document.getElementById('padbar').hidden);
      // Aide de la manette (mire-padbar) : textes des catalogues.
      assert.ok((await page.locator('#padbar .ph').count()) >= 4);
      for (const [position, next] of [
        ['left', 'down'],
        ['top', 'right'],
      ]) {
        await setMenu(position);
        await page.locator('#rail [data-key="screen:search"]').focus();
        const seen = [await focusedKey()];
        for (let i = 1; i < KEYS.length; i++) {
          await padPress(next);
          seen.push(await focusedKey());
          assert.ok(await focusVisible(), `${position} : ${seen.at(-1)} est visible`);
        }
        assert.deepEqual(seen, KEYS, position);
      }
      // A ouvre l'entrée choisie (la vue de page, P4-11) ; Affichage ramène au menu, sur l'entrée affichée.
      await page.locator('#rail [data-key="music"]').focus();
      await padPress('a');
      await page.waitForFunction(() => document.body.dataset.section === 'page' && document.getElementById('title')?.textContent === 'Musique');
      await page.locator('#view mire-group-card ds-trigger.hydrated').first().focus();
      await padPress('select');
      assert.equal(await focusedKey(), 'music');
      assert.deepEqual(errors, []);
    });
  });

  describe('vue de page et thèmes (P4-11)', () => {
    // Les sept pages prêtes à l'emploi et leur nom, dans l'ordre du menu.
    const PAGES = [
      ['movies', 'Films'],
      ['series', 'Séries'],
      ['music', 'Musique'],
      ['images', 'Images'],
      ['streaming', 'Streaming'],
      ['tv', 'Télévision'],
      ['games', 'Jeux'],
    ];
    const PAD = { a: 0, b: 1, right: 15 };
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => (window.__pad.buttons[n] = { pressed: false, value: 0 }), PAD[button]);
      await settle();
    };
    // Vue de page chargée et rendue : la vue, et chaque composant qu'elle contient, ont la classe hydrated.
    const viewReady = () =>
      page.waitForFunction(() => {
        const v = document.querySelector('#view mire-page-view');
        if (!v?.classList.contains('hydrated') || v.loading) return false;
        // Rendu à jour (il suit les propriétés, à l'image suivante) : le chemin parcouru, et le niveau chargé.
        if (v.querySelectorAll('.mire-page-view__crumb').length !== v.crumbs.length) return false;
        const grid = v.querySelector('mire-grid');
        const rendered =
          v.kind === 'elements' ? grid?.elements === v.elements : v.querySelectorAll('mire-group-card, .mire-page-view__row').length === v.groups.length;
        if (!rendered) return false;
        return [...v.querySelectorAll('mire-card, mire-group-card, mire-row, mire-grid, ds-trigger, ds-thumb, ds-scroller')].every((c) =>
          c.classList.contains('hydrated'),
        );
      });
    // Ce que la vue montre : chemin parcouru, regroupements (ou rangées), éléments, message.
    const shown = () =>
      page.evaluate(() => {
        const v = document.querySelector('#view mire-page-view');
        const texts = (sel) => [...v.querySelectorAll(sel)].map((x) => x.textContent.trim());
        return {
          crumbs: texts('.mire-page-view__crumbs:not([hidden]) .mire-page-view__crumb'),
          groups: texts('.mire-group-card__title, .mire-page-view__row-name'),
          cards: texts('mire-card .mire-card__title'),
          status: texts('.mire-page-view__status'),
        };
      });
    const activeKey = () => page.evaluate(() => document.activeElement?.closest('[data-key]')?.getAttribute('data-key') ?? null);
    async function openPage(target, title, path = []) {
      await page.evaluate(([t, p]) => document.querySelector('mire-app').open({ target: t, path: p }), [target, path]);
      await page.waitForFunction((t) => document.body.dataset.section === 'page' && document.getElementById('title')?.textContent === t, title);
      await viewReady();
    }
    // Thème des pages, choisi dans les réglages : appliqué sans redémarrage.
    async function setTheme(id) {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:settings' }));
      await page.locator(`#view .mire-settings-view__theme[data-key="${id}"]`).click();
      await page.waitForFunction(
        (t) => document.querySelector(`#view .mire-settings-view__theme[data-key="${t}"]`)?.getAttribute('aria-pressed') === 'true',
        id,
      );
    }

    before(async () => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });

    after(async () => {
      await page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
        }
      });
      await setTheme('mire');
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('les sept pages s’affichent avec le thème Mire, puis avec Papier, sans redémarrage', async () => {
      const seen = {};
      for (const theme of ['mire', 'papier']) {
        await setTheme(theme);
        for (const [id, title] of PAGES) {
          await openPage(id, title);
          const s = await shown();
          // Une page vide l'affiche ; les autres montrent leurs regroupements (« Autres » compris) ou leurs éléments.
          assert.ok(s.groups.length + s.cards.length > 0 || s.status.length > 0, `${theme} ${id} : ${JSON.stringify(s)}`);
          seen[`${theme}:${id}`] = s.groups.length ? s.groups : s.cards;
          assert.equal(await page.locator('#rail .rail-item[aria-current="page"]').getAttribute('data-key'), id);
        }
        assert.equal(await page.evaluate(() => document.querySelector('mire-page').dataset.theme), theme);
        const look = await page.evaluate(() => {
          const host = document.querySelector('mire-page');
          const view = host.querySelector('mire-page-view');
          return {
            palette: host.dataset.palette ?? null,
            bg: getComputedStyle(host).backgroundColor,
            font: getComputedStyle(view).fontFamily,
            rows: view.classList.contains('--layout-rows'),
            menuTop: document.body.classList.contains('menu-top'),
          };
        });
        if (theme === 'mire') assert.deepEqual([look.palette, look.menuTop, look.rows], [null, false, false]);
        else {
          // Papier : palette claire sur les pages seulement, polices à empattements, rangées, menu en haut.
          assert.deepEqual([look.palette, look.menuTop, look.rows], ['jour', true, true]);
          assert.match(look.font, /Georgia/);
          assert.equal(look.bg, hexToRgb('#f1efe8'));
          assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.rail')).backgroundColor), look.bg);
        }
        // Séries › Série : le niveau des saisons (grille de regroupements, ou rangées de leurs épisodes).
        await openPage('series', 'Séries', ['Série']);
        // Pas de message en cours (« Manette déconnectée », laissé par le bloc précédent) sur la capture.
        await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 8000 });
        await settle();
        await shot(`page-${theme}-series`);
      }
      // Les mêmes pages, les mêmes contenus, quel que soit le thème.
      for (const [id] of PAGES) assert.deepEqual(seen[`papier:${id}`].length > 0, seen[`mire:${id}`].length > 0, id);
      assert.deepEqual(errors, []);
    });

    it('regroupements au clavier : Séries › Série › Saison 1, puis retour d’un niveau', async () => {
      await setTheme('mire');
      await openPage('series', 'Séries');
      await page.locator('#view mire-group-card ds-trigger.hydrated').first().focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#view mire-page-view')?.depth === 1);
      await viewReady();
      assert.deepEqual((await shown()).crumbs, ['Séries', 'Série']);
      assert.deepEqual((await shown()).groups, ['Saison 1']);
      await settle();
      assert.ok(await page.evaluate(() => !!document.activeElement?.closest('#view mire-group-card')), 'focus sur le contenu');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#view mire-page-view')?.kind === 'elements');
      await viewReady();
      const s = await shown();
      assert.deepEqual(s.crumbs, ['Séries', 'Série', 'Saison 1']);
      assert.equal(s.cards.length, 2);
      // Échap remonte d'un niveau ; l'étape « Séries » du chemin ramène à la page.
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('#view mire-page-view')?.depth === 1);
      await viewReady();
      await page.locator('#view .mire-page-view__crumb-link.hydrated', { hasText: 'Séries' }).click();
      await page.waitForFunction(() => document.querySelector('#view mire-page-view')?.depth === 0);
      assert.deepEqual(errors, []);
    });

    it('manette : la croix parcourt les regroupements, A ouvre, puis A ouvre un élément par sa clé', async () => {
      await page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
      await openPage('games', 'Jeux');
      await page.locator('#view mire-group-card ds-trigger.hydrated').first().focus();
      await padPress('right');
      assert.ok(await page.evaluate(() => document.activeElement?.closest('mire-group-card') === document.querySelectorAll('#view mire-group-card')[1]));
      await openPage('images', 'Images');
      await page.locator('#view mire-group-card ds-trigger.hydrated').first().focus();
      await padPress('a');
      await page.waitForFunction(() => document.querySelector('#view mire-page-view')?.kind === 'elements');
      await viewReady();
      await page.locator('#view mire-card ds-trigger.hydrated').first().focus();
      const key = await activeKey();
      assert.match(key, /^local:.*Montagne/);
      // A ouvre l'image dans la visionneuse ; B la ferme.
      await padPress('a');
      await page.waitForFunction(() => !document.getElementById('image-layer').hidden);
      await padPress('b');
      await page.waitForFunction(() => document.getElementById('image-layer').hidden);
      assert.deepEqual(errors, []);
    });

    it('« Ancienne vue » ouvre la section historique ; le menu garde la page', async () => {
      await openPage('series', 'Séries');
      await openLegacy('videos');
      await page.waitForFunction(() => document.body.dataset.section === 'videos');
      assert.equal(await page.locator('#rail .rail-item[aria-current="page"]').getAttribute('data-key'), 'series');
      assert.deepEqual(errors, []);
    });
  });

  describe('accueil (P4-12)', () => {
    const PAD = { a: 0, b: 1, right: 15 };
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => (window.__pad.buttons[n] = { pressed: false, value: 0 }), PAD[button]);
      await settle();
    };
    // Accueil affiché et rendu : la vue, ses rangées voulues, et chaque composant qu'elle contient, ont la classe hydrated.
    const homeReady = (rows) =>
      page.waitForFunction((want) => {
        const v = document.querySelector('#view mire-home mire-home-view');
        if (document.body.dataset.section !== 'home' || !v?.classList.contains('hydrated')) return false;
        const ids = [...v.querySelectorAll('.mire-home-view__section')].map((x) => x.dataset.row);
        if (want.some((id) => !ids.includes(id))) return false;
        return [...v.querySelectorAll('mire-card, mire-group-card, mire-row, ds-trigger, ds-thumb, ds-scroller')].every((c) =>
          c.classList.contains('hydrated'),
        );
      }, rows);
    const openHome = async (rows = ['bars']) => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:home' }));
      await homeReady(rows);
    };
    const focusedBar = () => page.evaluate(() => document.activeElement?.closest('.mire-home-view__bar')?.dataset.target ?? null);
    const pageShown = (title) =>
      page.waitForFunction((t) => document.body.dataset.section === 'page' && document.getElementById('title')?.textContent === t, title);
    // Thème des pages et de l'accueil, choisi dans les réglages ; une rangée de l'accueil, montrée ou cachée.
    async function setTheme(id) {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:settings' }));
      await page.locator(`#view .mire-settings-view__theme[data-key="${id}"]`).click();
      await page.waitForFunction(
        (t) => document.querySelector(`#view .mire-settings-view__theme[data-key="${t}"]`)?.getAttribute('aria-pressed') === 'true',
        id,
      );
    }
    // Capture de l'accueil, défilé jusqu'aux barres pour montrer aussi les rangées, sans message en cours.
    async function homeShot(name) {
      await page.waitForFunction(() => !document.getElementById('toast').classList.contains('show'), null, { timeout: 5000 });
      await page.evaluate(() => document.querySelector('#view .mire-home-view__bars').scrollIntoView({ block: 'start' }));
      await settle();
      await shot(name);
      await page.evaluate(() => (document.getElementById('view').scrollTop = 0));
    }
    async function setRow(kind, id, on) {
      // Écran Réglages (P4-20) : une valeur montrée est dans la liste ordonnable, une valeur cachée a son bouton « Afficher ».
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:settings' }));
      const shown = ([k, i]) => !!document.querySelector(`#view ds-sortable[data-list="${k}"] [data-key="${CSS.escape(i)}"]`);
      await page.waitForSelector('#view mire-settings-view.hydrated ds-sortable');
      if ((await page.evaluate(shown, [kind, id])) !== on) {
        const list = on ? '.mire-settings-view__hidden' : 'ds-sortable';
        await page.locator(`#view .mire-settings-view__order[data-list="${kind}"] ${list} ds-trigger[action*='"id":"${id}"']`).click();
      }
      await page.waitForFunction(
        ([k, i, o]) => !!document.querySelector(`#view ds-sortable[data-list="${k}"] [data-key="${CSS.escape(i)}"]`) === o,
        [kind, id, on],
      );
    }

    before(async () => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });

    after(async () => {
      await page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
        }
      });
      await setTheme('mire');
      await setRow('rows', 'page:series', false);
      await setRow('rows', 'sites', false);
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('les réglages ajoutent des rangées ; l’accueil s’affiche avec le thème Mire, puis avec Papier', async () => {
      // Rangées choisies dans les réglages : la page Séries et les sites épinglés (Arte).
      await setRow('rows', 'page:series', true);
      await setRow('sites', 'web:arte', true);
      await setTheme('mire');
      await openHome(['bars', 'page:series', 'sites']);
      const shown = () =>
        page.evaluate(() => {
          const host = document.querySelector('#view mire-home');
          const v = host.querySelector('mire-home-view');
          return {
            theme: host.dataset.theme,
            palette: host.dataset.palette ?? null,
            layout: v.classList.contains('--layout-grid') ? 'grid' : 'rows',
            font: getComputedStyle(v.querySelector('.mire-home-view__time')).fontFamily,
            rows: [...v.querySelectorAll('.mire-home-view__section')].map((x) => x.dataset.row),
            bars: [...v.querySelectorAll('.mire-home-view__bar')].map((b) => b.dataset.target),
            sites: [...v.querySelectorAll('.mire-home-view__site-name')].map((x) => x.textContent),
            series: v.querySelectorAll('[data-row="page:series"] mire-group-card, [data-row="page:series"] mire-card').length,
          };
        });
      const mire = await shown();
      assert.equal(mire.theme, 'mire');
      assert.equal(mire.palette, null, 'Mire garde la palette des réglages');
      assert.equal(mire.layout, 'rows');
      // Les barres de la v8 (sans réglage) : la recherche, puis les pages prêtes à l'emploi.
      assert.deepEqual(mire.bars, ['screen:search', 'movies', 'series', 'music', 'images', 'streaming', 'tv', 'games']);
      assert.deepEqual(mire.sites, ['Arte']);
      assert.ok(mire.series > 0, 'la rangée Séries montre ses séries');
      assert.deepEqual(
        mire.rows.filter((r) => r !== 'recent'),
        ['bars', 'page:series', 'sites'],
      );
      await homeShot('accueil-mire');

      await setTheme('papier');
      await openHome(['bars', 'page:series', 'sites']);
      const papier = await shown();
      assert.equal(papier.theme, 'papier');
      assert.equal(papier.palette, 'jour', 'Papier pose sa palette sur l’accueil comme sur les pages');
      assert.equal(papier.layout, 'grid');
      assert.match(papier.font, /Palatino|Georgia/);
      assert.equal(await page.evaluate(() => document.querySelector('#view mire-home').dataset.background), 'image');
      // Les écrans du cœur gardent la palette des réglages.
      assert.equal(await page.evaluate(() => document.querySelector('mire-app').dataset.palette ?? null), null);
      await homeShot('accueil-papier');
      await setTheme('mire');
      assert.deepEqual(errors, []);
    });

    it('clavier : le focus arrive sur la première barre, la flèche passe à Films, Entrée ouvre la page, Échap revient', async () => {
      await openHome();
      await page.waitForFunction(() => document.activeElement?.closest('.mire-home-view__bar'));
      assert.equal(await focusedBar(), 'screen:search');
      await page.keyboard.press('ArrowRight');
      assert.equal(await focusedBar(), 'movies');
      await page.keyboard.press('Enter');
      await pageShown('Films');
      assert.equal(await page.locator('#rail .rail-item[aria-current="page"]').getAttribute('data-key'), 'movies');
      await page.keyboard.press('Escape');
      await homeReady(['bars']);
      await page.waitForFunction(() => document.activeElement?.closest('.mire-home-view__bar'));
      // Le titre d'une rangée ouvre sa page.
      await page.locator('#view .mire-home-view__heading-link.hydrated').first().focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.body.dataset.section === 'page');
      assert.deepEqual(errors, []);
    });

    it('manette : la croix parcourt les barres, A ouvre une page, B revient à l’accueil', async () => {
      await page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
      await openHome();
      await page.waitForFunction(() => document.activeElement?.closest('.mire-home-view__bar'));
      await padPress('right');
      await padPress('right');
      assert.equal(await focusedBar(), 'series');
      await padPress('a');
      await pageShown('Séries');
      await padPress('b');
      await homeReady(['bars']);
      await page.waitForFunction(() => document.activeElement?.closest('.mire-home-view__bar'));
      assert.deepEqual(errors, []);
    });
  });

  // Centre (P4-18) : téléchargements et apps dans mire-centre ; une ligne qui avance ne redessine qu'elle ; parcours à
  // la manette ; installation d'un émulateur suivie jusqu'au bout, avec une source simulée dans le processus principal.
  describe('Centre (P4-18)', () => {
    const PAD = { a: 0, b: 1, lb: 4, rb: 5, up: 12, down: 13, right: 15 };
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    // Un appui de la manette simulée : trois images enfoncé, puis relâché, sans autre pause.
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: false, value: 0 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, PAD[button]);
    };
    const VIEW = '#view mire-centre mire-centre-view';
    // Centre affiché sur l'onglet voulu, rendu : la vue et chaque composant qu'elle contient ont la classe hydrated.
    const centreReady = (tab) =>
      page.waitForFunction(
        ([sel, want]) => {
          const v = document.querySelector(sel);
          if (document.body.dataset.section !== 'downloads' || !v?.classList.contains('hydrated') || v.tab !== want) return false;
          return [...v.querySelectorAll('ds-trigger, mire-download-row')].every((c) => c.classList.contains('hydrated'));
        },
        [VIEW, tab],
      );
    const openCentre = async (tab = 'downloads') => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:center' }));
      await page.waitForFunction(() => document.querySelector('#view mire-centre')?.showTab);
      await page.evaluate((t) => document.querySelector('#view mire-centre').showTab({ tab: t }), tab);
      await centreReady(tab);
    };
    const active = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        return a?.dataset.tab ?? (a?.classList.contains('mire-centre-view__add-link') ? 'addLink' : (a?.localName ?? null));
      });
    // Téléchargement envoyé par le processus principal, comme le gestionnaire de téléchargements (canal `download`).
    const sendDownload = (item) =>
      app.evaluate(
        ({ BrowserWindow }, d) =>
          BrowserWindow.getAllWindows()
            .find((w) => !w.webContents.getURL().startsWith('mire-plugin:'))
            .webContents.send('download', d),
        item,
      );
    const STOPPED = {
      id: 'demo-interrompu',
      kind: 'http',
      name: 'Course de karts (Europe).sfc',
      console: 0,
      consoleName: 'Super Nintendo',
      dir: '/jeux',
      // Le gestionnaire passe au démarrage les téléchargements en pause de la démonstration à « interrompu ».
      state: 'interrupted',
      received: 262144,
      total: 524288,
      error: '',
      installers: [],
    };

    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    // Dossier des jeux dans le dossier du test, avant la première lecture du catalogue de la boutique : les consoles
    // installées y créent leur dossier, et la capture montre un chemin qui ne dépend pas de la machine.
    const roms = () => path.join(tmp, 'roms');

    before(async () => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
      await page.evaluate(async (root) => {
        const { config } = await window.api.getConfig();
        await window.api.saveConfig({ ...config, store: { ...config.store, romsRoot: root } });
      }, roms());
    });

    after(async () => {
      await disconnectPad();
      await page.evaluate(() => document.querySelector('mire-centre')?.showTab({ tab: 'downloads' }));
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('le Centre affiche les téléchargements ; une ligne qui avance ne redessine qu’elle', async () => {
      await openCentre();
      // Le titre est rendu par mire-header à l'image suivante.
      await page.waitForFunction(() => document.getElementById('title')?.textContent === 'Centre');
      assert.equal(await page.locator('#rail .rail-item[aria-current="page"]').getAttribute('data-key'), 'screen:center');
      const rows = () => page.$$eval(`${VIEW} mire-download-row`, (els) => els.map((e) => [e.closest('[data-group]').dataset.group, e.dataset.key]));
      assert.deepEqual(await rows(), [
        ['others', 'demo-erreur'],
        ['others', 'demo-interrompu'],
        ['others', 'demo-termine'],
      ]);
      // Rendus comptés à partir d'ici : la vue, et chaque ligne.
      await page.evaluate((sel) => {
        const v = document.querySelector(sel);
        window.__renders = { view: 0, rows: {} };
        window.__row = v.querySelector('mire-download-row[data-key="demo-interrompu"]');
        v.addEventListener('mireCentreRender', () => window.__renders.view++);
        v.addEventListener('mireDownloadRowRender', (e) => (window.__renders.rows[e.detail.id] = (window.__renders.rows[e.detail.id] || 0) + 1));
      }, VIEW);
      // Les rendus de l'ouverture terminés, on repart de zéro.
      await settle();
      await page.evaluate(() => (window.__renders = { view: 0, rows: {} }));
      const meta = `${VIEW} mire-download-row[data-key="demo-interrompu"] .mire-download-row__meta`;
      await sendDownload({ ...STOPPED, received: 393216 });
      await page.waitForFunction((sel) => document.querySelector(sel)?.textContent.includes('384 Ko sur 512 Ko'), meta);
      assert.deepEqual(await page.evaluate(() => window.__renders), { view: 0, rows: { 'demo-interrompu': 1 } });
      assert.ok(
        await page.evaluate(() => window.__row.isConnected && window.__row.querySelector('[role="progressbar"]').getAttribute('aria-valuenow') === '75'),
      );
      // Autre état : la ligne change de groupe et de boutons, la liste est redessinée.
      await sendDownload({ ...STOPPED, state: 'downloading', speed: 1024 });
      await page.waitForFunction((sel) => document.querySelector(`${sel} [data-group="running"] mire-download-row[data-key="demo-interrompu"]`), VIEW);
      assert.ok((await page.evaluate(() => window.__renders.view)) >= 1);
      await sendDownload(STOPPED);
      await page.waitForFunction((sel) => document.querySelector(`${sel} [data-group="others"] mire-download-row[data-key="demo-interrompu"]`), VIEW);
      assert.deepEqual(errors, []);
    });

    const connectPad = () =>
      page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });

    it('manette : la croix va aux onglets et aux boutons, A ouvre, B ferme, LB et RB changent d’écran', async () => {
      await connectPad();
      await openCentre();
      await page.locator(`${VIEW} .mire-centre-view__tab[data-tab="downloads"]`).focus();
      // Croix vers le bas : « Ajouter un lien » ; A ouvre le formulaire d'ajout (P4-06), B le ferme.
      await padPress('down');
      assert.equal(await active(), 'addLink');
      await padPress('a');
      const form = page.locator('mire-dialogs mire-form');
      await form.locator('input').first().waitFor();
      assert.equal(await form.locator('.ds-modal__title, h2').first().textContent(), 'Ajouter un téléchargement');
      assert.ok(await form.locator('select').count(), 'le formulaire propose la destination');
      await padPress('b');
      await page.waitForFunction(() => !document.querySelector('mire-dialogs mire-form'));
      await page.waitForFunction(() => document.activeElement?.classList.contains('mire-centre-view__add-link'));
      // Croix vers le haut puis à droite : l'onglet Apps ; A l'affiche.
      await padPress('up');
      await padPress('right');
      assert.equal(await active(), 'apps');
      await padPress('a');
      await centreReady('apps');
      await page.locator(`${VIEW} .mire-centre-view__card`).first().waitFor();
      // Le Centre ferme le cycle de LB et RB : LB ouvre la dernière page du haut du menu, RB revient au début (Recherche).
      await padPress('lb');
      await page.waitForFunction(() => document.querySelector('#rail .rail-item[aria-current="page"]')?.dataset.key === 'games');
      await openCentre('apps');
      await padPress('rb');
      await page.waitForFunction(() => document.body.dataset.section === 'search');
      await disconnectPad();
      assert.deepEqual(errors, []);
    });

    it('manette : RB depuis la dernière page ouvre le Centre', async () => {
      await connectPad();
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'games' }));
      await page.waitForFunction(() => document.querySelector('#rail .rail-item[aria-current="page"]')?.dataset.key === 'games');
      await page.locator('#view mire-page-view.hydrated').waitFor();
      await padPress('rb');
      await page.waitForFunction(() => document.querySelector('#rail .rail-item[aria-current="page"]')?.dataset.key === 'screen:center');
      await page.locator(`${VIEW}.hydrated`).waitFor();
      await page.waitForFunction(() => document.getElementById('title')?.textContent === 'Centre');
      await disconnectPad();
      assert.deepEqual(errors, []);
    });

    it('installation d’un émulateur suivie jusqu’au bout (source simulée), puis désinstallation', async () => {
      // Source simulée : le fetch du processus principal répond pour la dernière version de DuckStation sur GitHub
      // (redirection, page des fichiers, fichier de 512 Ko envoyé en huit morceaux) ; le reste passe au vrai fetch.
      await app.evaluate(() => {
        const real = globalThis.fetch;
        globalThis.__mireRealFetch = real;
        const repo = 'https://github.com/stenzek/duckstation';
        const file = '/stenzek/duckstation/releases/download/v0.1-e2e/DuckStation-x64.AppImage';
        globalThis.fetch = async (url, init) => {
          const u = String(url);
          if (u === `${repo}/releases/latest`) {
            // Un court délai, comme le vrai site : l'étape « Recherche de la dernière version » reste visible.
            await new Promise((r) => setTimeout(r, 300));
            return new Response(null, { status: 302, headers: { location: `${repo}/releases/tag/v0.1-e2e` } });
          }
          if (u === `${repo}/releases/expanded_assets/v0.1-e2e`)
            return new Response(`<a href="${file}">DuckStation</a>`, { headers: { 'content-type': 'text/html' } });
          if (u === `https://github.com${file}`) {
            let sent = 0;
            const body = new ReadableStream({
              async pull(controller) {
                if (sent === 8) return controller.close();
                await new Promise((r) => setTimeout(r, 120));
                sent += 1;
                controller.enqueue(new Uint8Array(64 * 1024));
              },
            });
            return new Response(body, { headers: { 'content-length': String(8 * 64 * 1024) } });
          }
          return real(url, init);
        };
      });
      try {
        await openCentre('apps');
        // Capture sans le message de la manette débranchée, focus sur le premier onglet.
        await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
        await page.locator(`${VIEW} .mire-centre-view__tab[data-tab="downloads"]`).focus();
        await page.mouse.move(1, 1);
        await settle();
        await shot('centre-apps');
        const card = page.locator(`${VIEW} .mire-centre-view__card[data-key="duckstation"]`);
        assert.equal(await card.locator('.mire-centre-view__state').textContent(), 'Non installé');
        // Textes d'avancement vus dans la carte, du début à la fin.
        await page.evaluate((sel) => {
          window.__steps = [];
          const el = document.querySelector(sel);
          const note = () => {
            const t = el.querySelector('.mire-centre-view__status')?.textContent;
            if (t && window.__steps.at(-1) !== t) window.__steps.push(t);
          };
          new MutationObserver(note).observe(el, { subtree: true, childList: true, characterData: true });
        }, `${VIEW} .mire-centre-view__card[data-key="duckstation"]`);
        await card.locator('ds-trigger.mire-centre-view__install.hydrated').click();
        await card.locator('.mire-centre-view__state', { hasText: 'Installé, version 0.1-e2e' }).waitFor({ timeout: 15000 });
        const steps = await page.evaluate(() => window.__steps);
        assert.ok(steps.includes('Recherche de la dernière version'), steps.join(' | '));
        assert.ok(
          steps.some((t) => /^DuckStation 0\.1-e2e, \d+ Ko sur 512 Ko$/.test(t)),
          steps.join(' | '),
        );
        await page.locator('#toast', { hasText: 'Installé. Les consoles sont prêtes dans « Ma ludothèque ».' }).waitFor();
        // Le programme est en place, la console PlayStation a son dossier, et la carte rappelle les BIOS.
        assert.ok(fs.existsSync(path.join(tmp, 'data', 'emulators', 'duckstation', 'DuckStation-x64.AppImage')));
        assert.ok(fs.readdirSync(roms()).length > 0);
        await card.locator('.mire-centre-view__bios-files').waitFor();
        await card.locator('ds-trigger.hydrated', { hasText: 'Désinstaller' }).click();
        await card.locator('.mire-centre-view__state', { hasText: 'Non installé' }).waitFor();
        assert.deepEqual(errors, []);
      } finally {
        await app.evaluate(() => {
          if (globalThis.__mireRealFetch) globalThis.fetch = globalThis.__mireRealFetch;
        });
      }
    });

    // Plugins et dépôts (P4-19) : sans réseau (les listes des dépôts ne sont lues en ligne que sur demande).
    it('plugins (P4-19) : le plugin inclus s’affiche, sa fiche s’ouvre, montre ce qu’il demande et se referme au clavier', async () => {
      await openCentre('plugins');
      const card = page.locator(`${VIEW} [data-group="installed"] .mire-centre-view__plugin[data-key="mire.exemple.inclus"]`);
      await card.waitFor();
      assert.equal(await card.locator('.mire-centre-view__name').textContent(), 'Exemple de plugin inclus');
      assert.equal(await card.locator('.mire-centre-view__state').textContent(), 'Actif');
      assert.match(await card.locator('.mire-centre-view__meta').textContent(), /^Version 1\.0\.0 · Livré avec Mire · Données seulement, sans code$/);
      await page.evaluate(() => document.getElementById('toast').classList.remove('show'));
      await page.locator(`${VIEW} .mire-centre-view__tab[data-tab="plugins"]`).focus();
      await page.mouse.move(1, 1);
      await settle();
      await shot('centre-plugins');
      // Fiche : ouverte par Entrée sur « Voir la fiche », le focus sur « Retour aux plugins ».
      await card.locator('ds-trigger.--openPlugin.hydrated').focus();
      await page.keyboard.press('Enter');
      const sheet = page.locator(`${VIEW} .mire-centre-view__sheet[data-key="mire.exemple.inclus"]`);
      await sheet.waitFor();
      await page.waitForFunction(() => document.activeElement?.closest('ds-trigger')?.classList.contains('mire-centre-view__sheet-back'));
      assert.equal(await sheet.locator('[data-part="permissions"] p').textContent(), 'Aucune permission particulière.');
      assert.deepEqual(await sheet.locator('[data-part="contributes"] li').allTextContents(), ['Des listes prêtes à l’emploi']);
      assert.deepEqual(await sheet.locator('.mire-centre-view__facts dd').allTextContents(), [
        '1.0.0',
        'Livré avec Mire',
        'Données seulement, sans code',
        'Actif',
      ]);
      // Livré avec Mire : on le désactive, on ne le désinstalle pas.
      assert.deepEqual(await sheet.locator('.mire-centre-view__sheet-action').evaluateAll((els) => els.map((e) => e.textContent)), ['Désactiver']);
      await page.keyboard.press('Enter');
      await card.waitFor();
      await page.waitForFunction(() => document.activeElement?.closest('ds-trigger')?.classList.contains('--openPlugin'));
      assert.deepEqual(errors, []);
    });

    it('dépôts (P4-19) : le dépôt officiel et son empreinte ; l’ajout refuse une adresse qui n’est pas en https:', async () => {
      await openCentre('repos');
      const official = page.locator(`${VIEW} .mire-centre-view__repo[data-key="official"]`);
      await official.waitFor();
      assert.match(await official.locator('.mire-centre-view__fingerprint').textContent(), /^([0-9a-f]{4} ){15}[0-9a-f]{4}$/);
      assert.equal(
        await official.locator('.mire-centre-view__address').textContent(),
        'https://github.com/jezoock/mire-addons/releases/download/index/index.json',
      );
      assert.equal(await official.locator('ds-trigger').count(), 0, 'le dépôt officiel ne se retire pas');
      await page.locator(`${VIEW} ds-trigger.mire-centre-view__add-repo.hydrated`).click();
      const form = page.locator('mire-dialogs mire-form');
      await form.locator('input[name="index"]').waitFor();
      await form.locator('input[name="index"]').fill('http://depot.exemple/index.json');
      await form.locator('textarea[name="key"]').fill('-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----');
      await form.locator('ds-trigger.hydrated', { hasText: 'Vérifier' }).click();
      await form.locator('.mire-form__help', { hasText: 'L’adresse doit commencer par https://' }).waitFor();
      assert.equal(await page.locator('mire-dialogs mire-form').count(), 1, 'la boîte reste ouverte');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('mire-dialogs mire-form'));
      assert.deepEqual(errors, []);
    });
  });

  // Recherche (P4-13) : le catalogue groupé par page, « Où regarder » et les sites dans mire-search ; la frappe ne
  // redessine pas les rangées ; un résultat s'ouvre dans sa page ; parcours à la manette.
  describe('Recherche (P4-13)', () => {
    const PAD = { a: 0, b: 1, lb: 4, rb: 5, down: 13 };
    const VIEW = '#view mire-search mire-search-view';
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: false, value: 0 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, PAD[button]);
    };
    const connectPad = () =>
      page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    const input = () => page.locator(`${VIEW} .mire-search-view__input`);
    const openSearch = async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:search' }));
      await page.waitForFunction((sel) => document.body.dataset.section === 'search' && document.querySelector(sel)?.classList.contains('hydrated'), VIEW);
    };
    // Recherche tapée dans le champ, puis attente des groupes voulus, chaque carte rendue (classe hydrated).
    const searchFor = async (query, group) => {
      await input().fill(query);
      await page.waitForFunction(
        ([sel, g]) => {
          const cards = [...document.querySelectorAll(`${sel} [data-group="${g}"] mire-card`)];
          return cards.length && cards.every((c) => c.querySelector('ds-trigger.hydrated'));
        },
        [VIEW, group],
      );
    };
    // Groupes affichés : identifiant et titres des cartes (ou des sites).
    const shown = () =>
      page.$$eval(`${VIEW} [data-group]`, (els) =>
        els.map((e) => [e.dataset.group, [...e.querySelectorAll('.mire-card__title, .mire-search-view__site-name')].map((t) => t.textContent)]),
      );
    const imagesOpen = () => page.evaluate(() => !document.getElementById('image-layer').hidden);

    before(() => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(async () => {
      await disconnectPad();
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('une recherche : le catalogue groupé par page, « Où regarder » et les sites ; la frappe ne redessine pas les rangées', async () => {
      await openSearch();
      // Le titre est rendu par mire-header à l'image suivante.
      await page.waitForFunction(() => document.getElementById('title')?.textContent === 'Rechercher');
      await searchFor('démonstration', 'games');
      assert.deepEqual(await shown(), [
        ['games', ['Aventure de démonstration', 'Puzzle de démonstration']],
        ['watch', []],
        ['sites', ['Arte', 'Radio France', 'Essai TV']],
      ]);
      // Sans plugin « Où regarder » (TMDB est un plugin à installer, P5-15), la Recherche propose d'en installer un.
      await page.locator(`${VIEW} [data-group="watch"] .mire-search-view__note`, { hasText: 'plugin « Où regarder »' }).waitFor();
      // Les chaînes entrent au catalogue quand leur liste est lue : la Recherche les trouve.
      await searchFor('chaîne', 'tv');
      assert.deepEqual((await shown())[0], ['tv', ['Chaîne Deux', 'Chaîne Trois', 'Chaîne Une']]);
      // Une frappe qui ne change pas les résultats : la vue reçoit les nouveaux groupes, la rangée garde ses cartes.
      await page.evaluate((sel) => {
        window.__searchRenders = 0;
        window.__card = document.querySelector(`${sel} [data-group="tv"] mire-card`);
        document.querySelector(sel).addEventListener('mireSearchRender', () => window.__searchRenders++);
      }, VIEW);
      await input().press('End');
      await input().press('Space');
      await page.waitForFunction(() => window.__searchRenders > 0);
      assert.equal(await input().inputValue(), 'chaîne ');
      assert.ok(
        await page.evaluate((sel) => window.__card === document.querySelector(`${sel} [data-group="tv"] mire-card`) && window.__card.isConnected, VIEW),
      );
      // Entrée retient la recherche et va au premier résultat ; champ vidé, elle est dans les recherches récentes.
      await input().press('Enter');
      await page.waitForFunction((sel) => document.activeElement?.closest(`${sel} .mire-search-view__results`), VIEW);
      await input().fill('');
      await page.locator(`${VIEW} .mire-search-view__chip.hydrated`, { hasText: 'chaîne' }).first().waitFor();
      // Une recherche récente relance la recherche.
      await page.locator(`${VIEW} .mire-search-view__chip.hydrated`, { hasText: 'chaîne' }).first().click();
      await page.waitForFunction((sel) => document.querySelector(`${sel} [data-group="tv"]`), VIEW);
      assert.equal(await input().inputValue(), 'chaîne');
      assert.deepEqual(errors, []);
    });

    it('un résultat s’ouvre dans sa page ; le titre d’un groupe ouvre la page', async () => {
      await openSearch();
      await searchFor('vacances', 'images');
      await page.locator(`${VIEW} [data-group="images"] mire-card ds-trigger.hydrated`).first().click();
      // La page Images s'affiche, et l'image s'ouvre comme elle l'ouvrirait.
      await page.waitForFunction(() => document.querySelector('#rail .rail-item[aria-current="page"]')?.dataset.key === 'images');
      await page.waitForFunction(() => !document.getElementById('image-layer').hidden);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('image-layer').hidden);
      assert.equal(await page.evaluate(() => document.body.dataset.section), 'page');
      // Le titre d'un groupe ouvre sa page.
      await openSearch();
      await searchFor('vacances', 'images');
      await page.locator(`${VIEW} [data-group="images"] .mire-search-view__heading-link.hydrated`).click();
      await page.waitForFunction(() => document.body.dataset.section === 'page' && document.getElementById('title')?.textContent === 'Images');
      assert.deepEqual(errors, []);
    });

    it('manette : la croix va du champ aux résultats, A ouvre dans la page, B ferme, LB et RB changent d’écran', async () => {
      await connectPad();
      await openSearch();
      await searchFor('plage', 'images');
      await input().focus();
      // Croix vers le bas : du champ aux résultats.
      await padPress('down');
      await page.waitForFunction((sel) => document.activeElement?.closest(`${sel} .mire-search-view__results`), VIEW);
      // A sur la carte : la page Images, puis l'image ; B la ferme.
      await page.locator(`${VIEW} [data-group="images"] mire-card ds-trigger.hydrated`).first().focus();
      await padPress('a');
      await page.waitForFunction(() => !document.getElementById('image-layer').hidden);
      assert.equal(await page.evaluate(() => document.querySelector('#rail .rail-item[aria-current="page"]')?.dataset.key), 'images');
      await padPress('b');
      await page.waitForFunction(() => document.getElementById('image-layer').hidden);
      assert.equal(await imagesOpen(), false);
      // LB depuis la Recherche : le Centre (fin du cycle) ; RB depuis la Recherche : l'Accueil.
      await openSearch();
      await padPress('lb');
      await page.waitForFunction(() => document.querySelector('#rail .rail-item[aria-current="page"]')?.dataset.key === 'screen:center');
      await openSearch();
      await padPress('rb');
      await page.waitForFunction(() => document.body.dataset.section === 'home');
      await disconnectPad();
      assert.deepEqual(errors, []);
    });
  });

  describe('Éditeurs (P4-22)', () => {
    const PAD = { a: 0, b: 1, x: 2, down: 13 };
    const VIEW = '#view mire-search mire-search-view';
    const FORM = 'mire-dialogs mire-form';
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: false, value: 0 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, PAD[button]);
    };
    const connectPad = () =>
      page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    // Le film « Amélie » trouvé par la Recherche : sa carte rendue, et sa clé.
    const card = () => page.locator(`${VIEW} [data-group="movies"] mire-card ds-trigger.hydrated`).first();
    const findFilm = async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:search' }));
      await page.waitForFunction((sel) => document.body.dataset.section === 'search' && document.querySelector(sel)?.classList.contains('hydrated'), VIEW);
      await page.locator(`${VIEW} .mire-search-view__input`).fill('Amélie');
      await page.waitForFunction((sel) => document.querySelector(`${sel} [data-group="movies"] mire-card ds-trigger.hydrated`), VIEW);
      return card().getAttribute('data-key');
    };
    const cardTitle = (name) =>
      page.waitForFunction(([sel, n]) => document.querySelector(`${sel} [data-group="movies"] mire-card .mire-card__title`)?.textContent === n, [VIEW, name]);
    // Boîte de l'éditeur ouverte et rendue (chaque bouton hydrated).
    const formOpen = async () => {
      await page.waitForFunction((sel) => {
        const f = document.querySelector(sel);
        return (
          f?.classList.contains('hydrated') &&
          f.querySelector('ds-modal.hydrated') &&
          [...f.querySelectorAll('ds-trigger')].every((t) => t.classList.contains('hydrated'))
        );
      }, FORM);
      return page.locator(`${FORM} .mire-form__title`).textContent();
    };
    const formClosed = () => page.waitForFunction((sel) => !document.querySelector(sel), FORM);
    const button = (label) => page.locator(`${FORM} .mire-form__actions ds-trigger`, { hasText: label });
    const element = (key) => page.evaluate((k) => window.api.catalogElement(k), key);
    const focusIn = (sel) => page.evaluate((s) => !!document.activeElement?.closest(s), sel);

    before(() => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(async () => {
      await disconnectPad();
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('clic droit : modifier le nom et ajouter un tag, puis réinitialiser (touche E)', async () => {
      const key = await findFilm();
      const before = await element(key);
      await cardTitle(before.name);
      await card().click({ button: 'right' });
      assert.equal(await formOpen(), 'Modifier la vidéo');
      assert.equal(await page.locator(`${FORM} input`).first().inputValue(), before.name);
      await page.locator(`${FORM} input`).first().fill('Amélie (version longue)');
      await page.locator(`${FORM} .mire-form__list input`).fill('À revoir');
      await page.locator(`${FORM} .mire-form__list ds-trigger`, { hasText: 'Ajouter' }).click();
      await page.locator(`${FORM} .mire-form__entry .mire-form__value`, { hasText: 'À revoir' }).waitFor();
      await shot('editor-video');
      await button('Enregistrer').click();
      await formClosed();
      // La Recherche se met à jour : la carte porte le nouveau nom ; le tag est un tag de l'utilisateur.
      await cardTitle('Amélie (version longue)');
      const edited = await element(key);
      assert.equal(edited.name, 'Amélie (version longue)');
      const tags = await page.evaluate(() => window.api.tagsList());
      const mine = tags.find((t) => t.name === 'À revoir');
      assert.equal(mine?.origin, 'user');
      assert.ok(edited.tags.includes(mine.id));
      // Touche E sur la carte, puis « Réinitialiser » : nom et tags d'origine.
      await card().focus();
      await page.keyboard.press('e');
      await formOpen();
      assert.equal(await page.locator(`${FORM} input`).first().inputValue(), 'Amélie (version longue)');
      await button('Réinitialiser').click();
      await formClosed();
      const reset = await element(key);
      assert.equal(reset.name, before.name);
      assert.deepEqual([...reset.tags].sort(), [...before.tags].sort());
      await cardTitle(before.name);
      assert.deepEqual(errors, []);
    });

    it('manette : X ouvre l’éditeur, la croix parcourt les champs, A choisit Annuler, B ferme', async () => {
      await connectPad();
      const key = await findFilm();
      const before = await element(key);
      await card().focus();
      await padPress('x');
      assert.equal(await formOpen(), 'Modifier la vidéo');
      await page.waitForFunction((sel) => document.activeElement?.closest(sel), FORM);
      // Croix vers le bas : le focus passe au champ suivant, sans quitter la boîte.
      const first = await page.evaluateHandle(() => document.activeElement);
      await padPress('down');
      assert.ok(await page.evaluate((f) => document.activeElement !== f, first));
      assert.ok(await focusIn(FORM));
      // A sur « Annuler » : la boîte se ferme, rien n'est changé.
      await button('Annuler').focus();
      await padPress('a');
      await formClosed();
      // X de nouveau, puis B : la boîte se ferme et le focus revient à la carte.
      await card().focus();
      await padPress('x');
      await formOpen();
      await page.waitForFunction((sel) => document.activeElement?.closest(sel), FORM);
      await padPress('b');
      await formClosed();
      await page.waitForFunction((sel) => document.activeElement?.closest(`${sel} mire-card`), VIEW);
      assert.deepEqual(await element(key), before);
      await disconnectPad();
      assert.deepEqual(errors, []);
    });
  });

  describe('Explorateur (P4-08)', () => {
    const PAD = { a: 0, b: 1, down: 13, right: 15 };
    const VIEW = '#view mire-explorer mire-explorer-view';
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: false, value: 0 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, PAD[button]);
    };
    const connectPad = () =>
      page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    // Titres des colonnes affichées, et une ligne rendue (classe hydrated) d'une colonne, par son texte.
    const headings = () =>
      page.$$eval(`${VIEW} .mire-explorer-view__column:not(.mire-explorer-view__preview)`, (cols) => cols.map((c) => c.getAttribute('aria-label')));
    const columns = (n) =>
      page.waitForFunction(
        ([sel, k]) => document.querySelectorAll(`${sel} .mire-explorer-view__column:not(.mire-explorer-view__preview)`).length === k,
        [VIEW, n],
      );
    const row = (col, text) =>
      page.locator(`${VIEW} .mire-explorer-view__column:nth-child(${col + 1}) .mire-explorer-view__row.hydrated`, { hasText: text }).first();
    // Ligne qui a le focus : sa colonne (à partir de 0) et son texte.
    const focusedRow = () =>
      page.evaluate((sel) => {
        const r = document.activeElement?.closest('.mire-explorer-view__row');
        if (!r) return null;
        const cols = [...document.querySelectorAll(`${sel} .mire-explorer-view__column`)];
        return [cols.indexOf(r.closest('.mire-explorer-view__column')), r.querySelector('.mire-explorer-view__label')?.textContent];
      }, VIEW);
    const openExplorer = async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:explorer' }));
      await page.waitForFunction(
        (sel) => document.body.dataset.section === 'explorer' && document.querySelector(`${sel} .mire-explorer-view__row.hydrated`),
        VIEW,
      );
    };

    before(() => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(async () => {
      await disconnectPad();
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('trois colonnes à la souris (Pages › Images › un dossier), l’aperçu d’une image, puis « Lire »', async () => {
      await openExplorer();
      await page.waitForFunction(() => document.getElementById('title')?.textContent === 'Explorateur');
      assert.equal(await page.evaluate(() => document.querySelector('#rail .rail-item[aria-current="page"]')?.dataset.key), 'screen:explorer');
      assert.deepEqual(await headings(), ['Explorateur']);
      await row(0, 'Pages').click();
      await columns(2);
      await row(1, 'Images').click();
      await columns(3);
      // Un dossier d'images : ses éléments dans la quatrième colonne.
      await page.locator(`${VIEW} .mire-explorer-view__column:nth-child(3) .mire-explorer-view__row.hydrated`).first().click();
      await columns(4);
      const titles = await headings();
      assert.deepEqual(titles.slice(0, 3), ['Explorateur', 'Pages', 'Images']);
      await page.locator(`${VIEW} .mire-explorer-view__column:nth-child(4) .mire-explorer-view__row.hydrated`).first().click();
      // L'aperçu : image, nom, tags (dont « Image »), emplacement, et les quatre actions.
      await page.locator(`${VIEW} .mire-explorer-view__preview .mire-explorer-view__action.hydrated`, { hasText: 'Lire' }).waitFor();
      const preview = await page.$eval(`${VIEW} .mire-explorer-view__preview`, (p) => ({
        image: !!p.querySelector('ds-thumb'),
        tags: [...p.querySelectorAll('.mire-explorer-view__tags li')].map((li) => li.textContent),
        location: p.querySelector('.mire-explorer-view__location')?.textContent ?? '',
        actions: [...p.querySelectorAll('.mire-explorer-view__action')].map((a) => a.textContent.trim()),
      }));
      assert.ok(preview.image);
      assert.ok(preview.tags.includes('Image'), preview.tags.join(', '));
      assert.ok(preview.location.length > 0);
      // Les quatre actions, puis celles du fichier (P4-09).
      assert.deepEqual(preview.actions, ['Lire', 'Modifier les infos', 'Tags', 'Ajouter à une liste', 'Renommer', 'Déplacer', 'Supprimer']);
      // Le focus est sur « Lire » ; Entrée ouvre l'image, Échap la ferme et l'explorateur est toujours là.
      await page.waitForFunction(() => document.activeElement?.dataset?.previewAction === 'play');
      await shot('section-explorer');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.getElementById('image-layer').hidden);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('image-layer').hidden);
      assert.equal(await page.evaluate(() => document.body.dataset.section), 'explorer');
      assert.deepEqual(errors, []);
    });

    it('manette : la croix parcourt une colonne et passe à la suivante, A ouvre, B revient d’une colonne', async () => {
      await connectPad();
      await openExplorer();
      await row(0, 'Pages').focus();
      // A sur Pages : la colonne des pages s'ouvre et reçoit le focus.
      await padPress('a');
      await page.waitForFunction(() => document.activeElement?.closest('.mire-explorer-view__column:nth-child(2)'));
      assert.deepEqual(await focusedRow(), [1, 'Films']);
      // La croix descend dans la colonne : la colonne suivante montre la ligne qui a le focus.
      await padPress('down');
      await page.waitForFunction(() => document.activeElement?.textContent?.includes('Séries'));
      await page.waitForFunction(
        (sel) => document.querySelector(`${sel} .mire-explorer-view__column:nth-child(3)`)?.getAttribute('aria-label') === 'Séries',
        VIEW,
      );
      // Croix à droite : on passe à la colonne de Séries.
      await page.waitForFunction((sel) => document.querySelector(`${sel} .mire-explorer-view__column:nth-child(3) .mire-explorer-view__row.hydrated`), VIEW);
      await padPress('right');
      await page.waitForFunction(() => document.activeElement?.closest('.mire-explorer-view__column:nth-child(3)'));
      // B : retour à la ligne choisie de la colonne précédente ; B encore : retour à la colonne de départ.
      await padPress('b');
      await page.waitForFunction(() => document.activeElement?.closest('.mire-explorer-view__column:nth-child(2)'));
      assert.deepEqual(await focusedRow(), [1, 'Séries']);
      await padPress('b');
      assert.deepEqual(await focusedRow(), [0, 'Pages']);
      // Depuis la première colonne, B quitte l'explorateur pour l'accueil.
      await padPress('b');
      await page.waitForFunction(() => document.body.dataset.section === 'home');
      await disconnectPad();
      assert.deepEqual(errors, []);
    });
  });

  describe('Éditeurs des regroupements (P4-22)', () => {
    const PAD = { a: 0, b: 1, x: 2, down: 13 };
    const VIEW = '#view mire-page-view';
    const FORM = 'mire-dialogs mire-form';
    // Les morceaux de démonstration n'ont pas d'artiste : ils sont rangés sous « Autres » (`null`).
    const ARTIST = null;
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: false, value: 0 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, PAD[button]);
    };
    const connectPad = () =>
      page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    // La carte de l'album, rendue avec ce nom.
    const card = () => page.locator(`${VIEW} mire-group-card ds-trigger.hydrated`).first();
    const albumShown = (name) =>
      page.waitForFunction(
        ([sel, n]) => {
          const c = document.querySelector(`${sel} mire-group-card`);
          return c?.querySelector('ds-trigger.hydrated') && c.querySelector('.mire-group-card__title')?.textContent === n;
        },
        [VIEW, name],
      );
    // Page Musique, au niveau des albums.
    const openAlbums = async () => {
      await page.evaluate((a) => document.querySelector('mire-app').open({ target: 'music', path: [a] }), ARTIST);
      await page.waitForFunction((sel) => document.body.dataset.section === 'page' && document.querySelector(sel)?.classList.contains('hydrated'), VIEW);
    };
    const formOpen = async () => {
      await page.waitForFunction((sel) => {
        const f = document.querySelector(sel);
        return (
          f?.classList.contains('hydrated') &&
          f.querySelector('ds-modal.hydrated') &&
          [...f.querySelectorAll('ds-trigger')].every((t) => t.classList.contains('hydrated'))
        );
      }, FORM);
      return page.locator(`${FORM} .mire-form__title`).textContent();
    };
    const formClosed = () => page.waitForFunction((sel) => !document.querySelector(sel), FORM);
    const button = (label) => page.locator(`${FORM} .mire-form__actions ds-trigger`, { hasText: label });
    const group = (name) => page.evaluate(([a, n]) => window.api.catalogGroup('music', [a, n]), [ARTIST, name]);
    const focusIn = (sel) => page.evaluate((s) => !!document.activeElement?.closest(s), sel);

    before(() => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(async () => {
      await disconnectPad();
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('clic droit sur un album : son nom et un tag pour tous ses morceaux, puis réinitialiser (touche E)', async () => {
      await openAlbums();
      await albumShown('Premier album');
      const before = await group('Premier album');
      assert.ok(before.elements.length > 0);
      await card().click({ button: 'right' });
      assert.equal(await formOpen(), 'Modifier l’album');
      assert.equal(await page.locator(`${FORM} input`).first().inputValue(), 'Premier album');
      await page.locator(`${FORM} input`).first().fill('Premier album (réédition)');
      await page.locator(`${FORM} .mire-form__list input`).fill('À écouter');
      await page.locator(`${FORM} .mire-form__list ds-trigger`, { hasText: 'Ajouter' }).click();
      await page.locator(`${FORM} .mire-form__entry .mire-form__value`, { hasText: 'À écouter' }).waitFor();
      await shot('editor-album');
      await button('Enregistrer').click();
      await formClosed();
      // La page se met à jour : l'album porte son nouveau nom ; chaque morceau a le tag de l'utilisateur.
      await albumShown('Premier album (réédition)');
      const edited = await group('Premier album (réédition)');
      assert.equal(edited.elements.length, before.elements.length);
      const mine = (await page.evaluate(() => window.api.tagsList())).find((t) => t.name === 'À écouter');
      assert.equal(mine?.origin, 'user');
      for (const e of edited.elements) assert.ok(e.tags.includes(mine.id));
      assert.equal(await group('Premier album'), null);
      // Touche E sur la carte, puis « Réinitialiser » : nom et tags d'origine.
      await card().focus();
      await page.keyboard.press('e');
      assert.equal(await formOpen(), 'Modifier l’album');
      await button('Réinitialiser').click();
      await formClosed();
      await albumShown('Premier album');
      const reset = await group('Premier album');
      assert.deepEqual(
        reset.elements.map((e) => [...e.tags].sort()),
        before.elements.map((e) => [...e.tags].sort()),
      );
      assert.deepEqual(errors, []);
    });

    it('manette : X ouvre l’éditeur de l’album, la croix parcourt les champs, A choisit Annuler, B ferme', async () => {
      await connectPad();
      await openAlbums();
      await albumShown('Premier album');
      const before = await group('Premier album');
      await card().focus();
      await padPress('x');
      assert.equal(await formOpen(), 'Modifier l’album');
      await page.waitForFunction((sel) => document.activeElement?.closest(sel), FORM);
      const first = await page.evaluateHandle(() => document.activeElement);
      await padPress('down');
      assert.ok(await page.evaluate((f) => document.activeElement !== f, first));
      assert.ok(await focusIn(FORM));
      await button('Annuler').focus();
      await padPress('a');
      await formClosed();
      await card().focus();
      await padPress('x');
      await formOpen();
      await page.waitForFunction((sel) => document.activeElement?.closest(sel), FORM);
      await padPress('b');
      await formClosed();
      await page.waitForFunction((sel) => document.activeElement?.closest(`${sel} mire-group-card`), VIEW);
      assert.deepEqual(await group('Premier album'), before);
      await disconnectPad();
      assert.deepEqual(errors, []);
    });
  });
  describe('Explorateur : Sources et Dossiers (P4-08)', () => {
    const PAD = { a: 0, b: 1, down: 13, right: 15 };
    const VIEW = '#view mire-explorer mire-explorer-view';
    const COL = `${VIEW} .mire-explorer-view__column:not(.mire-explorer-view__preview)`;
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    // Une touche de la manette ; la ligne qui a le focus est rendue (hydrated) avant chaque appui.
    const padPress = async (button) => {
      await page.waitForFunction(() => document.activeElement?.classList.contains('hydrated'));
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: false, value: 0 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, PAD[button]);
    };
    const connectPad = () =>
      page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    const headings = () => page.$$eval(COL, (cols) => cols.map((c) => c.getAttribute('aria-label')));
    const columns = (n) => page.waitForFunction(([sel, k]) => document.querySelectorAll(sel).length === k, [COL, n]);
    const row = (col, text) =>
      page.locator(`${VIEW} .mire-explorer-view__column:nth-child(${col + 1}) .mire-explorer-view__row.hydrated`, { hasText: text }).first();
    const focusedRow = () =>
      page.evaluate((sel) => {
        const r = document.activeElement?.closest('.mire-explorer-view__row');
        if (!r) return null;
        const cols = [...document.querySelectorAll(`${sel} .mire-explorer-view__column`)];
        return [cols.indexOf(r.closest('.mire-explorer-view__column')), r.querySelector('.mire-explorer-view__label')?.textContent];
      }, VIEW);
    const inColumn = (n) => page.waitForFunction((k) => document.activeElement?.closest(`.mire-explorer-view__column:nth-child(${k})`), n + 1);
    const openExplorer = async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:explorer' }));
      await page.waitForFunction(
        (sel) => document.body.dataset.section === 'explorer' && document.querySelector(`${sel} .mire-explorer-view__row.hydrated`),
        VIEW,
      );
    };

    before(() => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(async () => {
      await disconnectPad();
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('souris : Sources › la source Images › Vacances, puis une image et son aperçu', async () => {
      await openExplorer();
      await row(0, 'Sources').click();
      await columns(2);
      // Les sources de la configuration de démonstration, avec leur sorte et leur emplacement.
      const sources = await page.$$eval(`${VIEW} .mire-explorer-view__column:nth-child(2) .mire-explorer-view__label`, (ls) => ls.map((l) => l.textContent));
      for (const name of ['Images', 'Musique', 'Vidéos']) assert.ok(sources.includes(`Dossier · ${name}`), sources.join(' | '));
      await row(1, 'Dossier · Images').click();
      await columns(3);
      await row(2, 'Vacances').click();
      await columns(4);
      assert.deepEqual((await headings()).slice(0, 2), ['Explorateur', 'Sources']);
      assert.equal((await headings())[3], 'Vacances');
      await page.locator(`${VIEW} .mire-explorer-view__column:nth-child(4) .mire-explorer-view__row.hydrated`).first().click();
      await page.locator(`${VIEW} .mire-explorer-view__preview .mire-explorer-view__action.hydrated`, { hasText: 'Lire' }).waitFor();
      const preview = await page.$eval(`${VIEW} .mire-explorer-view__preview`, (p) => ({
        image: !!p.querySelector('ds-thumb'),
        location: p.querySelector('.mire-explorer-view__location')?.textContent ?? '',
      }));
      assert.ok(preview.image);
      assert.ok(preview.location.includes('/bibliotheque/Images/Vacances/'), preview.location);
      await page.waitForFunction(() => document.activeElement?.dataset?.previewAction === 'play');
      await shot('section-explorer-sources');
      assert.deepEqual(errors, []);
    });

    it('manette : la croix descend jusqu’à Dossiers, A ouvre un dossier puis un élément, B revient jusqu’à l’accueil', async () => {
      await connectPad();
      await openExplorer();
      await row(0, 'Pages').focus();
      for (let i = 0; i < 4; i++) await padPress('down');
      await page.waitForFunction(() => document.activeElement?.textContent?.includes('Dossiers'));
      // A sur Dossiers : les dossiers autorisés, le focus sur le premier (Vidéos, premier de la configuration).
      // La colonne des dossiers autorisés s'affiche dès que le focus s'arrête sur Dossiers ; A y entre.
      await page.waitForFunction(
        (sel) => document.querySelector(`${sel} .mire-explorer-view__column:nth-child(2)`)?.getAttribute('aria-label') === 'Dossiers',
        VIEW,
      );
      await page.waitForFunction((sel) => document.querySelector(`${sel} .mire-explorer-view__column:nth-child(2) .mire-explorer-view__row.hydrated`), VIEW);
      await padPress('a');
      await inColumn(1);
      const [, first] = await focusedRow();
      assert.equal(first, 'Vidéos');
      // A : les sous-dossiers, puis les fichiers de Vidéos.
      await padPress('a');
      await inColumn(2);
      assert.deepEqual(await focusedRow(), [2, 'Série']);
      // La croix descend sur un film : son aperçu s'affiche ; A y porte le focus (« Lire »).
      await padPress('down');
      await page.waitForFunction((sel) => document.querySelector(`${sel} .mire-explorer-view__preview .mire-explorer-view__action.hydrated`), VIEW);
      const film = (await focusedRow())[1];
      await padPress('a');
      await page.waitForFunction(() => document.activeElement?.dataset?.previewAction === 'play');
      // B : retour au film, puis au dossier Vidéos, puis à Dossiers, puis à l'accueil.
      await padPress('b');
      assert.deepEqual(await focusedRow(), [2, film]);
      await padPress('b');
      await inColumn(1);
      assert.deepEqual(await focusedRow(), [1, 'Vidéos']);
      await padPress('b');
      assert.deepEqual(await focusedRow(), [0, 'Dossiers']);
      await padPress('b');
      await page.waitForFunction(() => document.body.dataset.section === 'home');
      await disconnectPad();
      assert.deepEqual(errors, []);
    });
  });

  describe('Lecteur vidéo (P4-14)', () => {
    // Vidéo de démonstration de six minutes, sans son, avec des sous-titres en anglais et en français à côté.
    const PAD = { b: 1, lt: 6, rt: 7, up: 12, down: 13 };
    const PLAYER = 'mire-video-player';
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    let file;
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: false, value: 0 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, PAD[button]);
    };
    const connectPad = () =>
      page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    const isOpen = () => page.evaluate((sel) => !document.querySelector(sel).hidden, PLAYER);
    const text = (part) => page.evaluate(([sel, p]) => document.querySelector(`${sel} .mire-video-player__${p}`)?.textContent ?? null, [PLAYER, part]);
    const state = () =>
      page.evaluate((sel) => {
        const v = document.querySelector(`${sel} video`);
        const [seek, volume] = [...document.querySelectorAll(`${sel} ds-range input`)];
        return { time: v.currentTime, volume: v.volume, seek: Number(seek.value), volumeRange: Number(volume.value), paused: v.paused };
      }, PLAYER);
    // Le lecteur est rendu (hydrated) et la durée de la vidéo connue : les touches peuvent agir.
    const ready = () =>
      page.waitForFunction(
        (sel) => {
          const el = document.querySelector(sel);
          return el?.classList.contains('hydrated') && !el.hidden && el.querySelector('video').readyState >= 1;
        },
        PLAYER,
        { timeout: 15000 },
      );
    // Ouverture comme depuis le système (fichier passé à une seconde instance de Mire).
    const openDemo = async () => {
      await app.evaluate(({ app: a }, f) => a.emit('second-instance', {}, ['electron', '.', f]), file);
      await ready();
    };
    // La réglette du volume montre le volume de la vidéo (rendu à l'image suivante).
    const rangeFollows = () =>
      page.waitForFunction(
        (sel) => Number(document.querySelector(`${sel} .mire-video-player__volume input`).value) === document.querySelector(`${sel} video`).volume,
        PLAYER,
      );
    // Message au centre de l'écran, rendu à l'image suivante.
    const osdShows = (re) =>
      page.waitForFunction(([sel, r]) => new RegExp(r).test(document.querySelector(`${sel} .mire-video-player__osd`)?.textContent ?? ''), [PLAYER, re]);
    const pause = async () => {
      await page.waitForFunction((sel) => !document.querySelector(`${sel} video`).paused && document.activeElement === document.querySelector(sel), PLAYER);
      await page.keyboard.press(' ');
      await page.waitForFunction((sel) => document.querySelector(`${sel} video`).paused, PLAYER);
    };

    before(() => {
      file = path.join(tmp, 'fixtures', 'media', 'Démonstration.webm');
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(async () => {
      await disconnectPad();
      if (await isOpen()) await page.keyboard.press('Escape');
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('une vidéo de démonstration s’ouvre : titre, réglettes, sous-titres en français', async () => {
      const from = await page.evaluateHandle(() => document.activeElement);
      await openDemo();
      assert.equal(await text('title'), 'Démonstration');
      assert.equal(await text('sub'), 'media');
      await page.waitForFunction((sel) => document.querySelectorAll(`${sel} ds-range.hydrated`).length === 2, PLAYER);
      // Les sous-titres français sont activés d'office.
      await page.waitForFunction((sel) => document.querySelector(`${sel} .mire-video-player__subs`)?.textContent === 'Sous-titres : fr', PLAYER);
      const showing = await page.evaluate((sel) => [...document.querySelector(`${sel} video`).textTracks].map((t) => `${t.label}:${t.mode}`), PLAYER);
      assert.deepEqual(showing.sort(), ['en:disabled', 'fr:showing']);
      // Pause (Espace) : l'affichage reste ; le message au centre s'efface avant la capture.
      await pause();
      await page.waitForFunction((sel) => !document.querySelector(`${sel} .mire-video-player__osd`).classList.contains('is-shown'), PLAYER);
      await page.evaluate((sel) => (document.querySelector(`${sel} video`).currentTime = 45), PLAYER);
      await page.waitForFunction((sel) => document.querySelector(`${sel} .mire-video-player__time`)?.textContent === '0:45 / 6:00', PLAYER);
      // Pas de message en cours (« Manette déconnectée », laissé par un bloc précédent) sur la capture.
      await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 8000 });
      await settle();
      await shot('lecteur-video');
      // Échap ferme et rend le focus là où il était.
      await page.keyboard.press('Escape');
      await page.waitForFunction((sel) => document.querySelector(sel).hidden, PLAYER);
      assert.ok(await page.evaluate((f) => document.activeElement === f, from));
      assert.deepEqual(errors, []);
    });

    it('clavier : les flèches règlent la position et le volume, S change les sous-titres', async () => {
      await openDemo();
      // Position gardée en fermant (45 s) : la vidéo reprend là, avec un message.
      await page.waitForFunction((sel) => Math.abs(document.querySelector(`${sel} video`).currentTime - 45) < 2, PLAYER);
      await page.waitForFunction(() => document.getElementById('toast')?.textContent.startsWith('Reprise à 0:45'));
      await pause();
      const start = await state();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(([sel, t]) => document.querySelector(`${sel} video`).currentTime > t + 9, [PLAYER, start.time]);
      await osdShows(/^\+10 s {2}0:5\d$/.source);
      await page.waitForFunction(([sel, v]) => Number(document.querySelector(`${sel} .mire-video-player__seek input`).value) > v, [PLAYER, start.seek]);
      await page.keyboard.press('ArrowUp');
      await page.waitForFunction(([sel, v]) => document.querySelector(`${sel} video`).volume > v, [PLAYER, start.volume]);
      const louder = await state();
      // La réglette du volume suit.
      await rangeFollows();
      await osdShows(`^Volume ${Math.round(louder.volume * 100)} %$`);
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction(([sel, v]) => document.querySelector(`${sel} video`).volume === v, [PLAYER, start.volume]);
      // S : sous-titres suivants (après le français, aucun).
      await page.keyboard.press('s');
      await page.waitForFunction((sel) => document.querySelector(`${sel} .mire-video-player__subs`)?.textContent === 'Sous-titres : non', PLAYER);
      await osdShows('^Sous-titres désactivés$');
      // La réglette de position, à la souris : la vidéo va au milieu.
      await page.evaluate((sel) => {
        const input = document.querySelector(`${sel} .mire-video-player__seek input`);
        input.value = '500';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, PLAYER);
      await page.waitForFunction((sel) => Math.abs(document.querySelector(`${sel} video`).currentTime - 180) < 1, PLAYER);
      assert.equal(await page.evaluate((sel) => document.activeElement === document.querySelector(sel), PLAYER), true);
      // Le bouton de fermeture (ds-trigger vers le contrôleur).
      await page.locator(`${PLAYER} ds-trigger[action="close"] button`).click();
      await page.waitForFunction((sel) => document.querySelector(sel).hidden, PLAYER);
      assert.deepEqual(errors, []);
    });

    it('manette : RT et LT avancent et reculent d’une minute, la croix règle le volume, B ferme', async () => {
      await connectPad();
      await openDemo();
      await pause();
      await page.waitForFunction(() => document.querySelector('mire-padbar')?.textContent.includes('Sous-titres'));
      const start = await state();
      await padPress('rt');
      await page.waitForFunction(([sel, t]) => document.querySelector(`${sel} video`).currentTime > t + 59, [PLAYER, start.time]);
      await padPress('lt');
      await page.waitForFunction(([sel, t]) => Math.abs(document.querySelector(`${sel} video`).currentTime - t) < 1, [PLAYER, start.time]);
      await padPress('up');
      await page.waitForFunction(([sel, v]) => document.querySelector(`${sel} video`).volume > v, [PLAYER, start.volume]);
      await rangeFollows();
      await padPress('down');
      await page.waitForFunction(([sel, v]) => document.querySelector(`${sel} video`).volume === v, [PLAYER, start.volume]);
      await padPress('b');
      await page.waitForFunction((sel) => document.querySelector(sel).hidden, PLAYER);
      await disconnectPad();
      assert.deepEqual(errors, []);
    });
  });

  describe('Jeux (P4-17)', () => {
    const PAD = { a: 0, b: 1, x: 2, down: 13 };
    const CENTRE = '#view mire-centre mire-centre-view';
    const SEARCH = '#view mire-search mire-search-view';
    const FORM = 'mire-dialogs mire-form';
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: false, value: 0 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, PAD[button]);
    };
    const connectPad = () =>
      page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    const formOpen = async () => {
      await page.waitForFunction((sel) => {
        const f = document.querySelector(sel);
        return (
          f?.classList.contains('hydrated') &&
          f.querySelector('ds-modal.hydrated') &&
          [...f.querySelectorAll('ds-trigger')].every((t) => t.classList.contains('hydrated'))
        );
      }, FORM);
      return page.locator(`${FORM} .mire-form__title`).textContent();
    };
    const formClosed = () => page.waitForFunction((sel) => !document.querySelector(sel), FORM);
    const button = (label) => page.locator(`${FORM} .mire-form__actions ds-trigger`, { hasText: label });
    const field = (label) => page.locator(`${FORM} ds-field`, { hasText: label });
    const consoles = () => page.evaluate(async () => (await window.api.getConfig()).config.emulators);
    const card = (name) => page.locator(`${CENTRE} .mire-centre-view__console`, { has: page.locator('.mire-centre-view__name', { hasText: name }) });
    // Onglet des consoles du Centre, rendu.
    const openConsoles = async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:center' }));
      await page.waitForFunction((sel) => document.body.dataset.section === 'downloads' && document.querySelector(sel)?.classList.contains('hydrated'), CENTRE);
      const tab = page.locator(`${CENTRE} .mire-centre-view__tab.hydrated[data-tab="consoles"]`);
      await tab.click();
      await page.waitForFunction((sel) => document.querySelector(sel)?.tab === 'consoles', CENTRE);
      await page.locator(`${CENTRE} .mire-centre-view__new-console.hydrated`).waitFor();
    };
    // Un jeu de la Super Nintendo de démonstration trouvé par la Recherche : sa carte rendue.
    const romCard = () => page.locator(`${SEARCH} mire-card ds-trigger.hydrated[data-key^="rom:"]`).first();
    const findRom = async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:search' }));
      await page.waitForFunction((sel) => document.body.dataset.section === 'search' && document.querySelector(sel)?.classList.contains('hydrated'), SEARCH);
      await page.locator(`${SEARCH} .mire-search-view__input`).fill('Course de karts');
      await romCard().waitFor();
      return romCard().getAttribute('data-key');
    };

    before(() => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(async () => {
      await disconnectPad();
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('créer une console à la main, puis lui faire lancer ses jeux avec l’émulateur d’une autre', async () => {
      await openConsoles();
      await card('Super Nintendo').waitFor();
      await page.locator(`${CENTRE} .mire-centre-view__new-console`).click();
      assert.equal(await formOpen(), 'Créer une console');
      const emulator = (await consoles())[0].path;
      await field('Nom').locator('input').fill('Super Nintendo (bis)');
      await field('Système').locator('select').selectOption('Nintendo - Super Nintendo Entertainment System');
      await field('Émulateur (programme)').locator('input').fill(emulator);
      await field('Arguments').locator('input').fill('--plein-ecran {rom}');
      await button('Enregistrer').click();
      await formClosed();
      await card('Super Nintendo (bis)').waitFor();
      const made = (await consoles()).find((e) => e.name === 'Super Nintendo (bis)');
      assert.ok(made?.id);
      assert.deepEqual(made.args, ['--plein-ecran', '{rom}']);
      assert.equal(made.path, emulator);
      await shot('centre-consoles');
      // La console de démonstration lance ses jeux avec l'émulateur de la nouvelle.
      const demo = (await consoles())[0];
      const demoCard = page.locator(`${CENTRE} .mire-centre-view__console[data-key="${demo.id}"]`);
      await demoCard.locator('.mire-centre-view__emulator').click();
      assert.equal(await formOpen(), 'Émulateur de Super Nintendo');
      await field('Émulateur').locator('select').selectOption(made.id);
      await button('Enregistrer').click();
      await formClosed();
      await until(() => page.evaluate(async (id) => (await window.api.getConfig()).config.emulators[0].emulator === id, made.id));
      await demoCard.getByText('celui de la console Super Nintendo (bis)').waitFor();
      // Pour un jeu : la boîte du jeu (clic droit sur sa carte) garde un autre choix, enregistré par sa clé.
      const key = await findRom();
      await romCard().click({ button: 'right' });
      assert.match(await formOpen(), /Course de karts/);
      await field('Émulateur').locator('select').selectOption(demo.id);
      await button('Enregistrer l’émulateur').click();
      await formClosed();
      const chosen = await page.evaluate((k) => window.api.gameEmulators(k), key);
      assert.deepEqual([chosen.console, chosen.consoleDefault, chosen.game], [demo.id, made.id, demo.id]);
      assert.deepEqual(errors, []);
    });

    it('manette : X ouvre la boîte d’un jeu, la croix la parcourt, A choisit Annuler, B ferme', async () => {
      await connectPad();
      const key = await findRom();
      const before = await page.evaluate((k) => window.api.gameEmulators(k), key);
      await romCard().focus();
      await padPress('x');
      assert.match(await formOpen(), /Course de karts/);
      await page.waitForFunction((sel) => document.activeElement?.closest(sel), FORM);
      const first = await page.evaluateHandle(() => document.activeElement);
      await padPress('down');
      assert.ok(await page.evaluate((f) => document.activeElement !== f, first));
      assert.ok(await page.evaluate((sel) => !!document.activeElement?.closest(sel), FORM));
      await button('Annuler').focus();
      await padPress('a');
      await formClosed();
      await romCard().focus();
      await padPress('x');
      await formOpen();
      await page.waitForFunction((sel) => document.activeElement?.closest(sel), FORM);
      await padPress('b');
      await formClosed();
      await page.waitForFunction((sel) => document.activeElement?.closest(`${sel} mire-card`), SEARCH);
      assert.deepEqual(await page.evaluate((k) => window.api.gameEmulators(k), key), before);
      await disconnectPad();
      // La console créée par le test est retirée : les blocs suivants retrouvent la configuration de démonstration.
      await openConsoles();
      await card('Super Nintendo (bis)').locator('ds-trigger', { hasText: 'Retirer' }).click();
      assert.equal(await formOpen(), 'Retirer la console Super Nintendo (bis) ?');
      await button('Retirer').click();
      await formClosed();
      await until(() => page.evaluate(async () => (await window.api.getConfig()).config.emulators.length === 1));
      assert.equal((await consoles())[0].emulator, undefined);
      assert.deepEqual(errors, []);
    });
  });

  describe('Vue web et télévision (P4-16)', () => {
    const PAD = { a: 0, b: 1, select: 8, left: 14, right: 15 };
    const BAR = '#view mire-web mire-webbar';
    const VIEW = '#view mire-page-view';
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    let site;
    let base;
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: false, value: 0 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, PAD[button]);
    };
    const connectPad = () =>
      page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    // Barre rendue pour ce site, avec ses boutons prêts.
    const barShown = (id) =>
      page.waitForFunction(
        ([sel, key]) => {
          const bar = document.querySelector(sel);
          return (
            bar?.classList.contains('hydrated') &&
            bar.dataset.key === key &&
            [...bar.querySelectorAll('ds-trigger')].every((t) => t.classList.contains('hydrated'))
          );
        },
        [BAR, id],
      );
    const pageTitle = (title) => page.waitForFunction(([sel, t]) => document.querySelector(`${sel} .mire-webbar__page`)?.textContent === t, [BAR, title]);
    const barButton = (web) => page.locator(`${BAR} button[data-web="${web}"]`);

    before(async () => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
      // Site de démonstration sur la boucle locale (Chromium ne passe pas par le proxy du test pour 127.0.0.1).
      site = http.createServer((req, res) => {
        const title = req.url === '/deux' ? 'Deuxième page' : 'Page de démonstration';
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
      });
      await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${site.address().port}`;
      // Portail web de démonstration (service de télévision « web ») ; lecteur externe absent : aucune chaîne ne se lance.
      await page.evaluate(async (url) => {
        const { config } = await window.api.getConfig();
        const services = [...config.tv.services, { id: 'demo-web', name: 'Portail de démonstration', kind: 'web', url }];
        await window.api.saveConfig({ ...config, tv: { ...config.tv, services }, externalPlayer: { path: 'mire-e2e-lecteur-absent', args: [] } });
      }, `${base}/`);
    });
    after(async () => {
      await disconnectPad();
      page.off('pageerror', onError);
      page.off('console', onConsole);
      await page.evaluate(() => window.api.webClose('tv:demo-web')).catch(() => {});
      site?.close();
    });

    it('une vue web de démonstration : nom et couleur publiés, titre de la page, place de la vue native', async () => {
      await page.evaluate(() => document.querySelector('mire-app').openSite({ id: 'tv:demo-web' }));
      await page.waitForFunction(() => document.body.dataset.section === 'web');
      await barShown('tv:demo-web');
      await pageTitle('Page de démonstration');
      const bar = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return { kind: el.dataset.kind, name: el.querySelector('.mire-webbar__site').textContent, brand: el.style.getPropertyValue('--brand') };
      }, BAR);
      assert.deepEqual(bar, { kind: 'tv', name: 'Portail de démonstration', brand: '#E23B3B' });
      // La vue native est posée sur la place réservée par mire-web-slot.
      const placed = await app.evaluate(({ BrowserWindow }) => {
        const [view] = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith('mire-plugin:')).contentView.children;
        return view ? view.getBounds() : null;
      });
      const slot = await page.evaluate(() => {
        const r = document.querySelector('#view mire-web-slot').getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      });
      assert.deepEqual(placed, slot);
      await settle();
      await shot('web-barre');
      assert.deepEqual(errors, []);
    });

    it('la barre et ses actions : page suivante, précédente, recharger', async () => {
      assert.equal(await barButton('back').isDisabled(), true);
      await page.evaluate((url) => window.api.webOpen('tv:demo-web', url), `${base}/deux`);
      await pageTitle('Deuxième page');
      await page.waitForFunction((sel) => !document.querySelector(`${sel} button[data-web="back"]`).disabled, BAR);
      await barButton('back').click();
      await pageTitle('Page de démonstration');
      await page.waitForFunction((sel) => !document.querySelector(`${sel} button[data-web="forward"]`).disabled, BAR);
      await barButton('forward').click();
      await pageTitle('Deuxième page');
      await barButton('reload').click();
      await pageTitle('Deuxième page');
      assert.deepEqual(errors, []);
    });

    it('manette : la croix parcourt la barre, A appuie, B revient à la page Télévision', async () => {
      await connectPad();
      await settle();
      // Mire a le clavier (bouton de la barre cliqué) : on part du premier bouton.
      await barButton('back').focus();
      const first = await page.evaluate(() => document.activeElement.dataset.web);
      await padPress('right');
      const next = await page.evaluate(() => document.activeElement.dataset.web);
      assert.notEqual(next, first, 'la croix passe au bouton suivant');
      await padPress('left');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.web), first);
      // A appuie sur le bouton : « Page précédente » ramène à la première page.
      assert.equal(first, 'back');
      await padPress('a');
      await pageTitle('Page de démonstration');
      // Première page : « Page précédente » devient inactif ; B depuis un autre bouton de la barre.
      await barButton('reload').focus();
      await padPress('b');
      await page.waitForFunction(() => document.body.dataset.section === 'page' && document.getElementById('title')?.textContent === 'Télévision');
      // La vue native est cachée hors de la section web.
      const visible = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => !w.webContents.getURL().startsWith('mire-plugin:'))
          .contentView.children.some((v) => v.getVisible()),
      );
      assert.equal(visible, false);
      assert.deepEqual(errors, []);
    });

    it('une chaîne de la page Télévision : la croix la choisit, A la regarde (variante choisie par le processus principal)', async () => {
      const card = (name) => page.locator(`${VIEW} mire-card ds-trigger.hydrated`, { hasText: name }).first();
      await card('Chaîne Deux').waitFor();
      await card('Chaîne Une').focus();
      await padPress('right');
      assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-key]')?.dataset.key), 'tv:demo|2');
      await padPress('a');
      await page.waitForFunction(() => /Chaîne Deux|lecteur externe/.test(document.getElementById('toast')?.textContent || ''));
      // Le lecteur externe de démonstration n'existe pas : le service a bien trouvé la chaîne et tenté de la lancer.
      const r = await page.evaluate(() => window.api.tvWatch('tv:demo|2'));
      assert.equal(r.ok, false);
      assert.doesNotMatch(r.error, /n’est plus dans la liste/);
      // Une clé inconnue est refusée par le service, sans rien lancer.
      const gone = await page.evaluate(() => window.api.tvWatch('tv:demo|99'));
      assert.deepEqual(gone, { ok: false, error: 'Cette chaîne n’est plus dans la liste. Rechargez les chaînes.' });
      await settle();
      await shot('television-page');
      await disconnectPad();
      assert.deepEqual(errors, []);
    });
  });

  describe('Réglages (P4-20)', () => {
    const PAD = { a: 0, b: 1, down: 13 };
    const VIEW = '#view mire-settings mire-settings-view';
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: false, value: 0 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, PAD[button]);
    };
    const connectPad = () =>
      page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    // Écran Réglages affiché, ses panneaux et leurs composants rendus (classe hydrated).
    const openSettings = async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:settings' }));
      await page.waitForFunction(
        (sel) =>
          document.body.dataset.section === 'settings' &&
          document.querySelector(`${sel}.hydrated .mire-settings-view__panel`) &&
          [...document.querySelectorAll(`${sel} ds-toggle, ${sel} ds-select, ${sel} ds-sortable, ${sel} ds-trigger`)].every((e) =>
            e.classList.contains('hydrated'),
          ),
        VIEW,
      );
    };
    // Valeur enregistrée dans la configuration (processus principal), au chemin donné.
    const saved = (p) => page.evaluate(async (q) => q.split('.').reduce((o, k) => o?.[k], (await window.api.getConfig()).config), p);
    const waitSaved = (p, v) =>
      until(async () => {
        const config = await page.evaluate(async () => (await window.api.getConfig()).config);
        return JSON.stringify(p.split('.').reduce((o, k) => o?.[k], config)) === JSON.stringify(v);
      });
    const palette = (id) => page.locator(`${VIEW} .mire-settings-view__palette[data-key="${id}"]`);
    const providers = () => page.$$eval(`${VIEW} ds-sortable[data-list="providers"] [data-key]`, (els) => els.map((e) => e.dataset.key));

    before(() => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(async () => {
      await disconnectPad();
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('un réglage s’enregistre dès qu’il change ; une palette s’applique tout de suite', async () => {
      await openSettings();
      // Interrupteur : enregistré aussitôt, sans bouton « Enregistrer ».
      const clock = await saved('ui.home.clock');
      await page.locator(`${VIEW} ds-toggle#set-ui-home-clock`).click();
      await waitSaved('ui.home.clock', !clock);
      await page.locator(`${VIEW} ds-toggle#set-ui-home-clock`).click();
      await waitSaved('ui.home.clock', clock);
      // Liste de choix.
      await page.locator(`${VIEW} select#set-downloads-torrentClient`).selectOption('system');
      await waitSaved('downloads.torrentClient', 'system');
      await page.locator(`${VIEW} select#set-downloads-torrentClient`).selectOption('mire');
      await waitSaved('downloads.torrentClient', 'mire');
      // Palette : l'aperçu porte ses propres jetons ; choisie, elle s'applique au document.
      assert.equal(await page.locator(`${VIEW} .mire-settings-view__palette[data-key="minuit"] [data-palette="minuit"]`).count(), 1);
      await palette('minuit').click();
      await page.waitForFunction(() => document.documentElement.dataset.palette === 'minuit');
      await page.waitForFunction(
        (sel) => document.querySelector(`${sel} .mire-settings-view__palette[data-key="minuit"]`)?.getAttribute('aria-pressed') === 'true',
        VIEW,
      );
      await waitSaved('ui.theme', 'minuit');
      await palette('ecran').click();
      await page.waitForFunction(() => document.documentElement.dataset.palette === 'ecran');
      await waitSaved('ui.theme', 'ecran');
      assert.deepEqual(errors, []);
    });

    it('l’ordre d’une liste change au clavier (ds-sortable) : celui des fournisseurs d’infos', async () => {
      await openSettings();
      // TMDB est un plugin à installer (P5-15) : seuls les fournisseurs du cœur sans lui.
      assert.deepEqual(await providers(), ['musicbrainz', 'libretro', 'steam']);
      const item = (key) => page.locator(`${VIEW} ds-sortable[data-list="providers"] [data-key="${key}"]`);
      await item('libretro').scrollIntoViewIfNeeded();
      await item('libretro').focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Space');
      await waitSaved('catalog.metadataProviders', ['libretro', 'musicbrainz', 'steam']);
      await page.waitForFunction((sel) => document.querySelector(`${sel} ds-sortable[data-list="providers"] [data-key]`)?.dataset.key === 'libretro', VIEW);
      await page.locator(`${VIEW} ds-sortable[data-list="providers"]`).scrollIntoViewIfNeeded();
      await settle();
      await page.locator(`${VIEW} [data-panel="scrape"]`).screenshot({ path: path.join(SHOTS, 'settings-order.png') });
      // Retour à l'ordre d'origine, par le bouton qui monte un élément d'un rang.
      await page.locator(`${VIEW} ds-sortable[data-list="providers"] [data-key="musicbrainz"] button`).first().click();
      await waitSaved('catalog.metadataProviders', ['musicbrainz', 'libretro', 'steam']);
      assert.deepEqual(errors, []);
    });

    it('manette : la croix parcourt les réglages, A choisit une palette, B quitte l’écran', async () => {
      await connectPad();
      await openSettings();
      await palette('auto').focus();
      // Croix vers le bas : le focus reste dans les réglages, sur un autre élément.
      await padPress('down');
      await page.waitForFunction((sel) => document.activeElement?.closest(sel) && !document.activeElement.closest('[data-key="auto"]'), VIEW);
      // A sur une palette : elle s'applique.
      await palette('jour').focus();
      await padPress('a');
      await page.waitForFunction(() => document.documentElement.dataset.palette === 'jour');
      await waitSaved('ui.theme', 'jour');
      // B : le focus quitte les réglages (retour au menu).
      await padPress('b');
      await page.waitForFunction((sel) => !document.activeElement?.closest(sel), VIEW);
      await disconnectPad();
      await openSettings();
      await palette('ecran').click();
      await waitSaved('ui.theme', 'ecran');
      assert.deepEqual(errors, []);
    });
  });

  describe('Réglages : blocs des pages (P4-20)', () => {
    const PAD = { a: 0, b: 1, down: 13 };
    const VIEW = '#view mire-settings mire-settings-view';
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const frames = (n) =>
      page.evaluate(
        (k) =>
          new Promise((resolve) =>
            (function next(i) {
              if (!i) resolve();
              else requestAnimationFrame(() => next(i - 1));
            })(k),
          ),
        n,
      );
    const padPress = async (button) => {
      await page.evaluate((n) => (window.__pad.buttons[n] = { pressed: true, value: 1 }), PAD[button]);
      await frames(3);
      await page.evaluate((n) => (window.__pad.buttons[n] = { pressed: false, value: 0 }), PAD[button]);
      await frames(2);
    };
    const connectPad = () =>
      page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    // Écran Réglages affiché, ses composants rendus (classe hydrated) : attendue avant chaque touche.
    const openSettings = async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:settings' }));
      await hydrated();
    };
    const hydrated = () =>
      page.waitForFunction(
        (sel) =>
          document.body.dataset.section === 'settings' &&
          document.querySelector(`${sel}.hydrated .mire-settings-view__group`) &&
          [...document.querySelectorAll(`${sel} ds-toggle, ${sel} ds-toggle-group, ${sel} ds-trigger, ${sel} ds-field`)].every((e) =>
            e.classList.contains('hydrated'),
          ),
        VIEW,
      );
    const config = () => page.evaluate(async () => (await window.api.getConfig()).config);
    const waitConfig = (fn, arg) => until(async () => fn(await config(), arg));
    const group = (key) => page.locator(`${VIEW} .mire-settings-view__group[data-list="${key}"]`);
    // Message bref masqué avant une capture : il dépend du minutage.
    const hideToast = async () => {
      await page.evaluate(() => document.getElementById('toast')?.classList.remove('show'));
      await settle();
    };
    const tvChoice = (id) => page.locator(`${VIEW} ds-toggle-group#set-tv ds-toggle[data-key="${id}"]`);

    before(() => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(async () => {
      await disconnectPad();
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('sources : ajouter une adresse, puis la retirer ; plus de bouton « Régler dans … »', async () => {
      await openSettings();
      assert.equal(await page.locator(`${VIEW} ds-trigger[action^="openPageSettings"]`).count(), 0);
      const location = path.join(os.tmpdir(), 'mire-e2e', 'fixtures', 'bibliotheque');
      const before = (await config()).library.sources.filter((x) => x.kind === 'image').length;
      await group('sources:image').locator('ds-trigger[action^="addSourceAddress"]').click();
      // Boîte « Ajouter une adresse » (encore celle de l'interface historique).
      await page.locator('#dlg[open] #dlgf-location').fill(location);
      await page.locator('#dlg[open] [data-dlg="ok"]').click();
      await waitConfig((c, a) => c.library.sources.some((x) => x.kind === 'image' && x.location === a), location);
      const added = (await config()).library.sources.find((x) => x.kind === 'image' && x.location === location);
      const row = group('sources:image').locator(`li.mire-settings-view__entry[data-key="${added.id}"]`);
      await row.waitFor();
      await hydrated();
      await page.locator(`${VIEW} [data-panel="sources"]`).evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await hideToast();
      await shot('settings-sources');
      await row.locator('ds-trigger').click();
      await waitConfig((c, a) => c.library.sources.filter((x) => x.kind === 'image').length === a, before);
      await row.waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
    });

    it('télévision : choisir un service, puis revenir au premier', async () => {
      await openSettings();
      assert.equal((await config()).tv.active, 'demo');
      await tvChoice('secours').click();
      await waitConfig((c) => c.tv.active === 'secours');
      // Service actif sous forme de playlist : son adresse est un champ de l'écran.
      await page.waitForFunction((sel) => document.querySelector(`${sel} input#set-tv-playlist`)?.value.endsWith('chaines.m3u'), VIEW);
      await hydrated();
      await tvChoice('demo').click();
      await waitConfig((c) => c.tv.active === 'demo');
      assert.deepEqual(errors, []);
    });

    it('manette : la croix parcourt les blocs, A choisit un service, B quitte l’écran', async () => {
      await connectPad();
      await openSettings();
      await tvChoice('demo').focus();
      // Croix vers le bas : le focus reste dans les réglages, sur un autre élément.
      await padPress('down');
      await page.waitForFunction((sel) => document.activeElement?.closest(sel) && document.activeElement.dataset.key !== 'demo', VIEW);
      assert.equal((await config()).tv.active, 'demo');
      // A sur un service : il devient le service actif.
      await hydrated();
      await tvChoice('secours').focus();
      await padPress('a');
      await waitConfig((c) => c.tv.active === 'secours');
      // B : le focus quitte les réglages (retour au menu).
      await hydrated();
      await padPress('b');
      await page.waitForFunction((sel) => !document.activeElement?.closest(sel), VIEW);
      await disconnectPad();
      // Retour au service de départ.
      await openSettings();
      await tvChoice('demo').click();
      await waitConfig((c) => c.tv.active === 'demo');
      await hydrated();
      await page.locator(`${VIEW} [data-panel="games"]`).evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await hideToast();
      await shot('settings-games');
      assert.deepEqual(errors, []);
    });
  });

  describe('Mode secours (P4-10)', () => {
    const VIEW = '#view mire-rescue mire-rescue-view';
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    before(() => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(() => {
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    // Bandeau du mode secours affiché au-dessus de l'explorateur, rendu, avec ce message.
    const rescueShown = (message) =>
      page.waitForFunction(
        ([sel, text]) => {
          const v = document.querySelector(sel);
          if (document.body.dataset.section !== 'explorer' || !v?.classList.contains('hydrated')) return false;
          const triggers = [...v.querySelectorAll('ds-trigger')];
          return (
            v.querySelector('.mire-rescue-view__message')?.textContent === text &&
            triggers.length > 0 &&
            triggers.every((t) => t.classList.contains('hydrated'))
          );
        },
        [VIEW, message],
      );
    const savedPageTheme = () => page.evaluate(() => window.api.getConfig().then((r) => r.config.ui.pageTheme));

    it('un thème cassé fait revenir à l’explorateur, avec un message ; un autre thème s’y choisit', async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:settings' }));
      await page.waitForFunction(() => typeof document.querySelector('mire-settings')?.setPageTheme === 'function');
      // Thème volontairement cassé : son theme.json est introuvable (un theme.json invalide est écarté de même).
      await page.evaluate(() => document.querySelector('mire-settings').setPageTheme({ id: 'casse' }));
      await rescueShown('Le thème « casse » est introuvable. Mire est revenu à l’explorateur.');
      assert.equal(await page.evaluate(() => document.querySelector('#view mire-explorer mire-explorer-view') !== null), true);
      const themes = await page.$$eval(`${VIEW} .mire-rescue-view__theme`, (ts) => ts.map((t) => [t.dataset.key, t.textContent.trim()]));
      assert.deepEqual(themes, [
        ['mire', 'Mire'],
        ['papier', 'Papier'],
      ]);
      await settle();
      await page.locator(VIEW).screenshot({ path: path.join(SHOTS, 'rescue-banner.png') });
      // Choix d'un autre thème depuis l'explorateur : enregistré, puis l'accueil.
      await page.locator(`${VIEW} .mire-rescue-view__theme.hydrated[data-key="mire"]`).click();
      await until(() => page.evaluate(async () => (await window.api.getConfig()).config.ui.pageTheme === 'mire'));
      await page.locator(`${VIEW} .mire-rescue-view__home.hydrated`).click();
      await page.waitForFunction(() => document.body.dataset.section === 'home');
      assert.equal(await page.evaluate(() => document.querySelector('#view mire-rescue')), null);
      assert.equal(await savedPageTheme(), 'mire');
      assert.deepEqual(errors, []);
    });

    it('le raccourci clavier (Ctrl+Maj+E), capté par le processus principal, ouvre l’explorateur', async () => {
      await page.locator('.mire-home-view__bar.hydrated').first().waitFor();
      // Touche envoyée par la fenêtre (comme le clavier), et non injectée dans la page : elle passe par
      // `before-input-event` du processus principal, qui la lit avant la page.
      await app.evaluate(({ BrowserWindow }) => {
        const wc = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().startsWith('mire-plugin:')).webContents;
        for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'E', modifiers: ['control', 'shift'] });
      });
      await rescueShown('Explorateur ouvert par le raccourci du mode secours.');
      await page.locator(`${VIEW} .mire-rescue-view__home.hydrated`).click();
      await page.waitForFunction(() => document.body.dataset.section === 'home');
      assert.deepEqual(errors, []);
    });

    it('la combinaison de la manette (Affichage + Menu) ouvre l’explorateur', async () => {
      await page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
      await page.evaluate(() => {
        window.__pad.buttons[8] = { pressed: true, value: 1 };
        window.__pad.buttons[9] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      });
      await page.evaluate(() => {
        window.__pad.buttons[8] = { pressed: false, value: 0 };
        window.__pad.buttons[9] = { pressed: false, value: 0 };
      });
      await rescueShown('Explorateur ouvert par la combinaison de la manette.');
      await page.evaluate(() => {
        navigator.getGamepads = () => [];
        window.dispatchEvent(new Event('gamepaddisconnected'));
        delete window.__pad;
      });
      await page.locator(`${VIEW} .mire-rescue-view__home.hydrated`).click();
      await page.waitForFunction(() => document.body.dataset.section === 'home');
      assert.deepEqual(errors, []);
    });
  });

  describe('Explorateur : gérer ses fichiers et sélection multiple (P4-09)', () => {
    const PAD = { y: 3 };
    const VIEW = '#view mire-explorer mire-explorer-view';
    const COL = `${VIEW} .mire-explorer-view__column:not(.mire-explorer-view__preview)`;
    const VACANCES = path.join(os.tmpdir(), 'mire-e2e', 'fixtures', 'bibliotheque', 'Images', 'Vacances');
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const row = (col, text) =>
      page.locator(`${VIEW} .mire-explorer-view__column:nth-child(${col + 1}) .mire-explorer-view__row.hydrated`, { hasText: text }).first();
    const picked = () => page.$$eval(`${VIEW} .mire-explorer-view__row[data-picked] .mire-explorer-view__label`, (ls) => ls.map((l) => l.textContent).sort());
    const selectionCount = () => page.locator(`${VIEW} .mire-explorer-view__selection-count`).textContent();
    const action = (name) => page.locator(`${VIEW} .mire-explorer-view__preview ds-trigger[data-preview-action="${name}"].hydrated`);
    // Boîte rendue et ouverte (ds-modal affiché, ds-trigger rendus), le focus dedans.
    const boxOpen = () =>
      page.waitForFunction(() => {
        const b = [...document.querySelectorAll('mire-form')].at(-1);
        return (
          b?.classList.contains('hydrated') &&
          b.querySelector('ds-modal')?.shown &&
          [...b.querySelectorAll('ds-trigger')].every((d) => d.classList.contains('hydrated')) &&
          document.activeElement?.closest('mire-form') === b
        );
      });
    // Notifications masquées avant une capture (leur durée dépend de la machine).
    const hideToasts = () =>
      page.evaluate(() => {
        document.getElementById('toast')?.classList.remove('show');
        for (const t of document.querySelectorAll('.ds-toaster.--shown')) t.classList.remove('--shown');
      });
    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    const boxClosed = () => page.waitForFunction(() => !document.querySelector('mire-form'));
    const boxButton = (text) => page.locator('mire-form ds-trigger.hydrated', { hasText: text }).last();
    // Colonne `n` affichée avec ce titre (l'explorateur garde ses colonnes d'une visite à l'autre).
    const heading = (n, text) => page.waitForFunction(([sel, k, h]) => document.querySelectorAll(sel)[k]?.getAttribute('aria-label') === h, [COL, n, text]);
    const openExplorer = async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:explorer' }));
      await page.waitForFunction(
        (sel) => document.body.dataset.section === 'explorer' && document.querySelector(`${sel} .mire-explorer-view__row.hydrated`),
        VIEW,
      );
      await row(0, 'Sources').click();
      await heading(1, 'Sources');
    };
    const openVacances = async () => {
      await openExplorer();
      await row(1, 'Dossier · Images').click();
      await heading(2, 'Dossier · Images');
      await row(2, 'Vacances').click();
      await heading(3, 'Vacances');
    };

    before(() => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(async () => {
      await disconnectPad();
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('sélection multiple : Ctrl + clic, Maj + clic, Espace et Y ; la barre propose ses actions', async () => {
      await openVacances();
      await row(3, 'Montagne').click({ modifiers: ['Control'] });
      await page.waitForFunction((sel) => document.querySelector(`${sel} .mire-explorer-view__selection`), VIEW);
      assert.deepEqual(await picked(), ['Montagne']);
      // Le choix n'ouvre pas l'aperçu.
      assert.equal(await page.locator(`${VIEW} .mire-explorer-view__preview`).count(), 0);
      await row(3, 'Plage').click({ modifiers: ['Shift'] });
      await page.waitForFunction((sel) => document.querySelectorAll(`${sel} .mire-explorer-view__row[data-picked]`).length === 2, VIEW);
      assert.equal(await selectionCount(), '2 éléments choisis');
      // Les deux fichiers sont dans un dossier autorisé : « Supprimer » est permis une fois le contrôle fait.
      const remove = page.locator(`${VIEW} ds-trigger[data-selection-action="remove"].hydrated`);
      await page.waitForFunction((sel) => !document.querySelector(`${sel} ds-trigger[data-selection-action="remove"]`)?.hasAttribute('disabled'), VIEW);
      assert.equal(await remove.count(), 1);
      await hideToasts();
      await settle();
      await shot('explorer-selection');
      // Espace sur une ligne qui a le focus la retire de la sélection, sans ouvrir l'aperçu.
      await row(3, 'Plage').focus();
      await page.waitForFunction(() => document.activeElement?.classList.contains('hydrated'));
      await page.keyboard.press(' ');
      await page.waitForFunction((sel) => document.querySelectorAll(`${sel} .mire-explorer-view__row[data-picked]`).length === 1, VIEW);
      assert.deepEqual(await picked(), ['Montagne']);
      // Y de la manette la choisit de nouveau.
      await page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
      await page.waitForFunction(() => document.activeElement?.classList.contains('hydrated'));
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD.y);
      await page.evaluate((n) => (window.__pad.buttons[n] = { pressed: false, value: 0 }), PAD.y);
      await page.waitForFunction((sel) => document.querySelectorAll(`${sel} .mire-explorer-view__row[data-picked]`).length === 2, VIEW);
      assert.equal(await page.evaluate(() => document.body.dataset.section), 'explorer', 'Y ne mène pas à la recherche');
      await disconnectPad();
      // Ranger dans une liste : une nouvelle liste reçoit les deux images.
      await page.locator(`${VIEW} ds-trigger[data-selection-action="list"].hydrated`).click();
      await boxOpen();
      assert.match(await page.locator('mire-form .mire-form__help').textContent(), /Les 2 éléments choisis/);
      await page.locator('mire-form input[name="name"]').fill('Vacances choisies');
      await boxButton('Ajouter').click();
      await boxClosed();
      const list = await page.evaluate(async () => (await window.api.listsList()).find((l) => l.name === 'Vacances choisies'));
      assert.equal(list?.count, 2);
      // Tout désélectionner : la barre disparaît.
      await page.locator(`${VIEW} ds-trigger[data-selection-action="clear"].hydrated`).click();
      await page.waitForFunction((sel) => !document.querySelector(`${sel} .mire-explorer-view__selection`), VIEW);
      assert.deepEqual(errors, []);
    });

    it('renommer : la confirmation dit ce qui sera fait ; annulé, rien ne change ; confirmé, le fichier est renommé', async () => {
      await openVacances();
      await row(3, 'Montagne').click();
      await action('rename').waitFor();
      const ask = async () => {
        await action('rename').click();
        await boxOpen();
        await page.locator('mire-form input[name="name"]').fill('Sommet.png');
        await boxButton('Continuer').click();
        await page.locator('mire-form .mire-form__help', { hasText: 'Sommet.png' }).waitFor();
        await boxOpen();
      };
      await ask();
      assert.equal(
        await page.locator('mire-form .mire-form__help').last().textContent(),
        `« Montagne.png » s’appellera « Sommet.png ». Il reste dans le dossier ${VACANCES}.`,
      );
      await boxButton('Annuler').click();
      await boxClosed();
      assert.ok(fs.existsSync(path.join(VACANCES, 'Montagne.png')));
      assert.ok(!fs.existsSync(path.join(VACANCES, 'Sommet.png')));
      await ask();
      await boxButton('Renommer').click();
      await boxClosed();
      // Le fichier est renommé, puis le catalogue suit : la colonne montre le nouveau nom.
      assert.ok(fs.existsSync(path.join(VACANCES, 'Sommet.png')));
      assert.ok(!fs.existsSync(path.join(VACANCES, 'Montagne.png')));
      await page.waitForFunction(
        (sel) =>
          [...document.querySelectorAll(`${sel} .mire-explorer-view__column:nth-child(4) .mire-explorer-view__label`)].some((l) => l.textContent === 'Sommet'),
        VIEW,
      );
      assert.deepEqual(errors, []);
    });

    it('ce qui n’est pas un fichier de vos dossiers (un site ajouté) : aucune action sur le fichier, la raison est affichée', async () => {
      await openExplorer();
      await row(1, 'Sites ajoutés').click();
      await heading(2, 'Sites ajoutés');
      await page.locator(`${VIEW} .mire-explorer-view__column:nth-child(3) .mire-explorer-view__row.hydrated`).first().click();
      await action('rename').waitFor();
      const state = await page.$$eval(`${VIEW} .mire-explorer-view__preview ds-trigger[data-preview-action]`, (ts) =>
        Object.fromEntries(ts.map((t) => [t.dataset.previewAction, t.hasAttribute('disabled') || t.disabled === true])),
      );
      assert.deepEqual([state.rename, state.move, state.remove], [true, true, true]);
      assert.match(await page.locator(`${VIEW} .mire-explorer-view__reason`).textContent(), /n’est pas un fichier de vos dossiers/);
      await hideToasts();
      await settle();
      await shot('explorer-files-blocked');
      assert.deepEqual(errors, []);
    });
  });

  describe('Réglages : pages (P4-21)', () => {
    const VIEW = '#view mire-settings mire-settings-view';
    const ID = 'films-des-annees-90';
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const group = () => page.locator(`${VIEW} .mire-settings-view__group[data-list="pages"]`);
    const row = (id) => group().locator(`li.mire-settings-view__entry[data-key="${id}"]`);
    // Écran Réglages et liste des pages rendus (classe hydrated) : attendus avant chaque touche.
    const hydrated = () =>
      page.waitForFunction(
        (sel) =>
          document.body.dataset.section === 'settings' &&
          document.querySelector(`${sel}.hydrated .mire-settings-view__group[data-list="pages"] li`) &&
          [...document.querySelectorAll(`${sel} [data-list="pages"] ds-trigger`)].every((e) => e.classList.contains('hydrated')),
        VIEW,
      );
    const openSettings = async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:settings' }));
      await hydrated();
    };
    // Dernière boîte ouverte, ses composants rendus, le focus dedans.
    const boxOpen = () =>
      page.waitForFunction(() => {
        const b = [...document.querySelectorAll('mire-form')].at(-1);
        return (
          b?.classList.contains('hydrated') &&
          b.querySelector('ds-modal')?.shown &&
          [...b.querySelectorAll('ds-trigger, ds-select, ds-field')].every((d) => d.classList.contains('hydrated')) &&
          document.activeElement?.closest('mire-form') === b
        );
      });
    const boxClosed = () => page.waitForFunction(() => !document.querySelector('mire-form'));
    const button = (re) => page.locator('mire-form ds-trigger', { hasText: re });
    const tab = (i) => page.locator('mire-form [role="tab"]').nth(i);
    const help = () => page.locator('mire-form .mire-form__help');
    const overview = () => page.evaluate(() => window.api.pagesOverview());
    // Confirmation : la boîte oui / non de l'interface (encore celle de l'interface historique, comme dans le Centre).
    const confirmYes = async (re) => {
      const yes = page.locator('#dlg[open] [data-dlg="yes"]');
      await yes.waitFor();
      assert.match(await yes.textContent(), re);
      await yes.click();
      await page.waitForFunction(() => !document.querySelector('#dlg[open]'));
    };

    before(() => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(() => {
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('créer « Films des années 90 » : nom, tag Films, année entre 1990 et 1999, compter, enregistrer ; le menu suit', async () => {
      await openSettings();
      // Pages prêtes à l'emploi : nombre d'éléments et origine.
      assert.match(await row('movies').locator('.mire-settings-view__detail').textContent(), /^\d+ éléments? · Prête à l’emploi · Dans le menu$/);
      // « Créer une page » au clavier.
      await group().locator('ds-trigger[action^="createEntry"]').focus();
      await page.keyboard.press('Enter');
      await boxOpen();
      assert.match(await page.locator('mire-form').textContent(), /Nouvelle page/);
      await page.locator('mire-form input[name="name"]').fill('Films des années 90');
      // Onglet « Éléments » : le tag Films (désigné par son nom), puis la condition sur l'année.
      await tab(1).click();
      await settle();
      const require = page.locator('mire-form .mire-form__list', { has: page.locator('input[name="require-new"]') });
      await require.locator('input[name="require-new"]').fill('Films');
      await require.locator('ds-trigger', { hasText: /^Ajouter$/ }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('mire-form .mire-form__value')].some((e) => e.textContent === 'Films'));
      await page.locator('mire-form select[name="where0.info"]').selectOption('year');
      await page.locator('mire-form input[name="where0.value"]').fill('1990');
      await page.locator('mire-form input[name="where0.to"]').fill('1999');
      // Aperçu : la bibliothèque d'essai n'a pas de film des années 90 ; avec 1900, Le Voyage dans la Lune (1902) compte.
      await button(/^Compter les éléments$/).click();
      await page.waitForFunction(() => /contiendrait 0 élément\./.test(document.querySelector('mire-form .mire-form__help')?.textContent ?? ''));
      await page.locator('mire-form input[name="where0.value"]').fill('1900');
      await button(/^Compter les éléments$/).click();
      await page.waitForFunction(() => /contiendrait 1 élément\./.test(document.querySelector('mire-form .mire-form__help')?.textContent ?? ''));
      await page.locator('mire-form input[name="where0.value"]').fill('1990');
      // Onglet « Rangement » : tri par année.
      await tab(2).click();
      await settle();
      await page.locator('mire-form select[name="sort0.by"]').selectOption('year');
      await button(/^Enregistrer$/).click();
      await boxClosed();
      const saved = (await overview()).find((o) => o.page.id === ID);
      assert.deepEqual(saved, {
        page: {
          id: ID,
          name: 'Films des années 90',
          require: ['movie'],
          where: [{ info: 'year', between: [1990, 1999] }],
          sort: [{ by: 'year' }],
          display: 'posters',
          menu: { pinned: true },
        },
        origin: 'user',
        count: 0,
      });
      await row(ID).waitFor();
      await hydrated();
      assert.equal(await row(ID).locator('.mire-settings-view__detail').textContent(), '0 élément · Créée par vous · Dans le menu');
      // La page rejoint le menu et s'ouvre.
      await page.locator(`#rail .rail-item[data-key="${ID}"]`).click();
      await page.waitForFunction(
        () => document.body.dataset.section === 'page' && /Films des années 90/.test(document.querySelector('#view mire-page-view')?.textContent ?? ''),
      );
      assert.deepEqual(errors, []);
    });

    it('une condition incomplète garde la boîte ouverte et dit pourquoi', async () => {
      await openSettings();
      await row(ID).locator('ds-trigger[action^="editEntry"]').click();
      await boxOpen();
      await tab(1).click();
      await settle();
      await page.locator('mire-form input[name="where0.value"]').fill('');
      await button(/^Enregistrer$/).click();
      await settle();
      await page.waitForFunction(() => /condition n’est pas complète/.test(document.querySelector('mire-form .mire-form__help')?.textContent ?? ''));
      assert.match(await help().textContent(), /condition n’est pas complète/);
      await button(/^Annuler$/).click();
      await boxClosed();
      assert.deepEqual((await overview()).find((o) => o.page.id === ID).page.where, [{ info: 'year', between: [1990, 1999] }]);
      assert.deepEqual(errors, []);
    });

    it('modifier une page prête à l’emploi, puis revenir à l’origine ; supprimer la page créée', async () => {
      await openSettings();
      await row('music').locator('ds-trigger[action^="editEntry"]').click();
      await boxOpen();
      await page.locator('mire-form select[name="display"]').selectOption('rows');
      await button(/^Enregistrer$/).click();
      await boxClosed();
      await row('music').locator('ds-trigger[action^="restoreEntry"]').waitFor();
      await hydrated();
      assert.match(await row('music').locator('.mire-settings-view__detail').textContent(), /Prête à l’emploi, modifiée/);
      await page.locator(`${VIEW} [data-panel="pages"]`).evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => document.getElementById('toast')?.classList.remove('show'));
      await settle();
      await shot('settings-pages');
      // Revenir à l'origine : confirmation, puis la page prête à l'emploi revient telle qu'elle était.
      await row('music').locator('ds-trigger[action^="restoreEntry"]').click();
      await confirmYes(/^Revenir à l’origine$/);
      await row('music').locator('ds-trigger[action^="restoreEntry"]').waitFor({ state: 'detached' });
      const music = (await overview()).find((o) => o.page.id === 'music');
      assert.deepEqual([music.origin, music.page.display], ['builtin', 'list']);
      // Supprimer la page créée : confirmation, puis elle quitte la liste et le menu.
      await hydrated();
      await row(ID).locator('ds-trigger[action^="removeEntry"]').click();
      await confirmYes(/^Supprimer la page$/);
      await row(ID).waitFor({ state: 'detached' });
      await page.locator(`#rail .rail-item[data-key="${ID}"]`).waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
    });
  });

  describe('Réglages : tags et listes (P4-21)', () => {
    const VIEW = '#view mire-settings mire-settings-view';
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
    const group = (key) => page.locator(`${VIEW} .mire-settings-view__group[data-list="${key}"]`);
    const row = (key, id) => group(key).locator(`li.mire-settings-view__entry[data-key="${id}"]`);
    // Écran Réglages et listes des tags rendus (classe hydrated) : attendus avant chaque touche.
    const hydrated = () =>
      page.waitForFunction(
        (sel) =>
          document.body.dataset.section === 'settings' &&
          document.querySelector(`${sel}.hydrated .mire-settings-view__group[data-list="tags"] li`) &&
          [...document.querySelectorAll(`${sel} [data-panel="tags"] ds-trigger, ${sel} [data-panel="lists"] ds-trigger, ${sel} ds-sortable`)].every((e) =>
            e.classList.contains('hydrated'),
          ),
        VIEW,
      );
    const openSettings = async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:settings' }));
      await hydrated();
    };
    const boxOpen = () =>
      page.waitForFunction(() => {
        const b = [...document.querySelectorAll('mire-form')].at(-1);
        return (
          b?.classList.contains('hydrated') &&
          b.querySelector('ds-modal')?.shown &&
          [...b.querySelectorAll('ds-trigger, ds-select, ds-field')].every((d) => d.classList.contains('hydrated')) &&
          document.activeElement?.closest('mire-form') === b
        );
      });
    const boxClosed = () => page.waitForFunction(() => !document.querySelector('mire-form'));
    const button = (re) => page.locator('mire-form ds-trigger', { hasText: re });
    const confirmYes = async (re) => {
      const yes = page.locator('#dlg[open] [data-dlg="yes"]');
      await yes.waitFor();
      assert.match(await yes.textContent(), re);
      await yes.click();
      await page.waitForFunction(() => !document.querySelector('#dlg[open]'));
    };
    const tags = () => page.evaluate(() => window.api.tagsOverview());
    const tag = async (id) => (await tags()).find((x) => x.id === id);
    const lists = () => page.evaluate(async () => (await window.api.listsList()).map((l) => l.name));
    const edit = async (key, id) => {
      await row(key, id).locator('ds-trigger[action^="editEntry"]').click();
      await boxOpen();
      await settle();
    };

    before(() => {
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(() => {
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('tags : couleur et icône d’un tag de Mire ; renommer, fusionner puis supprimer vos tags', async () => {
      // Deux tags de l'utilisateur posés sur un film, comme le ferait l'éditeur (P4-22).
      await page.evaluate(async () => {
        const lvl = await window.api.catalogPage('tag:movie', [], null);
        await window.api.catalogSetTags(lvl.elements[0].key, { 'Vus en e2e': true, 'Favoris e2e': true });
      });
      await openSettings();
      assert.match(await row('tags', 'video').locator('.mire-settings-view__detail').textContent(), /^\d+ éléments? · Posé par Mire$/);
      assert.equal(await row('tags', 'video').locator('ds-trigger[action^="removeEntry"]').count(), 0);
      // Tag de Mire : seulement la couleur et l'icône.
      await edit('tags', 'video');
      assert.equal(await page.locator('mire-form input[name="name"]').count(), 0);
      await page.locator('mire-form select[name="color"]').selectOption('blue');
      await page.locator('mire-form select[name="icon"]').selectOption('play');
      await button(/^Enregistrer$/).click();
      await boxClosed();
      assert.deepEqual((await tag('video')).look, { color: 'blue', icon: 'play' });
      await hydrated();
      await page.waitForFunction(
        (sel) => /Bleu · Lecture$/.test(document.querySelector(`${sel} [data-list="tags"] [data-key="video"] .mire-settings-view__detail`)?.textContent ?? ''),
        VIEW,
      );
      // Votre tag : renommé.
      await edit('tags', 'vus-en-e2e');
      await page.locator('mire-form input[name="name"]').fill('Déjà vus e2e');
      await button(/^Enregistrer$/).click();
      await boxClosed();
      assert.equal((await tag('vus-en-e2e')).name, 'Déjà vus e2e');
      // Fusionné dans l'autre : il disparaît, l'autre reste sur le film.
      await hydrated();
      await edit('tags', 'vus-en-e2e');
      await page.locator('mire-form select[name="merge"]').selectOption('favoris-e2e');
      await button(/^Enregistrer$/).click();
      await boxClosed();
      assert.equal(await tag('vus-en-e2e'), undefined);
      assert.equal((await tag('favoris-e2e')).count, 1);
      await row('tags', 'vus-en-e2e').waitFor({ state: 'detached' });
      await hydrated();
      await page.locator(`${VIEW} [data-panel="tags"]`).evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => document.getElementById('toast')?.classList.remove('show'));
      await settle();
      await shot('settings-tags');
      // Supprimé, après confirmation.
      await row('tags', 'favoris-e2e').locator('ds-trigger[action^="removeEntry"]').click();
      await confirmYes(/^Supprimer le tag$/);
      await row('tags', 'favoris-e2e').waitFor({ state: 'detached' });
      assert.equal(await tag('favoris-e2e'), undefined);
      // La couleur de Vidéo revient à aucune.
      await hydrated();
      await edit('tags', 'video');
      await page.locator('mire-form select[name="color"]').selectOption('');
      await page.locator('mire-form select[name="icon"]').selectOption('');
      await button(/^Enregistrer$/).click();
      await boxClosed();
      assert.deepEqual((await tag('video')).look, {});
      assert.deepEqual(errors, []);
    });

    it('règles par type de fichier : ajouter une extension, puis la retirer', async () => {
      await openSettings();
      await page.locator('#set-fileTags-ext').fill('XYZ');
      await page.locator('#set-fileTags-tags').fill('Vidéo, Films');
      await group('fileTags').locator('ds-trigger[action^="addEntry"]').click();
      await until(() => page.evaluate(async () => JSON.stringify((await window.api.getConfig()).config.catalog?.fileTags) === '{".xyz":["video","movie"]}'));
      await row('fileTags', '.xyz').waitFor();
      assert.equal(await row('fileTags', '.xyz').locator('.mire-settings-view__detail').textContent(), 'Vidéo, Films');
      await hydrated();
      await row('fileTags', '.xyz').locator('ds-trigger[action^="removeEntry"]').click();
      await until(() => page.evaluate(async () => JSON.stringify((await window.api.getConfig()).config.catalog?.fileTags) === '{}'));
      await row('fileTags', '.xyz').waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
    });

    it('listes : créer, renommer, ordonner au clavier, supprimer', async () => {
      await openSettings();
      const before = await lists();
      for (const name of ['Pour ce soir', 'Plus tard']) {
        await group('lists').locator('ds-trigger[action^="createEntry"]').click();
        await boxOpen();
        await page.locator('mire-form input[name="name"]').fill(name);
        await button(/^Enregistrer$/).click();
        await boxClosed();
        await hydrated();
      }
      assert.deepEqual(await lists(), [...before, 'Pour ce soir', 'Plus tard']);
      const ids = await page.evaluate(async () => (await window.api.listsList()).map((l) => l.id));
      const [tonight, later] = ids.slice(-2);
      await edit('lists', later);
      await page.locator('mire-form input[name="name"]').fill('Un autre jour');
      await button(/^Enregistrer$/).click();
      await boxClosed();
      assert.deepEqual((await lists()).slice(-2), ['Pour ce soir', 'Un autre jour']);
      // Ordre au clavier : « Un autre jour » monte d'un rang.
      await hydrated();
      const item = page.locator(`${VIEW} ds-sortable[data-list="lists"] [data-key="${later}"]`);
      await item.scrollIntoViewIfNeeded();
      await item.focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Space');
      await until(async () => {
        const order = await page.evaluate(async () => (await window.api.listsList()).map((l) => l.id));
        return order.indexOf(later) === order.indexOf(tonight) - 1;
      });
      // Supprimées, après confirmation : on revient aux listes du départ.
      for (const id of [tonight, later]) {
        await hydrated();
        await row('lists', id).locator('ds-trigger[action^="removeEntry"]').click();
        await confirmYes(/^Supprimer la liste$/);
        await row('lists', id).waitFor({ state: 'detached' });
      }
      assert.deepEqual(await lists(), before);
      assert.deepEqual(errors, []);
    });
  });

  describe('Lecteurs de musique et d’images (P4-15)', () => {
    const PAD = { a: 0, b: 1, lb: 4, rb: 5, start: 9, right: 15 };
    const MINI = 'mire-mini-player';
    const VIEWER = 'mire-image-viewer';
    const errors = [];
    const onError = (e) => errors.push(e.message);
    const onConsole = (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text());
    let tracks;
    const padPress = async (button) => {
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: true, value: 1 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, PAD[button]);
      await page.evaluate((n) => {
        window.__pad.buttons[n] = { pressed: false, value: 0 };
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, PAD[button]);
    };
    const connectPad = () =>
      page.evaluate(() => {
        window.__pad = {
          id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
    const disconnectPad = () =>
      page.evaluate(() => {
        if (window.__pad) {
          navigator.getGamepads = () => [];
          window.dispatchEvent(new Event('gamepaddisconnected'));
          delete window.__pad;
        }
      });
    const text = (sel, part) => page.evaluate(([s, p]) => document.querySelector(`${s} .${s}__${p}`)?.textContent ?? null, [sel, part]);
    const textIs = (sel, part, value) => page.waitForFunction(([s, p, v]) => document.querySelector(`${s} .${s}__${p}`)?.textContent === v, [sel, part, value]);
    const hidden = (sel) => page.evaluate((s) => document.querySelector(s).hidden, sel);
    // Les deux morceaux de démonstration (40 s chacun) ouverts comme depuis le système (seconde instance de Mire).
    const openTracks = async () => {
      await app.evaluate(({ app: a }, files) => a.emit('second-instance', {}, ['electron', '.', ...files]), tracks);
      await page.waitForFunction((s) => {
        const el = document.querySelector(s);
        return el.classList.contains('hydrated') && !el.hidden && el.querySelectorAll('ds-trigger.hydrated, ds-range.hydrated').length === 6;
      }, MINI);
      await textIs(MINI, 'title', 'Morceau un');
      await page.waitForFunction((s) => document.querySelector(s).playing, MINI);
    };
    const stopMusic = async () => {
      if (await hidden(MINI)) return;
      await page.locator(`${MINI} ds-trigger[action="stop"] button`).click();
      await page.waitForFunction((s) => document.querySelector(s).hidden, MINI);
    };
    // Page Images, au niveau de l'album Vacances (rendu complet), le focus sur sa première image.
    const openVacances = async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'images', path: ['Vacances'] }));
      await page.waitForFunction(() => {
        const v = document.querySelector('#view mire-page-view');
        return v?.kind === 'elements' && !v.loading && v.querySelectorAll('mire-card ds-trigger.hydrated').length === 2;
      });
      await page.locator('#view mire-card ds-trigger.hydrated').first().focus();
    };
    const viewerReady = () =>
      page.waitForFunction((s) => {
        const el = document.querySelector(s);
        return el.classList.contains('hydrated') && !el.hidden && el.querySelector('img').complete && document.activeElement === el;
      }, VIEWER);

    before(() => {
      const media = path.join(tmp, 'fixtures', 'media');
      tracks = ['Morceau un.opus', 'Morceau deux.opus'].map((f) => path.join(media, f));
      page.on('pageerror', onError);
      page.on('console', onConsole);
    });
    after(async () => {
      await disconnectPad();
      await stopMusic();
      if (!(await hidden(VIEWER))) await page.keyboard.press('Escape');
      page.off('pageerror', onError);
      page.off('console', onConsole);
    });

    it('musique : le mini-lecteur montre le morceau et la file, passe au suivant, partage le volume avec la vidéo', async () => {
      await openTracks();
      assert.equal(await text(MINI, 'sub'), 'media, 1 sur 2');
      assert.ok(await page.evaluate(() => document.body.classList.contains('has-mini')));
      // Le temps avance et la réglette de position suit.
      await page.waitForFunction((s) => document.querySelector(`${s} .${s}__current`).textContent !== '0:00', MINI, { timeout: 5000 });
      await textIs(MINI, 'duration', '0:40');
      // Morceau suivant, puis précédent (moins de 3 s de lecture : le morceau d'avant).
      await page.locator(`${MINI} ds-trigger[action="next"] button`).click();
      await textIs(MINI, 'title', 'Morceau deux');
      await textIs(MINI, 'sub', 'media, 2 sur 2');
      await page.locator(`${MINI} ds-trigger[action="previous"] button`).click();
      await textIs(MINI, 'title', 'Morceau un');
      // Lecture ou pause.
      await page.locator(`${MINI} ds-trigger[action="togglePlay"] button`).click();
      await page.waitForFunction((s) => !document.querySelector(s).playing, MINI);
      // Volume réglé à la souris : le lecteur vidéo prend le même.
      await page.evaluate((s) => {
        const input = document.querySelector(`${s} .${s}__volume input`);
        input.value = '0.5';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, MINI);
      await page.waitForFunction(() => {
        const v = document.querySelector('mire-video-player');
        return v.volume === 0.5 && v.querySelector('video').volume === 0.5;
      });
      // Position réglée à la souris (au milieu : 0:20), pour une capture fixe.
      await page.evaluate((s) => {
        const input = document.querySelector(`${s} .${s}__seek input`);
        input.value = '500';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, MINI);
      await textIs(MINI, 'current', '0:20');
      await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 8000 });
      await settle();
      await shot('lecteur-musique');
      await page.evaluate((s) => {
        const input = document.querySelector(`${s} .${s}__volume input`);
        input.value = '0.9';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, MINI);
      await stopMusic();
      assert.ok(!(await page.evaluate(() => document.body.classList.contains('has-mini'))));
      assert.deepEqual(errors, []);
    });

    it('musique à la manette : Start met en pause, la croix et A passent au morceau suivant, A arrête la musique', async () => {
      await connectPad();
      await openTracks();
      await page.locator(`${MINI} ds-trigger[action="togglePlay"] button`).focus();
      await padPress('start');
      await page.waitForFunction((s) => !document.querySelector(s).playing, MINI);
      await padPress('start');
      await page.waitForFunction((s) => document.querySelector(s).playing, MINI);
      // La croix passe au bouton suivant (les réglettes se règlent à la souris), A l'active.
      await padPress('right');
      await page.waitForFunction(
        (s) => document.activeElement?.closest('ds-trigger')?.getAttribute('action') === 'next' && document.querySelector(s).contains(document.activeElement),
        MINI,
      );
      await padPress('a');
      await textIs(MINI, 'title', 'Morceau deux');
      // Arrêt : le bouton est au bout de la bande ; la croix y mène selon l'écran du dessous, on y pose le focus.
      await page.locator(`${MINI} ds-trigger[action="stop"] button`).focus();
      await padPress('a');
      await page.waitForFunction((s) => document.querySelector(s).hidden, MINI);
      // Le focus quitte le mini-lecteur caché.
      assert.ok(!(await page.evaluate((s) => document.querySelector(s).contains(document.activeElement), MINI)));
      await disconnectPad();
      assert.deepEqual(errors, []);
    });

    it('images : plein écran, image suivante en boucle, préchargement, diaporama, Échap rend le focus', async () => {
      await openVacances();
      const from = await page.evaluateHandle(() => document.activeElement);
      await page.keyboard.press('Enter');
      await viewerReady();
      // Place de l'image dans la liste (« 1 sur 2, Vacances ») : l'ordre suit la liste de la page.
      const place = () =>
        page
          .waitForFunction((s) => /^([12]) sur 2, Vacances$/.exec(document.querySelector(`${s} .${s}__sub`)?.textContent)?.[1], VIEWER)
          .then((h) => h.jsonValue());
      const preload = () => page.evaluate((s) => document.querySelector(s).preload, VIEWER);
      const opened = await place();
      const first = await text(VIEWER, 'title');
      // Image suivante (flèche), en boucle : l'autre image, puis la première.
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(([s, t]) => document.querySelector(`${s} .${s}__title`)?.textContent !== t, [VIEWER, first]);
      assert.notEqual(await place(), opened);
      await page.locator(`${VIEWER} ds-trigger[action="next"] button`).click();
      await textIs(VIEWER, 'title', first);
      assert.ok(await page.evaluate((s) => document.activeElement === document.querySelector(s), VIEWER));
      // La première image précharge la suivante ; la dernière ne précharge rien.
      if ((await place()) === '2') await page.keyboard.press('ArrowRight');
      await page.waitForFunction((s) => document.querySelector(`${s} .${s}__sub`)?.textContent.startsWith('1 sur 2'), VIEWER);
      assert.match(await preload(), /^media:/);
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction((s) => document.querySelector(`${s} .${s}__sub`)?.textContent.startsWith('2 sur 2'), VIEWER);
      assert.equal(await preload(), '');
      // Diaporama : le bouton change de libellé.
      await page.keyboard.press(' ');
      await textIs(VIEWER, 'text-btn', 'Arrêter le diaporama');
      await page.keyboard.press(' ');
      await textIs(VIEWER, 'text-btn', 'Diaporama');
      // Capture sur Plage (le bloc P4-09 renomme l'autre image).
      if ((await text(VIEWER, 'title')) !== 'Plage') await page.keyboard.press('ArrowRight');
      await textIs(VIEWER, 'title', 'Plage');
      await page.waitForFunction(() => !document.querySelector('.toast.show'), null, { timeout: 8000 });
      // L'affichage se cache sans mouvement : la souris le réveille pour la capture.
      await page.mouse.move(800, 450);
      await page.mouse.move(810, 460);
      await page.waitForFunction((s) => !document.querySelector(s).idle, VIEWER);
      await settle();
      await shot('visionneuse-images');
      await page.keyboard.press('Escape');
      await page.waitForFunction((s) => document.querySelector(s).hidden, VIEWER);
      assert.ok(await page.evaluate((f) => document.activeElement === f, from));
      assert.deepEqual(errors, []);
    });

    it('images à la manette : A ouvre, RB et LB changent d’image, A lance le diaporama, B ferme', async () => {
      await connectPad();
      await openVacances();
      await padPress('a');
      await viewerReady();
      await page.waitForFunction((s) => / sur 2, Vacances$/.test(document.querySelector(`${s} .${s}__sub`)?.textContent), VIEWER);
      const first = await text(VIEWER, 'title');
      await padPress('rb');
      await page.waitForFunction(([s, t]) => document.querySelector(`${s} .${s}__title`)?.textContent !== t, [VIEWER, first]);
      await padPress('lb');
      await textIs(VIEWER, 'title', first);
      await page.waitForFunction(() => document.querySelector('mire-padbar')?.textContent.includes('Diaporama'));
      await padPress('a');
      await page.waitForFunction((s) => document.querySelector(s).slideshow, VIEWER);
      await padPress('b');
      await page.waitForFunction((s) => document.querySelector(s).hidden && !document.querySelector(s).slideshow, VIEWER);
      await disconnectPad();
      assert.deepEqual(errors, []);
    });
  });

  // Profils de manettes (P5-04) : trois plugins inclus, actifs dès le premier lancement ; une manette PlayStation est
  // reconnue par son plugin et l'aide montre ses boutons.
  describe('profils de manettes, plugins inclus (P5-04)', () => {
    it('les trois plugins inclus sont actifs, et une manette PlayStation montre ses boutons', async () => {
      const errors = [];
      const onError = (e) => errors.push(e.message);
      page.on('pageerror', onError);
      const list = await page.evaluate(() => window.api.pluginsList());
      for (const f of ['xbox', 'playstation', 'nintendo']) {
        const p = list.find((x) => x.id === `mire.gamepad.${f}`);
        assert.deepEqual([p?.origin, p?.status], ['bundled', 'active'], f);
      }
      const profiles = await page.evaluate(() => window.api.gamepadsProfiles());
      assert.deepEqual(
        profiles.map((p) => p.id),
        ['mire.gamepad.xbox/xbox', 'mire.gamepad.playstation/playstation', 'mire.gamepad.nintendo/nintendo'],
      );
      await page.evaluate(() => {
        window.__pad = {
          id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
          index: 0,
          connected: true,
          mapping: 'standard',
          buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
          axes: [0, 0, 0, 0],
        };
        navigator.getGamepads = () => [window.__pad];
      });
      await page.waitForFunction(() => document.querySelector('mire-padbar')?.textContent.includes('✕'));
      await page.evaluate(() => {
        navigator.getGamepads = () => [];
        window.dispatchEvent(new Event('gamepaddisconnected'));
        delete window.__pad;
      });
      page.off('pageerror', onError);
      assert.deepEqual(errors, []);
    });
  });

  // Pages prêtes à l'emploi (P5-03) : sept plugins inclus, actifs dès le premier lancement ; le cœur n'a plus de page
  // intégrée, celles du menu viennent des plugins.
  describe('pages prêtes à l’emploi, plugins inclus (P5-03)', () => {
    const PAGES = {
      movies: ['movies', 1],
      series: ['series', 2],
      music: ['music', 3],
      images: ['images', 4],
      streaming: ['streaming', 5],
      tv: ['tv', 6],
      games: ['games', 7],
    };

    it('les sept plugins inclus sont actifs et leurs pages sont celles du cœur, dans l’ordre du menu', async () => {
      const list = await page.evaluate(() => window.api.pluginsList());
      for (const slug of Object.keys(PAGES)) {
        const p = list.find((x) => x.id === `mire.page.${slug}`);
        assert.deepEqual([p?.origin, p?.status], ['bundled', 'active'], slug);
      }
      const pages = await page.evaluate(() => window.api.pagesList());
      assert.deepEqual(
        pages.map((p) => [p.id, p.menu?.order]),
        Object.values(PAGES),
      );
      // Le nom vient des textes du plugin (pas d'une clé brute).
      assert.ok(pages.every((p) => typeof p.name === 'object' && p.name.key.startsWith('pluginTexts.mire_page_')));
      const overview = await page.evaluate(() => window.api.pagesOverview());
      assert.deepEqual([...new Set(overview.map((o) => o.origin))], ['builtin']);
    });
  });

  // Lecteurs externes (P5-20) : plugin inclus, actif dès le premier lancement ; désactivé, le bouton « Lecteur
  // externe » du lecteur vidéo disparaît sans erreur, et revient avec le plugin.
  describe('lecteurs externes, plugin inclus (P5-20)', () => {
    it('le plugin inclus est actif ; le désactiver cache le bouton du lecteur externe', async () => {
      const errors = [];
      const onError = (e) => errors.push(e.message);
      page.on('pageerror', onError);
      const p = (await page.evaluate(() => window.api.pluginsList())).find((x) => x.id === 'mire.players.external');
      assert.deepEqual([p?.origin, p?.status], ['bundled', 'active']);
      const players = await page.evaluate(() => window.api.externalPlayers());
      assert.deepEqual(
        players.map((x) => x.id),
        ['mire.players.external/mpv', 'mire.players.external/vlc'],
      );
      await page.waitForFunction(() => document.querySelector('mire-video-player')?.external === true);
      await page.evaluate(() => window.api.pluginsSetEnabled('mire.players.external', false));
      await page.waitForFunction(() => document.querySelector('mire-video-player')?.external === false);
      assert.deepEqual(await page.evaluate(() => window.api.externalPlayers()), []);
      await page.evaluate(() => window.api.pluginsSetEnabled('mire.players.external', true));
      await page.waitForFunction(() => document.querySelector('mire-video-player')?.external === true);
      page.off('pageerror', onError);
      assert.deepEqual(errors, []);
    });
  });

  // Palettes des plugins (P5-02) : la palette d'un plugin factice s'applique comme une palette du cœur, avec une
  // feuille fabriquée par l'interface ; absente (plugin désactivé), la palette par défaut et un message ; elle revient
  // avec son plugin.
  describe('palettes des plugins (P5-02)', () => {
    const palette = (id) => page.locator(`#view .mire-settings-view__palette.hydrated[data-key="${id}"]`);
    const shown = () => page.evaluate(() => document.documentElement.dataset.palette);

    it('la palette d’un plugin factice s’applique ; plugin désactivé : palette par défaut et message ; réactivé : elle revient', async () => {
      const errors = [];
      const onError = (e) => errors.push(e.message);
      page.on('pageerror', onError);
      // Par le menu, à la souris : l'état du focus laissé par les tests précédents n'y joue pas.
      await page.locator('#rail [data-go="settings"]').click();
      await page.waitForFunction(() => document.body.dataset.section === 'settings');
      await palette('velours').click();
      await page.waitForFunction(() => document.documentElement.dataset.palette === 'velours');
      // Feuille fabriquée par le cœur (CSSOM), aucune feuille ni adresse venue du plugin.
      const sheet = await page.evaluate(() => {
        const style = document.querySelector('style[data-palette-tokens="velours"]');
        return {
          rules: [...(style?.sheet?.cssRules ?? [])].map((r) => r.selectorText),
          link: !!document.querySelector('link[href*="velours"]'),
          bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
        };
      });
      assert.deepEqual(sheet, { rules: ['[data-palette="velours"]'], link: false, bg: '#1c1513' });
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), hexToRgb(paletteBackground('velours')));

      // Plugin désactivé : la palette par défaut, un message simple, le réglage gardé.
      assert.ok(await page.evaluate(() => window.api.pluginsSetEnabled('org.exemple.palettes', false)));
      await page.waitForFunction(() => document.documentElement.dataset.palette === 'ecran');
      await page.locator('#toast', { hasText: 'La palette choisie n’est pas disponible' }).waitFor();
      assert.equal(await page.evaluate(() => window.api.getConfig().then((r) => r.config.ui.theme)), 'velours');
      // Les Réglages, redessinés à l'arrivée de la nouvelle liste, ne la proposent plus.
      await palette('velours').waitFor({ state: 'detached', timeout: 5000 });

      // Réactivé : la palette revient, sans rien choisir de nouveau.
      await page.evaluate(() => window.api.pluginsSetEnabled('org.exemple.palettes', true));
      await page.waitForFunction(() => document.documentElement.dataset.palette === 'velours');
      await palette('ecran').click();
      await page.waitForFunction(() => document.documentElement.dataset.palette === 'ecran');
      assert.equal(await shown(), 'ecran');
      await page.evaluate(() => document.getElementById('toast')?.classList.remove('show'));
      await page.locator('#rail [data-go="home"]').click();
      await page.waitForFunction(() => document.body.dataset.section === 'home');
      page.off('pageerror', onError);
      assert.deepEqual(errors, []);
    });
  });

  // Services de streaming des plugins (P5-05) : le service d'un plugin factice rejoint Streaming ; plugin désactivé,
  // il en sort sans erreur (réglages gardés) ; réactivé, il revient.
  describe('services de streaming des plugins (P5-05)', () => {
    const service = () => page.evaluate(() => window.api.getConfig().then((r) => r.config.web.find((w) => w.id === 'essai-tv') ?? null));
    const element = () => page.evaluate(() => window.api.catalogElement('web:essai-tv'));

    it('le service d’un plugin factice est un site de Streaming ; désactivé : il disparaît sans erreur ; réactivé : il revient', async () => {
      const errors = [];
      const onError = (e) => errors.push(e.message);
      page.on('pageerror', onError);
      await page.waitForFunction(() => window.api.getConfig().then((r) => r.config.web.some((w) => w.id === 'essai-tv')), null, { timeout: 20000 });
      const site = await service();
      assert.deepEqual(
        [site.url, site.color, site.group, site.app, site.search, site.providers, site.inactive],
        ['https://essai-tv.example/', '#3366CC', 'video', 'org.exemple.service', 'https://essai-tv.example/recherche?q={q}', ['essai tv'], undefined],
      );
      await page.waitForFunction(() => window.api.catalogElement('web:essai-tv').then((e) => !!e), null, { timeout: 10000 });
      assert.equal((await element()).infos.category, 'video');

      assert.ok(await page.evaluate(() => window.api.pluginsSetEnabled('org.exemple.service', false)));
      await page.waitForFunction(() => window.api.getConfig().then((r) => r.config.web.find((w) => w.id === 'essai-tv')?.inactive === true), null, {
        timeout: 10000,
      });
      await page.waitForFunction(() => window.api.catalogElement('web:essai-tv').then((e) => !e), null, { timeout: 10000 });
      assert.equal((await service()).url, 'https://essai-tv.example/');

      await page.evaluate(() => window.api.pluginsSetEnabled('org.exemple.service', true));
      await page.waitForFunction(() => window.api.getConfig().then((r) => r.config.web.find((w) => w.id === 'essai-tv')?.inactive === undefined), null, {
        timeout: 10000,
      });
      await page.waitForFunction(() => window.api.catalogElement('web:essai-tv').then((e) => !!e), null, { timeout: 10000 });
      page.off('pageerror', onError);
      assert.deepEqual(errors, []);
    });
  });

  // Tags automatiques (P5-09) : cinq plugins inclus de niveau code, actifs dès le premier lancement ; un épisode de la
  // bibliothèque porte le tag `series` et ses infos ; plugin désactivé, ses tags disparaissent, un tag saisi à la main
  // reste ; réactivé, ils reviennent.
  describe('tags automatiques, plugins inclus (P5-09)', () => {
    const seriesKeys = () => page.evaluate(() => window.api.catalogPage('tag:series', [], null).then((l) => (l.elements ?? []).map((e) => e.key)));
    const waitSeries = (some) => until(async () => (await seriesKeys()).length > 0 === some, { timeout: 15000 });

    it('les cinq plugins inclus sont actifs ; un épisode porte `series`, sa saison et son épisode', async () => {
      const list = await page.evaluate(() => window.api.pluginsList());
      for (const k of ['series', 'movies', 'music', 'consoles', 'photos']) {
        const p = list.find((x) => x.id === `mire.tags.${k}`);
        assert.deepEqual([p?.origin, p?.status], ['bundled', 'active'], k);
      }
      // Les lots se calculent dans l'hôte isolé : le tag arrive peu après le démarrage.
      await waitSeries(true);
      const keys = await seriesKeys();
      const episodes = await Promise.all(keys.map((k) => page.evaluate((key) => window.api.catalogElement(key), k)));
      const e = episodes.find((x) => x.name === 'S01E01');
      assert.ok(e, episodes.map((x) => x.name).join());
      assert.ok(e.tags.includes('video') && e.tags.includes('series'), e.tags.join());
      assert.deepEqual([e.infos.season, e.infos.episode], [1, 1]);
      const tag = (await page.evaluate(() => window.api.tagsList())).find((t) => t.id === 'series');
      assert.deepEqual([tag?.origin, tag?.name], ['plugin', 'Séries']);
    });

    it('plugin désactivé : ses tags disparaissent, un tag saisi à la main reste ; réactivé, ils reviennent', async () => {
      const [key] = await seriesKeys();
      await page.evaluate((k) => window.api.catalogSetTags(k, { 'Gardé e2e': true }), key);
      await page.evaluate(() => window.api.pluginsSetEnabled('mire.tags.series', false));
      await waitSeries(false);
      const off = await page.evaluate((k) => window.api.catalogElement(k), key);
      assert.equal(off.tags.includes('series'), false);
      assert.ok(off.tags.includes('garde-e2e'), off.tags.join());
      assert.equal(off.infos.season, undefined);
      assert.equal(
        (await page.evaluate(() => window.api.tagsList())).some((t) => t.id === 'series'),
        false,
      );
      await page.evaluate(() => window.api.pluginsSetEnabled('mire.tags.series', true));
      await waitSeries(true);
      const on = await page.evaluate((k) => window.api.catalogElement(k), key);
      assert.ok(on.tags.includes('series') && on.tags.includes('garde-e2e'), on.tags.join());
      await page.evaluate((k) => window.api.catalogSetTags(k, { 'garde-e2e': null }), key);
    });
  });

  describe('sous-titres (P5-11b)', () => {
    it('le plugin inclus mire.subtitles est actif ; désactivé, la vidéo de démonstration n’a plus de sous-titres, réactivé ils reviennent', async () => {
      const file = path.join(tmp, 'fixtures', 'media', 'Démonstration.webm');
      const plugin = () => page.evaluate(() => window.api.pluginsList().then((l) => l.find((p) => p.id === 'mire.subtitles')));
      assert.deepEqual(await plugin().then((p) => p && [p.origin, p.enabled, p.status]), ['bundled', true, 'active']);
      // Fichier ouvert : autorisé par la politique d'accès, comme à l'ouverture depuis le système.
      await page.evaluate((f) => window.api.fromPaths([f]), file);
      const langs = () => page.evaluate((f) => window.api.subtitles(f).then((l) => l.map((s) => s.lang).sort()), file);
      assert.deepEqual(await langs(), ['en', 'fr']);
      await page.evaluate(() => window.api.pluginsSetEnabled('mire.subtitles', false));
      await until(async () => (await plugin())?.status === 'disabled', { timeout: 10000 });
      assert.deepEqual(await langs(), []);
      await page.evaluate(() => window.api.pluginsSetEnabled('mire.subtitles', true));
      await until(async () => (await plugin())?.status === 'active', { timeout: 10000 });
      assert.deepEqual(await langs(), ['en', 'fr']);
    });
  });
});
