'use strict';
/**
 * Bloqueur de publicités des sites ouverts dans Mire (moteur open source de Ghostery).
 *
 * Listes : celles d'Adblock Plus (EasyList, EasyPrivacy, Liste FR) et celles d'uBlock Origin,
 * dont les règles contre les fenêtres surgissantes et les redirections publicitaires.
 * Le moteur compilé est gardé en cache ; les listes sont rafraîchies tous les quatre jours. Rien n'est
 * téléchargé tant que le bloqueur est désactivé.
 *
 * C'est une extension des vues web (src/main/web/extensions.ts) : l'hôte des extensions lui passe les requêtes
 * réseau, lui demande ses scripts correcteurs avant chaque page et lui soumet les navigations.
 */
const path = require('node:path');
const fsp = require('node:fs/promises');
const electron = require('electron');
const { BlockingContext, ElectronBlocker, adsAndTrackingLists, fetchResources, Request } = require('@ghostery/adblocker-electron');
const { parse: parseDomain } = require('tldts-experimental');
const { hostOf, siteOf } = require('@mire/shared');
const http = require('./net/http.ts');
const { createJsonStore } = require('./storage/json-store.ts');
const { dataPaths } = require('./storage/paths.ts');

// Liste FR : la liste qu'Adblock Plus ajoute à EasyList pour les sites français.
const EXTRA_LISTS = ['https://easylist-downloads.adblockplus.org/liste_fr.txt'];
const REFRESH_MS = 4 * 24 * 3600 * 1000;

// Version du moteur : un moteur en cache construit par une autre version est reconstruit
// (la 2.20 partage entre les scripts correcteurs le cliché des fonctions d'origine du navigateur).
function engineVersion() {
  try {
    let dir = path.dirname(require.resolve('@ghostery/adblocker'));
    for (let i = 0; i < 5; i++) {
      const pkg = path.join(dir, 'package.json');
      try {
        const j = JSON.parse(require('node:fs').readFileSync(pkg, 'utf8'));
        if (j.name === '@ghostery/adblocker') return j.version;
      } catch { /* on remonte */ }
      dir = path.dirname(dir);
    }
  } catch { /* inconnu */ }
  return '';
}
const ENGINE_VERSION = engineVersion();

// Masquage seul (script de page du moteur et ses canaux) : les requêtes réseau passent par l'hôte des extensions,
// qui est le seul à poser des écouteurs webRequest sur la session.
function cosmeticContext(ses, blocker) {
  const cosmeticSession = {
    registerPreloadScript: (script) => ses.registerPreloadScript(script),
    unregisterPreloadScript: (id) => ses.unregisterPreloadScript(id),
    webRequest: { onBeforeRequest() {}, onHeadersReceived() {} },
  };
  return new BlockingContext(cosmeticSession, blocker);
}

const wait = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); });

/**
 * Dépendances facultatives (tests) : `fetchText` (listes), `fetch` (ressources d'uBlock), `contentsFromId`
 * (webContents.fromId) et `cosmetics` (masquage dans la session).
 */
function createAdblock({ dataDir, getConfig, saveConfig, onCount, fetchText = (url) => http.getText(url, { timeout: 30000 }), fetch: fetchImpl = globalThis.fetch, contentsFromId = (id) => electron.webContents.fromId(id), cosmetics = cosmeticContext }) {
  const { adblockDir: dir, adblockEngine: engineFile, adblockLists } = dataPaths(dataDir);
  // État des listes ; absent ou illisible : le moteur est reconstruit (première fois).
  const infoStore = createJsonStore(adblockLists, { defaults: { updated: 0, loaded: [], failed: [] } });
  let blocker = null;
  let ses = null;
  let cosmetic = null; // masquage en place dans la session
  let info = infoStore.get();
  let building = null;
  let loading = null;
  const counts = new Map(); // page (webContents) → nombre d'éléments bloqués

  const settings = () => getConfig().adblock || { enabled: true, allowlist: [], customLists: [] };
  const enabled = () => settings().enabled !== false;
  // Le bloqueur agit : moteur prêt, branché sur la session, et activé.
  const running = () => !!blocker && !!ses && enabled();

  // Le site de la page qui fait la requête est-il dans la liste « bloqueur désactivé » ?
  function pageAllowed(pageUrl) {
    const h = hostOf(pageUrl);
    if (!h) return false;
    return (settings().allowlist || []).some((d) => h === d || h.endsWith(`.${d}`));
  }
  const pageUrlOf = (id, fallback) => {
    const wc = id ? contentsFromId(id) : null;
    return (wc && !wc.isDestroyed() && wc.getURL()) || fallback || '';
  };

  // Branche nos exceptions par site et le compteur sur le moteur.
  function wrap(engine) {
    // Règles de masquage seulement : les scripts correcteurs (scriptlets) sont injectés par Mire
    // dès le début de la page (voir scriptletsFor). Le moteur, lui, les injectait trop tard, et à la
    // suite les uns des autres : sur YouTube, certains se gênaient (« JSONPath déjà déclaré ») et le
    // lecteur recevait des données à moitié modifiées, d'où une vidéo noire et muette.
    engine.onInjectCosmeticFilters = async (event, url, msg) => {
      if (pageAllowed(event.sender?.getURL?.() || url)) return undefined;
      const parsed = parseDomain(url);
      const isFirstRun = msg === undefined;
      const { active, styles } = engine.getCosmeticsFilters({
        domain: parsed.domain || '',
        hostname: parsed.hostname || '',
        url,
        classes: msg?.classes,
        hrefs: msg?.hrefs,
        ids: msg?.ids,
        getBaseRules: isFirstRun,
        getInjectionRules: false,
        getExtendedRules: false,
        getRulesFromHostname: isFirstRun,
        getRulesFromDOM: !isFirstRun,
        callerContext: { frameId: event.frameId, processId: event.processId, lifecycle: msg?.lifecycle },
      });
      if (active === false || !styles.length) return undefined;
      event.sender.insertCSS(styles, { cssOrigin: 'user' }).catch(() => {});
      return undefined;
    };
    engine.on('request-blocked', (request) => {
      const id = request.tabId;
      if (id == null || id < 0) return;
      counts.set(id, (counts.get(id) || 0) + 1);
      onCount(id, counts.get(id));
      if (COLLAPSE_TYPES.has(request.type)) collapse(id, request.url);
    });
    return engine;
  }

  // Comme Adblock Plus : le cadre ou l'image bloqués ne laissent pas de case vide dans la page.
  const COLLAPSE_TYPES = new Set(['sub_frame', 'subFrame', 'image', 'media', 'object']);
  const pending = new Map();
  function collapse(id, url) {
    if (!pending.has(id)) {
      pending.set(id, new Set());
      setTimeout(() => {
        const urls = [...(pending.get(id) || [])].slice(0, 80);
        pending.delete(id);
        const wc = contentsFromId(id);
        if (!wc || wc.isDestroyed() || !urls.length) return;
        const q = (u) => `"${u.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        const selectors = urls.flatMap((u) => [`iframe[src=${q(u)}]`, `img[src=${q(u)}]`, `embed[src=${q(u)}]`, `object[data=${q(u)}]`, `video[src=${q(u)}]`]);
        wc.insertCSS(`${selectors.join(',')}{display:none!important}`, { cssOrigin: 'user' }).catch(() => {});
      }, 300);
    }
    pending.get(id).add(url);
  }

  // Met le masquage en accord avec l'état : en place quand le bloqueur agit, retiré sinon.
  function sync() {
    if (cosmetic && (!running() || cosmetic.blocker !== blocker)) { cosmetic.disable(); cosmetic = null; }
    if (running() && !cosmetic) { cosmetic = cosmetics(ses, blocker); cosmetic.enable(); }
  }

  function use(engine) {
    blocker = wrap(engine);
    sync();
  }

  // Télécharge les listes ; une liste indisponible n'empêche pas les autres de servir.
  async function build() {
    const urls = [...adsAndTrackingLists, ...EXTRA_LISTS, ...(settings().customLists || [])];
    const results = await Promise.allSettled(urls.map(fetchText));
    const texts = [];
    const loaded = [];
    const failed = [];
    results.forEach((r, i) => { if (r.status === 'fulfilled') { texts.push(r.value); loaded.push(urls[i]); } else failed.push(urls[i]); });
    if (!texts.length) throw new Error('Aucune liste de filtres n’a pu être téléchargée. Vérifiez la connexion Internet.');
    const engine = ElectronBlocker.parse(texts.join('\n'), { loadNetworkFilters: true, loadCosmeticFilters: true, enableCompression: true });
    try {
      const resources = await fetchResources(fetchImpl);
      if (resources) engine.updateResources(resources, String(resources.length));
    } catch { /* sans les scripts correcteurs d'uBlock */ }
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(engineFile, engine.serialize());
    info = { updated: Date.now(), loaded, failed, engine: ENGINE_VERSION };
    infoStore.set(info);
    return engine;
  }

  function refresh() {
    if (!building) {
      building = build().then((engine) => { use(engine); return true; }).finally(() => { building = null; });
    }
    return building;
  }

  // Moteur en cache tout de suite, mise à jour des listes en arrière-plan si besoin ; sans cache, téléchargement.
  async function loadEngine() {
    info = infoStore.load();
    let cached = null;
    if (info.engine === ENGINE_VERSION) {
      try { cached = ElectronBlocker.deserialize(new Uint8Array(await fsp.readFile(engineFile))); } catch { cached = null; }
    }
    if (cached) {
      use(cached);
      if (Date.now() - info.updated > REFRESH_MS) refresh().catch((err) => console.error('Bloqueur :', err.message));
      return true;
    }
    await refresh();
    return true;
  }

  function load() {
    if (blocker) return Promise.resolve(true);
    if (!loading) loading = loadEngine().finally(() => { loading = null; });
    return loading;
  }

  // Démarrage : rien n'est chargé ni téléchargé tant que le bloqueur est désactivé.
  async function start() {
    if (!enabled()) return false;
    return load();
  }

  // Scripts correcteurs d'une page, à exécuter avant ceux du site. Chacun est enfermé dans son propre
  // bloc : leurs déclarations (class JSONPath…) ne se gênent plus, et l'échec de l'un n'arrête pas les autres.
  function scriptletsFor(url) {
    if (!running() || !/^https?:/i.test(url) || pageAllowed(url)) return '';
    try {
      const parsed = parseDomain(url);
      const { active, scripts } = blocker.getCosmeticsFilters({
        url,
        hostname: parsed.hostname || '',
        domain: parsed.domain || '',
        getBaseRules: false,
        getInjectionRules: true,
        getExtendedRules: false,
        getRulesFromHostname: true,
        getRulesFromDOM: false,
      });
      if (active === false || !scripts.length) return '';
      return scripts.map((code) => `try {\n${code}\n} catch (e) {}`).join('\n');
    } catch { return ''; }
  }

  // Redirection publicitaire : la page part vers une régie (« clic sur la vidéo → page de pub »).
  function blocksNavigation(url, fromUrl) {
    if (!running() || !/^https?:/i.test(url) || pageAllowed(fromUrl)) return false;
    if (fromUrl && siteOf(url) === siteOf(fromUrl)) return false;
    try { return !!blocker.match(Request.fromRawDetails({ url, type: 'main_frame', sourceUrl: fromUrl || url })).match; } catch { return false; }
  }

  // Activé pour la première fois : les listes sont chargées (téléchargées sans cache), dix secondes d'attente au plus
  // avant de rendre la main, comme au démarrage.
  async function setEnabled(on) {
    saveConfig({ ...getConfig(), adblock: { ...settings(), enabled: !!on } });
    sync();
    if (on && !blocker) {
      const ready = load().catch((err) => { console.error('Bloqueur :', err.message); return false; });
      await Promise.race([ready, wait(10000)]);
    }
    return status();
  }

  // Active ou désactive le bloqueur pour un site (ex. : juststream.now).
  function toggleSite(url) {
    const h = hostOf(url).replace(/^www\./, '');
    if (!h) return status();
    const list = [...(settings().allowlist || [])];
    const i = list.indexOf(h);
    if (i >= 0) list.splice(i, 1); else list.push(h);
    saveConfig({ ...getConfig(), adblock: { ...settings(), allowlist: list } });
    return status();
  }

  function setLists({ allowlist, customLists }) {
    const next = { ...settings() };
    if (Array.isArray(allowlist)) next.allowlist = allowlist;
    if (Array.isArray(customLists)) next.customLists = customLists;
    saveConfig({ ...getConfig(), adblock: next });
    return status();
  }

  function status() {
    const s = settings();
    return {
      enabled: s.enabled !== false,
      ready: !!blocker,
      updating: !!building,
      updated: info.updated,
      loaded: info.loaded.length,
      failed: info.failed,
      allowlist: s.allowlist || [],
      customLists: s.customLists || [],
    };
  }

  // Requêtes réseau, passées par l'hôte des extensions. Sites autorisés et bloqueur inactif : rien n'est fait.
  const webRequest = {
    onBeforeRequest: (details) => new Promise((resolve) => {
      if (!running() || pageAllowed(pageUrlOf(details.webContentsId, details.referrer))) { resolve({}); return; }
      blocker.onBeforeRequest(details, resolve);
    }),
    onHeadersReceived: (details) => new Promise((resolve) => {
      if (!running() || pageAllowed(pageUrlOf(details.webContentsId, details.url))) { resolve({}); return; }
      blocker.onHeadersReceived(details, resolve);
    }),
  };

  return {
    // Extension des vues web.
    id: 'adblock',
    attach(session) { ses = session; sync(); },
    detach() { if (cosmetic) { cosmetic.disable(); cosmetic = null; } ses = null; },
    webRequest,
    beforePageScript: (url) => scriptletsFor(url),
    guardNavigation: (url, fromUrl) => blocksNavigation(url, fromUrl),
    status,
    blockedCount: (id) => counts.get(id) || 0,
    resetPage: (id) => { counts.delete(id); },
    activeOn: (url) => enabled() && !pageAllowed(url),
    // Réglages.
    start,
    refresh,
    blocksNavigation,
    scriptletsFor,
    setEnabled,
    toggleSite,
    setLists,
    pageAllowed,
  };
}

module.exports = { createAdblock };
