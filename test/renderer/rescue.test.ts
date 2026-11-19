// Mode secours, côté page (P4-10) : délai de chargement d'un thème, choix du repli, combinaison de la manette.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createThemeWatch, fallbackFor, pickRequest, rescueMessageKey } from '../../src/renderer/rescue/model.ts';
import type { Timers } from '../../src/renderer/rescue/model.ts';
import { padPresses, readPad, rescueCombo } from '../../src/renderer/nav/gamepad-data.ts';
import type { PadMemory } from '../../src/renderer/nav/gamepad-data.ts';
import fr from '../../packages/shared/src/i18n/locales/fr.json' with { type: 'json' };

/** Minuteries à la main : `tick(ms)` fait avancer le temps. */
function fakeTimers() {
  let now = 0;
  let id = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      pending.set(++id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => void pending.delete(h as number),
  };
  const tick = (ms: number) => {
    now += ms;
    for (const [k, t] of [...pending]) {
      if (t.at <= now) {
        pending.delete(k);
        t.fn();
      }
    }
  };
  return { timers, tick, count: () => pending.size };
}

function setup() {
  const { timers, tick, count } = fakeTimers();
  const failed: unknown[] = [];
  const stable: string[] = [];
  const watch = createThemeWatch({ onFail: (r) => failed.push(r), onStable: (th) => stable.push(th), timeout: 100, stable: 500, timers });
  return { watch, tick, count, failed, stable };
}

describe('choix du repli', () => {
  it('thème introuvable ou en échec : l’explorateur, avec la raison et le thème ; sinon rien', () => {
    assert.deepEqual(fallbackFor({ theme: 'casse', state: 'missing' }), { reason: 'missing', theme: 'casse' });
    assert.deepEqual(fallbackFor({ theme: 'casse', state: 'failed' }), { reason: 'failed', theme: 'casse' });
    assert.equal(fallbackFor({ theme: 'mire', state: 'loading' }), null);
    assert.equal(fallbackFor({ theme: 'mire', state: 'ready' }), null);
  });

  it('un problème l’emporte sur une demande de la personne ; sinon la plus récente', () => {
    const crash = { reason: 'crash' as const };
    const option = { reason: 'option' as const };
    const missing = { reason: 'missing' as const, theme: 'x' };
    assert.equal(pickRequest(null, option), option);
    assert.equal(pickRequest(option, null), option);
    assert.equal(pickRequest(crash, option), crash);
    assert.equal(pickRequest(option, crash), crash);
    assert.equal(pickRequest(crash, missing), missing);
    assert.equal(pickRequest(option, { reason: 'shortcut' })?.reason, 'shortcut');
  });

  it('chaque raison a son message dans les catalogues', () => {
    for (const reason of ['option', 'key', 'shortcut', 'pad', 'crash', 'missing', 'failed', 'timeout'] as const) {
      const [, , key] = rescueMessageKey(reason).split('.');
      assert.equal(typeof fr.messages.rescue.reasons[key as keyof typeof fr.messages.rescue.reasons], 'string', reason);
    }
  });
});

describe('délai de chargement d’un thème', () => {
  it('chargé à temps : pas de repli ; signalé stable après le délai d’affichage', () => {
    const { watch, tick, failed, stable } = setup();
    watch.load({ theme: 'papier', state: 'loading' });
    tick(90);
    watch.load({ theme: 'papier', state: 'ready' });
    tick(100);
    assert.deepEqual(failed, []);
    assert.deepEqual(stable, []);
    tick(400);
    assert.deepEqual(stable, ['papier']);
  });

  it('délai dépassé : repli avec la raison « timeout » ; un « prêt » arrivé ensuite est sans suite', () => {
    const { watch, tick, failed, stable } = setup();
    watch.load({ theme: 'papier', state: 'loading' });
    tick(100);
    assert.deepEqual(failed, [{ reason: 'timeout', theme: 'papier' }]);
    watch.load({ theme: 'papier', state: 'ready' });
    tick(1000);
    assert.deepEqual(stable, []);
  });

  it('thème introuvable ou en échec : repli tout de suite, minuterie arrêtée', () => {
    const { watch, tick, count, failed } = setup();
    watch.load({ theme: 'casse', state: 'missing' });
    watch.load({ theme: 'velours', state: 'loading' });
    watch.load({ theme: 'velours', state: 'failed' });
    assert.equal(count(), 0);
    tick(1000);
    assert.deepEqual(failed, [
      { reason: 'missing', theme: 'casse' },
      { reason: 'failed', theme: 'velours' },
    ]);
  });

  it('un autre thème choisi pendant le chargement : seul le dernier compte', () => {
    const { watch, tick, failed, stable } = setup();
    watch.load({ theme: 'velours', state: 'loading' });
    tick(60);
    watch.load({ theme: 'mire', state: 'loading' });
    watch.load({ theme: 'velours', state: 'ready' });
    watch.load({ theme: 'velours', state: 'failed' });
    tick(60);
    watch.load({ theme: 'mire', state: 'ready' });
    tick(1000);
    assert.deepEqual(failed, []);
    assert.deepEqual(stable, ['mire']);
  });

  it('un nouveau chargement annule le signal « stable » en attente', () => {
    const { watch, tick, stable } = setup();
    watch.load({ theme: 'mire', state: 'loading' });
    watch.load({ theme: 'mire', state: 'ready' });
    tick(200);
    watch.load({ theme: 'papier', state: 'loading' });
    tick(50);
    watch.load({ theme: 'papier', state: 'ready' });
    tick(500);
    assert.deepEqual(stable, ['papier']);
  });
});

describe('combinaison de la manette', () => {
  const pad = (pressed: number[]) => ({ buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: 0 })), axes: [0, 0, 0, 0] });

  it('Affichage + Menu : une fois tant qu’on les tient, sans leur action habituelle', () => {
    const mem: PadMemory = { prev: {}, repeatAt: {} };
    const both = readPad(pad([8, 9]));
    assert.equal(rescueCombo(both, mem), true);
    assert.deepEqual(padPresses(both, mem, 0), []);
    assert.equal(rescueCombo(both, mem), false);
    const none = readPad(pad([]));
    assert.equal(rescueCombo(none, mem), false);
    padPresses(none, mem, 10);
    assert.equal(rescueCombo(both, mem), true);
  });

  it('un seul des deux boutons : rien, et son action habituelle', () => {
    const mem: PadMemory = { prev: {}, repeatAt: {} };
    const select = readPad(pad([8]));
    assert.equal(rescueCombo(select, mem), false);
    assert.deepEqual(
      padPresses(select, mem, 0).map((p) => p.button),
      ['select'],
    );
  });
});
