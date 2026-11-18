// Éditeurs (P4-22) : genre d'un élément, champs du formulaire, changements à enregistrer (infos et tags), demande de
// recherche en ligne.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Element, OpenSpec, TagSummary } from '@mire/shared';
import { normalizeField } from '@mire/ui/utils';
import { EditorController } from '../../src/renderer/controllers/editor.ts';
import type { ControllerContext } from '../../src/renderer/controllers/types.ts';
import type { FormOptions } from '../../src/renderer/ui/dialogs.ts';
import type { Candidate } from '../../src/renderer/editors/model.ts';
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
    let v = key.split('.').reduce<unknown>((o, k) => (o as Messages | undefined)?.[k], messages);
    // Pluriel : forme `one` ou `other` selon `count`.
    if (v && typeof v === 'object' && 'count' in vars) v = (v as Messages)[vars.count === 1 ? 'one' : 'other'];
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

describe('éditeurs : contrôleur mire-editor', () => {
  // Contexte factice : le formulaire « clique » sur les boutons donnés, dans l'ordre, avec les valeurs saisies.
  function harness(clicks: { action: string; values?: Record<string, unknown> }[], api: Record<string, unknown> = {}) {
    const calls: [string, ...unknown[]][] = [];
    const toasts: string[] = [];
    const helps: string[] = [];
    let current: Element | null = film;
    const fakeApi = {
      catalogElement: async () => current,
      tagsList: async () => KNOWN,
      catalogSetInfos: async (...a: unknown[]) => (calls.push(['setInfos', ...a]), current),
      catalogSetTags: async (...a: unknown[]) => (calls.push(['setTags', ...a]), current),
      catalogReset: async (...a: unknown[]) => (calls.push(['reset', ...a]), current),
      catalogPickImage: async (...a: unknown[]) => (calls.push(['pickImage', ...a]), { ...film, images: { poster: '/meta/img/n.jpg' } }),
      catalogClearImages: async (...a: unknown[]) => (calls.push(['clearImages', ...a]), { ...film, images: {} }),
      ...api,
    };
    let opened: FormOptions | null = null;
    const ctx = {
      api: fakeApi,
      t: tFr,
      toast: (m: string) => toasts.push(m),
      ui: { afterEdit: () => calls.push(['afterEdit']) },
      dialogs: {
        async form(opts: FormOptions) {
          opened = opts;
          let values: Record<string, unknown> = Object.fromEntries((opts.fields ?? []).map((f) => [f.id, normalizeField(f).value]));
          const form = {
            values: () => values,
            set: (id: string, v: unknown) => (values = { ...values, [id]: v }),
            setImage: (id: string, v: unknown) => (values = { ...values, [id]: v }),
            help: (h: string) => helps.push(h),
          };
          for (const c of clicks) {
            values = { ...values, ...c.values };
            const keep = await opts.onAction!(c.action, form as never);
            if (!keep) return { action: c.action, values };
          }
          return { action: 'cancel', values };
        },
        pick: async (items: Candidate[]) => items[0],
      },
    } as unknown as ControllerContext;
    return { ctrl: new EditorController(ctx), calls, toasts, helps, opened: () => opened, gone: () => (current = null) };
  }

  it('enregistrer : seulement les infos et les tags changés, puis un message', async () => {
    const h = harness([{ action: 'save', values: { title: 'Le Fabuleux Destin', tags: ['Vidéo', 'Films', 'Mes favoris'] } }]);
    assert.equal(await h.ctrl.edit({ key: film.key }), 'save');
    assert.deepEqual(h.calls, [
      ['setInfos', film.key, { title: 'Le Fabuleux Destin' }],
      ['setTags', film.key, { local: false, 'mes-favoris': true }],
      ['afterEdit'],
    ]);
    assert.deepEqual(h.toasts, ['Modifications enregistrées']);
    assert.deepEqual(
      h.opened()!.actions.map((a) => a.id),
      ['save', 'online', 'reset', 'cancel'],
    );
  });

  it('année invalide : la boîte reste ouverte avec un message', async () => {
    const h = harness([{ action: 'save', values: { year: 'deux mille' } }]);
    assert.equal(await h.ctrl.edit({ key: film.key }), 'cancel');
    assert.deepEqual(h.helps, ['L’année s’écrit en chiffres, par exemple 1999.']);
    assert.deepEqual(h.calls, []);
  });

  it('images (choisir, retirer) sans fermer, puis réinitialiser', async () => {
    const h = harness([{ action: 'pick:poster' }, { action: 'clear:background' }, { action: 'reset' }]);
    assert.equal(await h.ctrl.edit({ key: film.key }), 'reset');
    assert.deepEqual(h.calls, [['pickImage', film.key, 'poster'], ['clearImages', film.key, ['background']], ['reset', film.key], ['afterEdit']]);
    assert.deepEqual(h.toasts, ['Infos d’origine rétablies']);
  });

  it('rechercher en ligne : fiche choisie, infos saisies retirées, champs remplis', async () => {
    const scraped = { ...film, infos: { ...film.infos, title: 'Le Fabuleux Destin d’Amélie Poulain', year: 2001 } };
    const h = harness([{ action: 'online' }, { action: 'save' }], {
      scrapeCandidates: async (job: unknown) => (h.calls.push(['candidates', job]), { ok: true, items: [{ title: 'Amélie', id: 194 }] }),
      scrapeOne: async (job: unknown) => (h.calls.push(['one', job]), { ok: true }),
      catalogSetInfos: async (...a: unknown[]) => (h.calls.push(['setInfos', ...a]), scraped),
    });
    await h.ctrl.edit({ key: film.key });
    assert.deepEqual(h.calls[0], ['candidates', { ...scrapeJob(film), query: 'Amélie', year: '2001' }]);
    assert.deepEqual(h.calls[1], ['one', { ...scrapeJob(film), override: { pick: { title: 'Amélie', id: 194 } } }]);
    assert.deepEqual(h.calls[2], ['setInfos', film.key, { title: null, year: null, genres: null, overview: null }]);
    // Le titre de la fiche est proposé comme nom, et s'enregistre.
    assert.deepEqual(h.calls[3], ['setInfos', film.key, { title: 'Le Fabuleux Destin d’Amélie Poulain' }]);
    assert.equal(h.helps.at(-1), 'Fiche « Amélie » récupérée : vérifiez les champs, puis enregistrez.');
  });

  it('rechercher en ligne : rien trouvé, erreur du fournisseur', async () => {
    const none = harness([{ action: 'online' }], { scrapeCandidates: async () => ({ ok: true, items: [] }) });
    await none.ctrl.edit({ key: film.key });
    assert.match(none.helps.at(-1)!, /^Aucune fiche trouvée/);
    const err = harness([{ action: 'online' }], { scrapeCandidates: async () => ({ ok: false, error: 'Clé TMDB refusée.' }) });
    await err.ctrl.edit({ key: film.key });
    assert.equal(err.helps.at(-1), 'Clé TMDB refusée.');
  });

  it('élément disparu : un message, pas de boîte', async () => {
    const h = harness([]);
    h.gone();
    assert.equal(await h.ctrl.edit({ key: film.key }), null);
    assert.deepEqual(h.toasts, ['Cet élément n’est plus dans la bibliothèque.']);
    assert.equal(h.opened(), null);
  });
});
