'use strict';
const path = require('node:path');

/**
 * Vrai si `target` se trouve strictement sous l'un des dossiers `roots`.
 * La racine elle-même est refusée, comme tout chemin relatif ou contenant un segment `..` :
 * un chemin légitime vient d'une lecture de dossier et n'en contient jamais.
 * Sous Windows, la comparaison ignore la casse et accepte les deux séparateurs.
 */
function isInside(target, roots, { platform = process.platform } = {}) {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  if (typeof target !== 'string' || !target || !p.isAbsolute(target)) return false;
  if (target.split(win ? /[\\/]+/ : /\/+/).includes('..')) return false;
  const key = (x) => (win ? p.resolve(x).toLowerCase() : p.resolve(x));
  const t = key(target);
  return (roots || []).some((root) => {
    if (typeof root !== 'string' || !root || !p.isAbsolute(root)) return false;
    const rel = p.relative(key(root), t);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel);
  });
}

module.exports = { isInside };
