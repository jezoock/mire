// Administration des pages (P4-21) : liste du panneau « Pages », formulaire d'une page (onglets), définition tirée de
// ses valeurs, et parcours du contrôleur (créer « Films des années 90 », compter, modifier, revenir à l'origine, supprimer).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CATALOGS, createI18n } from '@mire/shared/i18n';
import { validatePage, type PageDefinition, type PageOverview, type TagSummary } from '@mire/shared';
import { normalizeField } from '@mire/ui/utils';
import type { FormValues } from '@mire/ui/utils';
import { BUILTIN_PAGES } from '../../src/main/catalog/pages/builtin.ts';
import { newPageId, pageFormTabs, pageFromForm, pagesGroup, previewText, tagIdOf } from '../../src/renderer/settings/pages.ts';
import { settingsPanels } from '../../src/renderer/settings/index.ts';
import { SettingsController } from '../../src/renderer/controllers/settings.ts';
import type { ControllerContext } from '../../src/renderer/controllers/types.ts';
import type { FormOptions } from '../../src/renderer/ui/dialogs.ts';

const fr = createI18n({ locale: 'fr', catalogs: BUILTIN_CATALOGS });
const en = createI18n({ locale: 'en', catalogs: BUILTIN_CATALOGS });
const t = fr.t;

const KNOWN: TagSummary[] = [
  { id: 'video', name: 'Vidéo', origin: 'core', count: 4 },
  { id: 'movie', name: 'Films', origin: 'core', count: 4 },
  { id: 'series', name: 'Séries', origin: 'core', count: 0 },
  { id: 'vus', name: 'Vus', origin: 'user', count: 1 },
];
const MOVIES = BUILTIN_PAGES[0] as PageDefinition;

/** Valeurs de départ du formulaire d'une page, comme les rend `mire-form`. */
const initial = (page: PageDefinition | null): FormValues =>
  Object.fromEntries(pageFormTabs(page, KNOWN, t).flatMap((tab) => tab.fields.map((f) => [f.id, normalizeField(f).value])));

describe('pages : liste du panneau', () => {
  const overview: PageOverview[] = [
    { page: MOVIES, origin: 'modified', count: 12 },
    { page: { id: 'films-des-annees-90', name: 'Films des années 90', require: ['movie'] }, origin: 'user', count: 1 },
  ];

  it('nom, nombre d’éléments, origine, place dans le menu ; « Revenir à l’origine » pour une page modifiée', () => {
    const g = pagesGroup(overview, t);
    assert.equal(g.key, 'pages');
    assert.deepEqual(
      g.entries.map((e) => [e.id, e.label, e.sub, !!e.restore]),
      [
        ['movies', 'Films', '12 éléments · Prête à l’emploi, modifiée · Dans le menu', true],
        ['films-des-annees-90', 'Films des années 90', '1 élément · Créée par vous', false],
      ],
    );
    assert.equal(g.edit, true);
    assert.equal(g.remove, true);
    assert.deepEqual(g.buttons, [{ label: 'Créer une page', action: 'createEntry' }]);
    assert.equal(pagesGroup(overview, en.t).entries[0]?.sub, '12 items · Ready-made, changed · In the menu');
  });

  it('panneau « Pages » de l’écran Réglages, après ceux du schéma', () => {
    const panels = settingsPanels({
      t,
      config: {},
      languages: [],
      sites: [],
      pageThemes: [],
      currentPageTheme: 'mire',
      homeLists: [],
      plugins: [],
      pages: overview,
    });
    const panel = panels.find((p) => p.id === 'pages');
    assert.equal(panel?.title, 'Pages');
    assert.equal(panel?.fields[0]?.groups?.[0]?.entries.length, 2);
    assert.ok(panels.indexOf(panel!) < panels.findIndex((p) => p.id === 'drm'));
  });
});

describe('pages : formulaire', () => {
  it('trois onglets ; une page existante remplit ses champs (noms des tags, conditions, regroupements, tri)', () => {
    const page: PageDefinition = {
      ...MOVIES,
      exclude: ['vus'],
      where: [
        { info: 'year', between: [1990, 1999] },
        { info: 'genres', contains: 'drame' },
      ],
    };
    const tabs = pageFormTabs(page, KNOWN, t);
    assert.deepEqual(
      tabs.map((x) => x.label),
      ['Général', 'Éléments', 'Rangement'],
    );
    const v = initial(page);
    assert.equal(v.name, 'Films');
    assert.deepEqual(v.require, ['Vidéo', 'Films']);
    assert.deepEqual(v.exclude, ['Vus']);
    assert.deepEqual([v['where0.info'], v['where0.op'], v['where0.value'], v['where0.to']], ['year', 'between', '1990', '1999']);
    assert.deepEqual([v['where1.info'], v['where1.op'], v['where1.value']], ['genres', 'contains', 'drame']);
    assert.equal(v['where2.info'], '');
    assert.deepEqual([v.groupBy0, v.groupBy1], ['genres', '']);
    assert.deepEqual([v['sort0.by'], v['sort1.by'], v['sort1.order']], ['title', 'year', 'asc']);
    assert.deepEqual([v.display, v.pinned, v.order], ['posters', true, '1']);
  });

  it('une page modifiée sans changement garde sa définition (nom traduit, icône)', () => {
    const r = pageFromForm(initial(MOVIES), MOVIES, KNOWN, [], t);
    assert.deepEqual(r, { ok: true, page: MOVIES });
  });

  it('« Films des années 90 » : nouvelle page, identifiant tiré du nom, tags désignés par leur nom', () => {
    const values = { ...initial(null), name: 'Films des années 90', require: ['films'], 'where0.info': 'year', 'where0.value': '1990', 'where0.to': '1999' };
    const r = pageFromForm(values, null, KNOWN, ['movies'], t);
    assert.deepEqual(r, {
      ok: true,
      page: {
        id: 'films-des-annees-90',
        name: 'Films des années 90',
        require: ['movie'],
        where: [{ info: 'year', between: [1990, 1999] }],
        display: 'posters',
        menu: { pinned: true },
      },
    });
    assert.equal(r.ok && validatePage(r.page).ok, true);
  });

  it('conditions : égal à, contient, bornes inversées, texte ; condition incomplète refusée', () => {
    const base = { ...initial(null), name: 'P' };
    const where = (extra: Record<string, unknown>) => {
      const r = pageFromForm({ ...base, ...extra } as FormValues, null, KNOWN, [], t);
      return r.ok ? r.page.where : r.error;
    };
    assert.deepEqual(where({ 'where0.info': 'year', 'where0.op': 'equals', 'where0.value': '1994' }), [{ info: 'year', equals: 1994 }]);
    assert.deepEqual(where({ 'where0.info': 'artist', 'where0.op': 'equals', 'where0.value': '1994' }), [{ info: 'artist', equals: '1994' }]);
    assert.deepEqual(where({ 'where0.info': 'genres', 'where0.op': 'contains', 'where0.value': 'Drame' }), [{ info: 'genres', contains: 'Drame' }]);
    assert.deepEqual(where({ 'where0.info': 'year', 'where0.value': '1999', 'where0.to': '1990' }), [{ info: 'year', between: [1990, 1999] }]);
    assert.deepEqual(where({ 'where0.info': 'year', 'where0.value': '1994' }), [{ info: 'year', between: [1994, 1994] }]);
    assert.deepEqual(where({ 'where0.info': 'title', 'where0.value': 'A', 'where0.to': 'M' }), [{ info: 'title', between: ['A', 'M'] }]);
    assert.equal(where({ 'where0.info': 'year', 'where0.value': '' }), 'settingsView.pages.errors.condition');
    assert.equal(where({ 'where0.info': 'year', 'where0.value': 'quatre-vingt' }), 'settingsView.pages.errors.condition');
    assert.equal(where({ 'where0.info': '', 'where0.value': 'oublié' }), undefined);
  });

  it('regroupements, tri, affichage, place dans le menu ; erreurs du nom et de la place', () => {
    const values = {
      ...initial(null),
      name: 'Musique récente',
      require: ['Musique'],
      exclude: ['Vus'],
      groupBy0: 'artist',
      groupBy1: 'artist',
      groupBy2: 'album',
      'sort0.by': 'added',
      'sort0.order': 'desc',
      display: 'list',
      pinned: false,
      order: '2,5',
    };
    const r = pageFromForm(values, null, KNOWN, [], t);
    assert.ok(r.ok);
    assert.deepEqual(r.page.require, ['musique']);
    assert.deepEqual(r.page.exclude, ['vus']);
    assert.deepEqual(r.page.groupBy, ['artist', 'album']);
    assert.deepEqual(r.page.sort, [{ by: 'added', order: 'desc' }]);
    assert.deepEqual([r.page.display, r.page.menu], ['list', { pinned: false, order: 2.5 }]);
    assert.deepEqual(pageFromForm({ ...values, name: '  ' }, null, KNOWN, [], t), { ok: false, error: 'settingsView.pages.errors.name' });
    assert.deepEqual(pageFromForm({ ...values, order: 'premier' }, null, KNOWN, [], t), { ok: false, error: 'settingsView.pages.errors.order' });
  });

  it('identifiants : unique, valide même pour un nom sans lettre simple', () => {
    assert.equal(newPageId('Films des années 90', ['films-des-annees-90']), 'films-des-annees-90-2');
    assert.equal(newPageId('Films des années 90', ['films-des-annees-90', 'films-des-annees-90-2']), 'films-des-annees-90-3');
    assert.equal(newPageId('日本', []), 'page');
    assert.equal(tagIdOf('VIDÉO', KNOWN), 'video');
    assert.equal(tagIdOf('series', KNOWN), 'series');
    assert.equal(tagIdOf('Vus en 2024', KNOWN), 'vus-en-2024');
  });

  it('texte de l’aperçu', () => {
    assert.equal(previewText({ ok: true, count: 2 }, t), 'Cette page contiendrait 2 éléments.');
    assert.equal(previewText({ ok: true, count: 1 }, en.t), 'This page would hold 1 item.');
    assert.match(previewText({ ok: false, errors: ['where.0'] }, t), /ne peut pas être enregistrée/);
  });
});

describe('pages : contrôleur mire-settings', () => {
  function harness(clicks: { action: string; values?: Record<string, unknown> }[], confirm = true) {
    const calls: [string, ...unknown[]][] = [];
    const toasts: string[] = [];
    const helps: string[] = [];
    const saved = new Map<string, PageDefinition>([['movies', MOVIES]]);
    const api = {
      tagsList: async () => KNOWN,
      pagesList: async () => [...saved.values()],
      pagesGet: async (id: string) => saved.get(id) ?? null,
      pagesPreview: async (p: PageDefinition) => (calls.push(['preview', p.id]), { ok: true, count: 2 }),
      pagesSave: async (p: PageDefinition) => (calls.push(['save', p]), saved.set(p.id, p), { ok: true, page: p }),
      pagesReset: async (id: string) => (calls.push(['reset', id]), MOVIES),
      pagesRemove: async (id: string) => (calls.push(['remove', id]), saved.delete(id)),
    };
    let opened: FormOptions | null = null;
    const ctx = {
      api,
      t,
      toast: (m: string) => toasts.push(m),
      ui: {
        confirm: async (title: string) => (calls.push(['confirm', title]), confirm),
        reloadPages: async () => void calls.push(['reloadPages']),
        settings: { refresh: async () => void calls.push(['refresh']) },
      },
      dialogs: {
        async form(opts: FormOptions) {
          opened = opts;
          let values: Record<string, unknown> = Object.fromEntries((opts.tabs ?? []).flatMap((tab) => tab.fields.map((f) => [f.id, normalizeField(f).value])));
          const form = { values: () => values, set: () => {}, setImage: () => {}, help: (h: string) => helps.push(h) };
          for (const c of clicks) {
            values = { ...values, ...c.values };
            if (!(await opts.onAction!(c.action, form as never))) return { action: c.action, values };
          }
          return { action: 'cancel', values };
        },
      },
    } as unknown as ControllerContext;
    return { ctrl: new SettingsController(ctx), calls, toasts, helps, opened: () => opened };
  }

  it('créer « Films des années 90 » : compter, puis enregistrer ; le menu et l’écran suivent', async () => {
    const fill = { name: 'Films des années 90', require: ['Films'], 'where0.info': 'year', 'where0.value': '1990', 'where0.to': '1999' };
    const h = harness([{ action: 'preview', values: fill }, { action: 'save' }]);
    await h.ctrl.createEntry({ key: 'pages' });
    assert.equal(h.opened()!.title, 'Nouvelle page');
    assert.deepEqual(h.helps, ['Cette page contiendrait 2 éléments.']);
    assert.deepEqual(
      h.calls.map((c) => c[0]),
      ['preview', 'save', 'reloadPages', 'refresh'],
    );
    assert.deepEqual((h.calls[1]?.[1] as PageDefinition).where, [{ info: 'year', between: [1990, 1999] }]);
    assert.deepEqual(h.toasts, ['Page « Films des années 90 » enregistrée']);
  });

  it('une condition incomplète garde la boîte ouverte, sans rien enregistrer', async () => {
    const h = harness([{ action: 'save', values: { name: 'X', 'where0.info': 'year' } }]);
    await h.ctrl.createEntry({ key: 'pages' });
    assert.deepEqual(h.calls, []);
    assert.match(h.helps[0] ?? '', /condition n’est pas complète/);
  });

  it('modifier, revenir à l’origine et supprimer une page, après confirmation', async () => {
    const h = harness([{ action: 'save', values: { name: 'Mes films' } }]);
    await h.ctrl.editEntry({ key: 'pages', id: 'movies' });
    assert.equal(h.opened()!.title, 'Modifier la page « Films »');
    assert.deepEqual((h.calls[0]?.[1] as PageDefinition).name, 'Mes films');
    await h.ctrl.restoreEntry({ key: 'pages', id: 'movies' });
    assert.deepEqual(h.calls.slice(3, 5), [
      ['confirm', 'Revenir à la page « Mes films » d’origine ?'],
      ['reset', 'movies'],
    ]);
    await h.ctrl.removeEntry({ key: 'pages', id: 'movies' });
    assert.deepEqual(h.calls.at(-3)?.[0], 'remove');
    const no = harness([], false);
    await no.ctrl.removeEntry({ key: 'pages', id: 'movies' });
    assert.deepEqual(
      no.calls.map((c) => c[0]),
      ['confirm'],
    );
    await assert.rejects(h.ctrl.createEntry({ key: 'autre' }), /Liste inconnue/);
  });
});
