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
      const win = BrowserWindow.getAllWindows()[0];
      win.setFullScreen(false);
      win.setContentSize(1600, 900);
    });
    // Heure figée (celle des aperçus de thèmes) : l'horloge de l'accueil ne change plus d'une capture à l'autre.
    await page.clock.setFixedTime(new Date('2026-10-30T20:45:00+01:00'));
    // L'horloge est rendue par mire-header : elle peut manquer aux premières images (?. : l'attente continue).
    await page.waitForFunction(() => document.getElementById('clock')?.textContent === '20:45', null, { timeout: 10000 });
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
      await page.locator(`#view .mire-settings-view__palette.hydrated[data-key="${theme}"]`).click();
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
    const sendDownload = (item) => app.evaluate(({ BrowserWindow }, d) => BrowserWindow.getAllWindows()[0].webContents.send('download', d), item);
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
        ['sites', ['Arte', 'Radio France']],
      ]);
      // Sans clé TMDB, « Où regarder » propose de l'ajouter.
      await page.locator(`${VIEW} [data-group="watch"] .mire-search-view__note`, { hasText: 'Ajoutez une clé TMDB' }).waitFor();
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
      assert.deepEqual(preview.actions, ['Lire', 'Modifier les infos', 'Tags', 'Ajouter à une liste']);
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
      page.waitForFunction(
        async ([q, w]) => JSON.stringify(q.split('.').reduce((o, k) => o?.[k], (await window.api.getConfig()).config)) === JSON.stringify(w),
        [p, v],
      );
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
      await page.locator(`${VIEW} select#set-search-region`).selectOption('BE');
      await waitSaved('search.region', 'BE');
      await page.locator(`${VIEW} select#set-search-region`).selectOption('FR');
      await waitSaved('search.region', 'FR');
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
      assert.deepEqual(await providers(), ['tmdb', 'musicbrainz', 'libretro', 'steam']);
      const item = (key) => page.locator(`${VIEW} ds-sortable[data-list="providers"] [data-key="${key}"]`);
      await item('musicbrainz').scrollIntoViewIfNeeded();
      await item('musicbrainz').focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Space');
      await waitSaved('catalog.metadataProviders', ['musicbrainz', 'tmdb', 'libretro', 'steam']);
      await page.waitForFunction((sel) => document.querySelector(`${sel} ds-sortable[data-list="providers"] [data-key]`)?.dataset.key === 'musicbrainz', VIEW);
      await page.locator(`${VIEW} ds-sortable[data-list="providers"]`).scrollIntoViewIfNeeded();
      await settle();
      await page.locator(`${VIEW} [data-panel="scrape"]`).screenshot({ path: path.join(SHOTS, 'settings-order.png') });
      // Retour à l'ordre d'origine, par le bouton qui monte un élément d'un rang.
      await page.locator(`${VIEW} ds-sortable[data-list="providers"] [data-key="tmdb"] button`).first().click();
      await waitSaved('catalog.metadataProviders', ['tmdb', 'musicbrainz', 'libretro', 'steam']);
      assert.deepEqual(errors, []);
    });

    it('« Ajouter la clé » de la Recherche mène au champ de la clé TMDB', async () => {
      await page.evaluate(() => document.querySelector('mire-app').open({ target: 'screen:search' }));
      await page.locator('#view mire-search-view .mire-search-view__input').fill('démonstration');
      const add = page.locator('#view mire-search-view ds-trigger[action="addKey"].hydrated');
      await add.click();
      await page.waitForFunction(() => document.body.dataset.section === 'settings' && document.activeElement?.id === 'set-search-tmdbToken');
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
    const waitConfig = (fn, arg) =>
      page.waitForFunction(async ([f, a]) => new Function('c', 'a', `return (${f})(c, a)`)((await window.api.getConfig()).config, a), [fn.toString(), arg]);
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
      await row.scrollIntoViewIfNeeded();
      await settle();
      await hideToast();
      await page.locator(`${VIEW} [data-panel="sources"]`).screenshot({ path: path.join(SHOTS, 'settings-sources.png') });
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
      await page.locator(`${VIEW} [data-panel="games"]`).scrollIntoViewIfNeeded();
      await settle();
      await hideToast();
      await page.locator(`${VIEW} [data-panel="games"]`).screenshot({ path: path.join(SHOTS, 'settings-games.png') });
      assert.deepEqual(errors, []);
    });
  });
});
