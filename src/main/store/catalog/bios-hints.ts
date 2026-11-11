/** BIOS : fichiers attendus par chaque émulateur (rappel affiché sur sa carte). */
export const BIOS_HINTS: Readonly<Record<string, string>> = {
  retroarch: 'Selon les consoles : gba_bios.bin (Game Boy Advance), bios_CD_E.bin, bios_CD_U.bin, bios_CD_J.bin (Mega-CD), syscard3.pce (PC Engine CD)…',
  duckstation: 'Le BIOS de votre PlayStation : scph1001.bin, scph5501.bin, scph7001.bin… (obligatoire).',
  pcsx2: 'Le BIOS de votre PlayStation 2, par exemple SCPH-70004.bin (obligatoire).',
  melonds: 'bios7.bin, bios9.bin et firmware.bin (facultatif : melonDS a un BIOS libre intégré). Indiquez-les ensuite dans melonDS, Configuration, Émulation.',
  dolphin: 'IPL.bin de votre GameCube (facultatif), à placer dans le sous-dossier de sa région (EUR, USA, JAP).',
  azahar: 'aes_keys.txt et fichiers système de votre 3DS (facultatif).',
  cemu: 'keys.txt, avec les clés de vos jeux Wii U (pour les jeux chiffrés).',
};
