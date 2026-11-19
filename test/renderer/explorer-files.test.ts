// Gérer ses fichiers depuis l'explorateur (P4-09), sans DOM : sélection (choisir, plage, retrait des éléments qui ne
// sont plus affichés), chemins, textes des confirmations en français et en anglais, dossiers d'arrivée, tags proposés,
// et l'état « actions permises » de l'aperçu et de la sélection.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Element, FolderLevel, TagSummary } from '@mire/shared';
import {
  baseName,
  checkNewName,
  destinations,
  dirName,
  fill,
  joinPath,
  moveText,
  NO_PICKS,
  prunePicks,
  quoteNames,
  rangePick,
  removeText,
  renameText,
  samePath,
  tagChoices,
  togglePick,
} from '../../src/renderer/explorer/files.ts';
import { createExplorerModel, folderNode } from '../../src/renderer/explorer/index.ts';
import { filePath } from '../../src/renderer/explorer/model.ts';
import type { ExplorerState } from '../../src/renderer/explorer/index.ts';
import { ExplorerController } from '../../src/renderer/controllers/explorer.ts';
import type { ControllerContext } from '../../src/renderer/controllers/types.ts';
import fr from '../../packages/shared/src/i18n/locales/fr.json' with { type: 'json' };
import en from '../../packages/shared/src/i18n/locales/en.json' with { type: 'json' };

type Messages = Record<string, unknown>;
const lookup = (messages: Messages, key: string) => key.split('.').reduce<unknown>((o, k) => (o as Messages | undefined)?.[k], messages);
function translator(messages: Messages) {
  return (key: string, vars: Record<string, string | number> = {}) => {
    const v = lookup(messages, key);
    assert.equal(typeof v, 'string', key);
    return (v as string).replace(/\{(\w+)\}/g, (_, n: string) => String(vars[n]));
  };
}
function plurals(messages: Messages, lang: string) {
  return (key: string, count: number) => {
    const forms = lookup(messages, key) as Record<string, string>;
    assert.equal(typeof forms, 'object', key);
    return (forms[new Intl.PluralRules(lang).select(count)] ?? forms.other).replaceAll('{count}', String(count));
  };
}
const tFr = translator(fr.messages as Messages);
const tEn = translator(en.messages as Messages);
const pFr = plurals(fr.messages as Messages, 'fr');
const pEn = plurals(en.messages as Messages, 'en');

describe('Sélection multiple', () => {
  it('choisir puis retirer un élément ; il devient le point de départ', () => {
    const a = togglePick(NO_PICKS, 'k1');
    assert.deepEqual(a, { keys: ['k1'], anchor: 'k1' });
    const b = togglePick(togglePick(a, 'k3'), 'k1');
    assert.deepEqual(b, { keys: ['k3'], anchor: 'k1' });
  });

  it('plage : du point de départ à l’élément, dans les deux sens, sans doublon', () => {
    const order = ['k1', 'k2', 'k3', 'k4', 'k5'];
    const p = togglePick(NO_PICKS, 'k2');
    assert.deepEqual(rangePick(p, order, 'k4'), { keys: ['k2', 'k3', 'k4'], anchor: 'k2' });
    assert.deepEqual(rangePick(togglePick(p, 'k5'), order, 'k1').keys, ['k2', 'k5', 'k1', 'k3', 'k4']);
    // Sans point de départ dans la colonne : l'élément seul.
    assert.deepEqual(rangePick(togglePick(NO_PICKS, 'ailleurs'), order, 'k3').keys, ['ailleurs', 'k3']);
    // Élément hors de la colonne : rien ne change.
    assert.equal(rangePick(p, order, 'zz'), p);
  });

  it('les éléments qui ne sont plus affichés quittent la sélection', () => {
    const p = { keys: ['k1', 'k2'], anchor: 'k2' };
    assert.equal(prunePicks(p, new Set(['k1', 'k2', 'k3'])), p);
    assert.deepEqual(prunePicks(p, new Set(['k1'])), { keys: ['k1'], anchor: null });
  });
});

describe('Chemins', () => {
  it('nom, dossier, dossier sous un dossier autorisé (POSIX et Windows)', () => {
    assert.equal(baseName('/bib/Films/a.mkv'), 'a.mkv');
    assert.equal(dirName('/bib/Films/a.mkv'), '/bib/Films');
    assert.equal(dirName('/a.mkv'), '/');
    assert.equal(baseName('C:\\Films\\a.mkv'), 'a.mkv');
    assert.equal(dirName('C:\\Films\\a.mkv'), 'C:\\Films');
    assert.equal(joinPath('/bib', 'Films/Action'), '/bib/Films/Action');
    assert.equal(joinPath('/bib/', ''), '/bib/');
    assert.equal(joinPath('D:\\Vidéos', 'Films/Action'), 'D:\\Vidéos\\Films\\Action');
    assert.ok(samePath('/bib/Films/', '/bib/Films'));
    assert.ok(!samePath('/bib/films', '/bib/Films'));
    assert.ok(samePath('C:\\Films', 'c:\\films'));
  });

  it('un élément a un fichier seulement s’il désigne un chemin (pas un site, un flux ni une adresse)', () => {
    const e = (open: unknown) => ({ open }) as Element;
    assert.equal(filePath(e({ kind: 'file', path: '/bib/a.mkv' })), '/bib/a.mkv');
    assert.equal(filePath(e({ kind: 'game', console: 'snes', path: '/roms/m.sfc' })), '/roms/m.sfc');
    assert.equal(filePath(e({ kind: 'file', path: 'https://nas/a.mkv' })), null);
    assert.equal(filePath(e({ kind: 'site', url: 'https://exemple.fr' })), null);
    assert.equal(filePath(e({ kind: 'stream', url: 'http://tv/1' })), null);
  });
});

describe('Textes des confirmations', () => {
  it('renommer : l’ancien nom, le nouveau, le dossier qui ne change pas', () => {
    assert.equal(
      renameText('/bib/Images/Montagne.jpg', 'Sommet.jpg', tFr),
      '« Montagne.jpg » s’appellera « Sommet.jpg ». Il reste dans le dossier /bib/Images.',
    );
    assert.equal(renameText('/bib/Images/Montagne.jpg', 'Peak.jpg', tEn), '“Montagne.jpg” will be called “Peak.jpg”. It stays in the folder /bib/Images.');
  });

  it('nouveau nom refusé : vide, séparateur, `..`, inchangé', () => {
    assert.deepEqual(checkNewName('  Sommet.jpg ', 'Montagne.jpg', tFr), { ok: true, name: 'Sommet.jpg' });
    for (const bad of ['', '   ', 'a/b', 'a\\b', '..', '.', 42]) assert.equal(checkNewName(bad, 'x', tFr).ok, false, String(bad));
    assert.deepEqual(checkNewName('x.jpg', 'x.jpg', tFr), { ok: false, error: 'Le nom n’a pas changé.' });
  });

  it('déplacer : le nom, le dossier de départ et celui d’arrivée', () => {
    assert.equal(moveText('/bib/Films/a.mkv', '/bib/Séries', tFr), '« a.mkv » quittera le dossier /bib/Films pour le dossier /bib/Séries.');
    assert.equal(moveText('/bib/Films/a.mkv', '/bib/Series', tEn), '“a.mkv” will leave the folder /bib/Films for the folder /bib/Series.');
  });

  it('corbeille : un fichier, puis plusieurs (les trois premiers noms, puis combien d’autres)', () => {
    assert.equal(removeText(['/bib/a.mkv'], tFr, pFr), '« a.mkv » ira dans la corbeille de l’ordinateur. Vous pourrez l’en sortir si besoin.');
    const five = ['/b/1.jpg', '/b/2.jpg', '/b/3.jpg', '/b/4.jpg', '/b/5.jpg'];
    assert.equal(
      removeText(five, tFr, pFr),
      '« 1.jpg », « 2.jpg », « 3.jpg » et 2 autres iront dans la corbeille de l’ordinateur. Vous pourrez les en sortir si besoin.',
    );
    assert.equal(quoteNames(['a', 'b', 'c', 'd'], tEn, pEn), '“a”, “b”, “c” and 1 other');
    assert.equal(fill('{names} : {inconnu}', { names: 'x' }), 'x : {inconnu}');
  });
});

describe('Dossiers d’arrivée et tags proposés', () => {
  const tree: Record<string, string[]> = { '': ['Films', 'Séries'], Films: ['Action'], 'Films/Action': [], Séries: [] };
  const folder = async (source: string, path: string): Promise<FolderLevel | null> =>
    source === 'd1'
      ? {
          source,
          path,
          total: 0,
          next: null,
          elements: [],
          folders: (tree[path] ?? []).map((n) => ({ name: n, path: path ? `${path}/${n}` : n, count: 1 })),
        }
      : null;
  const sources = async () => ({ folders: [{ id: 'd1', place: '/bib', count: 3 }] });

  it('les dossiers autorisés, puis leurs sous-dossiers, avec un libellé qui suit le chemin', async () => {
    assert.deepEqual(await destinations({ sources, folder }), [
      { path: '/bib', label: 'bib' },
      { path: '/bib/Films', label: 'bib / Films' },
      { path: '/bib/Séries', label: 'bib / Séries' },
      { path: '/bib/Films/Action', label: 'bib / Films / Action' },
    ]);
    assert.equal((await destinations({ sources, folder }, { depth: 1 })).length, 3);
    assert.equal((await destinations({ sources, folder }, { limit: 2 })).length, 2);
    assert.deepEqual(await destinations({ sources: async () => null, folder }), []);
  });

  it('ajouter : tous les tags ; retirer : ceux que portent les éléments choisis', () => {
    const known: TagSummary[] = [
      { id: 'video', name: 'Vidéo', origin: 'core', count: 3 },
      { id: 'a-revoir', name: 'À revoir', origin: 'user', count: 1 },
      { id: 'image', name: 'Image', origin: 'core', count: 2 },
    ];
    assert.deepEqual(
      tagChoices('add', known, []).map((x) => x.id),
      ['a-revoir', 'image', 'video'],
    );
    assert.deepEqual(
      tagChoices('remove', known, [['image'], ['image', 'a-revoir']]).map((x) => x.id),
      ['a-revoir', 'image'],
    );
  });
});

describe('Explorateur : sélection et actions permises', () => {
  const el = (path: string, name: string, open: Record<string, unknown> = { kind: 'file', path }): Element =>
    ({ key: `local:${path}`, name, source: { plugin: 'src-local', instance: '/bib' }, open, tags: ['image'], infos: {}, images: {}, added: 0 }) as Element;
  const ELEMENTS = [
    el('/bib/a.jpg', 'A'),
    el('/bib/b.jpg', 'B'),
    el('/bib/c.jpg', 'C'),
    el('/ailleurs/d.jpg', 'D'),
    el('', 'Site', { kind: 'site', url: 'https://x' }),
  ];

  function setup() {
    const states: ExplorerState[] = [];
    const model = createExplorerModel(
      {
        t: tFr,
        plural: pFr,
        pages: () => [],
        lists: async () => [],
        tags: async () => [],
        level: async () => null,
        element: async (key) => ELEMENTS.find((e) => e.key === key) ?? null,
        sources: async () => ({ sources: [], folders: [{ id: 'd1', place: '/bib', count: 5 }] }),
        folder: async (source, path) => (source === 'd1' && !path ? { source, path, total: 5, next: null, folders: [], elements: ELEMENTS } : null),
        check: async (paths) => paths.map((p) => (p.startsWith('/bib/') ? null : 'Ce fichier n’est pas dans vos dossiers.')),
      },
      (s) => states.push(s),
    );
    model.reset();
    const last = () => states[states.length - 1] as ExplorerState;
    const settle = () => new Promise((r) => setTimeout(r, 0));
    return { model, last, settle };
  }

  it('Ctrl + clic, puis Maj + clic : choix et plage ; le contrôle permet la corbeille', async () => {
    const { model, last, settle } = setup();
    await model.open('folders');
    await model.open(folderNode('d1', ''));
    assert.equal(model.pick('local:/bib/a.jpg'), true);
    assert.equal(model.pick('local:/bib/c.jpg', { range: true }), true);
    assert.deepEqual(last().picked, ['local:/bib/a.jpg', 'local:/bib/b.jpg', 'local:/bib/c.jpg']);
    await settle();
    assert.equal(last().blocked, '');
    assert.deepEqual(
      model.picked().map((x) => x.path),
      ['/bib/a.jpg', '/bib/b.jpg', '/bib/c.jpg'],
    );
    assert.equal(model.pick('inconnu'), false);
  });

  it('un élément hors des dossiers autorisés, ou qui n’est pas un fichier, bloque la corbeille, avec la raison', async () => {
    const { model, last, settle } = setup();
    await model.open('folders');
    await model.open(folderNode('d1', ''));
    model.pick('local:/bib/a.jpg');
    model.pick('local:/ailleurs/d.jpg');
    assert.equal(last().blocked, null);
    await settle();
    assert.equal(last().blocked, '« D » : Ce fichier n’est pas dans vos dossiers.');
    model.pick('local:');
    assert.equal(last().blocked, '« Site » n’est pas un fichier de vos dossiers : la sélection ne peut pas être supprimée.');
    model.clearPicks();
    assert.deepEqual(last().picked, []);
    assert.equal(last().blocked, '');
  });

  it('la sélection perd les éléments dont la colonne est fermée', async () => {
    const { model, last } = setup();
    await model.open('folders');
    await model.open(folderNode('d1', ''));
    model.pick('local:/bib/a.jpg');
    await model.open('pages');
    assert.deepEqual(last().picked, []);
  });

  it('aperçu : actions sur le fichier permises dans un dossier autorisé, sinon désactivées avec la raison', async () => {
    const { model, last } = setup();
    await model.open('folders');
    await model.open(folderNode('d1', ''));
    await model.show('local:/bib/a.jpg');
    assert.deepEqual(last().preview?.files, { allowed: true, reason: '' });
    await model.show('local:/ailleurs/d.jpg');
    assert.deepEqual(last().preview?.files, { allowed: false, reason: 'Ce fichier n’est pas dans vos dossiers.' });
    await model.show('local:');
    assert.equal(last().preview?.files?.allowed, false);
    assert.match(last().preview?.files?.reason ?? '', /n’est pas un fichier/);
  });
});

describe('Explorateur : contrôleur des fichiers et de la sélection', () => {
  type Form = { title: string; help?: string; fields?: { id: string; options?: [string, string][] }[] };
  /** `answers` : réponses successives des boîtes (la dernière se répète). */
  function ctl(answers: { action: string; values?: Record<string, unknown> }[], picked: { key: string; name: string; path: string | null }[] = []) {
    const calls: unknown[][] = [];
    const toasts: string[] = [];
    const forms: Form[] = [];
    let n = 0;
    const known: Record<string, { key: string; name: string; path: string | null }> = {
      'local:/bib/Images/Montagne.jpg': { key: 'local:/bib/Images/Montagne.jpg', name: 'Montagne', path: '/bib/Images/Montagne.jpg' },
      'local:/ailleurs/x.jpg': { key: 'local:/ailleurs/x.jpg', name: 'X', path: '/ailleurs/x.jpg' },
      site: { key: 'site', name: 'Site', path: null },
    };
    const explorer = {
      fileOf: (key: string) => known[key] ?? null,
      picked: () => picked,
      clearPicks: () => calls.push(['clear']),
      focusedRowKey: () => 'local:/bib/Images/Montagne.jpg',
      pick: (key: string) => (calls.push(['pick', key]), true),
    };
    const api = {
      filesCheck: async (paths: string[]) => paths.map((p) => (p.startsWith('/bib/') ? null : 'Hors de vos dossiers.')),
      filesRename: async (p: string, name: string) => (calls.push(['rename', p, name]), { ok: true, path: name }),
      filesMove: async (p: string, folder: string) => (calls.push(['move', p, folder]), { ok: true, path: folder }),
      filesRemove: async (p: string) => (calls.push(['remove', p]), p.includes('refus') ? { ok: false, error: 'Non.' } : { ok: true, path: p }),
      catalogElement: async (key: string) =>
        ({ key, name: key, tags: key.endsWith('2') ? ['image', 'a-revoir'] : ['image'], open: { kind: 'file', path: `/bib/${key}` } }) as unknown as Element,
      catalogSetTags: async (key: string, changes: unknown) => (calls.push(['tags', key, changes]), {}),
      catalogSources: async () => ({ sources: [], folders: [{ id: 'd1', place: '/bib', count: 2 }] }),
      catalogFolder: async (_s: string, p: string) =>
        p === ''
          ? { source: 'd1', path: '', total: 1, next: null, elements: [], folders: [{ name: 'Images', path: 'Images', count: 1 }] }
          : { source: 'd1', path: p, total: 0, next: null, elements: [], folders: [] },
      tagsList: async () => [
        { id: 'image', name: 'Image', origin: 'core', count: 2 },
        { id: 'a-revoir', name: 'À revoir', origin: 'user', count: 1 },
      ],
      listsList: async () => [{ id: 'favoris', name: 'Favoris', count: 0 }],
      listsAdd: async (id: string, keys: string[]) => (calls.push(['list', id, keys]), keys.length),
    };
    const dialogs = {
      form: async (f: Form) => {
        forms.push(f);
        return answers[Math.min(n++, answers.length - 1)] as { action: string; values: Record<string, unknown> };
      },
    };
    const ctx = { api, ui: { explorer }, toast: (m: string) => toasts.push(m), t: tFr, plural: pFr, dialogs } as unknown as ControllerContext;
    return { c: new ExplorerController(ctx), calls, toasts, forms };
  }
  const MONTAGNE = { key: 'local:/bib/Images/Montagne.jpg' };

  it('renommer : abandon au nom, abandon à la confirmation, puis confirmé ; la confirmation dit tout', async () => {
    let r = ctl([{ action: 'cancel' }]);
    assert.equal(await r.c.rename(MONTAGNE), false);
    assert.deepEqual(r.calls, []);
    r = ctl([{ action: 'next', values: { name: 'Sommet.jpg' } }, { action: 'no' }]);
    assert.equal(await r.c.rename(MONTAGNE), false);
    assert.equal(r.forms[1]?.help, '« Montagne.jpg » s’appellera « Sommet.jpg ». Il reste dans le dossier /bib/Images.');
    assert.deepEqual(r.calls, []);
    r = ctl([{ action: 'next', values: { name: 'Sommet.jpg' } }, { action: 'yes' }]);
    assert.equal(await r.c.rename(MONTAGNE), true);
    assert.deepEqual(r.calls, [['rename', '/bib/Images/Montagne.jpg', 'Sommet.jpg']]);
    assert.deepEqual(r.toasts, ['Renommé en « Sommet.jpg ».']);
  });

  it('hors des dossiers autorisés, ou pas un fichier : aucune boîte, la raison est affichée', async () => {
    for (const key of ['local:/ailleurs/x.jpg', 'site']) {
      const r = ctl([{ action: 'yes' }]);
      assert.equal(await r.c.rename({ key }), false);
      assert.equal(await r.c.move({ key }), false);
      assert.equal(await r.c.remove({ key }), 0);
      assert.deepEqual(r.forms, []);
      assert.deepEqual(r.calls, []);
      assert.equal(r.toasts.length, 3);
    }
  });

  it('déplacer : seuls les autres dossiers autorisés sont proposés, puis confirmation', async () => {
    const r = ctl([{ action: 'next', values: { folder: '/bib' } }, { action: 'yes' }]);
    assert.equal(await r.c.move(MONTAGNE), true);
    assert.deepEqual(r.forms[0]?.fields?.[0]?.options, [['/bib', 'bib']]);
    assert.equal(r.forms[1]?.help, '« Montagne.jpg » quittera le dossier /bib/Images pour le dossier /bib.');
    assert.deepEqual(r.calls, [['move', '/bib/Images/Montagne.jpg', '/bib']]);
    // Un dossier qui n'a pas été proposé n'est pas envoyé.
    const r2 = ctl([{ action: 'next', values: { folder: '/etc' } }]);
    assert.equal(await r2.c.move(MONTAGNE), false);
    assert.deepEqual(r2.calls, []);
  });

  it('sélection : corbeille confirmée par les noms, un échec est dit ; bloquée hors des dossiers', async () => {
    const picks = [
      { key: 'a', name: 'A', path: '/bib/a.jpg' },
      { key: 'b', name: 'B', path: '/bib/refus.jpg' },
    ];
    let r = ctl([{ action: 'yes' }], picks);
    assert.equal(await r.c.removePicked(), 1);
    assert.equal(r.forms[0]?.title, 'Mettre ces 2 fichiers à la corbeille ?');
    assert.match(r.forms[0]?.help ?? '', /« a\.jpg », « refus\.jpg » iront dans la corbeille/);
    assert.deepEqual(r.calls, [['remove', '/bib/a.jpg'], ['remove', '/bib/refus.jpg'], ['clear']]);
    assert.deepEqual(r.toasts, ['« refus.jpg » : Non.', '1 fichier mis à la corbeille.']);
    r = ctl([{ action: 'yes' }], [...picks, { key: 'x', name: 'X', path: '/ailleurs/x.jpg' }]);
    assert.equal(await r.c.removePicked(), 0);
    assert.deepEqual(r.forms, []);
    assert.deepEqual(r.toasts, ['« X » : Hors de vos dossiers.']);
  });

  it('sélection : ajouter un tag (existant ou nouveau), retirer un tag porté, ranger dans une liste', async () => {
    const picks = [
      { key: 'k1', name: 'Un', path: '/bib/k1' },
      { key: 'k2', name: 'Deux', path: '/bib/k2' },
    ];
    let r = ctl([{ action: 'go', values: { tag: 'a-revoir', name: '' } }], picks);
    assert.equal(await r.c.addTagToPicked(), 2);
    assert.deepEqual(r.calls, [
      ['tags', 'k1', { 'a-revoir': true }],
      ['tags', 'k2', { 'a-revoir': true }],
    ]);
    r = ctl([{ action: 'go', values: { tag: '_new', name: 'Vacances 2025' } }], picks);
    assert.equal(await r.c.addTagToPicked(), 2);
    assert.deepEqual(r.calls[0], ['tags', 'k1', { 'Vacances 2025': true }]);
    r = ctl([{ action: 'go', values: { tag: 'a-revoir' } }], picks);
    assert.equal(await r.c.removeTagFromPicked(), 1);
    assert.deepEqual(r.calls, [['tags', 'k2', { 'a-revoir': false }]]);
    r = ctl([{ action: 'add', values: { list: 'favoris', name: '' } }], picks);
    assert.equal(await r.c.addPickedToList(), 2);
    assert.deepEqual(r.calls, [['list', 'favoris', ['k1', 'k2']]]);
    assert.equal(r.forms[0]?.help, 'Les 2 éléments choisis seront ajoutés à la fin de la liste choisie.');
  });

  it('Y de la manette choisit l’élément qui a le focus', () => {
    const r = ctl([]);
    assert.equal(r.c.pickFocused(), true);
    assert.deepEqual(r.calls, [['pick', 'local:/bib/Images/Montagne.jpg']]);
  });
});
