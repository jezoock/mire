// P1-29 : textes du processus principal en français et en anglais. Langue des fiches : réglage `language` des plugins
// mire.tmdb (P5-15) et mire.steam (P5-16), testés dans mire-addons.
import { afterEach, describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '@mire/shared';
import { BUILTIN_CATALOGS, flattenMessages } from '@mire/shared/i18n';
import { DEFAULT_CONFIG, migrate, normalizeConfig } from '../../src/main/config/index.ts';
import { builtinTranslator, createLanguageService, currentLanguage, t, useLanguage } from '../../src/main/i18n/index.ts';
import { locationError } from '../../src/main/library/location.ts';
import { GAME_GENRES, libretroProvider } from '../../src/main/scrape/providers/libretro.ts';
import { BIOS_HINTS, EMULATORS } from '../../src/main/store/catalog/index.ts';
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
      ...EMULATORS.map((e) => `store.emulators.${e.id}`),
      ...[...BIOS_HINTS].map((id) => `store.bios.${id}`),
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

  // Jeu libre d'un plugin factice (P5-07) : adapté d'un autre jeu ; texte de présentation désigné par sa clé.
  const GAME = {
    id: 'cavestory',
    name: 'Cave Story',
    system: 'md',
    author: 'andwn',
    basedOn: 'Daisuke Amaya',
    url: 'https://x.example/c.gen',
    file: 'c.gen',
    descKey: 'store.errors.unknownGame',
  };
  it('boutique : descriptions, auteur et rappel des BIOS dans la langue de l’interface', (tc: TestContext) => {
    const dir = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.mire-boutique-'));
    tc.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const store = createStore({
      dataDir: dir,
      defaultRomsRoot: dir,
      getConfig: () => DEFAULT_CONFIG,
      saveConfig: () => {},
      extract: async () => {},
      freeGames: () => [GAME],
    } as never);
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

  it('installation existante : ui.language passe à fr (v7), les fiches suivent l’interface (fr-FR)', () => {
    const config = normalizeConfig(migrate({ version: 6, search: { language: 'fr-FR' } }).config);
    assert.equal(config.ui.language, 'fr');
    assert.equal(config.search.language, '');
  });
});
