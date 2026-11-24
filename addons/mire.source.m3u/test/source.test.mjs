// Listes M3U : reprise des tests du fournisseur « m3u » du cœur de Mire (test/library/http.test.ts et
// test/library/element-sources.test.ts, avant P5-12) : titres, logos, adresses relatives, type d'après l'extension
// ou celui demandé, clés `m3u:<liste>|<flux>`, liste inaccessible ; liste de cet ordinateur ; contrat attendu par le
// cœur (P5-11a, P5-12).
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import createSource, { LIST_TIMEOUT, MAX_ITEMS } from '../src/source.mjs';
import { cleanPath, entryKey, listElements, listName, normalizePath, normalizeUrl } from '../src/list.mjs';
import { parseM3U } from '../src/parse.mjs';
import { TEXT_CATALOGS } from '../src/texts.mjs';
import { fakeContext, local, online, tree } from './helpers.mjs';

const read = (rel) => JSON.parse(readFileSync(path.join(import.meta.dirname, '..', rel), 'utf8'));
const manifest = read('mire-plugin.json');

const BASE = 'http://192.168.1.10:8080';
const LIST = `${BASE}/listes/chaines.m3u`;
const CHAINES = '#EXTM3U\n#EXTINF:-1 tvg-logo="http://logo/a.png",Chaîne A\nhttp://flux/a\n#EXTINF:-1,Morceau\nmusique/b.mp3\nvideo/c.mkv\n';

describe('manifeste et contrat', () => {
  it('code limité, `folders` pour une liste de cet ordinateur, ni hôte ni réseau local', () => {
    assert.equal(manifest.id, 'mire.source.m3u');
    assert.equal(manifest.level, 'code');
    assert.deepEqual(manifest.permissions, { folders: true });
    assert.deepEqual(manifest.contributes.sources, [{ id: 'src-m3u', main: 'src/source.mjs' }]);
  });

  it('accepte une liste en ligne ou de cet ordinateur, avec un type de média', () => {
    const s = createSource(fakeContext().ctx);
    assert.equal(s.id, 'src-m3u');
    for (const l of [online(LIST), online('https://box/tv.M3U8?jeton=1', ['audio']), local('/home/moi/radios.m3u', ['audio']), local('D:\\Listes\\films.m3u8')])
      assert.ok(s.handles(l), JSON.stringify(l));
    for (const l of [
      online('http://nas/films/'),
      online(LIST, ['game']),
      online(LIST, []),
      local('/home/moi/Films'),
      local('\\\\NAS\\Listes\\tv.m3u', ['video'], true),
      online('ftp://box/tv.m3u'),
      null,
    ])
      assert.ok(!s.handles(l), JSON.stringify(l));
    assert.equal(s.instance(online(LIST)), LIST);
    assert.equal(s.instance(local('/home/moi/radios.m3u')), '/home/moi/radios.m3u');
  });

  it('textes du code identiques à ceux des catalogues', () => {
    for (const lang of ['fr', 'en']) {
      const { name, ...texts } = read(`i18n/${lang}.json`).messages.source;
      assert.ok(name);
      assert.deepEqual(texts, TEXT_CATALOGS[lang]);
    }
  });
});

describe('liste en ligne', () => {
  // Une ligne sans #EXTINF a pour titre l'adresse telle qu'écrite dans la liste.
  it('titres, logos, adresses relatives, type d’après l’extension ou celui demandé ; mêmes clés que le cœur', async () => {
    const { ctx, asked } = fakeContext({ urls: [LIST], lists: { [LIST]: CHAINES } });
    const s = createSource(ctx);
    const video = await s.scan(online(LIST, ['video']));
    assert.deepEqual(asked, [{ url: LIST, options: { timeout: LIST_TIMEOUT } }]);
    assert.deepEqual(video, [
      {
        key: `m3u:${LIST}|http://flux/a`,
        name: 'Chaîne A',
        open: { kind: 'stream', url: 'http://flux/a' },
        tags: ['remote'],
        infos: { playlist: 'chaines', mediaType: 'video' },
        images: { logo: 'http://logo/a.png' },
      },
      {
        key: `m3u:${LIST}|${BASE}/listes/video/c.mkv`,
        name: 'video/c.mkv',
        open: { kind: 'stream', url: `${BASE}/listes/video/c.mkv` },
        tags: ['remote'],
        infos: { playlist: 'chaines' },
        images: {},
      },
    ]);
    const audio = await s.scan(online(LIST, ['audio']));
    assert.deepEqual(
      audio.map((e) => [e.name, e.open.url, e.infos]),
      [
        ['Chaîne A', 'http://flux/a', { playlist: 'chaines', mediaType: 'audio' }],
        ['Morceau', `${BASE}/listes/musique/b.mp3`, { playlist: 'chaines' }],
      ],
    );
  });

  it('liste inaccessible (absente, serveur injoignable, adresse non accordée) : message affichable', async () => {
    const absent = fakeContext({ urls: [LIST] }).ctx;
    await assert.rejects(createSource(absent).scan(online(LIST)), { message: 'Liste de lecture inaccessible.' });
    const down = fakeContext({ urls: [LIST], down: true, locale: 'en' }).ctx;
    await assert.rejects(createSource(down).scan(online(LIST)), { message: "Can't open this playlist." });
    await assert.rejects(createSource(fakeContext().ctx).scan(online(LIST)), { message: 'Liste de lecture inaccessible.' });
  });

  it('clé : comme `m3uEntryKey` du cœur (liste et flux normalisés, `|` et `%` de la liste échappés)', () => {
    assert.equal(entryKey('HTTPS://Box/a|b%.m3u#x', 'HTTP://Flux:80/a#t'), 'm3u:https://box/a%7Cb%25.m3u|http://flux/a');
    assert.equal(normalizeUrl('https://box/tv.m3u#frag'), 'https://box/tv.m3u');
    assert.equal(listName('https://box/Mes%20cha%C3%AEnes.m3u8'), 'Mes chaînes');
  });

  it('nombre maximal d’éléments', () => {
    const entries = parseM3U(Array.from({ length: 10 }, (_, i) => `http://flux/${i}.mp4`).join('\n'));
    assert.equal(listElements(LIST, entries, ['video'], 3).length, 3);
    assert.equal(MAX_ITEMS, 150000);
  });
});

describe('liste de cet ordinateur', () => {
  const t = tree({
    'Listes/radios.m3u':
      '#EXTM3U\n#EXTINF:-1 tvg-logo="https://logo/r.png",Radio\nhttps://flux/radio\n#EXTINF:-1,Début\nMusique/01 - Début.mp3\n../Ailleurs/x.mp3\nnotes.txt\n',
  });
  after(t.remove);
  const list = t.at('Listes/radios.m3u');

  it('flux et fichiers cités (relatifs à la liste), lus dans le dossier accordé', async () => {
    const s = createSource(fakeContext({ folders: [path.dirname(list)] }).ctx);
    const els = await s.scan(local(list, ['audio']));
    assert.deepEqual(
      els.map((e) => [e.key, e.name, e.open, e.tags]),
      [
        [entryKey(list, 'https://flux/radio'), 'Radio', { kind: 'stream', url: 'https://flux/radio' }, ['remote']],
        [entryKey(list, t.at('Listes/Musique/01 - Début.mp3')), 'Début', { kind: 'file', path: t.at('Listes/Musique/01 - Début.mp3') }, ['local']],
        // Hors du dossier de la liste : Mire l'écartera (dossier non accordé), le plugin ne le cache pas.
        [entryKey(list, t.at('Ailleurs/x.mp3')), '../Ailleurs/x.mp3', { kind: 'file', path: t.at('Ailleurs/x.mp3') }, ['local']],
      ],
    );
    assert.deepEqual(els[0].images, { logo: 'https://logo/r.png' });
    assert.deepEqual(els[1].infos, { playlist: 'radios' });
  });

  it('liste illisible (dossier non accordé, fichier absent) : message affichable', async () => {
    await assert.rejects(createSource(fakeContext().ctx).scan(local(list, ['audio'])), { message: 'Liste de lecture inaccessible.' });
    const s = createSource(fakeContext({ folders: [path.dirname(list)] }).ctx);
    await assert.rejects(s.scan(local(t.at('Listes/absente.m3u'), ['audio'])), { message: 'Liste de lecture inaccessible.' });
  });

  it('chemins : résolus, séparateur du système du chemin ; clé comme `normalizePath` du cœur', () => {
    assert.equal(cleanPath('/a/./b//c/../d/'), '/a/b/d');
    assert.equal(cleanPath('/../a'), '/a');
    assert.equal(cleanPath('C:/Listes/../Musique/x.mp3'), 'C:\\Musique\\x.mp3');
    assert.equal(cleanPath('C:\\..\\x.mp3'), 'C:\\x.mp3');
    assert.equal(cleanPath('\\\\NAS\\Partage\\a\\..\\b.mp3'), '\\\\NAS\\Partage\\b.mp3');
    assert.equal(normalizePath('D:\\Listes\\Films.M3U'), 'd:/listes/films.m3u');
    assert.equal(normalizePath('C:\\'), 'c:/');
    assert.equal(normalizePath('/home/moi/Listes/'), '/home/moi/Listes');
    const win = listElements('D:\\Listes\\films.m3u', parseM3U('..\\Films\\Amélie.mkv\nhttps://flux/x.mkv'), ['video'], 10);
    assert.deepEqual(
      win.map((e) => [e.key, e.open]),
      [
        ['m3u:d:/listes/films.m3u|d:/films/amélie.mkv', { kind: 'file', path: 'D:\\Films\\Amélie.mkv' }],
        ['m3u:d:/listes/films.m3u|https://flux/x.mkv', { kind: 'stream', url: 'https://flux/x.mkv' }],
      ],
    );
  });
});

describe('lecture M3U', () => {
  it('titre après la première virgule hors guillemets, attributs, lignes sans #EXTINF', () => {
    assert.deepEqual(
      parseM3U('#EXTM3U\r\n#EXTINF:-1 tvg-name="A, B" group-title="Info" tvg-chno="3",Titre, avec virgule\r\nhttp://x\r\n\r\n# note\r\nhttp://y'),
      [
        { title: 'Titre, avec virgule', logo: '', group: 'Info', chno: '3', url: 'http://x' },
        { title: 'http://y', url: 'http://y', logo: '', group: '', chno: '' },
      ],
    );
  });
});
