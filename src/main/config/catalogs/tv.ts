/**
 * Services pour regarder la télévision, proposés d'office (ils ne sont pas vidés à l'installation).
 * kind « playlist » : liste M3U lue dans Mire ; kind « web » : portail du fournisseur dans la vue intégrée.
 * detect : adresse jointe sur le réseau local au premier lancement pour reconnaître le service en place.
 * Données : futur contenu d'un addon (phase 3).
 */
import type { TvService } from '@mire/shared';

export const DEFAULT_TV: readonly TvService[] = [
  {
    id: 'freebox',
    name: 'Freebox TV',
    kind: 'playlist',
    url: 'http://mafreebox.freebox.fr/freeboxtv/playlist.m3u',
    detect: 'http://mafreebox.freebox.fr/',
    quality: 'hd',
  },
  { id: 'orange', name: 'Orange TV', kind: 'playlist', url: 'http://lafibre.info/images/orange/TV_sur_PC_Orange.m3u', detect: 'http://livebox.home/' },
  { id: 'sfr', name: 'SFR TV', kind: 'web', url: 'https://tv.sfr.fr/', detect: 'http://192.168.1.1/' },
  { id: 'bouygues', name: 'B.tv (Bouygues)', kind: 'web', url: 'https://www.bouyguestelecom.fr/tv-direct/', detect: 'http://mabbox.bytel.fr/' },
  { id: 'molotov', name: 'Molotov', kind: 'web', url: 'https://www.molotov.tv/', detect: '' },
];
