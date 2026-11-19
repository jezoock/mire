// Administration des tags et des listes (P4-21, partie 2) : lignes des panneaux « Tags » et « Listes », formulaire
// d'un tag, règles par type de fichier, ordre des listes, et parcours du contrôleur.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CATALOGS, createI18n } from '@mire/shared/i18n';
import type { ListSummary, TagOverview } from '@mire/shared';
import { normalizeField } from '@mire/ui/utils';
import {
  fileRulesGroup,
  listsGroup,
  listsOrder,
  normalizeExt,
  setByText,
  tagChangesFromForm,
  tagFormFields,
  tagsGroup,
  withFileRule,
  withoutFileRule,
} from '../../src/renderer/settings/tags.ts';
import { settingsPanels } from '../../src/renderer/settings/index.ts';
import { SettingsController } from '../../src/renderer/controllers/settings.ts';
import type { ControllerContext } from '../../src/renderer/controllers/types.ts';
import type { FormOptions } from '../../src/renderer/ui/dialogs.ts';

const t = createI18n({ locale: 'fr', catalogs: BUILTIN_CATALOGS }).t;
const en = createI18n({ locale: 'en', catalogs: BUILTIN_CATALOGS }).t;

const TAGS: TagOverview[] = [
  { id: 'video', name: 'Vidéo', origin: 'core', count: 3, look: { color: 'blue', icon: 'play' }, setBy: ['core', 'mire.anime'] },
  { id: 'movie', name: 'Films', origin: 'core', count: 2, look: {}, setBy: ['core'] },
  { id: 'vus', name: 'Vus', origin: 'user', count: 1, look: {}, setBy: ['user'] },
  { id: 'a-voir', name: 'À voir', origin: 'user', count: 0, look: {}, setBy: ['user'] },
  { id: 'vieux', name: 'vieux', origin: 'other', count: 1, look: {}, setBy: [] },
];
const NAMES = { 'mire.anime': 'Animés' };
const LISTS: ListSummary[] = [
  { id: 'l1', name: 'À regarder', count: 2 },
  { id: 'l2', name: { key: 'shell.views.home' }, count: 0 },
];

describe('tags : panneau', () => {
  it('lignes : nombre d’éléments, qui pose le tag, couleur et icône ; Retirer seulement pour vos tags', () => {
    const g = tagsGroup(TAGS, NAMES, t);
    assert.deepEqual(
      g.entries.map((e) => [e.id, e.sub, !!e.keep]),
      [
        ['video', '3 éléments · Posé par Mire, Animés · Bleu · Lecture', true],
        ['movie', '2 éléments · Posé par Mire', true],
        ['vus', '1 élément · Posé par vous', false],
        ['a-voir', '0 élément · Posé par vous', false],
        ['vieux', '1 élément · Posé par un ancien réglage', true],
      ],
    );
    assert.deepEqual([g.edit, g.remove], [true, true]);
    assert.equal(setByText({ setBy: ['inconnu'] }, {}, en), 'Set by inconnu');
  });

  it('panneaux « Tags » et « Listes » de l’écran Réglages, après « Pages »', () => {
    const panels = settingsPanels({
      t,
      config: { catalog: { fileTags: { '.ts': ['video'] } } },
      languages: [],
      sites: [],
      pageThemes: [],
      currentPageTheme: 'mire',
      homeLists: [],
      plugins: [],
      tags: TAGS,
      lists: LISTS,
      pluginNames: NAMES,
    });
    const ids = panels.map((p) => p.id);
    assert.deepEqual(ids.slice(ids.indexOf('pages'), ids.indexOf('pages') + 3), ['pages', 'tags', 'lists']);
    const tags = panels.find((p) => p.id === 'tags')!;
    assert.deepEqual(
      tags.fields.map((f) => f.key),
      ['tags', 'fileTags'],
    );
    assert.deepEqual(
      tags.fields[1]?.groups?.[0]?.entries.map((e) => [e.label, e.sub]),
      [['.ts', 'Vidéo']],
    );
    const lists = panels.find((p) => p.id === 'lists')!;
    assert.deepEqual(
      lists.fields.map((f) => f.kind),
      ['order', 'entries'],
    );
    // Une seule liste : rien à ordonner.
    const one = settingsPanels({
      t,
      config: {},
      languages: [],
      sites: [],
      pageThemes: [],
      currentPageTheme: 'mire',
      homeLists: [],
      plugins: [],
      lists: [LISTS[0]!],
    });
    assert.deepEqual(
      one.find((p) => p.id === 'lists')!.fields.map((f) => f.kind),
      ['entries'],
    );
  });
});

describe('tags : formulaire', () => {
  const values = (fields: ReturnType<typeof tagFormFields>) => Object.fromEntries(fields.map((f) => [f.id, normalizeField(f).value]));

  it('tag du cœur : couleur et icône seulement ; votre tag : nom et fusion en plus', () => {
    assert.deepEqual(
      tagFormFields(TAGS[0]!, TAGS, t).map((f) => f.id),
      ['color', 'icon'],
    );
    const fields = tagFormFields(TAGS[2]!, TAGS, t);
    assert.deepEqual(
      fields.map((f) => f.id),
      ['name', 'color', 'icon', 'merge'],
    );
    // Fusion : vers un tag du cœur ou de l'utilisateur, pas lui-même ni un tag non déclaré.
    assert.deepEqual(
      fields[3]?.options?.map((o) => (Array.isArray(o) ? o[0] : o)),
      ['', 'video', 'movie', 'a-voir'],
    );
    assert.deepEqual(values(fields), { name: 'Vus', color: '', icon: '', merge: '' });
  });

  it('changements : seulement ce qui a changé ; null enlève ; nom vide refusé', () => {
    assert.deepEqual(tagChangesFromForm({ color: 'blue', icon: 'play' }, TAGS[0]!), { ok: true, changes: {} });
    assert.deepEqual(tagChangesFromForm({ color: '', icon: 'star' }, TAGS[0]!), { ok: true, changes: { look: { color: null, icon: 'star' } } });
    assert.deepEqual(tagChangesFromForm({ name: ' Déjà vus ', color: 'red', icon: '', merge: '' }, TAGS[2]!), {
      ok: true,
      changes: { rename: 'Déjà vus', look: { color: 'red' } },
    });
    assert.deepEqual(tagChangesFromForm({ name: 'Vus', color: '', icon: '', merge: 'movie' }, TAGS[2]!), { ok: true, changes: { merge: 'movie' } });
    assert.deepEqual(tagChangesFromForm({ name: '  ', color: '', icon: '' }, TAGS[2]!), { ok: false, error: 'settingsView.tags.errors.name' });
  });
});

describe('tags : règles par type de fichier', () => {
  it('ajouter (extension écrite à la main, tags par leur nom), remplacer, retirer', () => {
    const config = { catalog: { fileTags: { '.ts': ['video'] } } };
    assert.equal(normalizeExt(' MKV '), '.mkv');
    assert.equal(normalizeExt('.m k v'), null);
    assert.deepEqual(withFileRule(config, 'M2TS', 'Vidéo, Films, vidéo', TAGS), { '.ts': ['video'], '.m2ts': ['video', 'movie'] });
    assert.deepEqual(withFileRule(config, '.ts', '', TAGS), { '.ts': [] });
    assert.deepEqual(withFileRule(config, 'Mes Films', 'Vidéo', TAGS), null);
    assert.deepEqual(withoutFileRule(config, '.ts'), {});
    assert.deepEqual(config.catalog.fileTags, { '.ts': ['video'] });
    const g = fileRulesGroup({ catalog: { fileTags: { '.zz': [], '.ts': ['video'] } } }, TAGS, t);
    assert.deepEqual(
      g.entries.map((e) => [e.id, e.sub]),
      [
        ['.ts', 'Vidéo'],
        ['.zz', 'Aucun tag'],
      ],
    );
    assert.equal(fileRulesGroup({}, TAGS, t).entries.length, 0);
  });
});

describe('listes : panneau', () => {
  it('lignes, nom traduit, ordre', () => {
    const g = listsGroup(LISTS, t);
    assert.deepEqual(
      g.entries.map((e) => [e.id, e.label, e.sub]),
      [
        ['l1', 'À regarder', '2 éléments'],
        ['l2', 'Accueil', '0 élément'],
      ],
    );
    assert.deepEqual(g.buttons, [{ label: 'Créer une liste', action: 'createEntry' }]);
    assert.deepEqual(
      listsOrder(LISTS, t).items.map((i) => i.id),
      ['l1', 'l2'],
    );
    assert.equal(listsOrder(LISTS, t).kind, 'lists');
  });
});

describe('tags et listes : contrôleur mire-settings', () => {
  function harness(clicks: { action: string; values?: Record<string, unknown> }[], { confirm = true, drafts = {} as Record<string, string> } = {}) {
    const calls: unknown[][] = [];
    const toasts: string[] = [];
    const helps: string[] = [];
    let lists = [...LISTS];
    const api = {
      tagsOverview: async () => TAGS,
      tagsList: async () => TAGS,
      tagsRename: async (...a: unknown[]) => (calls.push(['rename', ...a]), true),
      tagsSetLook: async (...a: unknown[]) => (calls.push(['look', ...a]), true),
      tagsMerge: async (...a: unknown[]) => (calls.push(['merge', ...a]), 1),
      tagsRemove: async (...a: unknown[]) => (calls.push(['removeTag', ...a]), true),
      listsList: async () => lists,
      listsCreate: async (name: string) => (calls.push(['create', name]), name.trim() ? { id: 'l3', name, count: 0 } : null),
      listsRename: async (...a: unknown[]) => (calls.push(['renameList', ...a]), true),
      listsRemove: async (id: string) => (calls.push(['removeList', id]), (lists = lists.filter((l) => l.id !== id)), true),
      listsReorder: async (ids: string[]) => (calls.push(['reorder', ids]), true),
    };
    const S = { config: { catalog: { fileTags: { '.ts': ['video'] } } } };
    const ctx = {
      api,
      S,
      t,
      toast: (m: string) => toasts.push(m),
      ui: {
        confirm: async (title: string) => (calls.push(['confirm', title]), confirm),
        afterEdit: () => calls.push(['afterEdit']),
        setCfg: async (p: string, v: unknown) => calls.push(['setCfg', p, v]),
        settings: {
          refresh: async () => void calls.push(['refresh']),
          draft: (k: string) => drafts[k],
          clearDraft: (k: string) => calls.push(['clearDraft', k]),
        },
      },
      dialogs: {
        async form(opts: FormOptions) {
          let values: Record<string, unknown> = Object.fromEntries((opts.fields ?? []).map((f) => [f.id, normalizeField(f).value]));
          const form = { values: () => values, set: () => {}, setImage: () => {}, help: (h: string) => helps.push(h) };
          for (const c of clicks) {
            values = { ...values, ...c.values };
            if (!(await opts.onAction!(c.action, form as never))) return { action: c.action, values };
          }
          return { action: 'cancel', values };
        },
      },
    } as unknown as ControllerContext;
    return { ctrl: new SettingsController(ctx), calls, toasts, helps };
  }

  it('modifier un tag du cœur : apparence seulement', async () => {
    const h = harness([{ action: 'save', values: { color: 'green' } }]);
    await h.ctrl.editEntry({ key: 'tags', id: 'video' });
    assert.deepEqual(h.calls, [['look', 'video', { color: 'green' }], ['afterEdit'], ['refresh']]);
    assert.deepEqual(h.toasts, ['Tag « Vidéo » enregistré']);
  });

  it('votre tag : renommer, ou fusionner (sans renommer)', async () => {
    const r = harness([{ action: 'save', values: { name: 'Déjà vus' } }]);
    await r.ctrl.editEntry({ key: 'tags', id: 'vus' });
    assert.deepEqual(r.calls[0], ['rename', 'vus', 'Déjà vus']);
    const m = harness([{ action: 'save', values: { name: 'Autre', merge: 'movie' } }]);
    await m.ctrl.editEntry({ key: 'tags', id: 'vus' });
    assert.deepEqual(m.calls[0], ['merge', 'vus', 'movie']);
    assert.match(m.toasts[0] ?? '', /fusionné dans « Films » \(1 élément\)/);
  });

  it('supprimer votre tag après confirmation ; un tag du cœur ne se supprime pas', async () => {
    const h = harness([]);
    await h.ctrl.removeEntry({ key: 'tags', id: 'vus' });
    assert.deepEqual(h.calls.slice(0, 2), [
      ['confirm', 'Supprimer le tag « Vus » ?'],
      ['removeTag', 'vus'],
    ]);
    const core = harness([]);
    await core.ctrl.removeEntry({ key: 'tags', id: 'video' });
    assert.deepEqual(core.calls, []);
    const no = harness([], { confirm: false });
    await no.ctrl.removeEntry({ key: 'tags', id: 'vus' });
    assert.deepEqual(
      no.calls.map((c) => c[0]),
      ['confirm'],
    );
  });

  it('règles par type de fichier : ajouter d’après les champs, retirer ; extension refusée', async () => {
    const h = harness([], { drafts: { 'fileTags.ext': 'M2TS', 'fileTags.tags': 'Vidéo' } });
    await h.ctrl.addEntry({ key: 'fileTags' });
    assert.deepEqual(h.calls[0], ['setCfg', 'catalog.fileTags', { '.ts': ['video'], '.m2ts': ['video'] }]);
    assert.deepEqual(
      h.calls.filter((c) => c[0] === 'clearDraft').map((c) => c[1]),
      ['fileTags.ext', 'fileTags.tags'],
    );
    await h.ctrl.removeEntry({ key: 'fileTags', id: '.ts' });
    assert.deepEqual(h.calls.at(-2), ['setCfg', 'catalog.fileTags', {}]);
    const bad = harness([], { drafts: { 'fileTags.ext': 'pas une extension' } });
    await bad.ctrl.addEntry({ key: 'fileTags' });
    assert.deepEqual(bad.calls, []);
    assert.deepEqual(bad.toasts, ['Écrivez une extension, par exemple .mkv.']);
  });

  it('listes : créer, renommer, supprimer après confirmation, ordonner', async () => {
    const c = harness([{ action: 'save', values: { name: 'Pour ce soir' } }]);
    await c.ctrl.createEntry({ key: 'lists' });
    assert.deepEqual(c.calls[0], ['create', 'Pour ce soir']);
    assert.deepEqual(c.toasts, ['Liste « Pour ce soir » créée']);
    const r = harness([{ action: 'save', values: { name: 'À revoir' } }]);
    await r.ctrl.editEntry({ key: 'lists', id: 'l1' });
    assert.deepEqual(r.calls[0], ['renameList', 'l1', 'À revoir']);
    const d = harness([]);
    await d.ctrl.removeEntry({ key: 'lists', id: 'l1' });
    assert.deepEqual(d.calls.slice(0, 2), [
      ['confirm', 'Supprimer la liste « À regarder » ?'],
      ['removeList', 'l1'],
    ]);
    const o = harness([]);
    await o.ctrl.setOrder({ kind: 'lists', keys: ['l2', 'l1'] });
    assert.deepEqual(o.calls, [['reorder', ['l2', 'l1']], ['refresh']]);
  });
});
