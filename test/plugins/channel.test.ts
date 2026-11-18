// Canal de requêtes de l'hôte de plugins (ADR 0002, « Échanges ») : réponse, erreur, délai, annulation, hôte disparu,
// méthodes refusées ; runtime d'un plugin chargé par ce canal.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { adaptPort, callableMethod, createChannel, type Channel, type RequestHandler } from '../../src/main/plugins/channel.ts';
import { startRuntime } from '../../src/main/plugins/runtime.ts';

const opened: Channel[] = [];
after(() => opened.forEach((c) => c.close()));

function pair(handle?: RequestHandler, options: { timeout?: number; onEvent?: (n: string, d: unknown) => void } = {}) {
  const { port1, port2 } = new MessageChannel();
  const a = createChannel(adaptPort(port1), { timeout: options.timeout ?? 1000 });
  const b = createChannel(adaptPort(port2), { handle, onEvent: options.onEvent });
  opened.push(a, b);
  return { a, b };
}

const code = (err: unknown) => (err as { code: string }).code;

describe('canal', () => {
  it('rend la valeur ou l’erreur du traitant', async () => {
    const { a } = pair((target, method, args) => {
      if (method === 'boom') throw Object.assign(new Error('raté'), { code: 'x' });
      return { target, method, args };
    });
    assert.deepEqual(await a.request('cible', 'm', [1, 'deux']), { target: 'cible', method: 'm', args: [1, 'deux'] });
    await assert.rejects(a.request('cible', 'boom'), (e) => code(e) === 'x' && (e as Error).message === 'raté');
  });

  it('abandonne après le délai et prévient le traitant', async () => {
    let aborted = false;
    const { a } = pair((_t, _m, _a, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve((aborted = true)))));
    await assert.rejects(a.request('c', 'lent', [], { timeout: 30 }), (e) => code(e) === 'timeout');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(aborted, true);
  });

  it('annule à la demande', async () => {
    const { a } = pair(() => new Promise(() => {}));
    const ctrl = new AbortController();
    const p = a.request('c', 'jamais', [], { signal: ctrl.signal, timeout: 0 });
    ctrl.abort();
    await assert.rejects(p, (e) => code(e) === 'cancelled');
  });

  it('fait échouer les requêtes en attente quand l’autre côté disparaît (host-gone)', async () => {
    const { a } = pair(() => new Promise(() => {}));
    const p = a.request('c', 'jamais', [], { timeout: 0 });
    assert.equal(a.pending(), 1);
    a.breakOff('Hôte arrêté.');
    await assert.rejects(p, (e) => code(e) === 'host-gone');
    await assert.rejects(a.request('c', 'apres'), (e) => code(e) === 'host-gone');
  });

  it('transmet les événements', async () => {
    const seen: unknown[] = [];
    const { a } = pair(undefined, { onEvent: (n, d) => seen.push([n, d]) });
    a.event('log', { message: 'bonjour' });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen, [['log', { message: 'bonjour' }]]);
  });

  it('refuse les méthodes héritées, privées ou absentes', () => {
    const o = { id: 'x', compute: () => 1, _secret: () => 2, notFn: 3 };
    assert.equal(typeof callableMethod(o, 'compute'), 'function');
    for (const name of ['_secret', 'constructor', 'toString', 'hasOwnProperty', '__proto__', 'notFn', 'absente'])
      assert.equal(callableMethod(o, name), null, name);
  });
});

describe('runtime d’un plugin', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mire-runtime-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    path.join(dir, 'tags.mjs'),
    `export default (ctx) => ({ id: 'annee', compute(e) { if (e.name === 'boom') throw new Error('boum'); return /(\\d{4})/.test(e.name) ? { tags: ['dated'], infos: { year: Number(RegExp.$1) } } : null; }, _cache: () => 1, async ask() { return ctx.http.getJson('https://x'); }, note() { ctx.log.info('note', { a: 1 }); return ctx.settings.get('mode'); } });\n`,
  );
  writeFileSync(path.join(dir, 'mauvais.mjs'), `export default () => ({ id: 'autre' });\n`);
  const base = pathToFileURL(dir + path.sep).href;
  const plugin = (main = 'tags.mjs', id = 'annee') => ({
    id: 'org.exemple.annee',
    version: '1.0.0',
    locale: 'fr',
    base,
    contributions: [{ kind: 'taggers', id, main }],
    settings: { mode: 'strict' },
  });

  function start() {
    const { port1, port2 } = new MessageChannel();
    const logs: unknown[] = [];
    const main = createChannel(adaptPort(port1), { timeout: 2000, onEvent: (n, d) => n === 'log' && logs.push(d) });
    const runtime = startRuntime(adaptPort(port2), (url) => import(url));
    opened.push(main, runtime);
    return { main, logs };
  }

  it('charge le plugin, calcule un lot, appelle une méthode, refuse le reste', async () => {
    const { main, logs } = start();
    assert.equal(await main.request('runtime', 'ping'), 'pong');
    assert.deepEqual(await main.request('runtime', 'load', [plugin()]), ['taggers/annee']);
    assert.deepEqual(await main.request('runtime', 'computeBatch', ['taggers/annee', [{ name: 'Film 1999' }, { name: 'sans date' }]]), [
      { tags: ['dated'], infos: { year: 1999 } },
      null,
    ]);
    assert.equal(await main.request('taggers/annee', 'note'), 'strict');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(logs, [{ level: 'info', message: 'note', details: [{ a: 1 }] }]);
    await assert.rejects(main.request('taggers/annee', '_cache'), (e) => code(e) === 'not-found');
    await assert.rejects(main.request('taggers/annee', 'constructor'), (e) => code(e) === 'not-found');
    await assert.rejects(main.request('taggers/autre', 'compute'), (e) => code(e) === 'not-found');
    // Contexte pas encore disponible (P3-04) : erreur claire.
    await assert.rejects(main.request('taggers/annee', 'ask'), (e) => code(e) === 'not-available' && /P3-04/.test((e as Error).message));
    // Une exception du plugin remonte en plugin-error.
    await assert.rejects(main.request('runtime', 'computeBatch', ['taggers/annee', [{ name: 'boom' }]]), (e) => code(e) === 'plugin-error');
  });

  it('refuse une contribution qui ne porte pas l’identifiant déclaré', async () => {
    const { main } = start();
    await assert.rejects(main.request('runtime', 'load', [plugin('mauvais.mjs', 'annee')]), /identifiant « annee »/);
  });
});
