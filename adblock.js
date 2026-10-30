'use strict';
/**
 * Bloqueur de publicités des sites ouverts dans Mire (moteur open source de Ghostery).
 *
 * Listes : celles d'Adblock Plus (EasyList, EasyPrivacy, Liste FR) et celles d'uBlock Origin,
 * dont les règles contre les fenêtres surgissantes et les redirections publicitaires.
 * Le moteur compilé est gardé en cache ; les listes sont rafraîchies tous les quatre jours.
 */
const path = require('node:path');
const fsp = require('node:fs/promises');
const { webContents } = require('electron');
const { ElectronBlocker, adsAndTrackingLists, fetchResources, Request } = require('@ghostery/adblocker-electron');
const { parse: parseDomain } = require('tldts-experimental');

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

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const siteOf = (u) => hostOf(u).split('.').slice(-2).join('.');

function createAdblock({ dataDir, getConfig, saveConfig, onCount }) {
  const dir = path.join(dataDir, 'adblock');
  const engineFile = path.join(dir, 'moteur.bin');
  const infoFile = path.join(dir, 'listes.json');
  let blocker = null;
  let ses = null;
  let attached = false;
  let info = { updated: 0, loaded: [], failed: [] };
  let building = null;
  const counts = new Map(); // page (webContents) → nombre d'éléments bloqués

  const settings = () => getConfig().adblock || { enabled: true, allowlist: [], customLists: [] };

  // Le site de la page qui fait la requête est-il dans la liste « bloqueur désactivé » ?
  function pageAllowed(pageUrl) {
    const h = hostOf(pageUrl);
    if (!h) return false;
    return (settings().allowlist || []).some((d) => h === d || h.endsWith(`.${d}`));
  }
  const pageUrlOf = (id, fallback) => {
    const wc = id ? webContents.fromId(id) : null;
    return (wc && !wc.isDestroyed() && wc.getURL()) || fallback || '';
  };

  // Branche nos exceptions par site sur les fonctions du moteur.
  function wrap(engine) {
    const before = engine.onBeforeRequest;
    const headers = engine.onHeadersReceived;
    engine.onBeforeRequest = (details, callback) => {
      if (pageAllowed(pageUrlOf(details.webContentsId, details.referrer))) { callback({}); return; }
      before(details, callback);
    };
    engine.onHeadersReceived = (details, callback) => {
      if (pageAllowed(pageUrlOf(details.webContentsId, details.url))) { callback({}); return; }
      headers(details, callback);
    };
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
        const wc = webContents.fromId(id);
        if (!wc || wc.isDestroyed() || !urls.length) return;
        const q = (u) => `"${u.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        const selectors = urls.flatMap((u) => [`iframe[src=${q(u)}]`, `img[src=${q(u)}]`, `embed[src=${q(u)}]`, `object[data=${q(u)}]`, `video[src=${q(u)}]`]);
        wc.insertCSS(`${selectors.join(',')}{display:none!important}`, { cssOrigin: 'user' }).catch(() => {});
      }, 300);
    }
    pending.get(id).add(url);
  }

  function attach(engine) {
    if (blocker && ses && attached) blocker.disableBlockingInSession(ses);
    attached = false;
    blocker = wrap(engine);
    if (ses && settings().enabled !== false) { blocker.enableBlockingInSession(ses); attached = true; }
  }

  async function fetchText(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`code ${res.status}`);
    return res.text();
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
      const resources = await fetchResources(fetch);
      if (resources) engine.updateResources(resources, String(resources.length));
    } catch { /* sans les scripts correcteurs d'uBlock */ }
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(engineFile, engine.serialize());
    info = { updated: Date.now(), loaded, failed, engine: ENGINE_VERSION };
    await fsp.writeFile(infoFile, JSON.stringify(info));
    return engine;
  }

  function refresh() {
    if (!building) {
      building = build().then((engine) => { attach(engine); return true; }).finally(() => { building = null; });
    }
    return building;
  }

  // Démarrage : moteur en cache tout de suite, mise à jour des listes en arrière-plan si besoin.
  async function start(session) {
    ses = session;
    try { info = { ...info, ...JSON.parse(await fsp.readFile(infoFile, 'utf8')) }; } catch { /* première fois */ }
    let cached = null;
    if (info.engine === ENGINE_VERSION) {
      try { cached = ElectronBlocker.deserialize(new Uint8Array(await fsp.readFile(engineFile))); } catch { cached = null; }
    }
    if (cached) {
      attach(cached);
      if (Date.now() - info.updated > REFRESH_MS) refresh().catch((err) => console.error('Bloqueur :', err.message));
      return true;
    }
    await refresh();
    return true;
  }

  // Scripts correcteurs d'une page, à exécuter avant ceux du site. Chacun est enfermé dans son propre
  // bloc : leurs déclarations (class JSONPath…) ne se gênent plus, et l'échec de l'un n'arrête pas les autres.
  function scriptletsFor(url) {
    if (!blocker || !attached || !/^https?:/i.test(url) || pageAllowed(url)) return '';
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
    if (!blocker || !attached || !/^https?:/i.test(url) || pageAllowed(fromUrl)) return false;
    if (fromUrl && siteOf(url) === siteOf(fromUrl)) return false;
    try { return !!blocker.match(Request.fromRawDetails({ url, type: 'main_frame', sourceUrl: fromUrl || url })).match; } catch { return false; }
  }

  function setEnabled(on) {
    saveConfig({ ...getConfig(), adblock: { ...settings(), enabled: !!on } });
    if (!blocker || !ses) return status();
    if (on && !attached) { blocker.enableBlockingInSession(ses); attached = true; }
    if (!on && attached) { blocker.disableBlockingInSession(ses); attached = false; }
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

  return {
    start,
    refresh,
    blocksNavigation,
    scriptletsFor,
    setEnabled,
    toggleSite,
    setLists,
    status,
    pageAllowed,
    countFor: (id) => counts.get(id) || 0,
    resetCount: (id) => counts.delete(id),
  };
}

module.exports = { createAdblock };
