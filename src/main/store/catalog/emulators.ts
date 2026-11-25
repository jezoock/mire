/**
 * Émulateurs encore dans le cœur, jusqu'à leur extraction en plugins (P5-19b) : PCSX2, PPSSPP, Dolphin, melonDS,
 * Azahar, Cemu. RetroArch et DuckStation viennent de leurs plugins (`mire.emulator.retroarch`,
 * `mire.emulator.duckstation`, P5-19a). Ces données ont la forme d'une contribution `apps` de genre `emulator` et sont
 * lues de la même façon (`read.ts`). Textes : `store.emulators.<id>` (présentation) et `store.bios.<id>` (BIOS).
 */
import { readEmulatorData } from './read.ts';
import type { StoreEmulator } from './types.ts';

const ps2 = 'Sony - PlayStation 2';
const psp = 'Sony - PlayStation Portable';
const gc = 'Nintendo - GameCube';
const wii = 'Nintendo - Wii';
const nds = 'Nintendo - Nintendo DS';
const n3ds = 'Nintendo - Nintendo 3DS';
const wiiu = 'Nintendo - Wii U';

/** Données des émulateurs du cœur, par identifiant, avec leur nom affiché. */
export const BUILTIN_EMULATOR_DATA: readonly { id: string; name: string; data: Record<string, unknown> }[] = [
  {
    id: 'pcsx2',
    name: 'PCSX2',
    data: {
      kind: 'emulator',
      site: 'https://pcsx2.net',
      source: { github: 'PCSX2/pcsx2', files: { windows: '*-windows-x64-Qt.7z', linux: '*-linux-appimage-x64-Qt.AppImage' } },
      program: { windows: 'pcsx2-qt.exe', linux: '*.AppImage' },
      args: ['-batch', '-fullscreen', '{rom}'],
      consoles: [{ id: 'ps2', libretro: ps2, folder: 'PlayStation 2', extensions: ['.iso', '.chd', '.cso', '.gz'] }],
      bios: {
        portable: { markers: ['portable.ini', 'portable.txt'], dir: ['bios'] },
        windows: ['documents', 'PCSX2', 'bios'],
        linux: ['xdgConfig', 'PCSX2', 'bios'],
      },
    },
  },
  {
    id: 'ppsspp',
    name: 'PPSSPP',
    data: {
      kind: 'emulator',
      site: 'https://www.ppsspp.org',
      source: { github: 'hrydgard/ppsspp', files: { windows: '*-Windows-x64.zip', linux: '*-anylinux-x86_64.AppImage' } },
      program: { windows: 'PPSSPPWindows64.exe', linux: '*.AppImage' },
      args: ['--fullscreen', '{rom}'],
      consoles: [{ id: 'psp', libretro: psp, folder: 'PSP', extensions: ['.iso', '.cso', '.pbp', '.chd'] }],
    },
  },
  {
    id: 'dolphin',
    name: 'Dolphin',
    data: {
      kind: 'emulator',
      site: 'https://dolphin-emu.org',
      source: { page: 'https://dolphin-emu.org/download/', links: { windows: 'https://dl.dolphin-emu.org/releases/*/dolphin-*-x64.7z' } },
      program: { windows: 'Dolphin.exe' },
      args: ['-b', '-e', '{rom}'],
      consoles: [
        { id: 'gc', libretro: gc, folder: 'GameCube', extensions: ['.iso', '.gcm', '.rvz', '.ciso', '.gcz'] },
        { id: 'wii', libretro: wii, folder: 'Wii', extensions: ['.wbfs', '.rvz', '.iso'] },
      ],
      bios: {
        portable: { markers: ['portable.txt'], dir: ['User', 'GC'] },
        windows: ['documents', 'Dolphin Emulator', 'GC'],
        linux: ['xdgData', 'dolphin-emu', 'GC'],
      },
    },
  },
  {
    id: 'melonds',
    name: 'melonDS',
    data: {
      kind: 'emulator',
      site: 'https://melonds.kuribo64.net',
      source: { github: 'melonDS-emu/melonDS', files: { windows: '*-windows-x86_64.zip', linux: '*-appimage-x86_64.zip' } },
      program: { windows: 'melonDS.exe', linux: '*.AppImage' },
      args: ['-f', '{rom}'],
      consoles: [{ id: 'nds', libretro: nds, folder: 'Nintendo DS', extensions: ['.nds', '.zip'] }],
      bios: { windows: ['install', 'bios'], linux: ['xdgConfig', 'melonDS', 'bios'] },
    },
  },
  {
    id: 'azahar',
    name: 'Azahar',
    data: {
      kind: 'emulator',
      site: 'https://azahar-emu.org',
      source: { github: 'azahar-emu/azahar', files: { windows: 'azahar-windows-msvc-*.zip' } },
      program: { windows: 'azahar.exe' },
      args: ['{rom}'],
      consoles: [{ id: '3ds', libretro: n3ds, folder: 'Nintendo 3DS', extensions: ['.3ds', '.cci', '.cxi', '.3dsx'] }],
      bios: {
        portable: { markers: ['user'], dir: ['user', 'sysdata'] },
        windows: ['appData', 'Azahar', 'sysdata'],
        linux: ['xdgData', 'azahar-emu', 'sysdata'],
      },
    },
  },
  {
    id: 'cemu',
    name: 'Cemu',
    data: {
      kind: 'emulator',
      site: 'https://cemu.info',
      source: { github: 'cemu-project/Cemu', files: { windows: '*-windows-x64.zip', linux: '*-x86_64.AppImage' } },
      program: { windows: 'Cemu.exe', linux: '*.AppImage' },
      args: ['-f', '-g', '{rom}'],
      consoles: [{ id: 'wiiu', libretro: wiiu, folder: 'Wii U', extensions: ['.wud', '.wux', '.wua', '.rpx'] }],
      bios: { portable: { markers: ['portable'], dir: ['portable'] }, windows: ['appData', 'Cemu'], linux: ['xdgData', 'Cemu'] },
    },
  },
];

export const EMULATORS: readonly StoreEmulator[] = BUILTIN_EMULATOR_DATA.flatMap(({ id, name, data }) => {
  const emu = readEmulatorData({ id, name, texts: { desc: `store.emulators.${id}`, bios: `store.bios.${id}` } }, data);
  if (!emu) throw new Error(`Émulateur du cœur mal décrit : ${id}`);
  return [emu];
});
