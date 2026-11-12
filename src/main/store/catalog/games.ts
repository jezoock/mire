/** Jeux homebrew publiés librement par leurs auteurs (téléchargés depuis leurs dépôts officiels). */
import type { FreeGame } from './types.ts';

export const FREE_GAMES: readonly FreeGame[] = [
  {
    id: 'nova',
    name: 'Nova the Squirrel',
    system: 'nes',
    author: 'NovaSquirrel',
    url: 'https://github.com/NovaSquirrel/NovaTheSquirrel/releases/latest/download/nova.nes',
    file: 'Nova the Squirrel.nes',
  },
  {
    id: 'thwaite',
    name: 'Thwaite',
    system: 'nes',
    author: 'Damian Yerrick',
    url: 'https://github.com/pinobatch/thwaite-nes/releases/latest/download/thwaite.nes',
    file: 'Thwaite.nes',
  },
  {
    id: 'croom',
    name: 'Concentration Room',
    system: 'nes',
    author: 'Damian Yerrick',
    url: 'https://github.com/pinobatch/croom-nes/releases/latest/download/croom.nes',
    file: 'Concentration Room.nes',
  },
  {
    id: 'libbet',
    name: 'Libbet and the Magic Floor',
    system: 'gb',
    author: 'Damian Yerrick',
    url: 'https://github.com/pinobatch/libbet/releases/latest/download/libbet.gb',
    file: 'Libbet and the Magic Floor.gb',
  },
  {
    id: 'ucity',
    name: 'µCity',
    system: 'gbc',
    author: 'Antonio Niño Díaz',
    url: 'https://github.com/AntonioND/ucity/releases/latest/download/ucity.gbc',
    file: 'uCity.gbc',
  },
  {
    id: 'cavestory',
    name: 'Cave Story',
    system: 'md',
    author: 'andwn',
    basedOn: 'Daisuke Amaya',
    url: 'https://github.com/andwn/cave-story-md/releases/latest/download/doukutsu-fr.gen',
    file: 'Cave Story (France).gen',
  },
];
