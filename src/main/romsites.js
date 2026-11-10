'use strict';
/**
 * Sites proposés d'office par « Ajouter des jeux », selon le système de la console.
 * Uniquement des sites qui distribuent des jeux légalement : homebrew, domaine public,
 * jeux récents créés pour ces consoles. La liste de chaque console se modifie dans
 * « Modifier la console » ; on peut y ajouter n'importe quel site.
 *
 * search : adresse de recherche, {q} = mots cherchés (vide : à mémoriser avec la loupe).
 */

// PDRoms : homebrew et domaine public, page de chaque plateforme (adresses vérifiées sur le site).
const PDROMS = {
  'Nintendo - Nintendo Entertainment System': 'nintendo-entertainment-system-nes-famicom',
  'Nintendo - Super Nintendo Entertainment System': 'super-nintendo-snes-super-famicom',
  'Nintendo - Game Boy': 'nintendo-game-boy-gb-gbc',
  'Nintendo - Game Boy Color': 'nintendo-game-boy-gb-gbc',
  'Nintendo - Game Boy Advance': 'nintendo-game-boy-advance-gba',
  'Nintendo - Nintendo 64': 'nintendo-64-n64',
  'Nintendo - Nintendo DS': 'nintendo-ds',
  'Nintendo - Wii': 'nintendo-wii',
  'Sega - Mega Drive - Genesis': 'sega-genesis-megadrive',
  'Sega - Master System - Mark III': 'sega-master-system-sms',
  'Sega - Game Gear': 'sega-game-gear',
  'Sega - Saturn': 'sega-saturn',
  'Sega - Dreamcast': 'sega-dreamcast',
  'NEC - PC Engine - TurboGrafx 16': 'nec-turbografx-16-pc-engine',
  'Sony - PlayStation': 'sony-playstation-ps1',
  'Sony - PlayStation 2': 'sony-playstation-2-ps2',
  'Sony - PlayStation Portable': 'sony-playstation-portable-psp',
  'Atari - 2600': 'atari-2600',
  'SNK - Neo Geo Pocket Color': 'snk-neo-geo-pocket-ngp-ngpc',
};

// Homebrew Hub (gbdev) : paramètres « q » et « platform » relevés dans le code du site.
const HOMEBREW_HUB = {
  'Nintendo - Game Boy': 'GB',
  'Nintendo - Game Boy Color': 'GBC',
  'Nintendo - Game Boy Advance': 'GBA',
  'Nintendo - Nintendo Entertainment System': 'NES',
};

// Universal-DB : homebrew Nintendo DS et 3DS.
const UNIVERSAL_DB = { 'Nintendo - Nintendo DS': 'ds', 'Nintendo - Nintendo 3DS': '3ds' };

// itch.io : nombreux jeux récents pour consoles rétro, gratuits ou vendus par leurs auteurs.
const ITCH_WORDS = {
  'Nintendo - Nintendo Entertainment System': 'nes',
  'Nintendo - Super Nintendo Entertainment System': 'snes',
  'Nintendo - Game Boy': 'game boy',
  'Nintendo - Game Boy Color': 'game boy color',
  'Nintendo - Game Boy Advance': 'gba',
  'Nintendo - Nintendo 64': 'n64',
  'Sega - Mega Drive - Genesis': 'mega drive',
  'Sega - Master System - Mark III': 'master system',
  'Sega - Game Gear': 'game gear',
  'NEC - PC Engine - TurboGrafx 16': 'pc engine',
  'Atari - 2600': 'atari 2600',
};

function defaultRomSites(system) {
  const sites = [];
  if (HOMEBREW_HUB[system]) {
    const p = HOMEBREW_HUB[system];
    sites.push({ name: 'Homebrew Hub', url: `https://hh.gbdev.io/search?platform=${p}&typetag=game`, search: `https://hh.gbdev.io/search?q={q}&platform=${p}&typetag=game` });
  }
  if (UNIVERSAL_DB[system]) {
    sites.push({ name: 'Universal-DB', url: `https://db.universal-team.net/${UNIVERSAL_DB[system]}`, search: '' });
  }
  if (PDROMS[system]) {
    sites.push({ name: 'PDRoms', url: `https://pdroms.de/files/${PDROMS[system]}/`, search: 'https://pdroms.de/?s={q}' });
  }
  if (ITCH_WORDS[system]) {
    const w = encodeURIComponent(ITCH_WORDS[system]).replace(/%20/g, '+');
    sites.push({ name: 'itch.io', url: `https://itch.io/search?q=${w}+rom`, search: `https://itch.io/search?q={q}+${w}` });
  }
  return sites;
}

// Fichiers de jeux : un lien vers l'un d'eux, ouvert dans une nouvelle fenêtre, devient un téléchargement.
const GAME_FILE_RE = /\.(zip|7z|iso|chd|cue|bin|cso|pbp|rvz|wbfs|wud|wux|gcm|ciso|nes|fds|sfc|smc|gb|gbc|gba|n64|z64|v64|md|gen|smd|sms|gg|pce|nds|3ds|cia|cci|3dsx|a26)$/i;

module.exports = { defaultRomSites, GAME_FILE_RE };
