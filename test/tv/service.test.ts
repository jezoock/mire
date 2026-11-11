// Télévision (P1-15) : détection de la box et chaînes du service actif, sur un serveur HTTP local (127.0.0.1)
// qui répond, puis sur une adresse où plus rien ne répond.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Config, TvService, TvSettings } from '@mire/shared';
import { createTv, detectTvService } from '../../src/main/tv/index.ts';
import * as http from '../../src/main/net/http.ts';

const freebox = readFileSync(new URL('../fixtures/tv/freebox.m3u', import.meta.url), 'utf8');

const server = createServer((req, res) => {
  if (req.url === '/') res.writeHead(200).end('box');
  else if (req.url === '/freeboxtv/playlist.m3u') res.writeHead(200).end(freebox);
  else if (req.url === '/vide.m3u') res.writeHead(200).end('#EXTM3U\n');
  else res.writeHead(404).end('absent');
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// Port libéré : plus rien n'y répond (connexion refusée).
const dead = await new Promise<string>((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    s.close(() => resolve(url));
  });
});
test.after(() => server.close());

const svc = (id: string, kind: TvService['kind'], url: string, detect = ''): TvService => ({ id, name: id.toUpperCase(), kind, url, detect });

// Configuration en mémoire, avec les seules méthodes dont le service a besoin.
function fakeConfig(tv: TvSettings) {
  let cfg = { tv } as Config;
  return {
    get: () => cfg,
    update(fn: (c: Config) => Config | void) {
      cfg = fn(cfg) || cfg;
      return cfg;
    },
  };
}

function setup(services: TvService[], active = '', detected = false) {
  const config = fakeConfig({ services, active, detected });
  const sent: [string, unknown][] = [];
  const tv = createTv({ config: config as never, http, toUi: (channel, payload) => sent.push([channel, payload]) });
  return { tv, config, sent };
}

test.describe('détection de la box', () => {
  test('la première box qui répond donne le service ; celles sans adresse de détection sont sautées', async () => {
    const services = [svc('molotov', 'web', 'https://m/'), svc('orange', 'playlist', '', `${dead}/`), svc('freebox', 'playlist', '', `${base}/`)];
    assert.equal(await detectTvService(services, http), 'freebox');
  });

  test('aucune box ne répond : chaîne vide', async () => {
    assert.equal(await detectTvService([svc('freebox', 'playlist', '', `${dead}/`)], http), '');
  });

  test('une box qui répond par une erreur HTTP compte comme présente', async () => {
    assert.equal(await detectTvService([svc('sfr', 'web', '', `${base}/inconnu`)], http), 'sfr');
  });

  test('premier lancement : service choisi, interface prévenue, une seule fois', async () => {
    const { tv, config, sent } = setup([svc('freebox', 'playlist', '', `${base}/`)]);
    await tv.detectOnce();
    assert.deepEqual(config.get().tv, { services: config.get().tv.services, active: 'freebox', detected: true });
    assert.deepEqual(sent, [['tv-detected', { id: 'freebox', name: 'FREEBOX' }]]);
    config.update((c) => ({ ...c, tv: { ...c.tv, active: '' } }));
    await tv.detectOnce();
    assert.equal(config.get().tv.active, '');
    assert.equal(sent.length, 1);
  });

  test('premier lancement sans box : le choix précédent est gardé, rien n’est envoyé', async () => {
    const { tv, config, sent } = setup([svc('freebox', 'playlist', '', `${dead}/`)], 'orange');
    await tv.detectOnce();
    assert.equal(config.get().tv.active, 'orange');
    assert.equal(config.get().tv.detected, true);
    assert.deepEqual(sent, []);
  });
});

test.describe('chaînes du service actif', () => {
  test('aucun service choisi', async () => {
    const { tv } = setup([svc('freebox', 'playlist', `${base}/freeboxtv/playlist.m3u`)]);
    assert.equal(tv.active(), null);
    assert.deepEqual(await tv.channels(), {
      ok: false,
      error: 'Aucun service de télévision choisi. Choisissez-en un dans les réglages de la page Télévision.',
    });
  });

  test('playlist Freebox lue sur le réseau de la box', async () => {
    const { tv } = setup([svc('freebox', 'playlist', ` ${base}/freeboxtv/playlist.m3u `)], 'freebox');
    const r = await tv.channels();
    assert.ok(r.ok && 'channels' in r);
    assert.deepEqual(
      r.channels.map((c) => c.name),
      ['France 2', 'France 3', 'France 5', 'Arte', 'Radio FIP'],
    );
  });

  test('portail web : son adresse, sans lecture de chaînes', async () => {
    const { tv } = setup([svc('sfr', 'web', 'https://tv.sfr.fr/')], 'sfr');
    assert.deepEqual(await tv.channels(), { ok: true, web: { id: 'sfr', url: 'https://tv.sfr.fr/', name: 'SFR' } });
  });

  test('erreurs : adresse vide, code HTTP, box injoignable, fichier absent, playlist vide', async () => {
    const run = async (url: string) => setup([svc('freebox', 'playlist', url)], 'freebox').tv.channels();
    assert.deepEqual(await run('  '), { ok: false, error: 'Aucune adresse de playlist pour FREEBOX.' });
    assert.deepEqual(await run(`${base}/absente.m3u`), {
      ok: false,
      error: 'FREEBOX a répondu avec le code 404. Vérifiez l’adresse de la playlist dans les réglages de la page.',
    });
    assert.deepEqual(await run(`${dead}/playlist.m3u`), {
      ok: false,
      error: 'FREEBOX ne répond pas. La télévision par playlist fonctionne seulement quand l’ordinateur est sur le réseau de la box (Wi-Fi ou câble).',
    });
    assert.deepEqual(await run('/nulle/part/playlist.m3u'), { ok: false, error: 'Fichier de playlist introuvable : /nulle/part/playlist.m3u' });
    assert.deepEqual(await run(`${base}/vide.m3u`), { ok: false, error: 'La playlist ne contient aucune chaîne.' });
  });

  test('playlist en fichier local', async () => {
    const config = fakeConfig({ services: [svc('local', 'playlist', 'C:\\TV\\chaines.m3u')], active: 'local', detected: true });
    const read: string[] = [];
    const readFile = async (file: string) => {
      read.push(file);
      return freebox;
    };
    const tv = createTv({ config: config as never, http, readFile, toUi: () => {} });
    const r = await tv.channels();
    assert.deepEqual(read, ['C:\\TV\\chaines.m3u']);
    assert.ok(r.ok && 'channels' in r && r.channels.length === 5);
  });
});
