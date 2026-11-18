// Pile des boîtes de dialogue (P4-06) : premier plan, retrait, première ouverte et dernière fermée signalées.
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { DialogStack } from '../../src/renderer/ui/dialog-stack.ts';

it('la dernière ouverte est au premier plan ; fermer celle du dessus rend la main à la précédente', () => {
  const stack = new DialogStack<string>();
  const a = stack.nextId();
  const b = stack.nextId();
  assert.notEqual(a, b);
  stack.push(a, 'formulaire');
  stack.push(b, 'confirmation');
  assert.equal(stack.top(), 'confirmation');
  assert.equal(stack.topId(), b);
  assert.equal(stack.remove(b), 'confirmation');
  assert.equal(stack.top(), 'formulaire');
  assert.equal(stack.remove(b), undefined, 'déjà fermée');
});

it('une boîte du dessous peut se fermer sans toucher à celle du dessus ; une clé remise remonte', () => {
  const stack = new DialogStack<string>();
  stack.push('d1', 'un');
  stack.push('d2', 'deux');
  stack.remove('d1');
  assert.equal(stack.top(), 'deux');
  assert.equal(stack.size, 1);
  stack.push('d3', 'trois');
  stack.push('d2', 'deux');
  assert.equal(stack.topId(), 'd2');
  assert.equal(stack.size, 2);
});

it('signale la première boîte ouverte et la dernière fermée, une seule fois chacune (vue web masquée puis réaffichée)', () => {
  const stack = new DialogStack<number>();
  const seen: boolean[] = [];
  const stop = stack.onChange((open) => seen.push(open));
  stack.push('d1', 1);
  stack.push('d2', 2);
  stack.remove('d2');
  assert.deepEqual(seen, [true]);
  stack.remove('d1');
  assert.deepEqual(seen, [true, false]);
  stop();
  stack.push('d3', 3);
  assert.deepEqual(seen, [true, false]);
});
