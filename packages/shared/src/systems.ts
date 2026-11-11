// Référentiel des systèmes de jeu (consoles). L'identifiant est le nom libretro du système : c'est lui qui sert à
// trouver les jaquettes et les genres, et c'est sous lui que sont rangées les correspondances propres à chaque
// usage (cœurs RetroArch dans la boutique, sites de jeux dans romsites).

/** Expression qui reconnaît le système dans le nom d'une console ou de son programme. */
export interface SystemAlias {
  pattern: RegExp;
  /**
   * Ordre d'essai, tous systèmes confondus : la première expression qui correspond l'emporte. L'ordre ne suit pas
   * celui des systèmes : « dolphin » (GameCube) n'est essayé qu'après « wii », sinon une console « Wii » lancée
   * par Dolphin serait rangée en GameCube.
   */
  priority: number;
}

export interface GameSystem {
  /** Nom libretro (« Nintendo - Game Boy »). */
  id: string;
  /** Nom court affiché (« Game Boy »). */
  name: string;
  /** Extensions propres au système, en minuscules : elles suffisent à le reconnaître. */
  extensions: readonly string[];
  aliases: readonly SystemAlias[];
}

const alias = (pattern: RegExp, priority: number): SystemAlias => ({ pattern, priority });

export const SYSTEMS: readonly GameSystem[] = [
  {
    id: 'Nintendo - Nintendo Entertainment System',
    name: 'NES',
    extensions: ['.nes', '.fds', '.unf'],
    aliases: [alias(/\bnes\b|famicom/i, 16)],
  },
  {
    id: 'Nintendo - Super Nintendo Entertainment System',
    name: 'Super Nintendo',
    extensions: ['.sfc', '.smc'],
    aliases: [alias(/super\s*nintendo|snes/i, 10)],
  },
  { id: 'Nintendo - Game Boy', name: 'Game Boy', extensions: ['.gb'], aliases: [alias(/game\s*boy|\bgb\b/i, 15)] },
  {
    id: 'Nintendo - Game Boy Color',
    name: 'Game Boy Color',
    extensions: ['.gbc'],
    aliases: [alias(/game\s*boy\s*color|\bgbc\b/i, 14)],
  },
  {
    id: 'Nintendo - Game Boy Advance',
    name: 'Game Boy Advance',
    extensions: ['.gba'],
    aliases: [alias(/game\s*boy\s*advance|\bgba\b/i, 13)],
  },
  {
    id: 'Nintendo - Nintendo 64',
    name: 'Nintendo 64',
    extensions: ['.n64', '.z64', '.v64'],
    aliases: [alias(/nintendo\s*64|\bn64\b/i, 12)],
  },
  { id: 'Nintendo - Nintendo DS', name: 'Nintendo DS', extensions: ['.nds'], aliases: [] },
  { id: 'Nintendo - Nintendo 3DS', name: 'Nintendo 3DS', extensions: ['.3ds', '.cci', '.cxi'], aliases: [] },
  {
    id: 'Nintendo - GameCube',
    name: 'GameCube',
    extensions: [],
    aliases: [alias(/gamecube|\bgc\b/i, 4), alias(/dolphin/i, 7)],
  },
  { id: 'Nintendo - Wii', name: 'Wii', extensions: [], aliases: [alias(/\bwii\b/i, 6)] },
  { id: 'Nintendo - Wii U', name: 'Wii U', extensions: [], aliases: [alias(/\bwii\s*u\b|cemu/i, 5)] },
  {
    id: 'Sega - Mega Drive - Genesis',
    name: 'Mega Drive',
    extensions: ['.md', '.gen', '.smd'],
    aliases: [alias(/mega\s*drive|genesis/i, 11)],
  },
  { id: 'Sega - Master System - Mark III', name: 'Master System', extensions: ['.sms'], aliases: [] },
  { id: 'Sega - Game Gear', name: 'Game Gear', extensions: ['.gg'], aliases: [] },
  { id: 'Sega - Saturn', name: 'Saturn', extensions: [], aliases: [alias(/saturn/i, 9)] },
  { id: 'Sega - Dreamcast', name: 'Dreamcast', extensions: [], aliases: [alias(/dreamcast|flycast/i, 8)] },
  {
    id: 'Sony - PlayStation',
    name: 'PlayStation',
    extensions: [],
    aliases: [alias(/duckstation|playstation(?!\s*[2p])|\bps1\b|psx/i, 1)],
  },
  {
    id: 'Sony - PlayStation 2',
    name: 'PlayStation 2',
    extensions: [],
    aliases: [alias(/pcsx2|playstation\s*2|\bps2\b/i, 2)],
  },
  { id: 'Sony - PlayStation Portable', name: 'PSP', extensions: [], aliases: [alias(/ppsspp|\bpsp\b/i, 3)] },
  { id: 'NEC - PC Engine - TurboGrafx 16', name: 'PC Engine', extensions: ['.pce'], aliases: [] },
  { id: 'Atari - 2600', name: 'Atari 2600', extensions: ['.a26'], aliases: [] },
  { id: 'SNK - Neo Geo Pocket Color', name: 'Neo Geo Pocket Color', extensions: [], aliases: [] },
];

const BY_ID = new Map(SYSTEMS.map((s) => [s.id, s]));

/** Système d'après son identifiant libretro. */
export const systemById = (id: unknown): GameSystem | undefined => BY_ID.get(String(id));

const NAME_RULES = SYSTEMS.flatMap((s) => s.aliases.map((a) => ({ ...a, id: s.id }))).sort((a, b) => a.priority - b.priority);

/** Ce dont `guessSystem` a besoin d'une console. */
export interface SystemHint {
  system?: string;
  name?: string;
  path?: string;
  extensions?: readonly unknown[];
}

/**
 * Devine le système libretro d'une console : celui choisi par l'utilisateur, sinon d'après son nom ou son
 * programme, sinon d'après ses extensions. Chaîne vide si rien n'est reconnaissable.
 */
export function guessSystem(emu: SystemHint): string {
  if (emu.system) return emu.system;
  const label = `${emu.name} ${emu.path}`;
  for (const rule of NAME_RULES) if (rule.pattern.test(label)) return rule.id;
  for (const ext of emu.extensions || []) {
    const lower = String(ext).toLowerCase();
    const found = SYSTEMS.find((s) => s.extensions.some((e) => lower.endsWith(e)));
    if (found) return found.id;
  }
  return '';
}
