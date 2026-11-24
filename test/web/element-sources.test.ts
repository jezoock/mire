// Sites → éléments (P2-03) : services des plugins (une source par app, `svc-<id>`), sites ajoutés (`web-perso`),
// marque-pages de pages (`web-bm`) ; tag `stream` et info `category`, suivis des changements de la configuration.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Bookmark, Config, WebSite } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { bookmarkKey, siteKey } from '../../src/main/catalog/keys.ts';
import { syncFeeds } from '../../src/main/catalog/sync.ts';
import { bookmarkElement, siteConfigFeed, siteElement, siteSourceId, siteSources } from '../../src/main/web/element-sources.ts';

const site = (o: Partial<WebSite>): WebSite => ({ id: 'x', url: 'https://x.example/', mode: 'integrated', search: '', ...o });
const NETFLIX = site({ id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com/browse', group: 'video', app: 'mire.web.netflix' });
const DEEZER = site({ id: 'deezer', name: 'Deezer', url: 'https://www.deezer.com/fr/', group: 'music', app: 'mire.web.deezer' });
const MINE = site({ id: 'arte', name: 'Arte', url: 'https://www.arte.tv/fr/' });
const BM: Bookmark = { id: 'b1', url: 'https://www.netflix.com/watch/1', title: 'Dark', type: 'tv', season: 2, episode: 3, site: 'netflix.com', added: 1 };

function setup() {
  return createCatalog({ dir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-web-cat-')), 'sources'), debounceMs: 0, onIgnored: () => {} });
}
const config = (web: WebSite[], bookmarks: Bookmark[] = []) => ({ web, bookmarks }) as unknown as Config;

describe('sites → éléments', () => {
  it('un service dont le plugin est désactivé ou absent quitte les sources, sans rien effacer', () => {
    const off = { ...NETFLIX, inactive: true };
    assert.deepEqual(
      siteSources(config([off, DEEZER, MINE])).map((s) => s.id),
      ['svc-deezer', 'web-perso', 'web-bm'],
    );
  });

  it('un site : tag `stream`, info `category`, ouvert par son identifiant', () => {
    assert.deepEqual(siteElement(NETFLIX), {
      key: siteKey('netflix'),
      name: 'Netflix',
      open: { kind: 'site', url: 'https://www.netflix.com/browse', site: 'netflix' },
      tags: ['stream'],
      infos: { category: 'video' },
      images: {},
    });
    assert.deepEqual(siteElement(MINE).infos, {});
  });

  it('une source par service de plugin, `web-perso` pour les sites ajoutés', () => {
    assert.equal(siteSourceId(NETFLIX), 'svc-netflix');
    assert.equal(siteSourceId(MINE), 'web-perso');
    assert.deepEqual(
      siteSources(config([NETFLIX, DEEZER, MINE])).map((s) => s.id),
      ['svc-netflix', 'svc-deezer', 'web-perso', 'web-bm'],
    );
  });

  it('la configuration alimente le catalogue ; un site retiré en sort', async () => {
    const catalog = setup();
    syncFeeds(catalog, [siteConfigFeed(config([NETFLIX, DEEZER, MINE], [BM]))]);
    assert.deepEqual(catalog.keys().sort(), [bookmarkKey('b1'), siteKey('arte'), siteKey('deezer'), siteKey('netflix')].sort());
    assert.deepEqual(catalog.element(siteKey('deezer'))?.source, { plugin: 'svc-deezer', instance: 'config' });
    // `scan` rend ce que la configuration donne.
    const perso = siteSources(config([MINE])).find((s) => s.id === 'web-perso')!;
    assert.deepEqual(
      (await perso.scan(config([MINE]))).map((e) => e.key),
      [siteKey('arte')],
    );
    syncFeeds(catalog, [siteConfigFeed(config([MINE]))]);
    assert.deepEqual(catalog.keys(), [siteKey('arte')]);
    assert.ok(!catalog.sources().some((s) => s.plugin === 'svc-netflix'));
  });
});

describe('marque-pages de pages → éléments (`web-bm`)', () => {
  it('ouvert par le site de la configuration au même domaine ; sa catégorie, la saison et l’épisode d’une série', () => {
    assert.deepEqual(bookmarkElement(BM, [NETFLIX]), {
      key: bookmarkKey('b1'),
      name: 'Dark',
      open: { kind: 'site', url: 'https://www.netflix.com/watch/1', site: 'netflix' },
      tags: ['stream'],
      infos: { category: 'video', season: 2, episode: 3 },
      images: {},
    });
    const film = bookmarkElement({ ...BM, type: 'movie', site: 'inconnu.example' }, [NETFLIX]);
    assert.deepEqual([film.open, film.infos], [{ kind: 'site', url: 'https://www.netflix.com/watch/1' }, {}]);
  });
});
