'use strict';

function decodeText(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  } // vieux .srt français
}

function srtToVtt(s) {
  return 'WEBVTT\n\n' + s.replace(/\r/g, '').replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
}

const foldText = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

// « Disney Plus » correspond à Disney+, « Paramount+ Amazon Channel » à Paramount+…
// Un alias précédé de « = » doit correspondre exactement (« =max » ne doit pas attraper « Action Max »).
function providerMatches(provider, alias) {
  if (alias.startsWith('=')) return provider === alias.slice(1);
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(provider);
}

// Numéros de saison et d'épisode d'après le nom du fichier (S01E03, 1x03…).
function episodeNumbers(name) {
  const m = /\bS(\d{1,2})\s*E(\d{1,3})\b/i.exec(name) || /\b(\d{1,2})x(\d{2})\b/.exec(name);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : { season: null, episode: null };
}

function cleanRomName(name) {
  // « Super Mario World (Europe) (En,Fr) [!] » → « Super Mario World »
  return (
    name
      .replace(/\s*[([][^)\]]*[)\]]/g, '')
      .replace(/_/g, ' ')
      .trim() || name
  );
}

function similarity(a, b) {
  const x = foldText(a).replace(/[^a-z0-9]/g, '');
  const y = foldText(b).replace(/[^a-z0-9]/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.8;
  return 0;
}

module.exports = { decodeText, srtToVtt, foldText, providerMatches, episodeNumbers, cleanRomName, similarity };
