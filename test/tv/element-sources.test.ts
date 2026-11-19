// Télévision → éléments (P2-03) : chaînes de la liste du service choisi (`tv-m3u`), portail d'un service web
// (`tv-web`) ; les chaînes lues par l'interface alimentent le catalogue, seul le service choisi y garde ses éléments.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config, TvService } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { tvChannelKey } from '../../src/main/catalog/keys.ts';
import { syncFeeds } from '../../src/main/catalog/sync.ts';
import { channelElements, tvConfigFeed, tvM3uSource, tvWebSource } from '../../src/main/tv/element-sources.ts';
import { groupChannels, parseM3U } from '../../src/main/tv/channels.ts';
import { createTv, playlistProvider } from '../../src/main/tv/index.ts';

const freebox = fs.readFileSync(new URL('../fixtures/tv/freebox.m3u', import.meta.url), 'utf8');
const BOX: TvService = { id: 'freebox', name: 'Freebox', kind: 'playlist', url: '/box.m3u', quality: 'sd' };
const PORTAL: TvService = { id: 'sfr', name: 'SFR TV', kind: 'web', url: 'https://tv.sfr.fr/' };
const NO_NUMBER = '#EXTM3U\n#EXTINF:0 tvg-logo="https://l/a.png",Chaîne locale\nhttp://flux/b\n#EXTINF:0,Chaîne locale (HD)\nhttp://flux/a\n';

function setup(active: string, text = freebox) {
  const catalog = createCatalog({ dir: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-tv-cat-')), 'sources'), debounceMs: 0, onIgnored: () => {} });
  const cfg = { tv: { services: [BOX, PORTAL], active, detected: true } } as unknown as Config;
  const config = { get: () => cfg, update: (fn: (c: Config) => Config) => fn(cfg) };
  const tv = createTv({ config, readFile: async () => text, toUi: () => {}, catalog });
  return { catalog, cfg, tv };
}

describe('chaînes d’une liste → éléments (`tv-m3u`)', () => {
  it('les chaînes lues pour l’interface alimentent le catalogue : une chaîne par numéro, avec ses variantes', async () => {
    const { catalog, tv } = setup('freebox');
    const r = await tv.channels();
    assert.ok(r.ok && 'channels' in r);
    assert.equal(catalog.keys().length, r.channels.length);
    const fr2 = catalog.element(tvChannelKey('freebox', { number: 2, urls: [] }))!;
    assert.deepEqual([fr2.source, fr2.name, fr2.tags, fr2.infos], [{ plugin: 'tv-m3u', instance: 'freebox' }, 'France 2', ['tv'], { channel: 2 }]);
    assert.equal(fr2.open.kind, 'stream');
    // Flux principal : la qualité choisie pour le service (`sd`) ; toutes les variantes suivent.
    assert.ok(fr2.open.kind === 'stream' && /flavour=sd/.test(fr2.open.url));
    assert.deepEqual(fr2.open.kind === 'stream' && fr2.open.variants?.map((v) => v.label), ['HD', 'standard', 'bas débit']);
  });

  it('sans numéro : clé d’après la plus petite adresse ; logo gardé', () => {
    const [e] = channelElements(BOX, groupChannels(parseM3U(NO_NUMBER)));
    assert.equal(e.key, 'tv:freebox|http://flux/a');
    assert.deepEqual(e.images, { logo: 'https://l/a.png' });
  });

  it('`scan` rend les mêmes éléments ; une liste illisible lève une erreur', async () => {
    const { catalog, tv } = setup('freebox');
    await tv.channels();
    const src = tvM3uSource(playlistProvider, { http: { request: async () => null, getText: async () => '' }, readFile: async () => freebox });
    assert.ok(src.handles(BOX) && !src.handles(PORTAL));
    assert.deepEqual((await src.scan(BOX)).map((e) => e.key).sort(), catalog.keys().sort());
    const broken = tvM3uSource(playlistProvider, {
      http: { request: async () => null, getText: async () => '' },
      readFile: async () => {
        throw new Error('absent');
      },
    });
    await assert.rejects(broken.scan(BOX));
  });

  it('un autre service choisi : les chaînes du précédent quittent le catalogue', async () => {
    const { catalog, cfg, tv } = setup('freebox');
    await tv.channels();
    syncFeeds(catalog, [tvConfigFeed(cfg)]);
    assert.ok(catalog.keys().length > 0, 'service toujours choisi : ses chaînes restent');
    syncFeeds(catalog, [tvConfigFeed({ ...cfg, tv: { ...cfg.tv, active: 'sfr' } })]);
    assert.deepEqual(catalog.keys(), [tvChannelKey('sfr', { number: null, urls: ['https://tv.sfr.fr/'] })]);
  });
});

describe('portail web → élément (`tv-web`)', () => {
  it('le service choisi, s’il est web, est un élément ouvert comme un site', async () => {
    const { catalog, cfg } = setup('sfr');
    syncFeeds(catalog, [tvConfigFeed(cfg)]);
    const key = tvChannelKey('sfr', { number: null, urls: ['https://tv.sfr.fr/'] });
    const e = catalog.element(key)!;
    assert.deepEqual(
      [e.source, e.name, e.open, e.tags],
      [{ plugin: 'tv-web', instance: 'sfr' }, 'SFR TV', { kind: 'site', url: 'https://tv.sfr.fr/', site: 'tv:sfr' }, ['tv']],
    );
    assert.deepEqual(
      (await tvWebSource.scan(PORTAL)).map((x) => x.key),
      [key],
    );
    syncFeeds(catalog, [tvConfigFeed({ ...cfg, tv: { ...cfg.tv, active: '' } })]);
    assert.deepEqual(catalog.keys(), []);
  });
});
