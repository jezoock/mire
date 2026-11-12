/**
 * Émulateurs de la boutique. source.github : dépôt officiel, dont on prend la dernière version publiée ;
 * source.page : page de téléchargement où chercher le lien (Dolphin).
 * Données : futur contenu d'un addon (phase 3). Descriptions : catalogues de textes (`store.emulators.<id>`).
 */
import { RETROARCH_SYSTEMS, storeSystem } from './systems.ts';
import type { StoreEmulator } from './types.ts';

export const EMULATORS: readonly StoreEmulator[] = [
  {
    id: 'retroarch',
    name: 'RetroArch',
    site: 'https://www.retroarch.com',
    retroarch: true,
    systems: [...RETROARCH_SYSTEMS],
    exe: { win32: /^retroarch\.exe$/i, linux: /^RetroArch-Linux-x86_64\.AppImage$/ },
  },
  {
    id: 'duckstation',
    name: 'DuckStation',
    site: 'https://www.duckstation.org',
    source: { github: 'stenzek/duckstation', win32: /^duckstation-windows-x64-release\.zip$/, linux: /^DuckStation-x64\.AppImage$/ },
    exe: { win32: /^duckstation-qt-x64-ReleaseLTCG\.exe$/i, linux: /^DuckStation-x64\.AppImage$/ },
    args: ['-batch', '-fullscreen', '{rom}'],
    systems: [storeSystem('ps1', 'Sony - PlayStation', { ext: ['.cue', '.chd', '.m3u', '.pbp', '.iso'] })],
  },
  {
    id: 'pcsx2',
    name: 'PCSX2',
    site: 'https://pcsx2.net',
    source: { github: 'PCSX2/pcsx2', win32: /-windows-x64-Qt\.7z$/, linux: /-linux-appimage-x64-Qt\.AppImage$/ },
    exe: { win32: /^pcsx2-qt\.exe$/i, linux: /\.AppImage$/ },
    args: ['-batch', '-fullscreen', '{rom}'],
    systems: [storeSystem('ps2', 'Sony - PlayStation 2', { ext: ['.iso', '.chd', '.cso', '.gz'] })],
  },
  {
    id: 'ppsspp',
    name: 'PPSSPP',
    site: 'https://www.ppsspp.org',
    source: { github: 'hrydgard/ppsspp', win32: /-Windows-x64\.zip$/, linux: /-anylinux-x86_64\.AppImage$/ },
    exe: { win32: /^PPSSPPWindows64\.exe$/i, linux: /\.AppImage$/ },
    args: ['--fullscreen', '{rom}'],
    systems: [storeSystem('psp', 'Sony - PlayStation Portable', { ext: ['.iso', '.cso', '.pbp', '.chd'] })],
  },
  {
    id: 'dolphin',
    name: 'Dolphin',
    site: 'https://dolphin-emu.org',
    source: { page: 'https://dolphin-emu.org/download/', win32: /https:\/\/dl\.dolphin-emu\.org\/releases\/[\w.-]+\/dolphin-[\w.-]+-x64\.7z/ },
    exe: { win32: /^Dolphin\.exe$/i },
    args: ['-b', '-e', '{rom}'],
    systems: [
      storeSystem('gc', 'Nintendo - GameCube', { ext: ['.iso', '.gcm', '.rvz', '.ciso', '.gcz'] }),
      storeSystem('wii', 'Nintendo - Wii', { ext: ['.wbfs', '.rvz', '.iso'] }),
    ],
  },
  {
    id: 'melonds',
    name: 'melonDS',
    site: 'https://melonds.kuribo64.net',
    source: { github: 'melonDS-emu/melonDS', win32: /-windows-x86_64\.zip$/, linux: /-appimage-x86_64\.zip$/ },
    exe: { win32: /^melonDS\.exe$/i, linux: /\.AppImage$/i },
    args: ['-f', '{rom}'],
    systems: [storeSystem('nds', 'Nintendo - Nintendo DS', { ext: ['.nds', '.zip'] })],
  },
  {
    id: 'azahar',
    name: 'Azahar',
    site: 'https://azahar-emu.org',
    source: { github: 'azahar-emu/azahar', win32: /^azahar-windows-msvc-[\w.]+\.zip$/ },
    exe: { win32: /^azahar\.exe$/i },
    args: ['{rom}'],
    systems: [storeSystem('3ds', 'Nintendo - Nintendo 3DS', { ext: ['.3ds', '.cci', '.cxi', '.3dsx'] })],
  },
  {
    id: 'cemu',
    name: 'Cemu',
    site: 'https://cemu.info',
    source: { github: 'cemu-project/Cemu', win32: /-windows-x64\.zip$/, linux: /-x86_64\.AppImage$/ },
    exe: { win32: /^Cemu\.exe$/i, linux: /\.AppImage$/ },
    args: ['-f', '-g', '{rom}'],
    systems: [storeSystem('wiiu', 'Nintendo - Wii U', { ext: ['.wud', '.wux', '.wua', '.rpx'] })],
  },
];
