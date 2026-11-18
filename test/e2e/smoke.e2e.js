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
  // Le titre est rendu par mire-header (P4-07), à l'image suivante : on l'attend un peu avant de le comparer.
  await page.waitForFunction((t) => document.getElementById('title').textContent === t, title, { timeout: 2000 }).catch(() => {});
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
});
