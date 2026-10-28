#!/usr/bin/env node
'use strict';
/**
 * Signature VMP de castLabs (service EVS, gratuit) : Netflix et Prime Video l'exigent
 * sous Windows et macOS pour accepter de lire leurs vidéos. Inutile sous Linux.
 *
 *   npm run drm:compte     création du compte EVS (une seule fois)
 *   npm run drm:connexion  reconnexion au compte (nouvel ordinateur, jetons expirés)
 *   npm run drm:signer     signature du moteur utilisé par « npm start »
 *
 * Utilisé aussi par electron-builder (afterPack) pour signer l'application installable.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function findPython() {
  const candidates = process.platform === 'win32'
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]];
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '--version'], { encoding: 'utf8' });
    if (r.status === 0 && /Python 3/.test(`${r.stdout || ''}${r.stderr || ''}`)) return { cmd, pre };
  }
  return null;
}

function run(py, args, interactive = true) {
  const r = spawnSync(py.cmd, [...py.pre, ...args], { stdio: interactive ? 'inherit' : ['ignore', 'inherit', 'inherit'] });
  return r.status === 0;
}

function ensureEvs(py) {
  if (spawnSync(py.cmd, [...py.pre, '-c', 'import castlabs_evs'], { stdio: 'ignore' }).status === 0) return true;
  console.log('Installation du client castLabs EVS (module Python « castlabs-evs »)…');
  return run(py, ['-m', 'pip', 'install', '--user', '--upgrade', 'castlabs-evs']);
}

function electronDist() {
  require('electron'); // télécharge le moteur s'il n'est pas encore là
  return path.join(path.dirname(require.resolve('electron/package.json')), 'dist');
}

function prepare() {
  const py = findPython();
  if (!py) {
    console.error('Python 3 est introuvable. Installez-le depuis https://www.python.org (sous Windows, cochez « Add python.exe to PATH »), puis relancez la commande.');
    return null;
  }
  return ensureEvs(py) ? py : null;
}

function cli() {
  const action = process.argv[2] || 'signer';
  if (process.platform === 'linux') {
    console.log('Sous Linux, Widevine ne demande pas de signature : rien à faire.');
    return 0;
  }
  const py = prepare();
  if (!py) return 1;
  if (action === 'compte') return run(py, ['-m', 'castlabs_evs.account', 'signup']) ? 0 : 1;
  if (action === 'connexion') return run(py, ['-m', 'castlabs_evs.account', 'reauth']) ? 0 : 1;
  if (action === 'signer') {
    const dist = electronDist();
    console.log(`Signature de ${dist}`);
    const ok = run(py, ['-m', 'castlabs_evs.vmp', 'sign-pkg', dist]);
    console.log(ok ? 'Signature terminée. Relancez Mire avec npm start.' : 'La signature a échoué. Vérifiez votre compte avec npm run drm:connexion.');
    return ok ? 0 : 1;
  }
  console.error(`Action inconnue : ${action} (compte, connexion ou signer).`);
  return 1;
}

// Crochet electron-builder : signe l'application après l'empaquetage (sans signature de code Windows).
async function afterPack(context) {
  if (context.electronPlatformName === 'linux') return;
  const py = prepare();
  const ok = py && run(py, ['-m', 'castlabs_evs.vmp', '--no-ask', 'sign-pkg', context.appOutDir], false);
  if (!ok) {
    console.warn('\n  Attention : l’application n’a pas reçu de signature VMP. Netflix et Prime Video risquent de refuser la lecture.');
    console.warn('  Lancez « npm run drm:connexion », puis refaites « npm run dist ».\n');
  }
}

module.exports = afterPack;
module.exports.default = afterPack;

if (require.main === module) process.exit(cli());
