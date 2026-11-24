'use strict';
/**
 * Chargé dans le processus principal d'Electron par le test de l'assistant (option -r d'Electron) : coupe le `fetch`
 * de Node pour tout hôte autre que la boucle locale, comme sans connexion. Les dépôts gardent leur index en cache.
 */
const LOOPBACK = /^(127\.|\[::1\]$|localhost$)/;
const real = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (LOOPBACK.test(url.hostname)) return real(input, init);
  throw new TypeError('fetch failed (test sans réseau)');
};
