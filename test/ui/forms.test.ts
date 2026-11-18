// Boîtes de dialogue (P4-06) : description des champs, valeurs, validation, listes, actions, fiches, durées.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionKind,
  addToList,
  allFields,
  dialogTrigger,
  formValues,
  initialValues,
  legacyActionId,
  missingRequired,
  nextCandidateImage,
  normalizeCandidates,
  normalizeField,
  parseDialogAction,
  removeFromList,
  toastDuration,
} from '@mire/ui/utils';

describe('description des champs', () => {
  it('complète un champ texte par défaut', () => {
    assert.deepEqual(normalizeField({ id: 'title', label: 'Titre' }), {
      id: 'title',
      type: 'text',
      label: 'Titre',
      value: '',
      placeholder: '',
      options: [],
      required: false,
      rows: 4,
      full: false,
      browse: '',
      wide: false,
    });
  });

  it('liste : options en paires, valeur inconnue remplacée par la première option', () => {
    const f = normalizeField({ id: 'k', type: 'select', value: 'zz', options: ['a', ['b', 'Bé']] });
    assert.deepEqual(f.options, [
      ['a', 'a'],
      ['b', 'Bé'],
    ]);
    assert.equal(f.value, 'a');
    assert.equal(normalizeField({ id: 'k', type: 'select', value: 'b', options: ['a', 'b'] }).value, 'b');
  });

  it('zone de texte et liste de sources en pleine largeur ; interrupteur booléen ; liste copiée', () => {
    assert.equal(normalizeField({ id: 'o', type: 'textarea' }).full, true);
    const sources = ['/a'];
    const list = normalizeField({ id: 's', type: 'list', value: sources });
    assert.equal(list.full, true);
    assert.deepEqual(list.value, ['/a']);
    assert.notEqual(list.value, sources);
    assert.equal(normalizeField({ id: 't', type: 'toggle', value: 'true' }).value, true);
    assert.equal(normalizeField({ id: 't', type: 'toggle' }).value, false);
  });

  it('type inconnu, « Parcourir » et lignes invalides ramenés aux valeurs par défaut', () => {
    const f = normalizeField({ id: 'p', type: 'date' as never, browse: 'web' as never, rows: -2 });
    assert.equal(f.type, 'text');
    assert.equal(f.browse, '');
    assert.equal(f.rows, 4);
    assert.equal(normalizeField({ id: 'p', browse: 'folder' }).browse, 'folder');
  });
});

describe('valeurs et validation', () => {
  const fields = allFields(
    [
      normalizeField({ id: 'title', value: '  Amélie ', required: true }),
      normalizeField({ id: 'poster', type: 'image', value: '/a.jpg' }),
      normalizeField({ id: 'src', type: 'list', value: ['/films'] }),
    ],
    [{ id: 'more', label: 'Plus', fields: [normalizeField({ id: 'subs', type: 'toggle', value: true })] }],
  );

  it('résultat de la même forme qu’openForm : texte nettoyé, listes copiées, sans les images', () => {
    const values = initialValues(fields);
    assert.equal(values.poster, '/a.jpg', 'l’aperçu garde l’image');
    const out = formValues(fields, values);
    assert.deepEqual(out, { title: 'Amélie', src: ['/films'], subs: true });
    assert.notEqual(out.src, values.src);
  });

  it('champ obligatoire vide ou blanc : signalé ; rempli : rien', () => {
    assert.equal(missingRequired(fields, { title: '   ' }), 'title');
    assert.equal(missingRequired(fields, { title: 'x' }), null);
    const req = [normalizeField({ id: 'l', type: 'list', required: true }), normalizeField({ id: 't', type: 'toggle', required: true })];
    assert.equal(missingRequired(req, { l: [], t: true }), 'l');
    assert.equal(missingRequired(req, { l: ['a'], t: false }), 't');
  });

  it('listes de sources : ajout sans doublon ni vide, retrait par valeur', () => {
    assert.deepEqual(addToList(['/a'], ' /b '), ['/a', '/b']);
    assert.equal(addToList(['/a'], '/a'), null);
    assert.equal(addToList(['/a'], '  '), null);
    assert.deepEqual(removeFromList(['/a', '/b'], '/a'), ['/b']);
  });
});

describe('actions des boutons', () => {
  const actions = [
    { id: 'save', label: 'Enregistrer', kind: 'primary' as const },
    { id: 'other', label: 'Autre' },
  ];

  it('argument lu par clé, refusé sans boîte ni bouton', () => {
    assert.deepEqual(parseDialogAction({ dialog: 'd1', action: 'list-del', field: 'src', value: '/a', extra: 1 }), {
      dialog: 'd1',
      action: 'list-del',
      field: 'src',
      value: '/a',
    });
    assert.equal(parseDialogAction({ dialog: 'd1' }), null);
    assert.equal(parseDialogAction(null), null);
    assert.equal(parseDialogAction('d1'), null);
  });

  it('action du ds-trigger : act suivi de l’argument en JSON', () => {
    assert.equal(dialogTrigger({ dialog: 'd2', action: 'save' }), 'act:[{"dialog":"d2","action":"save"}]');
  });

  it('nature de l’action, et identifiant rendu à l’appelant comme dans openForm', () => {
    assert.equal(actionKind(actions, { action: 'save' }), 'submit');
    assert.equal(actionKind(actions, { action: 'other' }), 'button');
    assert.equal(actionKind(actions, { action: 'cancel' }), 'cancel');
    assert.equal(actionKind(actions, { action: 'list-add', field: 'src' }), 'field');
    assert.equal(actionKind(actions, { action: 'pick', field: 'poster' }), 'button');
    assert.equal(legacyActionId({ action: 'pick', field: 'poster' }), 'pick:poster');
    assert.equal(legacyActionId({ action: 'save' }), 'save');
  });
});

describe('choisir la bonne fiche', () => {
  it('clés uniques (clé, identifiant, sinon rang) et sous-titre année, détail', () => {
    const c = normalizeCandidates([{ id: 7, title: 'A', year: 2001, sub: 'Film' }, { key: 'x', title: 'B' }, { title: 'C' }, { id: 7, title: 'D' }]);
    assert.deepEqual(
      c.map((x) => x.key),
      ['7', 'x', '2', '7#3'],
    );
    assert.equal(c[0].sub, '2001, Film');
    assert.equal(c[1].sub, '');
  });

  it('image de secours une fois, puis aucune (l’initiale reste)', () => {
    const c = { image: '/a.jpg', fallback: '/b.jpg' };
    assert.equal(nextCandidateImage(c, '/a.jpg'), '/b.jpg');
    assert.equal(nextCandidateImage(c, '/b.jpg'), '');
    assert.equal(nextCandidateImage({ image: '/a.jpg', fallback: '' }, '/a.jpg'), '');
  });
});

it('durée des notifications : celles de toast', () => {
  assert.equal(toastDuration(), 3800);
  assert.equal(toastDuration({ duration: 1500 }), 1500);
  assert.equal(toastDuration({ duration: 3000, action: 'Annuler' }), 7000);
  assert.equal(toastDuration({ duration: 9000, action: 'Annuler' }), 9000);
  assert.equal(toastDuration({ duration: -1 }), 3800);
});
