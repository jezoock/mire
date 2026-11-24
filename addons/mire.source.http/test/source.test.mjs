// Serveur web : reprise des tests du fournisseur « http-index » du cœur de Mire (test/library/http.test.ts et
// test/library/element-sources.test.ts, avant P5-12) : pages d'index Apache et nginx, sous-dossiers, affiches, fanart,
// illustrations écartées, sous-titres à côté des vidéos, clés `remote:<adresse>`, erreurs ; contrat attendu par le
// cœur (P5-11a, P5-12).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import createSource, { MAX_ITEMS } from '../src/source.mjs';
import { crawl, linksOf, MAX_PAGES } from '../src/crawl.mjs';
import { normalizeUrl, remoteFileKey } from '../src/page.mjs';
import { TEXT_CATALOGS, translator } from '../src/texts.mjs';
import { BASE, fakeContext, location } from './helpers.mjs';

const read = (rel) => JSON.parse(readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8'));
const manifest = read('mire-plugin.json');
const films = `${BASE}/films/`;
const amelie = `${BASE}/films/Am%C3%A9lie%20(2001).mkv`;

async function scan(url, kinds, opts = {}) {
  const { ctx, asked } = fakeContext({ granted: [url], ...opts });
  return { elements: await createSource(ctx).scan(location(url, kinds)), asked };
}

describe('manifeste et contrat', () => {
  it('code limité, sans hôte ni réseau local : Mire lui accorde l’adresse qu’il lit', () => {
    assert.equal(manifest.id, 'mire.source.http');
    assert.equal(manifest.level, 'code');
    assert.equal(manifest.permissions, undefined);
    assert.deepEqual(manifest.contributes.sources, [{ id: 'src-http', main: 'src/source.mjs' }]);
  });

  it('accepte une adresse web qui n’est pas une liste, avec un type de média', () => {
    const s = createSource(fakeContext().ctx);
    assert.equal(s.id, 'src-http');
    assert.deepEqual(s.tags, ['remote']);
    assert.ok(s.handles(location('http://192.168.1.10/films/')));
    assert.ok(s.handles(location('HTTPS://nas.local/musique', ['audio'])));
    for (const l of [
      location('https://box/tv.m3u'),
      location('https://box/tv.M3U8?jeton=1'),
      location('http://nas/films/', ['game']),
      location('http://nas/films/', []),
      { location: '/home/moi/Films', path: '/home/moi/Films', network: false, kinds: ['video'] },
      { location: 'ftp://nas/films', url: 'ftp://nas/films', network: false, kinds: ['video'] },
      null,
    ])
      assert.ok(!s.handles(l), JSON.stringify(l));
    assert.equal(s.instance(location(films)), films);
  });

  it('textes du code identiques à ceux des catalogues', () => {
    for (const lang of ['fr', 'en']) {
      const { name, ...texts } = read(`i18n/${lang}.json`).messages.source;
      assert.ok(name);
      assert.deepEqual(texts, TEXT_CATALOGS[lang]);
    }
  });
});

describe('pages d’index', () => {
  it('Apache et nginx : sous-dossiers, affiches, fanart, sans sortir du dossier', async () => {
    const { elements } = await scan(films, ['video', 'image']);
    assert.deepEqual(
      elements.map((e) => [e.name, e.open.path]),
      [
        ['Amélie (2001)', amelie],
        ['Série S01E04', `${BASE}/films/S%C3%A9rie/S%C3%A9rie%20S01E04.mp4`],
        ['Photo', `${BASE}/films/S%C3%A9rie/Photo.png`],
      ],
    );
    const [film, episode, photo] = elements;
    assert.deepEqual(film, {
      key: `remote:${amelie}`,
      name: 'Amélie (2001)',
      open: { kind: 'file', path: amelie },
      tags: ['remote'],
      infos: {
        folder: 'films',
        server: '192.168.1.10:8080',
        subtitles: [`${BASE}/films/Am%C3%A9lie%20(2001).fr.srt`, `${BASE}/films/Am%C3%A9lie%20(2001).en.vtt`],
      },
      images: { poster: `${BASE}/films/Am%C3%A9lie%20(2001).jpg`, background: `${BASE}/films/fanart.jpg` },
    });
    assert.deepEqual(episode.infos, { folder: 'Série', server: '192.168.1.10:8080' });
    assert.deepEqual(episode.images, { poster: `${BASE}/films/S%C3%A9rie/cover.jpg` });
    // Images : l'affiche d'Amélie, le fanart et la pochette sont écartés ; une photo n'a ni affiche ni fond.
    assert.deepEqual(photo.images, {});
  });

  it('musique : pochette du dossier ; seulement les types demandés', async () => {
    const { elements } = await scan(`${BASE}/musique/`, ['audio']);
    assert.deepEqual(
      elements.map((e) => [e.name, e.images]),
      [['01 - Début', { poster: `${BASE}/musique/folder.jpg` }]],
    );
    assert.deepEqual((await scan(`${BASE}/musique/`, ['video'])).elements, []);
  });

  it('adresse sans barre finale : même parcours, mêmes clés', async () => {
    const { elements, asked } = await scan(`${BASE}/films`, ['video']);
    assert.equal(asked[0].url, films);
    assert.equal(elements[0].key, `remote:${amelie}`);
  });

  it('chaque page visitée une fois, délai de 15 s, bornes', async () => {
    const { asked } = await scan(films, ['video']);
    assert.deepEqual(
      asked.map((a) => a.url),
      [films, `${BASE}/films/S%C3%A9rie/`, `${BASE}/films/S%C3%A9rie/Vide/`],
    );
    assert.ok(asked.every((a) => a.options.timeout === 15000));
    assert.equal(MAX_ITEMS, 150000);
    assert.equal(MAX_PAGES, 400);
    const seen = [];
    const { ctx } = fakeContext({ granted: [films] });
    await crawl(ctx.http, films, (u) => seen.push(u), { t: translator('fr'), maxPages: 1 });
    assert.deepEqual(seen, [films]);
  });

  it('liens hors du dossier de départ écartés', () => {
    const base = new URL(films);
    const { dirs, files } = linksOf('<a href="../">..</a><a href="/autre/">x</a><a href="a/">a</a><a href="b.mkv">b</a><a href="//ailleurs/c.mkv">c</a>', films, base);
    assert.deepEqual(dirs, [`${films}a/`]);
    assert.deepEqual(
      files.map((u) => u.href),
      [`${films}b.mkv`],
    );
  });

  it('clé : adresse normalisée, sans fragment', () => {
    assert.equal(normalizeUrl('HTTP://NAS.local:80/Films/a.mkv#t=3'), 'http://nas.local/Films/a.mkv');
    assert.equal(remoteFileKey('https://nas.local/a.mkv'), 'remote:https://nas.local/a.mkv');
  });
});

describe('erreurs : message affichable', () => {
  it('page absente, code de réponse, serveur injoignable, renvoi vers une autre adresse', async () => {
    await assert.rejects(scan(`${BASE}/absent/`, ['video']), { message: 'Adresse inaccessible (le serveur a répondu avec le code 404).' });
    await assert.rejects(scan(`${BASE}/panne/`, ['video']), { message: 'Adresse inaccessible (le serveur a répondu avec le code 500).' });
    await assert.rejects(scan(films, ['video'], { down: true }), { message: 'Adresse inaccessible (serveur injoignable).' });
    await assert.rejects(scan(`${BASE}/redirige/`, ['video']), { message: 'Adresse inaccessible (le serveur renvoie vers une autre adresse).' });
    await assert.rejects(scan(films, ['video'], { locale: 'en', down: true }), { message: "Can't open this address (server unreachable)." });
  });

  it('une page suivante inaccessible est passée', async () => {
    const pages = { '/films/': '<a href="a.mkv">a</a><a href="trou/">t</a>' };
    const { elements } = await scan(films, ['video'], { pages });
    assert.deepEqual(
      elements.map((e) => e.name),
      ['a'],
    );
  });
});
