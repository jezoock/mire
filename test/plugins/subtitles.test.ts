// Sous-titres des plugins (P5-11b) : forme des résultats, lecture par le cœur (chemin réel, taille, adresse), dossier de
// la vidéo prêté pendant l'appel, plugin tiers, désactivé puis réactivé ; enfin le plugin inclus `mire.subtitles` avec
// le vrai contexte des plugins.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkSubtitles, createPluginBridges, readSubtitle, SUBTITLE_LIMITS, type BridgeService } from '../../src/main/plugins/bridges.ts';
import { findSubtitles } from '../../src/main/library/subtitles.ts';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';
import { bundledSubtitles } from './bundled-subtitles.ts';

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'mire-subs-')));
after(() => rmSync(root, { recursive: true, force: true }));

const films = path.join(root, 'Films');
const outside = path.join(root, 'Prive');
mkdirSync(films, { recursive: true });
mkdirSync(outside, { recursive: true });
const video = path.join(films, 'Film.mkv');
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nBonjour <b>toi</b>\n';
writeFileSync(video, 'film');
writeFileSync(path.join(films, 'Film.fr.srt'), SRT);
writeFileSync(path.join(films, 'Film.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n');
writeFileSync(path.join(films, 'Autre.srt'), SRT);
writeFileSync(path.join(outside, 'secret.srt'), SRT);
symlinkSync(path.join(outside, 'secret.srt'), path.join(films, 'Film.lien.srt'));

const P = 'mire.subtitles.test';
const entry: ContributionEntry = { pluginId: P, kind: 'subtitles', id: 'test', declaration: {} };

describe('checkSubtitles : forme des résultats d’un plugin', () => {
  const hosts = ['subs.exemple.org'];

  it('fichier .srt ou .vtt sous un dossier accordé ; adresse https: d’un hôte déclaré', () => {
    const raw = [
      { path: path.join(films, 'Film.fr.srt'), lang: 'fr', label: 'fr' },
      { path: path.join(films, 'Film.vtt') },
      { url: 'https://subs.exemple.org/a.srt', lang: 'pt-BR', label: 'Portugais' },
      // Écartés : hors des dossiers, relatif, autre extension, les deux à la fois, doublon.
      { path: path.join(outside, 'secret.srt') },
      { path: 'Films/Film.fr.srt' },
      { path: path.join(films, 'Film.mkv') },
      { path: path.join(films, 'Film.vtt'), url: 'https://subs.exemple.org/b.srt' },
      { path: path.join(films, '..', 'Films', 'Film.fr.srt') },
      // Adresses écartées : http:, hôte non déclaré, réseau local, identifiants.
      { url: 'http://subs.exemple.org/a.srt' },
      { url: 'https://autre.exemple.org/a.srt' },
      { url: 'https://192.168.1.2/a.srt' },
      { url: 'https://moi:mdp@subs.exemple.org/a.srt' },
      'texte',
      null,
    ];
    assert.deepEqual(checkSubtitles(raw, [films], hosts), [
      { path: path.join(films, 'Film.fr.srt'), lang: 'fr', label: 'fr' },
      { path: path.join(films, 'Film.vtt'), lang: '', label: '' },
      { url: 'https://subs.exemple.org/a.srt', lang: 'pt-BR', label: 'Portugais' },
    ]);
    // Sans dossier accordé, aucun fichier local.
    assert.deepEqual(checkSubtitles([{ path: path.join(films, 'Film.vtt') }], [], hosts), []);
  });

  it('libellé en texte simple et borné, langue vérifiée, nombre borné', () => {
    const [s] = checkSubtitles([{ path: path.join(films, 'Film.vtt'), lang: '<b>fr</b>', label: `a\u0000\n<img src=x>${'x'.repeat(500)}` }], [films], hosts);
    assert.equal(s.lang, '');
    assert.equal(s.label.length, SUBTITLE_LIMITS.label);
    assert.ok(!/[\u0000-\u001f]/.test(s.label));
    const many = Array.from({ length: 50 }, (_, i) => ({ url: `https://subs.exemple.org/${i}.srt` }));
    assert.equal(checkSubtitles(many, [], hosts).length, SUBTITLE_LIMITS.results);
    assert.throws(() => checkSubtitles({ path: video }, [films], hosts), /array/);
  });
});

describe('readSubtitle : lecture par le cœur', () => {
  it('SRT converti en WebVTT, VTT gardé ; le balisage reste du texte de sous-titre', async () => {
    const fr = await readSubtitle({ path: path.join(films, 'Film.fr.srt'), lang: 'fr', label: 'fr' }, [films]);
    assert.match(fr?.vtt ?? '', /^WEBVTT[\s\S]*00:00:01\.000 --> 00:00:02\.000\nBonjour <b>toi<\/b>/);
    const vtt = await readSubtitle({ path: path.join(films, 'Film.vtt'), lang: '', label: '' }, [films]);
    assert.match(vtt?.vtt ?? '', /Hello/);
  });

  it('un lien qui mène hors des dossiers accordés, un fichier absent ou trop gros : rien', async () => {
    assert.equal(await readSubtitle({ path: path.join(films, 'Film.lien.srt'), lang: '', label: '' }, [films]), null);
    assert.equal(await readSubtitle({ path: path.join(films, 'absent.srt'), lang: '', label: '' }, [films]), null);
    const big = path.join(films, 'Gros.srt');
    writeFileSync(big, Buffer.alloc(SUBTITLE_LIMITS.bytes + 1, 0x41));
    assert.equal(await readSubtitle({ path: big, lang: '', label: '' }, [films]), null);
    rmSync(big);
  });

  it('adresse : téléchargée sans suivre de redirection, taille bornée, format reconnu à son début', async () => {
    const asked: Array<[string, RequestRedirect | undefined]> = [];
    const routes: Record<string, () => Response> = {
      'https://subs.exemple.org/a': () => new Response('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nSalut\n'),
      'https://subs.exemple.org/b': () => new Response(SRT),
      'https://subs.exemple.org/absent.srt': () => new Response('', { status: 404 }),
      'https://subs.exemple.org/gros.srt': () => new Response('x', { headers: { 'content-length': String(SUBTITLE_LIMITS.bytes + 1) } }),
    };
    const fetch = async (url: string, init?: RequestInit) => {
      asked.push([url, init?.redirect]);
      return routes[url]();
    };
    const read = (url: string) => readSubtitle({ url, lang: 'fr', label: 'fr' }, [], { fetch });
    assert.match((await read('https://subs.exemple.org/a'))?.vtt ?? '', /^WEBVTT[\s\S]*Salut/);
    assert.match((await read('https://subs.exemple.org/b'))?.vtt ?? '', /^WEBVTT[\s\S]*00:00:01\.000/);
    assert.equal(await read('https://subs.exemple.org/absent.srt'), null);
    assert.equal(await read('https://subs.exemple.org/gros.srt'), null);
    assert.ok(asked.every(([, r]) => r === 'error'));
  });
});

/** Service factice : un fournisseur de sous-titres, dont `find` est donné par le test. */
function fakeService(find: (videoPath: string) => unknown, rights = { trusted: true, folders: true }) {
  const listeners: Array<(k: string[]) => void> = [];
  let entries: ContributionEntry[] = [entry];
  const calls: unknown[][] = [];
  const service: BridgeService = {
    contributions: (kind) => (kind === 'subtitles' ? entries : []),
    onContributionsChange: (l) => (listeners.push(l as never), () => {}),
    call: async (_id, kind, _c, method, args) => {
      calls.push([kind, method, ...(args ?? [])]);
      return find(args?.[0] as string);
    },
    levelOf: (id) => (entries.some((e) => e.pluginId === id) ? 'code' : null),
    folders: () => [],
    hosts: () => ['subs.exemple.org'],
    sourceRights: () => rights,
  };
  const set = (list: ContributionEntry[]) => {
    entries = list;
    for (const l of listeners) l(['subtitles']);
  };
  return { service, calls, enable: () => set([entry]), disable: () => set([]) };
}

const catalog = { setSource: () => {}, removeSource: () => {} };

describe('pont des sous-titres', () => {
  it('le plugin reçoit la vidéo ; son dossier lui est prêté pendant l’appel seulement ; le cœur lit les fichiers', async () => {
    let lentDuring: string[] = [];
    const ref: { b?: ReturnType<typeof createPluginBridges> } = {};
    const { service, calls } = fakeService(() => {
      lentDuring = ref.b!.lentFolders(P);
      return [{ path: path.join(films, 'Film.fr.srt'), lang: 'fr', label: 'fr' }, { path: path.join(films, 'Film.lien.srt') }];
    });
    ref.b = createPluginBridges({ service, catalog, log: () => {} });
    const subs = await ref.b.subtitles(video);
    assert.deepEqual(calls, [['subtitles', 'find', video]]);
    assert.deepEqual(lentDuring, [films]);
    assert.deepEqual(ref.b.lentFolders(P), []);
    assert.deepEqual(
      subs.map((s) => [s.lang, s.label]),
      [['fr', 'fr']],
    );
  });

  it('plugin tiers : jamais interrogé ; sans `folders` : aucun dossier prêté, fichiers locaux refusés', async () => {
    const third = fakeService(() => [{ url: 'https://subs.exemple.org/a.srt' }], { trusted: false, folders: true });
    assert.deepEqual(await createPluginBridges({ service: third.service, catalog, log: () => {} }).subtitles(video), []);
    assert.deepEqual(third.calls, []);
    let lent: string[] = ['?'];
    const ref: { b?: ReturnType<typeof createPluginBridges> } = {};
    const noFolders = fakeService(
      () => {
        lent = ref.b!.lentFolders(P);
        return [{ path: path.join(films, 'Film.fr.srt') }];
      },
      { trusted: true, folders: false },
    );
    ref.b = createPluginBridges({ service: noFolders.service, catalog, log: () => {} });
    assert.deepEqual(await ref.b.subtitles(video), []);
    assert.deepEqual(lent, []);
  });

  it('plugin désactivé : plus de sous-titres, sans erreur ; réactivé : ils reviennent', async () => {
    const { service, disable, enable } = fakeService(() => [{ path: path.join(films, 'Film.fr.srt'), lang: 'fr' }]);
    const logs: string[] = [];
    const b = createPluginBridges({ service, catalog, log: (m) => logs.push(m) });
    assert.equal((await b.subtitles(video)).length, 1);
    disable();
    assert.deepEqual(await b.subtitles(video), []);
    enable();
    assert.equal((await b.subtitles(video)).length, 1);
    assert.deepEqual(logs, []);
  });

  it('un plugin en panne ou qui rend n’importe quoi : rien, noté au journal ; le dossier est rendu', async () => {
    const logs: string[] = [];
    for (const find of [
      () => {
        throw new Error('panne');
      },
      () => 'pas une liste',
    ]) {
      const { service } = fakeService(find);
      const b = createPluginBridges({ service, catalog, log: (m) => logs.push(m) });
      assert.deepEqual(await b.subtitles(video), []);
      assert.deepEqual(b.lentFolders(P), []);
    }
    assert.equal(logs.length, 2);
  });

  it('chemin relatif ou vide : le plugin n’est pas interrogé', async () => {
    const { service, calls } = fakeService(() => []);
    const b = createPluginBridges({ service, catalog, log: () => {} });
    for (const p of ['', 'Films/Film.mkv']) assert.deepEqual(await b.subtitles(p), []);
    assert.deepEqual(calls, []);
  });
});

describe('bibliothèque : sous-titres d’une vidéo locale', () => {
  it('seulement une vidéo autorisée par la politique d’accès, chemin absolu ; libellé vide : « Sous-titres »', async () => {
    const asked: string[] = [];
    const plugins = async (p: string) => (asked.push(p), [{ label: '', lang: '', vtt: 'WEBVTT\n' }]);
    const opts = { remote: new Map(), plugins };
    assert.deepEqual(await findSubtitles(video, { ...opts, isAllowed: () => false }), []);
    for (const bad of [42, null, '', 'Films/Film.mkv', 'x'.repeat(5000)]) assert.deepEqual(await findSubtitles(bad, { ...opts, isAllowed: () => true }), []);
    assert.deepEqual(asked, []);
    assert.deepEqual(await findSubtitles(`${films}/./Film.mkv`, { ...opts, isAllowed: () => true }), [{ label: 'Sous-titres', lang: '', vtt: 'WEBVTT\n' }]);
    assert.deepEqual(asked, [video]);
    // Sans plugin, ou un plugin en panne : aucun sous-titre, sans erreur.
    assert.deepEqual(await findSubtitles(video, { remote: new Map(), isAllowed: () => true }), []);
    assert.deepEqual(await findSubtitles(video, { remote: new Map(), isAllowed: () => true, plugins: () => Promise.reject(new Error('x')) }), []);
  });
});

describe('plugin inclus mire.subtitles, avec le vrai contexte des plugins', () => {
  it('trouve les sous-titres posés à côté de la vidéo par `ctx.files`, dans le seul dossier prêté', async () => {
    const { bridges, call } = bundledSubtitles();
    const subs = await bridges.subtitles(video);
    // Le lien symbolique (`Film.lien.srt`) n'est pas suivi par `walk`.
    assert.deepEqual(subs.map((s) => [s.lang, s.label]).sort(), [
      ['', ''],
      ['fr', 'fr'],
    ]);
    assert.match(subs.find((s) => s.lang === 'fr')?.vtt ?? '', /^WEBVTT[\s\S]*Bonjour/);
    // Hors de l'appel, le plugin ne lit plus rien.
    await assert.rejects(call('files.walk')(films), /granted/);
  });
});
