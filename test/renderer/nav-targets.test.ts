// Règles de la navigation sur les composants (P4-03) : composants, éléments désactivés, touches relayées, colonnes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  componentOf,
  deferredFocusStands,
  isComponentTag,
  isDisabled,
  isSelectedRow,
  nextColumn,
  pickInColumn,
  relaysPadKey,
  type ElementLike,
} from '../../src/renderer/nav/targets.ts';
import { PAD_HINTS, padHints } from '../../src/renderer/nav/gamepad-data.ts';

interface Fake extends ElementLike {
  name: string;
  parentElement: Fake | null;
  getBoundingClientRect(): { top: number; right: number; bottom: number; left: number };
  getClientRects(): { length: number };
}

/** Élément factice : balise, attributs, parent, propriété `disabled`, ligne à l'écran (`top`). */
function el(localName: string, attrs: Record<string, string> = {}, parent: Fake | null = null, extra: { disabled?: boolean; top?: number } = {}): Fake {
  const top = extra.top ?? 0;
  const rect = { top, right: 100, bottom: top + 40, left: 0 };
  return {
    name: attrs.name ?? localName,
    localName,
    parentElement: parent,
    disabled: extra.disabled,
    getAttribute: (n) => (Object.hasOwn(attrs, n) ? (attrs[n] as string) : null),
    hasAttribute: (n) => Object.hasOwn(attrs, n),
    getBoundingClientRect: () => rect,
    getClientRects: () => ({ length: 1 }),
  };
}

describe('nav/targets : composants', () => {
  it('reconnaît les balises ds-* et mire-*', () => {
    assert.equal(isComponentTag('ds-trigger'), true);
    assert.equal(isComponentTag('mire-explorer'), true);
    assert.equal(isComponentTag('button'), false);
    assert.equal(isComponentTag('dsx-truc'), false);
  });

  it('trouve le composant le plus proche, l’élément compris', () => {
    const trigger = el('ds-trigger');
    const button = el('button', {}, el('span', {}, trigger));
    assert.equal(componentOf(button), trigger);
    assert.equal(componentOf(trigger), trigger);
    assert.equal(componentOf(el('button', {}, el('div'))), null);
    assert.equal(componentOf(null), null);
  });
});

describe('nav/targets : règle des éléments désactivés', () => {
  it('écarte la propriété disabled, l’attribut disabled et aria-disabled="true"', () => {
    assert.equal(isDisabled(el('ds-trigger', {}, null, { disabled: true })), true);
    assert.equal(isDisabled(el('ds-trigger', { disabled: '' })), true);
    assert.equal(isDisabled(el('ds-toggle', { 'aria-disabled': 'true' })), true);
  });

  it('écarte le contenu d’un composant désactivé (attribut ou aria-disabled)', () => {
    assert.equal(isDisabled(el('button', {}, el('ds-trigger', { disabled: '' }))), true);
    assert.equal(isDisabled(el('ds-toggle', {}, el('ds-toggle-group', { 'aria-disabled': 'true' }))), true);
    assert.equal(isDisabled(el('input', {}, el('fieldset', { disabled: '' }))), true);
  });

  it('garde un élément actif', () => {
    assert.equal(isDisabled(el('ds-trigger', {}, null, { disabled: false })), false);
    assert.equal(isDisabled(el('ds-toggle', { 'aria-disabled': 'false' })), false);
    assert.equal(isDisabled(el('button', {}, el('ds-trigger'))), false);
  });
});

describe('nav/targets : touches de la manette relayées aux composants', () => {
  const inCombo = (expanded: string) => el('button', { 'aria-haspopup': 'listbox', 'aria-expanded': expanded }, el('div', {}, el('ds-combo')));

  it('relaie flèches, Entrée et Échap à un composant, rien hors des composants', () => {
    const trigger = el('ds-trigger');
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape']) assert.equal(relaysPadKey(trigger, key), true, key);
    assert.equal(relaysPadKey(trigger, '/'), false);
    assert.equal(relaysPadKey(trigger, 'MediaPlayPause'), false);
    assert.equal(relaysPadKey(el('button', { class: 'focusable' }), 'Enter'), false);
    assert.equal(relaysPadKey(null, 'Enter'), false);
  });

  it('liste fermée : haut et bas vont à l’élément voisin, A (Entrée) l’ouvre ; ouverte, tout lui revient', () => {
    assert.equal(relaysPadKey(inCombo('false'), 'ArrowDown'), false);
    assert.equal(relaysPadKey(inCombo('false'), 'ArrowUp'), false);
    assert.equal(relaysPadKey(inCombo('false'), 'Enter'), true);
    assert.equal(relaysPadKey(inCombo('true'), 'ArrowDown'), true);
    assert.equal(relaysPadKey(inCombo('true'), 'Escape'), true);
  });
});

describe('nav/targets : navigation par colonnes', () => {
  const filled = new Set([0, 1, 3]);
  const has = (i: number) => filled.has(i);

  it('gauche et droite passent à la colonne voisine qui a des destinations', () => {
    assert.equal(nextColumn(4, 1, 'right', has), 3);
    assert.equal(nextColumn(4, 1, 'left', has), 0);
    assert.equal(nextColumn(4, 0, 'left', has), -1);
    assert.equal(nextColumn(4, 3, 'right', has), -1);
    assert.equal(nextColumn(4, 1, 'up', has), -1);
  });

  it('arrivée dans une colonne : la dernière visitée, puis la ligne sélectionnée, puis la plus proche en hauteur', () => {
    const from = { top: 200, right: 100, bottom: 240, left: 0 };
    const a = el('button', { name: 'a' }, null, { top: 0 });
    const b = el('button', { name: 'b' }, null, { top: 190 });
    const c = el('button', { name: 'c', 'aria-current': 'true' }, null, { top: 400 });
    assert.equal(pickInColumn(from, [a, b, c])?.name, 'c');
    assert.equal(pickInColumn(from, [a, b, c], a)?.name, 'a');
    assert.equal(pickInColumn(from, [a, b])?.name, 'b');
    assert.equal(pickInColumn(from, [a, b], el('button'))?.name, 'b');
    assert.equal(pickInColumn(from, []), null);
  });

  it('ligne sélectionnée : aria-selected="true" ou aria-current (sauf "false")', () => {
    assert.equal(isSelectedRow(el('div', { 'aria-selected': 'true' })), true);
    assert.equal(isSelectedRow(el('div', { 'aria-current': 'page' })), true);
    assert.equal(isSelectedRow(el('div', { 'aria-current': 'false' })), false);
    assert.equal(isSelectedRow(el('div', { 'aria-selected': 'false' })), false);
  });

  it('le rappel de la manette en colonnes est celui des listes, sauf Y qui choisit un élément (P4-09)', () => {
    assert.deepEqual(
      PAD_HINTS.columns,
      PAD_HINTS.list?.map(([b, k]) => (b === 'y' ? ['y', 'pick'] : [b, k])),
    );
    assert.deepEqual(padHints('columns', 'xbox')?.find((h) => h.key === 'shell.pad.pick')?.glyphs, ['Y']);
  });

  it('un focus différé cède à une flèche pressée pendant l’attente ou à un focus placé ailleurs (P4-03b)', () => {
    const [body, start, other] = ['body', 'start', 'other'];
    const req = { ticket: 3, from: start };
    assert.equal(deferredFocusStands(req, 3, start, body), true, 'rien ne s’est passé');
    assert.equal(deferredFocusStands(req, 3, body, body), true, 'focus perdu par un nouvel affichage');
    assert.equal(deferredFocusStands(req, 3, null, body), true);
    assert.equal(deferredFocusStands(req, 4, start, body), false, 'une flèche est venue après');
    assert.equal(deferredFocusStands(req, 3, other, body), false, 'le focus a été placé ailleurs');
  });
});
