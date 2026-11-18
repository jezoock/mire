// Éditeurs (P4-22) : genre d'un élément, champs du formulaire, changements à enregistrer (infos et tags), demande de
// recherche en ligne.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Element, OpenSpec, TagSummary } from '@mire/shared';
import { normalizeField } from '@mire/ui/utils';
import {
  editorFields,
  editorHelp,
  editorKind,
  editorTitle,
  infoChanges,
  infoValues,
  scrapeJob,
  tagChanges,
  tagNames,
} from '../../src/renderer/editors/model.ts';
import fr from '../../packages/shared/src/i18n/locales/fr.json' with { type: 'json' };
import en from '../../packages/shared/src/i18n/locales/en.json' with { type: 'json' };

type Messages = Record<string, unknown>;
function translator(messages: Messages) {
  return (key: string, vars: Record<string, string | number> = {}) => {
    const v = key.split('.').reduce<unknown>((o, k) => (o as Messages | undefined)?.[k], messages);
    assert.equal(typeof v, 'string', key);
    return (v as string).replace(/\{(\w+)\}/g, (_, n: string) => String(vars[n]));
  };
}
const tFr = translator(fr.messages as Messages);
const tEn = translator(en.messages as Messages);

function el(open: OpenSpec, extra: Partial<Element> = {}): Element {
  return {
    key: 'local:/films/Amélie.mkv',
    source: { plugin: 'src-local', instance: '/films' },
    name: 'Amélie',
    open,
    tags: [],
    infos: {},
    images: {},
    added: 0,
    ...extra,
  };
}
const film = el(
  { kind: 'file', path: '/films/Amélie (2001).mkv' },
  {
    tags: ['local', 'video', 'movie'],
    infos: { year: 2001, genres: ['Comédie', 'Romance'], overview: 'Montmartre.' },
    images: { poster: '/img/a.jpg' },
  },
);
const KNOWN: TagSummary[] = [
  { id: 'video', name: 'Vidéo', origin: 'core', count: 3 },
  { id: 'movie', name: 'Films', origin: 'core', count: 2 },
  { id: 'local', name: 'Sur l’ordinateur', origin: 'core', count: 3 },
  { id: 'mes-favoris', name: 'Mes favoris', origin: 'user', count: 1 },
];

describe('éditeurs : genre et champs', () => {
  it('genre d’après l’ouverture puis le type de fichier', () => {
    assert.equal(editorKind(film), 'video');
    assert.equal(editorKind(el({ kind: 'file', path: '/m/a.flac' }, { tags: ['audio'] })), 'track');
    assert.equal(editorKind(el({ kind: 'file', path: '/i/a.jpg' }, { tags: ['image'] })), 'image');
    assert.equal(editorKind(el({ kind: 'game', console: 'snes', path: '/r/a.sfc' })), 'game');
    assert.equal(editorKind(el({ kind: 'program', path: 'C:/a.exe' })), 'program');
    assert.equal(editorKind(el({ kind: 'site', url: 'https://a' })), 'other');
    assert.equal(editorKind(el({ kind: 'file', path: '/d.txt' }, { tags: ['local'] })), 'other');
  });

  it('champs d’une vidéo : nom, année, genres, résumé, tags (noms affichés), image et fond', () => {
    const fields = editorFields(film, KNOWN, tFr).map(normalizeField);
    assert.deepEqual(
      fields.map((f) => [f.id, f.type]),
      [
        ['title', 'text'],
        ['year', 'text'],
        ['genres', 'text'],
        ['overview', 'textarea'],
        ['tags', 'list'],
        ['poster', 'image'],
        ['background', 'image'],
      ],
    );
    const v = Object.fromEntries(fields.map((f) => [f.id, f.value]));
    assert.deepEqual(v, {
      title: 'Amélie',
      year: '2001',
      genres: 'Comédie, Romance',
      overview: 'Montmartre.',
      tags: ['Sur l’ordinateur', 'Vidéo', 'Films'],
      poster: '/img/a.jpg',
      background: '',
    });
    assert.equal(fields[0].label, 'Nom');
    assert.equal(editorFields(film, KNOWN, tEn).map(normalizeField)[0].label, 'Name');
    assert.ok(fields.find((f) => f.id === 'background')!.wide);
  });

  it('champs d’un morceau et d’une image : nom, genres et tags, comme l’éditeur historique', () => {
    const track = el({ kind: 'file', path: '/m/a.flac' }, { tags: ['audio'] });
    assert.deepEqual(
      editorFields(track, KNOWN, tFr).map((f) => f.id),
      ['title', 'genres', 'tags'],
    );
  });

  it('titres et aide (adresse décodée)', () => {
    assert.equal(editorTitle('video', tFr), 'Modifier la vidéo');
    assert.equal(editorTitle('game', tEn), 'Edit game');
    assert.equal(editorHelp(film), '/films/Amélie (2001).mkv');
    assert.equal(editorHelp(el({ kind: 'file', path: 'http://nas/Am%C3%A9lie.mkv' })), 'http://nas/Amélie.mkv');
    assert.equal(editorHelp(el({ kind: 'site', url: 'https://x/%E0%A4%A' })), 'https://x/%E0%A4%A');
  });
});

describe('éditeurs : changements à enregistrer', () => {
  const fields = ['title', 'year', 'genres', 'overview'] as const;
  const initial = infoValues(film, fields);

  it('seuls les champs changés ; un champ vidé revient à l’automatique', () => {
    assert.deepEqual(infoChanges(initial, { ...initial }, fields), { changes: {}, invalid: [] });
    const r = infoChanges(initial, { ...initial, title: ' Le Fabuleux Destin ', year: '', genres: 'Comédie,Romance ', overview: '' }, fields);
    assert.deepEqual(r, { changes: { title: 'Le Fabuleux Destin', year: null, overview: null }, invalid: [] });
    assert.deepEqual(infoChanges(initial, { ...initial, genres: ' ' }, fields).changes, { genres: null });
    assert.deepEqual(infoChanges(initial, { ...initial, genres: 'Drame, Comédie' }, fields).changes, { genres: ['Drame', 'Comédie'] });
  });

  it('année : en chiffres, sinon signalée', () => {
    assert.deepEqual(infoChanges(initial, { ...initial, year: '2002' }, fields).changes, { year: 2002 });
    assert.deepEqual(infoChanges(initial, { ...initial, year: 'deux mille' }, fields), { changes: {}, invalid: ['year'] });
  });

  it('tags : retirés à la main, ajoutés (nom connu → son tag, nouveau nom → tag de l’utilisateur)', () => {
    const names = tagNames(film.tags, KNOWN);
    assert.deepEqual(tagChanges(film.tags, names, KNOWN), {});
    assert.deepEqual(tagChanges(film.tags, ['Vidéo', 'films', 'Mes favoris', 'À revoir', ' '], KNOWN), {
      local: false,
      'mes-favoris': true,
      'À revoir': true,
    });
    // Un tag non déclaré garde son identifiant comme nom.
    assert.deepEqual(tagNames(['anime'], KNOWN), ['anime']);
    assert.deepEqual(tagChanges(['anime'], [], KNOWN), { anime: false });
  });
});

describe('éditeurs : recherche en ligne', () => {
  it('vidéo (TMDB), jeu de console (libretro), programme (Steam) ; rien pour les autres', () => {
    assert.deepEqual(scrapeJob(film), { kind: 'video', item: { path: '/films/Amélie (2001).mkv', name: 'Amélie (2001).mkv', dir: '/films' } });
    assert.deepEqual(scrapeJob(el({ kind: 'game', console: 'snes', path: 'D:\\Roms\\Zelda (F).sfc' }, { name: 'Zelda' })), {
      kind: 'rom',
      item: { path: 'D:\\Roms\\Zelda (F).sfc', name: 'Zelda (F)', displayName: 'Zelda', emu: 'snes' },
    });
    assert.deepEqual(scrapeJob(el({ kind: 'program', path: 'steam://rungameid/42' }, { name: 'Portal' })), {
      kind: 'pc',
      item: { name: 'Portal', path: 'steam://rungameid/42' },
    });
    assert.equal(scrapeJob(el({ kind: 'file', path: '/m/a.flac' }, { tags: ['audio'] })), null);
    assert.equal(scrapeJob(el({ kind: 'site', url: 'https://a' })), null);
  });
});
