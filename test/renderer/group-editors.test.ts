// Éditeurs des regroupements (P4-22) : champs d'un album ou d'une série, valeurs communes à leurs éléments,
// modification à enregistrer (nom, infos, tags), recherche en ligne, regroupement désigné par l'action d'une carte,
// contrôleur avec un faux client.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogGroup, Element, TagSummary } from '@mire/shared';
import { normalizeField } from '@mire/ui/utils';
import { EditorController } from '../../src/renderer/controllers/editor.ts';
import type { ControllerContext } from '../../src/renderer/controllers/types.ts';
import type { FormOptions } from '../../src/renderer/ui/dialogs.ts';
import type { Candidate } from '../../src/renderer/editors/model.ts';
import {
  commonImage,
  commonInfo,
  commonTags,
  factValues,
  groupEdit,
  groupFields,
  groupKind,
  groupRefOfAction,
  groupScrapeJob,
  groupTitle,
  groupValues,
} from '../../src/renderer/editors/group-model.ts';
import fr from '../../packages/shared/src/i18n/locales/fr.json' with { type: 'json' };
import en from '../../packages/shared/src/i18n/locales/en.json' with { type: 'json' };

type Messages = Record<string, unknown>;
function translator(messages: Messages) {
  return (key: string, vars: Record<string, string | number> = {}) => {
    let v = key.split('.').reduce<unknown>((o, k) => (o as Messages | undefined)?.[k], messages);
    if (v && typeof v === 'object' && 'count' in vars) v = (v as Messages)[vars.count === 1 ? 'one' : 'other'];
    assert.equal(typeof v, 'string', key);
    return (v as string).replace(/\{(\w+)\}/g, (_, n: string) => String(vars[n]));
  };
}
const tFr = translator(fr.messages as Messages);
const tEn = translator(en.messages as Messages);

function track(n: number, extra: Partial<Element> = {}): Element {
  return {
    key: `local:/bib/Orchestre/Premier album/0${n}.mp3`,
    source: { plugin: 'src-local', instance: '/bib' },
    name: `0${n}.mp3`,
    open: { kind: 'file', path: `/bib/Orchestre/Premier album/0${n}.mp3` },
    tags: ['local', 'audio', 'jazz'],
    infos: { artist: 'Orchestre', album: 'Premier album', genres: ['Jazz'] },
    images: {},
    added: 0,
    ...extra,
  };
}
const ALBUM: CatalogGroup = {
  page: 'music',
  path: ['Orchestre', 'Premier album'],
  info: 'album',
  value: 'Premier album',
  elements: [
    track(1, { infos: { artist: 'Orchestre', album: 'Premier album', genres: ['Jazz'], year: 1999 } }),
    track(2, { tags: ['local', 'audio'], images: { poster: '/img/p.jpg' } }),
  ],
};
const KNOWN: TagSummary[] = [
  { id: 'local', name: 'Sur l’ordinateur', origin: 'core', count: 2 },
  { id: 'audio', name: 'Musique', origin: 'core', count: 2 },
];

describe('éditeurs des regroupements : champs et valeurs communes', () => {
  it('genre d’après l’info qui forme le regroupement ; titres en français et en anglais', () => {
    assert.equal(groupKind('album'), 'album');
    assert.equal(groupKind('series'), 'series');
    assert.equal(groupKind('season'), 'other');
    assert.equal(groupTitle('album', tFr), 'Modifier l’album');
    assert.equal(groupTitle('series', tEn), 'Edit TV show');
    assert.equal(groupTitle('other', tFr), 'Modifier le regroupement');
  });

  it('valeurs communes : une valeur partagée, « plusieurs valeurs », tags de tous, image', () => {
    assert.deepEqual(commonInfo(ALBUM.elements, 'artist'), { value: 'Orchestre', mixed: false });
    assert.deepEqual(commonInfo(ALBUM.elements, 'year'), { value: '', mixed: true });
    assert.deepEqual(commonInfo(ALBUM.elements, 'overview'), { value: '', mixed: false });
    assert.deepEqual(commonTags(ALBUM.elements), ['local', 'audio']);
    assert.equal(commonImage(ALBUM.elements, 'poster'), '/img/p.jpg');
    assert.deepEqual(groupValues(ALBUM), { name: 'Premier album', artist: 'Orchestre', year: '', genres: 'Jazz' });
  });

  it('champs d’un album : nom, artiste, année (plusieurs valeurs), genres, tags communs, image', () => {
    const fields = groupFields(ALBUM, KNOWN, tFr);
    assert.deepEqual(
      fields.map((f) => [f.id, f.label]),
      [
        ['name', 'Nom'],
        ['artist', 'Artiste'],
        ['year', 'Année'],
        ['genres', 'Genres'],
        ['tags', 'Tags'],
        ['poster', 'Image'],
      ],
    );
    assert.equal(fields[2].placeholder, 'Plusieurs valeurs');
    assert.deepEqual(fields[4].value, ['Sur l’ordinateur', 'Musique']);
    const series = groupFields({ ...ALBUM, info: 'series', value: 'Friends' }, KNOWN, tEn);
    assert.deepEqual(
      series.map((f) => f.id),
      ['name', 'year', 'genres', 'overview', 'tags', 'poster', 'background'],
    );
    assert.equal(series[0].value, 'Friends');
    assert.equal(groupFields({ ...ALBUM, info: 'season', value: null }, KNOWN, tFr)[0].value, '');
  });
});

describe('éditeurs des regroupements : modification à enregistrer', () => {
  const initial = groupValues(ALBUM);
  const values = (v: Record<string, unknown>) => ({ ...initial, tags: ['Sur l’ordinateur', 'Musique'], ...v });

  it('nom changé, infos changées, tags communs ajoutés ou retirés', () => {
    const { edit, invalid } = groupEdit(ALBUM, initial, values({ name: ' Premier album (réédition) ', year: '2001', tags: ['Musique', 'À écouter'] }), KNOWN);
    assert.deepEqual(invalid, []);
    assert.deepEqual(edit, { rename: 'Premier album (réédition)', infos: { year: 2001 }, tags: { local: false, 'À écouter': true } });
  });

  it('rien de changé ; un champ « plusieurs valeurs » laissé vide ne change rien', () => {
    assert.deepEqual(groupEdit(ALBUM, initial, values({}), KNOWN), { edit: {}, invalid: [] });
  });

  it('nom vidé ou année invalide : refusés', () => {
    assert.deepEqual(groupEdit(ALBUM, initial, values({ name: ' ' }), KNOWN).invalid, ['name']);
    assert.deepEqual(groupEdit(ALBUM, initial, values({ year: 'mil neuf cent' }), KNOWN).invalid, ['year']);
  });

  it('recherche en ligne : MusicBrainz pour un album, TMDB (séries) pour une série, rien sinon', () => {
    assert.deepEqual(groupScrapeJob('album'), { kind: 'album', item: {} });
    assert.deepEqual(groupScrapeJob('series'), { kind: 'video', item: { tv: true } });
    assert.equal(groupScrapeJob('other'), null);
    assert.deepEqual(factValues({ title: 'Kind of Blue', year: '1959', genre: 'Jazz', artist: 'Miles Davis', overview: 'x' }, 'album'), {
      name: 'Kind of Blue',
      artist: 'Miles Davis',
      year: '1959',
      genres: 'Jazz',
    });
  });

  it('regroupement désigné par l’action de sa carte : page affichée, ou accueil (page donnée)', () => {
    const route = { page: 'music', path: ['Orchestre'] };
    assert.deepEqual(groupRefOfAction('openGroup:[{"value":"Premier album"}]', 'mire-page', route), { page: 'music', path: ['Orchestre', 'Premier album'] });
    assert.deepEqual(groupRefOfAction('openGroup:[{"target":"movies","value":"Drame"}]', 'mire-home', null), { page: 'movies', path: ['Drame'] });
    assert.deepEqual(groupRefOfAction('openGroup:[{"value":null}]', 'mire-page', route), { page: 'music', path: ['Orchestre', null] });
    assert.equal(groupRefOfAction('openGroup:[{"value":"A"}]', 'mire-page', null), null);
    assert.equal(groupRefOfAction('openElement:[{"key":"a"}]', 'mire-page', route), null);
    assert.equal(groupRefOfAction('openGroup:pas du json', 'mire-page', route), null);
    assert.equal(groupRefOfAction(null, null, route), null);
  });
});

describe('éditeurs des regroupements : contrôleur mire-editor', () => {
  function harness(clicks: { action: string; values?: Record<string, unknown> }[], api: Record<string, unknown> = {}) {
    const calls: [string, ...unknown[]][] = [];
    const toasts: string[] = [];
    const helps: string[] = [];
    let current: CatalogGroup | null = ALBUM;
    const fakeApi = {
      catalogGroup: async () => current,
      tagsList: async () => KNOWN,
      catalogEditGroup: async (...a: unknown[]) => (calls.push(['edit', ...a]), current),
      catalogGroupPickImage: async (...a: unknown[]) => (calls.push(['pickImage', ...a]), current),
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
  const ref = { page: 'music', path: ['Orchestre', 'Premier album'] };

  it('enregistrer : une seule modification pour tout l’album, puis un message', async () => {
    const h = harness([{ action: 'save', values: { name: 'Nouveau nom', tags: ['Musique'] } }]);
    assert.equal(await h.ctrl.editGroup(ref), 'save');
    assert.deepEqual(h.calls, [['edit', 'music', ref.path, { rename: 'Nouveau nom', tags: { local: false } }], ['afterEdit']]);
    assert.deepEqual(h.toasts, ['Modifications enregistrées']);
    assert.equal(h.opened()!.title, 'Modifier l’album');
    assert.equal(h.opened()!.help, 'Les modifications valent pour ses 2 éléments.');
    assert.deepEqual(
      h.opened()!.actions.map((a) => a.id),
      ['save', 'online', 'reset', 'cancel'],
    );
  });

  it('nom vidé : la boîte reste ouverte avec un message ; rien de changé : aucun appel', async () => {
    const h = harness([
      { action: 'save', values: { name: '' } },
      { action: 'save', values: { name: 'Premier album' } },
    ]);
    assert.equal(await h.ctrl.editGroup(ref), 'save');
    assert.deepEqual(h.helps, ['Donnez un nom à ce regroupement.']);
    assert.deepEqual(h.calls, [['afterEdit']]);
  });

  it('images (choisir, retirer) sans fermer, puis réinitialiser', async () => {
    const h = harness([{ action: 'pick:poster' }, { action: 'clear:poster' }, { action: 'reset' }]);
    assert.equal(await h.ctrl.editGroup(ref), 'reset');
    assert.deepEqual(h.calls, [
      ['pickImage', 'music', ref.path, 'poster'],
      ['edit', 'music', ref.path, { clearImages: ['poster'] }],
      ['edit', 'music', ref.path, { reset: true }],
      ['afterEdit'],
    ]);
    assert.deepEqual(h.toasts, ['Infos d’origine rétablies']);
  });

  it('rechercher en ligne : fiche choisie, champs remplis, puis enregistrés', async () => {
    const h = harness([{ action: 'online' }, { action: 'save' }], {
      scrapeCandidates: async (job: unknown) => (h.calls.push(['candidates', job]), { ok: true, items: [{ title: 'Premier album', id: 'mb-1' }] }),
      catalogGroupFetch: async (...a: unknown[]) => (
        h.calls.push(['fetch', ...a]),
        { ok: true, facts: { title: 'Premier Album', year: '1999', genre: 'Jazz, Swing', artist: 'Orchestre' }, group: ALBUM }
      ),
    });
    await h.ctrl.editGroup(ref);
    assert.deepEqual(h.calls[0], ['candidates', { kind: 'album', item: {}, query: 'Premier album', year: '', artist: 'Orchestre' }]);
    assert.deepEqual(h.calls[1], ['fetch', 'music', ref.path, { kind: 'album', item: {}, pick: { title: 'Premier album', id: 'mb-1' } }]);
    assert.deepEqual(h.calls[2], ['edit', 'music', ref.path, { rename: 'Premier Album', infos: { year: 1999, genres: ['Jazz', 'Swing'] } }]);
    assert.equal(h.helps.at(-1), 'Fiche « Premier album » récupérée : vérifiez les champs, puis enregistrez.');
  });

  it('recherche en ligne : erreur du fournisseur, rien trouvé', async () => {
    const failing = harness([{ action: 'online' }], { scrapeCandidates: async () => ({ ok: false, error: 'Clé TMDB manquante.' }) });
    await failing.ctrl.editGroup(ref);
    assert.equal(failing.helps.at(-1), 'Clé TMDB manquante.');
    const none = harness([{ action: 'online' }], { scrapeCandidates: async () => ({ ok: true, items: [] }) });
    await none.ctrl.editGroup(ref);
    assert.match(none.helps.at(-1)!, /^Aucune fiche trouvée/);
    const refused = harness([{ action: 'online' }], {
      scrapeCandidates: async () => ({ ok: true, items: [{ title: 'A', id: 'x' }] }),
      catalogGroupFetch: async () => ({ ok: false }),
    });
    await refused.ctrl.editGroup(ref);
    assert.equal(refused.helps.at(-1), 'Impossible de récupérer cette fiche.');
  });

  it('regroupement disparu : un message, pas de boîte', async () => {
    const h = harness([]);
    h.gone();
    assert.equal(await h.ctrl.editGroup(ref), null);
    assert.deepEqual(h.toasts, ['Ce regroupement n’est plus dans la bibliothèque.']);
    assert.equal(h.opened(), null);
  });
});
