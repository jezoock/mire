'use strict';
/**
 * Boutique de Mire : installe des émulateurs depuis leurs sources officielles,
 * télécharge des jeux homebrew distribués librement par leurs auteurs,
 * et range vos propres copies de jeux dans le bon dossier.
 *
 * Aucun jeu du commerce n'est proposé : pour ceux-là, utilisez vos propres copies (« Importer »).
 */
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const UA = 'Mire/1.0 (lecteur multimédia personnel)';
const PLATFORM = process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : 'other';

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

// Systèmes de RetroArch : chaque système ajoute un « cœur » (module d'émulation) et une console dans Mire.
const RETROARCH_SYSTEMS = [
  { id: 'nes', name: 'NES', folder: 'NES', libretro: 'Nintendo - Nintendo Entertainment System', core: 'fceumm', ext: ['.nes', '.fds', '.unf', '.zip'] },
  { id: 'snes', name: 'Super Nintendo', folder: 'Super Nintendo', libretro: 'Nintendo - Super Nintendo Entertainment System', core: 'snes9x', ext: ['.sfc', '.smc', '.zip'] },
  { id: 'gb', name: 'Game Boy', folder: 'Game Boy', libretro: 'Nintendo - Game Boy', core: 'gambatte', ext: ['.gb', '.zip'] },
  { id: 'gbc', name: 'Game Boy Color', folder: 'Game Boy Color', libretro: 'Nintendo - Game Boy Color', core: 'gambatte', ext: ['.gbc', '.zip'] },
  { id: 'gba', name: 'Game Boy Advance', folder: 'Game Boy Advance', libretro: 'Nintendo - Game Boy Advance', core: 'mgba', ext: ['.gba', '.zip'] },
  { id: 'n64', name: 'Nintendo 64', folder: 'Nintendo 64', libretro: 'Nintendo - Nintendo 64', core: 'mupen64plus_next', ext: ['.n64', '.z64', '.v64', '.zip'] },
  { id: 'md', name: 'Mega Drive', folder: 'Mega Drive', libretro: 'Sega - Mega Drive - Genesis', core: 'genesis_plus_gx', ext: ['.md', '.gen', '.smd', '.bin', '.zip'] },
  { id: 'sms', name: 'Master System', folder: 'Master System', libretro: 'Sega - Master System - Mark III', core: 'genesis_plus_gx', ext: ['.sms', '.zip'] },
  { id: 'gg', name: 'Game Gear', folder: 'Game Gear', libretro: 'Sega - Game Gear', core: 'genesis_plus_gx', ext: ['.gg', '.zip'] },
  { id: 'pce', name: 'PC Engine', folder: 'PC Engine', libretro: 'NEC - PC Engine - TurboGrafx 16', core: 'mednafen_pce_fast', ext: ['.pce', '.zip'] },
];

// Émulateurs autonomes. source.github : dépôt officiel ; on prend la dernière version publiée.
const EMULATORS = [
  {
    id: 'retroarch',
    name: 'RetroArch',
    desc: 'Un seul programme pour les consoles 8 et 16 bits, les Game Boy et la Nintendo 64. Choisissez les consoles à ajouter.',
    site: 'https://www.retroarch.com',
    retroarch: true,
    systems: RETROARCH_SYSTEMS,
    exe: { win32: /^retroarch\.exe$/i, linux: /^RetroArch-Linux-x86_64\.AppImage$/ },
  },
  {
    id: 'duckstation',
    name: 'DuckStation',
    desc: 'PlayStation. Demande le BIOS de votre console, à placer dans son dossier « bios ».',
    site: 'https://www.duckstation.org',
    source: { github: 'stenzek/duckstation', win32: /^duckstation-windows-x64-release\.zip$/, linux: /^DuckStation-x64\.AppImage$/ },
    exe: { win32: /^duckstation-qt-x64-ReleaseLTCG\.exe$/i, linux: /^DuckStation-x64\.AppImage$/ },
    args: ['-batch', '-fullscreen', '{rom}'],
    systems: [{ id: 'ps1', name: 'PlayStation', folder: 'PlayStation', libretro: 'Sony - PlayStation', ext: ['.cue', '.chd', '.m3u', '.pbp', '.iso'] }],
  },
  {
    id: 'pcsx2',
    name: 'PCSX2',
    desc: 'PlayStation 2. Demande le BIOS de votre console.',
    site: 'https://pcsx2.net',
    source: { github: 'PCSX2/pcsx2', win32: /-windows-x64-Qt\.7z$/, linux: /-linux-appimage-x64-Qt\.AppImage$/ },
    exe: { win32: /^pcsx2-qt\.exe$/i, linux: /\.AppImage$/ },
    args: ['-batch', '-fullscreen', '{rom}'],
    systems: [{ id: 'ps2', name: 'PlayStation 2', folder: 'PlayStation 2', libretro: 'Sony - PlayStation 2', ext: ['.iso', '.chd', '.cso', '.gz'] }],
  },
  {
    id: 'ppsspp',
    name: 'PPSSPP',
    desc: 'PlayStation Portable.',
    site: 'https://www.ppsspp.org',
    source: { github: 'hrydgard/ppsspp', win32: /-Windows-x64\.zip$/, linux: /-anylinux-x86_64\.AppImage$/ },
    exe: { win32: /^PPSSPPWindows64\.exe$/i, linux: /\.AppImage$/ },
    args: ['--fullscreen', '{rom}'],
    systems: [{ id: 'psp', name: 'PSP', folder: 'PSP', libretro: 'Sony - PlayStation Portable', ext: ['.iso', '.cso', '.pbp', '.chd'] }],
  },
  {
    id: 'dolphin',
    name: 'Dolphin',
    desc: 'GameCube et Wii. Sous Windows, demande le « Visual C++ Redistributable » de Microsoft.',
    site: 'https://dolphin-emu.org',
    source: { page: 'https://dolphin-emu.org/download/', win32: /https:\/\/dl\.dolphin-emu\.org\/releases\/[\w.-]+\/dolphin-[\w.-]+-x64\.7z/ },
    exe: { win32: /^Dolphin\.exe$/i },
    args: ['-b', '-e', '{rom}'],
    systems: [
      { id: 'gc', name: 'GameCube', folder: 'GameCube', libretro: 'Nintendo - GameCube', ext: ['.iso', '.gcm', '.rvz', '.ciso', '.gcz'] },
      { id: 'wii', name: 'Wii', folder: 'Wii', libretro: 'Nintendo - Wii', ext: ['.wbfs', '.rvz', '.iso'] },
    ],
  },
  {
    id: 'melonds',
    name: 'melonDS',
    desc: 'Nintendo DS.',
    site: 'https://melonds.kuribo64.net',
    source: { github: 'melonDS-emu/melonDS', win32: /-windows-x86_64\.zip$/, linux: /-appimage-x86_64\.zip$/ },
    exe: { win32: /^melonDS\.exe$/i, linux: /\.AppImage$/i },
    args: ['-f', '{rom}'],
    systems: [{ id: 'nds', name: 'Nintendo DS', folder: 'Nintendo DS', libretro: 'Nintendo - Nintendo DS', ext: ['.nds', '.zip'] }],
  },
  {
    id: 'azahar',
    name: 'Azahar',
    desc: 'Nintendo 3DS.',
    site: 'https://azahar-emu.org',
    source: { github: 'azahar-emu/azahar', win32: /^azahar-windows-msvc-[\w.]+\.zip$/ },
    exe: { win32: /^azahar\.exe$/i },
    args: ['{rom}'],
    systems: [{ id: '3ds', name: 'Nintendo 3DS', folder: 'Nintendo 3DS', libretro: 'Nintendo - Nintendo 3DS', ext: ['.3ds', '.cci', '.cxi', '.3dsx'] }],
  },
  {
    id: 'cemu',
    name: 'Cemu',
    desc: 'Wii U.',
    site: 'https://cemu.info',
    source: { github: 'cemu-project/Cemu', win32: /-windows-x64\.zip$/, linux: /-x86_64\.AppImage$/ },
    exe: { win32: /^Cemu\.exe$/i, linux: /\.AppImage$/ },
    args: ['-f', '-g', '{rom}'],
    systems: [{ id: 'wiiu', name: 'Wii U', folder: 'Wii U', libretro: 'Nintendo - Wii U', ext: ['.wud', '.wux', '.wua', '.rpx'] }],
  },
];

// Jeux homebrew publiés librement par leurs auteurs (téléchargés depuis leurs dépôts officiels).
const FREE_GAMES = [
  { id: 'nova', name: 'Nova the Squirrel', system: 'nes', author: 'NovaSquirrel', desc: 'Plateformes : un écureuil qui copie les pouvoirs de ses ennemis.', url: 'https://github.com/NovaSquirrel/NovaTheSquirrel/releases/latest/download/nova.nes', file: 'Nova the Squirrel.nes' },
  { id: 'thwaite', name: 'Thwaite', system: 'nes', author: 'Damian Yerrick', desc: 'Défendez vos villages contre une pluie de missiles.', url: 'https://github.com/pinobatch/thwaite-nes/releases/latest/download/thwaite.nes', file: 'Thwaite.nes' },
  { id: 'croom', name: 'Concentration Room', system: 'nes', author: 'Damian Yerrick', desc: 'Jeu de mémoire : retrouvez les paires de cartes.', url: 'https://github.com/pinobatch/croom-nes/releases/latest/download/croom.nes', file: 'Concentration Room.nes' },
  { id: 'libbet', name: 'Libbet and the Magic Floor', system: 'gb', author: 'Damian Yerrick', desc: 'Réflexion : passez sur chaque case du sol sans rester coincé.', url: 'https://github.com/pinobatch/libbet/releases/latest/download/libbet.gb', file: 'Libbet and the Magic Floor.gb' },
  { id: 'ucity', name: 'µCity', system: 'gbc', author: 'Antonio Niño Díaz', desc: 'Construisez et gérez votre ville, dans l’esprit de SimCity.', url: 'https://github.com/AntonioND/ucity/releases/latest/download/ucity.gbc', file: 'uCity.gbc' },
  { id: 'cavestory', name: 'Cave Story', system: 'md', author: 'andwn, d’après Daisuke Amaya', desc: 'Le grand jeu d’aventure gratuit, adapté pour la Mega Drive, en français.', url: 'https://github.com/andwn/cave-story-md/releases/latest/download/doukutsu-fr.gen', file: 'Cave Story (France).gen' },
];

/* ------------------------------------------------------------------ */
/* Outils                                                              */
/* ------------------------------------------------------------------ */

// fetch avec un message compréhensible quand le site ne répond pas.
async function get(url, opts = {}) {
  try {
    return await fetch(url, { ...opts, headers: { 'user-agent': UA, ...(opts.headers || {}) } });
  } catch (err) {
    const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
    throw new Error(err.name === 'TimeoutError' ? `${host} met trop de temps à répondre.` : `Impossible de joindre ${host}. Vérifiez la connexion Internet.`);
  }
}

async function fetchText(url) {
  const res = await get(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} a répondu avec le code ${res.status}`);
  return res.text();
}

// Dernière version d'un dépôt GitHub, sans l'API (limitée à 60 appels par heure).
async function githubLatest(repo) {
  const res = await get(`https://github.com/${repo}/releases/latest`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  const loc = res.headers.get('location') || '';
  const m = /\/releases\/tag\/([^/?#]+)/.exec(loc);
  if (!m) throw new Error(`Aucune version publiée pour ${repo}.`);
  const tag = decodeURIComponent(m[1]);
  const html = await fetchText(`https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`);
  const prefix = `/${repo}/releases/download/`;
  const assets = [...html.matchAll(/href="([^"]+)"/g)]
    .map((x) => x[1])
    .filter((h) => h.startsWith(prefix))
    .map((h) => ({ name: decodeURIComponent(h.split('/').pop()), url: `https://github.com${h}` }));
  return { tag, assets };
}

async function resolveSource(emu) {
  const src = emu.source;
  const pattern = src[PLATFORM];
  if (!pattern) throw new Error(`${emu.name} n’est pas proposé pour ce système.`);
  if (src.github) {
    const { tag, assets } = await githubLatest(src.github);
    const asset = assets.find((a) => pattern.test(a.name));
    if (!asset) throw new Error(`Fichier de ${emu.name} introuvable dans la version ${tag}.`);
    return { url: asset.url, name: asset.name, version: tag };
  }
  if (src.page) {
    const html = await fetchText(src.page);
    const m = pattern.exec(html);
    if (!m) throw new Error(`La page de téléchargement de ${emu.name} a changé. Installez-le depuis ${emu.site}.`);
    const url = m[0];
    return { url, name: url.split('/').pop(), version: (/releases\/([^/]+)\//.exec(url) || [])[1] || '' };
  }
  throw new Error('Source inconnue.');
}

async function download(url, dest, onProgress) {
  const res = await get(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible : ${new URL(url).hostname} a répondu avec le code ${res.status}.`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let last = 0;
  const counter = new (require('node:stream').Transform)({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      const now = Date.now();
      if (now - last > 200) { last = now; onProgress?.(received, total); }
      cb(null, chunk);
    },
  });
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(dest));
  onProgress?.(received, total || received);
  return dest;
}

async function findFile(dir, pattern, depth = 0) {
  if (depth > 4) return null;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isFile() && pattern.test(e.name)) return path.join(dir, e.name);
  for (const e of entries) {
    if (!e.isDirectory() || e.name.endsWith('.home') || e.name.endsWith('.config')) continue;
    const r = await findFile(path.join(dir, e.name), pattern, depth + 1);
    if (r) return r;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Le module                                                           */
/* ------------------------------------------------------------------ */

// BIOS : fichiers attendus par chaque émulateur (rappel affiché sur sa carte).
const BIOS_HINTS = {
  retroarch: 'Selon les consoles : gba_bios.bin (Game Boy Advance), bios_CD_E.bin, bios_CD_U.bin, bios_CD_J.bin (Mega-CD), syscard3.pce (PC Engine CD)…',
  duckstation: 'Le BIOS de votre PlayStation : scph1001.bin, scph5501.bin, scph7001.bin… (obligatoire).',
  pcsx2: 'Le BIOS de votre PlayStation 2, par exemple SCPH-70004.bin (obligatoire).',
  melonds: 'bios7.bin, bios9.bin et firmware.bin (facultatif : melonDS a un BIOS libre intégré). Indiquez-les ensuite dans melonDS, Configuration, Émulation.',
  dolphin: 'IPL.bin de votre GameCube (facultatif), à placer dans le sous-dossier de sa région (EUR, USA, JAP).',
  azahar: 'aes_keys.txt et fichiers système de votre 3DS (facultatif).',
  cemu: 'keys.txt, avec les clés de vos jeux Wii U (pour les jeux chiffrés).',
};

function createStore({ dataDir, defaultRomsRoot, getConfig, saveConfig, onProgress, sevenZipPath, paths = {} }) {
  const emuRoot = path.join(dataDir, 'emulators');
  const tmpRoot = path.join(os.tmpdir(), 'mire-store');
  const metaFile = path.join(emuRoot, 'installed.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { /* rien d'installé */ }
  const saveMeta = () => fsp.mkdir(emuRoot, { recursive: true }).then(() => fsp.writeFile(metaFile, JSON.stringify(meta, null, 2)));
  const busy = new Set();

  const romsRoot = () => getConfig().store?.romsRoot || defaultRomsRoot;

  // 7za doit être exécutable ; dans une application empaquetée, on en fait une copie si besoin.
  let sevenZip = null;
  async function seven() {
    if (sevenZip) return sevenZip;
    let bin = sevenZipPath;
    if (process.platform !== 'win32') {
      try { await fsp.chmod(bin, 0o755); } catch {
        const copy = path.join(dataDir, 'bin', '7za');
        await fsp.mkdir(path.dirname(copy), { recursive: true });
        await fsp.copyFile(bin, copy);
        await fsp.chmod(copy, 0o755);
        bin = copy;
      }
    }
    sevenZip = bin;
    return bin;
  }

  async function extract(archive, dest) {
    const bin = await seven();
    await fsp.mkdir(dest, { recursive: true });
    await new Promise((resolve, reject) => {
      const p = spawn(bin, ['x', '-y', `-o${dest}`, archive], { stdio: 'ignore', windowsHide: true });
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Extraction impossible (code ${code}).`))));
    });
  }

  // Une console par système, rangée dans ROMs/<Système> ; une console existante du même système est mise à jour.
  function registerConsoles(emu, systems, exePath, argsFor) {
    const cfg = getConfig();
    const emulators = [...cfg.emulators];
    for (const sys of systems) {
      const romsDir = path.join(romsRoot(), sys.folder);
      fs.mkdirSync(romsDir, { recursive: true });
      const entry = { name: sys.name, path: exePath, args: argsFor(sys), romsDir, extensions: sys.ext, system: sys.libretro, store: `${emu.id}:${sys.id}` };
      const i = emulators.findIndex((e) => e.store === entry.store);
      if (i >= 0) emulators[i] = { ...emulators[i], ...entry, romsDir: emulators[i].romsDir || romsDir };
      else emulators.push(entry);
    }
    saveConfig({ ...cfg, emulators });
  }

  function progress(id, phase, extra = {}) { onProgress({ id, phase, ...extra }); }

  async function installRetroArch(emu, systemIds) {
    const dir = path.join(emuRoot, 'retroarch');
    let exe = meta.retroarch?.exe && fs.existsSync(meta.retroarch.exe) ? meta.retroarch.exe : null;
    if (!exe) {
      const { tag } = await githubLatest('libretro/RetroArch');
      const version = tag.replace(/^v/, '');
      const sub = PLATFORM === 'win32' ? 'windows/x86_64' : 'linux/x86_64';
      const url = `https://buildbot.libretro.com/stable/${version}/${sub}/RetroArch.7z`;
      const file = path.join(tmpRoot, `RetroArch-${version}.7z`);
      progress(emu.id, 'download', { label: `RetroArch ${version}` });
      await download(url, file, (received, total) => progress(emu.id, 'download', { label: `RetroArch ${version}`, received, total }));
      progress(emu.id, 'extract', { label: 'Extraction de RetroArch' });
      await extract(file, dir);
      await fsp.unlink(file).catch(() => {});
      exe = await findFile(dir, emu.exe[PLATFORM]);
      if (!exe) throw new Error('RetroArch est téléchargé, mais son programme est introuvable dans l’archive.');
      if (PLATFORM !== 'win32') await fsp.chmod(exe, 0o755);
      meta.retroarch = { version, exe, systems: [], at: Date.now() };
    }
    const coresDir = path.join(dir, 'cores');
    const ext = PLATFORM === 'win32' ? 'dll' : 'so';
    const sub = PLATFORM === 'win32' ? 'windows/x86_64' : 'linux/x86_64';
    const systems = RETROARCH_SYSTEMS.filter((s) => systemIds.includes(s.id));
    for (const core of [...new Set(systems.map((s) => s.core))]) {
      const coreFile = path.join(coresDir, `${core}_libretro.${ext}`);
      if (fs.existsSync(coreFile)) continue;
      const zip = path.join(tmpRoot, `${core}.zip`);
      progress(emu.id, 'download', { label: `Module ${core}` });
      await download(`https://buildbot.libretro.com/nightly/${sub}/latest/${core}_libretro.${ext}.zip`, zip, (received, total) => progress(emu.id, 'download', { label: `Module ${core}`, received, total }));
      await extract(zip, coresDir);
      await fsp.unlink(zip).catch(() => {});
    }
    registerConsoles(emu, systems, exe, (sys) => ['-f', '-L', path.join(coresDir, `${sys.core}_libretro.${ext}`), '{rom}']);
    meta.retroarch.systems = [...new Set([...(meta.retroarch.systems || []), ...systemIds])];
    await saveMeta();
  }

  async function installStandalone(emu) {
    const dir = path.join(emuRoot, emu.id);
    progress(emu.id, 'resolve', { label: 'Recherche de la dernière version' });
    const src = await resolveSource(emu);
    const file = path.join(tmpRoot, src.name);
    progress(emu.id, 'download', { label: `${emu.name} ${src.version}` });
    await download(src.url, file, (received, total) => progress(emu.id, 'download', { label: `${emu.name} ${src.version}`, received, total }));
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    if (/\.(zip|7z)$/i.test(src.name)) {
      progress(emu.id, 'extract', { label: 'Extraction' });
      await extract(file, dir);
      await fsp.unlink(file).catch(() => {});
    } else {
      await fsp.rename(file, path.join(dir, src.name)).catch(async () => { await fsp.copyFile(file, path.join(dir, src.name)); await fsp.unlink(file); });
    }
    const exe = await findFile(dir, emu.exe[PLATFORM]);
    if (!exe) throw new Error(`${emu.name} est téléchargé, mais son programme est introuvable.`);
    if (PLATFORM !== 'win32') await fsp.chmod(exe, 0o755);
    registerConsoles(emu, emu.systems, exe, () => emu.args);
    meta[emu.id] = { version: src.version, exe, at: Date.now() };
    await saveMeta();
  }

  async function install(id, systemIds = []) {
    const emu = EMULATORS.find((e) => e.id === id);
    if (!emu) return { ok: false, error: 'Émulateur inconnu.' };
    if (PLATFORM === 'other') return { ok: false, error: 'La boutique installe les émulateurs sous Windows et Linux. Sur ce système, installez-les depuis leur site.' };
    if (busy.has(id)) return { ok: false, error: 'Installation déjà en cours.' };
    busy.add(id);
    try {
      if (emu.retroarch) {
        if (!systemIds.length) throw new Error('Choisissez au moins une console.');
        await installRetroArch(emu, systemIds);
      } else {
        await installStandalone(emu);
      }
      progress(id, 'done');
      return { ok: true, config: getConfig() };
    } catch (err) {
      progress(id, 'error', { message: err.message });
      return { ok: false, error: err.message };
    } finally {
      busy.delete(id);
    }
  }

  async function uninstall(id) {
    const cfg = getConfig();
    saveConfig({ ...cfg, emulators: cfg.emulators.filter((e) => !String(e.store || '').startsWith(`${id}:`)) });
    await fsp.rm(path.join(emuRoot, id), { recursive: true, force: true }).catch(() => {});
    delete meta[id];
    await saveMeta();
    return { ok: true, config: getConfig() };
  }

  /* ---------- BIOS : dossier où chaque émulateur les cherche ---------- */

  function biosDir(id) {
    const home = paths.home || os.homedir();
    const docs = paths.documents || path.join(home, 'Documents');
    const appData = paths.appData || path.join(home, 'AppData', 'Roaming');
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const xdgData = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    const exe = id === 'retroarch' ? meta.retroarch?.exe : meta[id]?.exe;
    const dir = exe ? path.dirname(exe) : path.join(emuRoot, id);
    const has = (f) => fs.existsSync(path.join(dir, f));
    const win = PLATFORM === 'win32';
    switch (id) {
      case 'retroarch': return win ? path.join(emuRoot, 'retroarch', 'system') : path.join(xdgConfig, 'retroarch', 'system');
      case 'duckstation': return has('portable.txt') ? path.join(dir, 'bios') : win ? path.join(docs, 'DuckStation', 'bios') : path.join(xdgData, 'duckstation', 'bios');
      case 'pcsx2': return has('portable.ini') || has('portable.txt') ? path.join(dir, 'bios') : win ? path.join(docs, 'PCSX2', 'bios') : path.join(xdgConfig, 'PCSX2', 'bios');
      case 'melonds': return win ? path.join(dir, 'bios') : path.join(xdgConfig, 'melonDS', 'bios');
      case 'dolphin': return has('portable.txt') ? path.join(dir, 'User', 'GC') : win ? path.join(docs, 'Dolphin Emulator', 'GC') : path.join(xdgData, 'dolphin-emu', 'GC');
      case 'azahar': return fs.existsSync(path.join(dir, 'user')) ? path.join(dir, 'user', 'sysdata') : win ? path.join(appData, 'Azahar', 'sysdata') : path.join(xdgData, 'azahar-emu', 'sysdata');
      case 'cemu': return fs.existsSync(path.join(dir, 'portable')) ? path.join(dir, 'portable') : win ? path.join(appData, 'Cemu') : path.join(xdgData, 'Cemu');
      default: return null;
    }
  }

  function biosInfo(id) {
    const dir = biosDir(id);
    if (!dir || !BIOS_HINTS[id]) return null;
    let files = [];
    try {
      files = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name).sort().slice(0, 30);
    } catch { /* dossier pas encore créé */ }
    return { dir, hint: BIOS_HINTS[id], files };
  }

  // Copie les fichiers choisis dans le dossier des BIOS de l'émulateur.
  async function addBios(id, files) {
    const dir = biosDir(id);
    if (!dir) return { ok: false, error: 'Cet émulateur n’utilise pas de BIOS.' };
    await fsp.mkdir(dir, { recursive: true });
    const copied = [];
    for (const f of files || []) {
      const dest = path.join(dir, path.basename(f));
      await fsp.copyFile(f, dest);
      copied.push(path.basename(f));
    }
    return { ok: true, copied, bios: biosInfo(id) };
  }

  function catalog() {
    const cfg = getConfig();
    const installedStore = new Set(cfg.emulators.map((e) => e.store).filter(Boolean));
    return {
      platform: PLATFORM,
      romsRoot: romsRoot(),
      emulators: EMULATORS.map((e) => ({
        id: e.id,
        name: e.name,
        desc: e.desc,
        site: e.site,
        retroarch: !!e.retroarch,
        available: e.retroarch ? PLATFORM !== 'other' : !!e.source?.[PLATFORM],
        installed: e.retroarch ? !!meta.retroarch : !!meta[e.id],
        version: (e.retroarch ? meta.retroarch?.version : meta[e.id]?.version) || '',
        busy: busy.has(e.id),
        bios: (e.retroarch ? meta.retroarch : meta[e.id]) ? biosInfo(e.id) : null,
        systems: e.systems.map((s) => ({ id: s.id, name: s.name, installed: installedStore.has(`${e.id}:${s.id}`) })),
      })),
      games: FREE_GAMES.map((g) => {
        const target = cfg.emulators.find((e) => String(e.store || '').endsWith(`:${g.system}`));
        const sys = [...RETROARCH_SYSTEMS].find((s) => s.id === g.system);
        const installed = target ? fs.existsSync(path.join(target.romsDir, g.file)) : false;
        return { ...g, systemName: sys ? sys.name : g.system, ready: !!target, installed };
      }),
    };
  }

  async function getGame(id) {
    const g = FREE_GAMES.find((x) => x.id === id);
    if (!g) return { ok: false, error: 'Jeu inconnu.' };
    const target = getConfig().emulators.find((e) => String(e.store || '').endsWith(`:${g.system}`));
    if (!target) return { ok: false, error: 'Installez d’abord la console correspondante.' };
    progress(`game:${id}`, 'download', { label: g.name });
    try {
      await download(g.url, path.join(target.romsDir, g.file), (received, total) => progress(`game:${id}`, 'download', { label: g.name, received, total }));
      progress(`game:${id}`, 'done');
      return { ok: true };
    } catch (err) {
      progress(`game:${id}`, 'error', { message: err.message });
      return { ok: false, error: err.message };
    }
  }

  // Copie vos propres fichiers de jeux dans le dossier d'une console.
  async function importFiles(emuIndex, files) {
    const emu = getConfig().emulators[emuIndex];
    if (!emu || !emu.romsDir) return { ok: false, error: 'Console inconnue ou sans dossier de jeux.' };
    await fsp.mkdir(emu.romsDir, { recursive: true });
    let n = 0;
    for (const f of files || []) {
      try { await fsp.copyFile(f, path.join(emu.romsDir, path.basename(f))); n += 1; } catch { /* fichier illisible */ }
    }
    return { ok: true, count: n, console: emu.name };
  }

  return { catalog, install, uninstall, getGame, importFiles, romsRoot, emuRoot, extract, biosDir, biosInfo, addBios };
}

module.exports = { createStore, EMULATORS, FREE_GAMES, githubLatest, download };
