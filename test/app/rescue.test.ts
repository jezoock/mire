// Mode secours, côté processus principal (P4-10) : option de démarrage, touche maintenue, raccourci, plantages.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CRASH_GIVE_UP, CRASH_LIMIT, HELD_KEY_WINDOW, afterCrash, createCrashCounter, createRescue } from '../../src/main/app/rescue.ts';
import { isRescueCombo, isRescueShortcut, wantsExplorer } from '@mire/shared';

const key = (k: string, mods: Record<string, boolean> = {}, type = 'keyDown') => ({ type, key: k, ...mods });

describe('déclencheurs partagés', () => {
  it('option de démarrage : --explorateur ou --explorer, exactement', () => {
    assert.equal(wantsExplorer(['mire', '.', '--explorateur']), true);
    assert.equal(wantsExplorer(['mire', '--explorer']), true);
    assert.equal(wantsExplorer(['mire', '--explorateur=1', '-explorateur', 'explorateur']), false);
    assert.equal(wantsExplorer([]), false);
  });

  it('raccourci : Ctrl+Maj+E ou ⌘+Maj+E, enfoncé, sans Alt', () => {
    assert.equal(isRescueShortcut(key('E', { control: true, shift: true })), true);
    assert.equal(isRescueShortcut(key('e', { meta: true, shift: true })), true);
    assert.equal(isRescueShortcut(key('e', { control: true, shift: true }, 'keyUp')), false);
    assert.equal(isRescueShortcut(key('e', { control: true })), false);
    assert.equal(isRescueShortcut(key('e', { shift: true })), false);
    assert.equal(isRescueShortcut(key('e', { control: true, shift: true, alt: true })), false);
  });

  it('combinaison de la manette : Affichage et Menu ensemble', () => {
    assert.equal(isRescueCombo({ select: true, start: true, a: false }), true);
    assert.equal(isRescueCombo({ select: true, start: false }), false);
    assert.equal(isRescueCombo({}), false);
  });
});

describe('compteur de plantages', () => {
  it('compte les plantages de suite, remis à zéro', () => {
    const c = createCrashCounter();
    assert.equal(c.crash(), 1);
    assert.equal(c.crash(), 2);
    c.reset();
    assert.equal(c.count(), 0);
  });

  it('un plantage : recharger ; deux de suite : l’explorateur ; trop : abandon', () => {
    assert.equal(CRASH_LIMIT, 2);
    assert.equal(afterCrash(1), 'reload');
    assert.equal(afterCrash(2), 'explorer');
    assert.equal(afterCrash(CRASH_GIVE_UP - 1), 'explorer');
    assert.equal(afterCrash(CRASH_GIVE_UP), 'give-up');
  });
});

describe('createRescue', () => {
  it('sans option : écran habituel ; avec --explorateur : l’explorateur, lu une seule fois', () => {
    assert.equal(createRescue({ argv: ['mire'] }).takeStart(), null);
    const r = createRescue({ argv: ['mire', '--explorateur'] });
    assert.deepEqual(r.takeStart(), { reason: 'option' });
    assert.equal(r.takeStart(), null);
  });

  it('Maj maintenue au lancement : l’explorateur, une fois, seulement juste après l’ouverture de la fenêtre', () => {
    let now = 1000;
    const r = createRescue({ argv: [], now: () => now });
    assert.equal(r.onInput(key('Shift')), null, 'avant la fenêtre');
    r.windowOpened();
    now += 500;
    assert.equal(r.onInput(key('Shift')), 'key');
    assert.equal(r.onInput(key('Shift')), null, 'touche répétée');
    assert.deepEqual(r.takeStart(), { reason: 'key' });
    r.windowOpened();
    now += HELD_KEY_WINDOW + 1;
    assert.equal(r.onInput(key('Shift')), null, 'trop tard');
    assert.equal(r.onInput(key('a')), null);
  });

  it('raccourci : toujours, sans rien mettre en attente', () => {
    const r = createRescue({ argv: [] });
    assert.equal(r.onInput(key('e', { control: true, shift: true })), 'shortcut');
    assert.equal(r.takeStart(), null);
  });

  it('deux plantages de suite : l’explorateur au rechargement ; un thème affiché sans souci remet le compte à zéro', () => {
    const r = createRescue({ argv: [] });
    assert.equal(r.onCrash(), 'reload');
    r.themeOk();
    assert.equal(r.onCrash(), 'reload');
    assert.equal(r.takeStart(), null);
    assert.equal(r.onCrash(), 'explorer');
    assert.deepEqual(r.takeStart(), { reason: 'crash' });
    assert.equal(r.onCrash(), 'explorer');
    assert.equal(r.onCrash(), 'give-up');
    assert.equal(r.crashes(), 4);
  });
});
