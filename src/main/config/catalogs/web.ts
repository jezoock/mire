/**
 * Sites de streaming connus : rien n'est installé d'office, mais la migration des anciennes configurations
 * complète les sites de l'utilisateur à partir de cette liste (adresse de recherche, lecture en fond, fournisseurs).
 * mode « integrated » : vue web dans Mire ; « browser » : navigateur externe (secours).
 * search : adresse de recherche ({q} = mots cherchés). Vide : à apprendre avec « Mémoriser la recherche ».
 * providers : noms utilisés par TMDB/JustWatch pour ce service (« =nom » : correspondance exacte).
 * background : la lecture continue quand on quitte le site (musique). group : rangement dans Streaming.
 * Données : futur contenu d'un addon (phase 3).
 */
import type { WebSite } from '@mire/shared';

const SITES = [
  {
    id: 'netflix',
    group: 'video',
    name: 'Netflix',
    url: 'https://www.netflix.com/browse',
    color: '#E50914',
    search: 'https://www.netflix.com/search?q={q}',
    providers: ['netflix'],
  },
  {
    id: 'prime',
    group: 'video',
    name: 'Prime Video',
    url: 'https://www.primevideo.com',
    color: '#1A98FF',
    search: 'https://www.primevideo.com/search/ref=atv_nb_sug?ie=UTF8&phrase={q}',
    providers: ['prime video'],
  },
  {
    id: 'disney',
    group: 'video',
    name: 'Disney+',
    url: 'https://www.disneyplus.com/fr-fr',
    color: '#1A3FD8',
    search: '',
    providers: ['disney plus', 'disney+'],
  },
  { id: 'canal', group: 'video', name: 'Canal+', url: 'https://www.canalplus.com', color: '#2B2B2B', search: '', providers: ['canal+', 'canal plus'] },
  { id: 'hbomax', group: 'video', name: 'HBO Max', url: 'https://play.hbomax.com', color: '#4B2BD6', search: '', providers: ['hbo max', '=max'] },
  {
    id: 'appletv',
    group: 'video',
    name: 'Apple TV',
    url: 'https://tv.apple.com/fr',
    color: '#DADADF',
    search: 'https://tv.apple.com/fr/search?term={q}',
    providers: ['apple tv'],
  },
  { id: 'paramount', group: 'video', name: 'Paramount+', url: 'https://www.paramountplus.com/fr/', color: '#0064FF', search: '', providers: ['paramount'] },
  {
    id: 'crunchyroll',
    group: 'video',
    name: 'Crunchyroll',
    url: 'https://www.crunchyroll.com/fr',
    color: '#F47521',
    search: 'https://www.crunchyroll.com/fr/search?q={q}',
    providers: ['crunchyroll'],
  },
  {
    id: 'youtube',
    group: 'video',
    name: 'YouTube',
    url: 'https://www.youtube.com',
    color: '#FF0033',
    search: 'https://www.youtube.com/results?search_query={q}',
    providers: ['youtube'],
  },
  { id: 'francetv', group: 'video', name: 'france.tv', url: 'https://www.france.tv', color: '#3046F0', search: '', providers: ['france tv', 'france.tv'] },
  {
    id: 'amazon-music',
    group: 'music',
    name: 'Amazon Music',
    url: 'https://music.amazon.fr',
    color: '#25D1DA',
    search: 'https://music.amazon.fr/search/{q}',
    background: true,
  },
  {
    id: 'spotify',
    group: 'music',
    name: 'Spotify',
    url: 'https://open.spotify.com',
    color: '#1ED760',
    search: 'https://open.spotify.com/search/{q}',
    background: true,
  },
  {
    id: 'deezer',
    group: 'music',
    name: 'Deezer',
    url: 'https://www.deezer.com/fr/',
    color: '#A238FF',
    search: 'https://www.deezer.com/search/{q}',
    background: true,
  },
  { id: 'juststream', name: 'JustStream', url: 'https://juststream.now/', color: '#8E6CF0', search: '' },
  { id: 'voir-anime', name: 'Voir-Anime', url: 'https://voir-anime.to/', color: '#F28C28', search: '' },
];

export const DEFAULT_WEB: readonly WebSite[] = SITES.map((w) => ({ mode: 'integrated' as const, ...w }));
