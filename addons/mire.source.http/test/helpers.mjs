// Contexte de plugin simulé (forme de `PluginContext` du SDK) : `http.request` rend les pages prévues, et refuse comme
// Mire (`src/main/plugins/context.ts`, P5-12) toute adresse hors de celle accordée (origine exacte, sous son chemin).

const apache = (title, links) =>
  `<html><head><title>Index of ${title}</title></head><body><h1>Index of ${title}</h1><table>` +
  `<tr><td><a href="?C=N;O=D">Name</a></td></tr><tr><td><a href="/">Parent Directory</a></td></tr>` +
  links.map((l) => `<tr><td><a href="${l}">${decodeURIComponent(l)}</a></td></tr>`).join('') +
  '</table></body></html>';
const nginx = (title, links) =>
  `<html><head><title>Index of ${title}</title></head><body><h1>Index of ${title}</h1><hr><pre><a href="../">../</a>\n` +
  links.map((l) => `<a href='${l}'>${l}</a>  01-Jan-2026 10:00  1234\n`).join('') +
  '</pre><hr></body></html>';

export const BASE = 'http://192.168.1.10:8080';

/** Pages d'un serveur de NAS (celles des tests du cœur de Mire avant P5-12). */
export const PAGES = {
  '/films/': apache('/films', [
    'Am%C3%A9lie%20(2001).mkv',
    'Am%C3%A9lie%20(2001).jpg',
    'Am%C3%A9lie%20(2001).fr.srt',
    'Am%C3%A9lie%20(2001).en.vtt',
    'fanart.jpg',
    'S%C3%A9rie/',
    'http://ailleurs/x.mkv',
    '/autre/y.mkv',
  ]),
  '/films/S%C3%A9rie/': nginx('/films/Série/', ['S%C3%A9rie%20S01E04.mp4', 'cover.jpg', 'Photo.png', 'Vide/']),
  '/musique/': apache('/musique', ['01%20-%20D%C3%A9but.mp3', 'folder.jpg']),
  '/redirige/': { status: 302, refused: true },
  '/panne/': { status: 500 },
};

function under(url, granted) {
  const u = new URL(url);
  const g = new URL(granted);
  const p = g.pathname;
  return u.origin === g.origin && (u.pathname === p || u.pathname.startsWith(p.endsWith('/') ? p : `${p}/`));
}

const refused = (message) => Object.assign(new Error(message), { code: 'refused' });

export function fakeContext({ granted = [], pages = PAGES, locale = 'fr', down = false } = {}) {
  const asked = [];
  const http = {
    async request(url, options = {}) {
      if (!granted.some((g) => under(url, g))) throw refused(`${new URL(url).hostname} is not declared in permissions.hosts.`);
      asked.push({ url, options });
      if (down) throw Object.assign(new Error('HTTP request failed.'), { code: 'http' });
      const page = pages[new URL(url).pathname];
      if (page === undefined) return { status: 404, headers: {}, text: 'absent' };
      if (typeof page === 'object') {
        if (page.refused) throw refused('ailleurs.example is not declared in permissions.hosts.');
        return { status: page.status, headers: {}, text: '' };
      }
      return { status: 200, headers: { 'content-type': 'text/html' }, text: page };
    },
  };
  return { ctx: { id: 'mire.source.http', version: '1.0.0', locale, http, log: { info() {}, warn() {}, error() {} } }, asked };
}

export const location = (url, kinds = ['video']) => ({ location: url, url, network: false, kinds });
