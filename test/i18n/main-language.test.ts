// P1-29 : textes du processus principal en français et en anglais, langue des fiches (TMDB, Steam).
import { afterEach, describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '@mire/shared';
import { BUILTIN_CATALOGS, flattenMessages } from '@mire/shared/i18n';
import { DEFAULT_CONFIG, migrate, normalizeConfig } from '../../src/main/config/index.ts';
import { builtinTranslator, createLanguageService, currentLanguage, metadataLanguage, steamLocale, t, useLanguage } from '../../src/main/i18n/index.ts';
import { locationError } from '../../src/main/library/location.ts';
import { HttpError } from '../../src/main/net/http.ts';
import type { TmdbClient, TmdbParams } from '../../src/main/net/tmdb.ts';
import { GAME_GENRES, libretroProvider } from '../../src/main/scrape/providers/libretro.ts';
import { MUSIC_GENRES, musicBrainzProvider } from '../../src/main/scrape/providers/musicbrainz.ts';
import { steamProvider } from '../../src/main/scrape/providers/steam.ts';
import { tmdbProvider } from '../../src/main/scrape/providers/tmdb.ts';
import { streamingSearchProvider } from '../../src/main/search/streaming.ts';
import { BIOS_HINTS, EMULATORS, FREE_GAMES } from '../../src/main/store/catalog/index.ts';
import { createStore } from '../../src/main/store/index.ts';
import { loadRoutes } from '../scrape/fake-fetch.ts';
import { providerContext } from '../scrape/helpers.ts';
import { roms } from '../scrape/scenario.ts';

const ROOT = path.join(import.meta.dirname, '..', '..');
const english = () => useLanguage(builtinTranslator('en'));
afterEach(() => useLanguage(null));

const KEYS = {
  fr: new Set(flattenMessages(BUILTIN_CATALOGS.fr.messages).leaves.keys()),
  en: new Set(flattenMessages(BUILTIN_CATALOGS.en.messages).leaves.keys()),
};

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : e.name.endsWith('.ts') ? [p] : [];
  });
}

describe('clés employées par le processus principal', () => {
  it('chaque clé écrite en toutes lettres existe en français et en anglais', () => {
    const used = new Set<string>();
    for (const file of sources(path.join(ROOT, 'src', 'main'))) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
    }
    assert.ok(used.size > 100, `${used.size} clés`);
    for (const key of used) for (const code of ['fr', 'en'] as const) assert.ok(KEYS[code].has(key), `${key} absente en ${code}`);
  });

  it('clés construites : genres, émulateurs, BIOS et jeux de la boutique', () => {
    const keys = [
      ...Object.values(GAME_GENRES).map((id) => `scrape.genres.games.${id}`),
      ...Object.values(MUSIC_GENRES).map((id) => `scrape.genres.music.${id}`),
      ...EMULATORS.map((e) => `store.emulators.${e.id}`),
      ...[...BIOS_HINTS].map((id) => `store.bios.${id}`),
      ...FREE_GAMES.map((g) => `store.games.${g.id}`),
    ];
    for (const key of keys) for (const code of ['fr', 'en'] as const) assert.ok(KEYS[code].has(key), `${key} absente en ${code}`);
  });
});

describe('langue des textes', () => {
  it('sans service branché : français ; avec le service : la langue de l’interface, suivie à chaud', () => {
    assert.equal(currentLanguage(), 'fr');
    assert.equal(locationError('/films', {}), 'Dossier introuvable : /films');
    let current = normalizeConfig({ ui: { language: 'en' } });
    const listeners = new Set<(next: Config, previous: Config) => void>();
    const config = {
      get: () => current,
      onChange: (l: (next: Config, previous: Config) => void) => (listeners.add(l), () => listeners.delete(l)),
    };
    useLanguage(createLanguageService({ config, systemLanguages: () => ['fr-FR'] }));
    assert.equal(locationError('/films', {}), 'Folder not found: /films');
    const previous = current;
    current = normalizeConfig({ ui: { language: 'fr' } });
    for (const l of listeners) l(current, previous);
    assert.equal(locationError('/films', {}), 'Dossier introuvable : /films');
  });

  it('dossier introuvable et partage réseau, dans les deux langues', () => {
    assert.match(locationError('//nas/films', { network: true }), /^Partage réseau inaccessible : \/\/nas\/films\. Vérifiez/);
    english();
    assert.equal(locationError('/films', {}), 'Folder not found: /films');
    assert.match(locationError('//nas/films', { network: true }), /^Network share unavailable: \/\/nas\/films\. Check/);
  });

  it('les textes français du catalogue sont ceux d’avant (échantillon)', () => {
    assert.equal(t('net.errors.unreachable', { host: 'exemple.fr' }), 'Impossible de joindre exemple.fr. Vérifiez la connexion Internet.');
    assert.equal(t('games.romProgress', { name: 'Jeu.cue', index: '2', total: '3' }), 'Jeu.cue (fichier 2 sur 3)');
    assert.equal(t('store.basedOn', { author: 'andwn', original: 'Daisuke Amaya' }), 'andwn, d’après Daisuke Amaya');
  });

  it('boutique : descriptions, auteur et rappel des BIOS dans la langue de l’interface', (tc: TestContext) => {
    const dir = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.mire-boutique-'));
    tc.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = createStore({ dataDir: dir, defaultRomsRoot: dir, getConfig: () => DEFAULT_CONFIG, saveConfig: () => {}, extract: async () => {} } as never);
    const fr = store.catalog();
    assert.match(fr.emulators[0].desc, /^Un seul programme pour les consoles/);
    assert.equal(fr.games.find((g: { id: string }) => g.id === 'cavestory')?.author, 'andwn, d’après Daisuke Amaya');
    english();
    const en = store.catalog();
    assert.match(en.emulators[0].desc, /^One program for 8-bit and 16-bit consoles/);
    assert.equal(en.games.find((g: { id: string }) => g.id === 'cavestory')?.author, 'andwn, based on Daisuke Amaya');
    assert.ok(!('basedOn' in en.games[0]));
  });
});

describe('genres', () => {
  it('libretro : traduit en français, valeur de libretro en anglais', async (tc) => {
    const scrape = async () => {
      const { ctx } = providerContext(tc, loadRoutes('libretro'));
      return (await libretroProvider().scrape({ ...roms[0], emu: 'snes' }, undefined, ctx('r:smw')))?.genre;
    };
    assert.equal(await scrape(), 'Plateformes');
    english();
    assert.equal(await scrape(), 'Platform');
  });

  it('MusicBrainz : traduit en français, étiquette d’origine en anglais', async (tc) => {
    const album = { dir: '/m/Daft Punk - Discovery (2001)', folder: 'Daft Punk - Discovery (2001)' };
    const scrape = async () => {
      const { ctx } = providerContext(tc, loadRoutes('musicbrainz'));
      return (await musicBrainzProvider({ intervalMs: 0 }).scrape(album, undefined, ctx('a:x')))?.genre;
    };
    assert.equal(await scrape(), 'Électronique');
    english();
    assert.equal(await scrape(), 'Electronic');
  });
});

describe('langue des fiches', () => {
  it('metadataLanguage : search.language s’il est fixé, sinon la langue de l’interface avec sa région', () => {
    assert.equal(metadataLanguage('', 'fr'), 'fr-FR');
    assert.equal(metadataLanguage(undefined, 'en'), 'en-US');
    assert.equal(metadataLanguage('  ', 'en-GB'), 'en-GB');
    assert.equal(metadataLanguage('nl-BE', 'en'), 'nl-BE');
    assert.equal(metadataLanguage('fr-FR', 'en'), 'fr-FR');
    assert.equal(metadataLanguage(''), 'fr-FR');
    english();
    assert.equal(metadataLanguage(''), 'en-US');
  });

  it('steamLocale : langue et pays du magasin', () => {
    assert.deepEqual(steamLocale('fr-FR'), { l: 'french', cc: 'FR' });
    assert.deepEqual(steamLocale('en-US'), { l: 'english', cc: 'US' });
    assert.deepEqual(steamLocale('fr-CA'), { l: 'french', cc: 'CA' });
    assert.deepEqual(steamLocale('de'), { l: 'german', cc: 'DE' });
    assert.deepEqual(steamLocale('xx'), { l: 'english', cc: 'US' });
  });

  function fakeTmdb(reply: unknown) {
    const calls: { pathname: string; params: TmdbParams }[] = [];
    const client: TmdbClient = {
      hasKey: () => true,
      async get<T>(pathname: string, params: TmdbParams = {}) {
        calls.push({ pathname, params });
        if (reply instanceof HttpError) throw reply;
        return reply as T;
      },
    };
    return { client, calls };
  }
  const searchContext = (language: string) => ({
    getConfig: () => ({ search: { tmdbToken: 'cle', region: 'FR', language }, web: [] }),
  });

  it('« où regarder » : TMDB demandé dans la langue de l’interface, sauf langue fixée', async () => {
    const { client, calls } = fakeTmdb({ results: [] });
    const search = streamingSearchProvider(client);
    await search.search('dune', searchContext(''));
    english();
    await search.search('dune', searchContext(''));
    await search.search('dune', searchContext('fr-FR'));
    assert.deepEqual(
      calls.map((c) => c.params.language),
      ['fr-FR', 'en-US', 'fr-FR'],
    );
  });

  it('clé TMDB refusée : le message arrive dans la langue de l’interface', async () => {
    const { client } = fakeTmdb(new HttpError('status', 'https://api.themoviedb.org/3/search/multi', 'x', { status: 401 }));
    const search = streamingSearchProvider(client);
    await assert.rejects(search.search('dune', searchContext('')), { message: 'Clé TMDB refusée. Vérifiez-la dans Réglages.' });
    english();
    await assert.rejects(search.search('dune', searchContext('')), { message: 'TMDB key refused. Check it in Settings.' });
  });

  it('fiches TMDB : genres et recherche en anglais avec ui.language en, en français sinon', async (tc) => {
    const languages = async () => {
      const { client, calls } = fakeTmdb({ results: [], genres: [] });
      const { ctx } = providerContext(tc, {}, { search: { tmdbToken: 'cle', region: 'FR', language: '' } });
      await tmdbProvider(client).scrape({ path: '/v/Dune (2021).mkv', name: 'Dune (2021).mkv' }, undefined, ctx('v:dune'));
      return [...new Set(calls.map((c) => c.params.language))];
    };
    assert.deepEqual(await languages(), ['fr-FR']);
    english();
    assert.deepEqual(await languages(), ['en-US']);
  });

  it('Steam : l=french&cc=FR en français (comme avant), l=english&cc=US en anglais', async (tc) => {
    const urls = async () => {
      const { ctx, fetch } = providerContext(tc, loadRoutes('steam'), { search: { tmdbToken: '', region: 'FR', language: '' } });
      await steamProvider().scrape({ name: 'Hades', path: 'C:/Hades.exe' }, undefined, ctx('g:hades'));
      return fetch.calls.filter((u) => u.includes('store.steampowered.com'));
    };
    const fr = await urls();
    assert.ok(fr.length >= 2 && fr.every((u) => u.endsWith('&l=french&cc=FR')), fr.join('\n'));
    english();
    const en = await urls();
    assert.ok(en.length >= 1 && en.every((u) => u.endsWith('&l=english&cc=US')), en.join('\n'));
  });
});

describe('search.language : migration v8', () => {
  const migrated = (raw: Record<string, unknown>) => normalizeConfig(migrate(raw).config).search.language;

  it('fr-FR (l’ancienne valeur par défaut) devient vide : les fiches suivent l’interface', () => {
    assert.equal(DEFAULT_CONFIG.search.language, '');
    assert.equal(migrated({ version: 7, search: { language: 'fr-FR' } }), '');
    assert.equal(migrated({ version: 3, search: { tmdbToken: 'x', language: 'fr-FR' } }), '');
    assert.equal(migrated({ version: 7 }), '');
  });

  it('une autre langue, écrite à la main, est conservée ; une configuration v8 n’est pas migrée', () => {
    assert.equal(migrated({ version: 7, search: { language: 'nl-BE' } }), 'nl-BE');
    assert.equal(migrated({ version: 8, search: { language: 'fr-FR' } }), 'fr-FR');
  });

  it('installation existante : ui.language passe à fr (v7), les fiches restent demandées en fr-FR', () => {
    const config = normalizeConfig(migrate({ version: 6, search: { language: 'fr-FR' } }).config);
    assert.equal(config.ui.language, 'fr');
    assert.equal(metadataLanguage(config.search.language, config.ui.language), 'fr-FR');
  });
});
