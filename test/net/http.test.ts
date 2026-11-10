// Client HTTP du processus principal, contre un serveur node:http local (aucune requête vers Internet).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as http from '../../src/main/net/http.ts';

type Route = (req: IncomingMessage, res: ServerResponse) => void;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const routes: Record<string, Route> = {
  '/texte': (_req, res) => res.end('bonjour'),
  '/json': (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ua: req.headers['user-agent'] ?? null, accept: req.headers.accept ?? null, method: req.method }));
  },
  '/echo': (req, res) => res.end(JSON.stringify({ ua: req.headers['user-agent'] ?? null, method: req.method, x: req.headers['x-essai'] ?? null })),
  '/absent': (_req, res) => {
    res.statusCode = 404;
    res.end('introuvable');
  },
  '/panne': (_req, res) => {
    res.statusCode = 500;
    res.end('panne');
  },
  '/lent': (_req, res) => {
    setTimeout(() => res.end('trop tard'), 2000).unref();
  },
  '/corps-lent': (_req, res) => {
    res.setHeader('content-length', '20');
    res.write('début');
    setTimeout(() => res.end('…fin'), 2000).unref();
  },
  '/fichier': async (_req, res) => {
    const part = Buffer.alloc(1000, 'a');
    res.setHeader('content-length', String(part.length * 3));
    for (let i = 0; i < 3; i++) {
      res.write(part);
      if (i < 2) await wait(250);
    }
    res.end();
  },
  '/coupure': (req, res) => {
    res.setHeader('content-length', '100000');
    res.write(Buffer.alloc(1000, 'b'));
    setTimeout(() => req.socket.destroy(), 50).unref();
  },
};

let server: ReturnType<typeof createServer>;
let base = '';
let closedPort = 0;
let dir = '';

before(async () => {
  server = createServer((req, res) => {
    const route = routes[new URL(req.url || '/', 'http://x').pathname];
    if (route) route(req, res);
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Un port libéré aussitôt : personne n'y répond.
  const tmp = createServer();
  await new Promise<void>((resolve) => tmp.listen(0, '127.0.0.1', resolve));
  closedPort = (tmp.address() as AddressInfo).port;
  await new Promise((resolve) => tmp.close(resolve));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-http-'));
});

after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function rejectsWith(promise: Promise<unknown>, kind: string, message: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof http.HttpError, String(err));
    assert.equal(err.kind, kind);
    assert.equal(err.message, message);
    return true;
  });
}

describe('request', () => {
  it("envoie l'identité de Mire par défaut", async () => {
    const res = await http.request(`${base}/echo`);
    assert.deepEqual(await res.json(), { ua: 'Mire/1.0 (lecteur multimédia personnel)', method: 'GET', x: null });
  });

  it('accepte des en-têtes, une méthode et une autre identité', async () => {
    const res = await http.request(`${base}/echo`, { method: 'POST', userAgent: 'Autre', headers: { 'x-essai': 'oui' } });
    assert.deepEqual(await res.json(), { ua: 'Autre', method: 'POST', x: 'oui' });
  });

  it('rend la réponse quel que soit son code', async () => {
    const res = await http.request(`${base}/panne`);
    assert.equal(res.status, 500);
  });

  it('délai dépassé : message « met trop de temps à répondre »', async () => {
    await rejectsWith(http.request(`${base}/lent`, { timeout: 100 }), 'timeout', '127.0.0.1 met trop de temps à répondre.');
  });

  it('serveur injoignable : message « Impossible de joindre »', async () => {
    await rejectsWith(
      http.request(`http://127.0.0.1:${closedPort}/`, { timeout: 2000 }),
      'unreachable',
      'Impossible de joindre 127.0.0.1. Vérifiez la connexion Internet.',
    );
  });

  it("annulation par le signal de l'appelant", async () => {
    const ctrl = new AbortController();
    const pending = http.request(`${base}/lent`, { signal: ctrl.signal, timeout: 5000 });
    setTimeout(() => ctrl.abort(), 50);
    await rejectsWith(pending, 'aborted', 'Requête annulée.');
  });

  it('utilise le fetch fourni (session des sites)', async () => {
    const seen: Array<{ url: string; ua: string | null }> = [];
    const fake: http.FetchLike = async (url, init) => {
      seen.push({ url, ua: new Headers(init?.headers).get('user-agent') });
      return new Response('session');
    };
    const text = await http.getText('https://exemple.fr/index', { fetch: fake, userAgent: null });
    assert.equal(text, 'session');
    assert.deepEqual(seen, [{ url: 'https://exemple.fr/index', ua: null }]);
  });
});

describe('head', () => {
  it('envoie une requête HEAD', async () => {
    const res = await http.head(`${base}/echo`);
    assert.equal(res.ok, true);
    assert.equal(await res.text(), '');
  });
});

describe('getText', () => {
  it('rend le texte', async () => {
    assert.equal(await http.getText(`${base}/texte`), 'bonjour');
  });

  it("code d'erreur : message « a répondu avec le code »", async () => {
    await rejectsWith(http.getText(`${base}/panne`), 'status', '127.0.0.1 a répondu avec le code 500');
  });

  it('délai dépassé pendant la lecture du corps', async () => {
    await rejectsWith(http.getText(`${base}/corps-lent`, { timeout: 200 }), 'timeout', '127.0.0.1 met trop de temps à répondre.');
  });
});

describe('getBuffer', () => {
  it('rend le contenu brut', async () => {
    assert.deepEqual(await http.getBuffer(`${base}/texte`), Buffer.from('bonjour'));
  });
});

describe('getJson', () => {
  it('envoie accept: application/json et rend le JSON', async () => {
    assert.deepEqual(await http.getJson(`${base}/json`), { ua: 'Mire/1.0 (lecteur multimédia personnel)', accept: 'application/json', method: 'GET' });
  });

  it('404 → null avec notFoundAsNull', async () => {
    assert.equal(await http.getJson(`${base}/absent`, { notFoundAsNull: true }), null);
  });

  it('404 → erreur sans notFoundAsNull', async () => {
    await rejectsWith(http.getJson(`${base}/absent`), 'status', '127.0.0.1 a répondu avec le code 404');
  });

  it('JSON invalide : erreur de lecture rendue telle quelle', async () => {
    await assert.rejects(http.getJson(`${base}/texte`), SyntaxError);
  });
});

describe('downloadToFile', () => {
  it('écrit le fichier, signale la progression et ne laisse pas de .part', async () => {
    const dest = path.join(dir, 'sous-dossier', 'fichier.bin');
    const calls: Array<[number, number]> = [];
    const out = await http.downloadToFile(`${base}/fichier`, dest, { onProgress: (r, t) => calls.push([r, t]) });
    assert.equal(out, dest);
    assert.equal(fs.statSync(dest).size, 3000);
    assert.equal(fs.existsSync(`${dest}.part`), false);
    assert.ok(calls.length >= 2, JSON.stringify(calls));
    assert.ok(calls.every(([, t]) => t === 3000));
    assert.deepEqual(calls.at(-1), [3000, 3000]);
    const received = calls.map(([r]) => r);
    assert.deepEqual(
      received,
      [...received].sort((a, b) => a - b),
    );
  });

  it("code d'erreur : message « Téléchargement impossible » et aucun fichier", async () => {
    const dest = path.join(dir, 'absent.bin');
    await rejectsWith(http.downloadToFile(`${base}/absent`, dest), 'status', 'Téléchargement impossible : 127.0.0.1 a répondu avec le code 404.');
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(`${dest}.part`), false);
  });

  it('connexion coupée en cours de route : .part supprimé', async () => {
    const dest = path.join(dir, 'coupure.bin');
    await assert.rejects(http.downloadToFile(`${base}/coupure`, dest));
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(`${dest}.part`), false);
  });

  it('délai dépassé en cours de route : .part supprimé', async () => {
    const dest = path.join(dir, 'lent.bin');
    await rejectsWith(http.downloadToFile(`${base}/corps-lent`, dest, { timeout: 200 }), 'timeout', '127.0.0.1 met trop de temps à répondre.');
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(`${dest}.part`), false);
  });

  it("le fichier existant n'est remplacé qu'une fois le téléchargement terminé", async () => {
    const dest = path.join(dir, 'existant.bin');
    fs.writeFileSync(dest, 'ancien');
    await assert.rejects(http.downloadToFile(`${base}/coupure`, dest));
    assert.equal(fs.readFileSync(dest, 'utf8'), 'ancien');
  });
});

describe('rateLimited', () => {
  it('espace les tâches lancées en même temps', async () => {
    const limit = http.rateLimited('essai-espacement', 100);
    const t0 = Date.now();
    const starts = await Promise.all([1, 2, 3].map(() => limit(async () => Date.now() - t0)));
    assert.ok(starts[0] < 50, String(starts));
    assert.ok(starts[1] >= 95, String(starts));
    assert.ok(starts[2] >= 195, String(starts));
  });

  it('partage le débit entre les limiteurs de même clé', async () => {
    const a = http.rateLimited('essai-partage', 100);
    const b = http.rateLimited('essai-partage', 100);
    const t0 = Date.now();
    await a(async () => null);
    await b(async () => null);
    assert.ok(Date.now() - t0 >= 95);
  });

  it('les clés différentes sont indépendantes', async () => {
    const a = http.rateLimited('essai-cle-a', 1000);
    const b = http.rateLimited('essai-cle-b', 1000);
    const t0 = Date.now();
    await a(async () => null);
    await b(async () => null);
    assert.ok(Date.now() - t0 < 500);
  });

  it('rend le résultat de la tâche', async () => {
    assert.equal(await http.rateLimited('essai-resultat', 10)(async () => 42), 42);
  });
});
