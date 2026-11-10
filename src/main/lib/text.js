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

// « Disney Plus » correspond à Disney+, « Paramount+ Amazon Channel » à Paramount+…
// Un alias précédé de « = » doit correspondre exactement (« =max » ne doit pas attraper « Action Max »).
function providerMatches(provider, alias) {
  if (alias.startsWith('=')) return provider === alias.slice(1);
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(provider);
}

module.exports = { decodeText, srtToVtt, providerMatches };
