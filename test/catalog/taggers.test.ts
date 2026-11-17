// Tags automatiques internes (P2-05) : séries, films, musique, consoles, photos, et leur branchement sur le moteur.
// Les cas reprennent ceux de test/scrape/parse.test.js, test/shared/systems.test.ts et test/renderer/domain/.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Element, ElementSourceRef, OpenSpec } from '@mire/shared';
import { createCatalog } from '../../src/main/catalog/index.ts';
import { localFileKey } from '../../src/main/catalog/keys.ts';
import { createOverrides } from '../../src/main/catalog/overrides.ts';
import { createTagEngine } from '../../src/main/catalog/tags/engine.ts';
import { fileTagRules } from '../../src/main/catalog/tags/file-rules.ts';
import { createRegistry } from '../../src/main/catalog/tags/registry.ts';
import { builtinTaggers, movieTagger, musicTagger, photoTagger, seriesTagger, systemTagger, taggerContributor } from '../../src/main/catalog/tags/taggers.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';
import { builtinTranslator } from '../../src/main/i18n/current.ts';

/** Élément tel que le voit un tag automatique : tags du type de fichier et de la source déjà posés. */
function el(name: string, open: OpenSpec, tags: string[] = [], infos: Element['infos'] = {}): Element {
  return { key: 'local:x', source: { plugin: 'src-local', instance: '/' }, name, open, tags, infos, images: {}, added: 0 };
}
const fileEl = (p: string, tag: string, infos: Element['infos'] = {}) =>
  el(path.parse(p.replace(/\\/g, '/')).name, { kind: 'file', path: p }, [tag, 'local'], infos);

describe('tags automatiques : séries', () => {
  it('« Friends S01E03 » : `series`, série, saison et épisode', () => {
    assert.deepEqual(seriesTagger.compute(fileEl('/Séries/Friends S01E03.mkv', 'video')), {
      tags: ['series'],
      infos: { series: 'Friends', season: 1, episode: 3 },
    });
  });

  it('épisode seul dans « Série/Saison 1 » : le titre vient du dossier parent', () => {
    const r = seriesTagger.compute(fileEl('/Séries/Le Bureau des légendes/Saison 1/S01E03.mkv', 'video'));
    assert.deepEqual(r?.infos, { series: 'Le Bureau des légendes', season: 1, episode: 3 });
  });

  it('notation 1x03 dans un dossier non générique (chemin Windows)', () => {
    const r = seriesTagger.compute(fileEl('D:\\Séries\\Kaamelott\\1x03.avi', 'video'));
    assert.deepEqual(r?.infos, { series: 'Kaamelott', season: 1, episode: 3 });
  });

  it('dossier générique sans parent : pas de nom de série, mais saison et épisode', () => {
    assert.deepEqual(seriesTagger.compute(fileEl('/Saison 1/S01E03.mkv', 'video'))?.infos, { season: 1, episode: 3 });
  });

  it('un film, une musique ou un flux ne sont pas des séries', () => {
    assert.equal(seriesTagger.compute(fileEl('/Films/Amélie (2001).mkv', 'video')), null);
    assert.equal(seriesTagger.compute(fileEl('/Musique/S01E03.mp3', 'audio')), null);
    assert.equal(seriesTagger.compute(el('Friends S01E03', { kind: 'stream', url: 'http://box/1' }, ['video'])), null);
  });
});

describe('tags automatiques : films', () => {
  it('titre et année d’après le nom', () => {
    assert.deepEqual(movieTagger.compute(fileEl('/Films/Amélie (2001).mkv', 'video')), { tags: ['movie'], infos: { title: 'Amélie', year: 2001 } });
    const scene = movieTagger.compute(fileEl('/Films/Le.Fabuleux.Destin.2001.1080p.BluRay.x264.mkv', 'video'));
    assert.deepEqual(scene?.infos, { title: 'Le Fabuleux Destin', year: 2001 });
    assert.deepEqual(movieTagger.compute(fileEl('/Films/Blade Runner 2049 (2017).mkv', 'video'))?.infos, { title: 'Blade Runner 2049', year: 2017 });
  });

  it('sans année : le titre seul', () => {
    assert.deepEqual(movieTagger.compute(fileEl('/Films/Blade Runner 2049.mkv', 'video'))?.infos, { title: 'Blade Runner 2049' });
  });

  it('un épisode ou une image ne sont pas des films', () => {
    assert.equal(movieTagger.compute(fileEl('/Séries/Friends S01E03.mkv', 'video')), null);
    assert.equal(movieTagger.compute(fileEl('/Photos/Amélie (2001).jpg', 'image')), null);
  });
});

describe('tags automatiques : musique', () => {
  it('dossier « Artiste - Album » : artiste, album, piste et titre', () => {
    const r = musicTagger.compute(fileEl('/Musique/Daft Punk - Discovery/01 - One More Time.mp3', 'audio', { folder: 'Daft Punk - Discovery' }));
    assert.deepEqual(r, { infos: { title: 'One More Time', artist: 'Daft Punk', album: 'Discovery', track: 1 } });
  });

  it('dossier générique (« CD 2 ») : l’album est le dossier parent', () => {
    const r = musicTagger.compute(fileEl('C:\\Musique\\Album\\CD 2\\1-05 - Face B.flac', 'audio', { folder: 'CD 2' }));
    assert.deepEqual(r, { infos: { title: 'Face B', album: 'Album', track: 5 } });
  });

  it('sans numéro de piste ni info `folder` : le dossier du fichier', () => {
    assert.deepEqual(musicTagger.compute(fileEl('/Musique/Discovery/Around the World.mp3', 'audio')), {
      infos: { title: 'Around the World', album: 'Discovery' },
    });
  });

  it('une vidéo n’a pas d’album', () => {
    assert.equal(musicTagger.compute(fileEl('/Musique/Clip.mp4', 'video')), null);
  });
});

describe('tags automatiques : consoles', () => {
  // Les jeux n'entrent dans le catalogue qu'avec P2-03 : éléments factices.
  const consoles = [
    { id: 'emu-1', name: 'Mednafen', path: '/usr/bin/mednafen', system: 'Sega - Saturn' },
    { id: 'emu-2', name: 'Ma console', path: '/emu/snes9x.exe' },
    { id: 'emu-3', name: 'Inconnue', path: '/emu/x', extensions: ['.gba'] },
  ];
  const tagger = systemTagger(() => consoles);
  const game = (console: string, p: string) => el(path.basename(p), { kind: 'game', console, path: p });

  it('système choisi, puis deviné d’après le nom ou le programme, puis les extensions de la console', () => {
    assert.deepEqual(tagger.compute(game('emu-1', '/roms/Panzer.cue')), { infos: { system: 'Sega - Saturn' } });
    assert.deepEqual(tagger.compute(game('emu-2', '/roms/Mario.sfc')), { infos: { system: 'Nintendo - Super Nintendo Entertainment System' } });
    assert.deepEqual(tagger.compute(game('emu-3', '/roms/Zelda.zip')), { infos: { system: 'Nintendo - Game Boy Advance' } });
  });

  it('console inconnue : d’après l’extension du jeu ; rien si elle ne dit rien', () => {
    assert.deepEqual(tagger.compute(game('absente', '/roms/Tetris.gb')), { infos: { system: 'Nintendo - Game Boy' } });
    assert.equal(tagger.compute(game('absente', '/roms/Jeu.zip')), null);
  });

  it('seuls les jeux de console ont un système', () => {
    assert.equal(tagger.compute(fileEl('/roms/Tetris.gb', 'video')), null);
  });
});

describe('tags automatiques : photos', () => {
  it('groupe de dossier de l’interface', () => {
    assert.deepEqual(photoTagger.compute(fileEl('/photos/Vacances/IMG_1.jpg', 'image', { folder: 'Vacances' })), { infos: { folder: 'Vacances' } });
    const generic = photoTagger.compute(fileEl('/photos/Mariage/Partie 2/IMG_2.jpg', 'image', { folder: 'Partie 2' }));
    assert.deepEqual(generic, { infos: { folder: 'Mariage, Partie 2' } });
  });

  it('seules les images', () => {
    assert.equal(photoTagger.compute(fileEl('/photos/Vacances/clip.mp4', 'video', { folder: 'Vacances' })), null);
  });
});

describe('tags automatiques branchés sur le moteur', () => {
  const SERIES: ElementSourceRef = { plugin: 'src-local', instance: '/series' };
  const input = (p: string, folder: string): ElementInput => ({
    key: localFileKey(p, 'linux'),
    name: path.parse(p).name,
    open: { kind: 'file', path: p },
    tags: ['local'],
    infos: { folder },
    images: {},
  });

  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-taggers-'));
    const catalog = createCatalog({ dir: path.join(dir, 'sources'), debounceMs: 0, onIgnored: () => {} });
    catalog.load();
    const overrides = createOverrides({ file: path.join(dir, 'overrides.json') });
    overrides.load();
    const registry = createRegistry(builtinTranslator('en').t);
    const contributors = builtinTaggers(() => []).map(taggerContributor);
    const engine = createTagEngine({ catalog, overrides, registry, rules: () => fileTagRules(undefined), contributors });
    return { catalog, engine };
  }

  it('« Friends S01E03.mkv » porte `video`, `series`, série « Friends », saison 1, épisode 3', () => {
    const { catalog, engine } = setup();
    const key = localFileKey('/series/Friends/Friends S01E03.mkv', 'linux');
    catalog.setSource(SERIES, [input('/series/Friends/Friends S01E03.mkv', 'Friends')]);
    const e = engine.element(key)!;
    assert.ok(e.tags.includes('video') && e.tags.includes('series'), e.tags.join());
    assert.equal(e.tags.includes('movie'), false);
    assert.equal(e.infos.series, 'Friends');
    assert.equal(e.infos.season, 1);
    assert.equal(e.infos.episode, 3);
    assert.deepEqual(engine.query(['video', 'series']), [key]);
  });

  it('les infos et les retraits faits à la main l’emportent sur les tags automatiques', () => {
    const { catalog, engine } = setup();
    const key = localFileKey('/series/Amélie (2001).mkv', 'linux');
    catalog.setSource(SERIES, [input('/series/Amélie (2001).mkv', 'series')]);
    assert.equal(engine.element(key)!.infos.year, 2001);
    engine.setInfos(key, { title: 'Le Fabuleux Destin d’Amélie Poulain' });
    engine.setTags(key, { movie: false });
    const e = engine.element(key)!;
    assert.equal(e.infos.title, 'Le Fabuleux Destin d’Amélie Poulain');
    assert.equal(e.tags.includes('movie'), false);
  });

  it('tags.list : `series` et `movie` sont déclarés, avec leur nom', () => {
    const { catalog, engine } = setup();
    catalog.setSource(SERIES, [input('/series/Friends S01E03.mkv', 'series'), input('/series/Amélie (2001).mkv', 'series')]);
    const list = engine.tagsList();
    assert.deepEqual(
      list.filter((t) => t.id === 'series' || t.id === 'movie'),
      [
        { id: 'series', name: 'TV shows', origin: 'core', count: 1 },
        { id: 'movie', name: 'Movies', origin: 'core', count: 1 },
      ],
    );
    assert.equal(
      list.some((t) => t.origin === 'other'),
      false,
    );
  });
});
