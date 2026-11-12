// Navigation de l'interface déplacée de src/renderer/app.js vers src/renderer/nav/ (P1-24) : mêmes décisions qu'avant.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { focusSelectorOf, isShown, pickNeighbor, type Direction, type Navigable, type Rect } from '../../src/renderer/nav/spatial.ts';
import { ARROW_KEYS, IMAGE_KEYS, LIST_KEYS, VIDEO_KEYS, activatesOnEnter, isTyping, keyAction } from '../../src/renderer/nav/keyboard.ts';
import {
  IMAGE_PAD,
  LIST_PAD,
  PAD_FAMILIES,
  PAD_GLYPHS,
  PAD_HINTS,
  REPEAT_DELAY,
  REPEAT_RATE,
  SECTION_ORDER,
  VIDEO_PAD,
  WEB_PAD,
  nextSection,
  padFamily,
  padHintsHtml,
  padKey,
  padPresses,
  readPad,
  type PadMemory,
  type PadState,
} from '../../src/renderer/nav/gamepad-data.ts';

interface Box extends Navigable {
  name: string;
}

/** Élément factice : position et taille à l'écran ; masqué = sans boîte (display: none). */
function box(name: string, left: number, top: number, width = 100, height = 50, { hidden = false, disabled = false } = {}): Box {
  const rect = hidden ? { top: 0, right: 0, bottom: 0, left: 0 } : { top, right: left + width, bottom: top + height, left };
  return { name, disabled, getBoundingClientRect: () => rect, getClientRects: () => ({ length: hidden ? 0 : 1 }) };
}

const rect = (left: number, top: number, width = 100, height = 50): Rect => ({ top, right: left + width, bottom: top + height, left });
const pick = (from: Rect, items: Box[], dir: Direction) => pickNeighbor(from, items, dir)?.name ?? null;

describe('nav/spatial : pickNeighbor', () => {
  // Grille 3 × 3 de tuiles 100 × 50, espacées de 20 px ; on part du centre (b2).
  const grid: Box[] = [];
  for (const [r, row] of ['a', 'b', 'c'].entries()) for (let c = 0; c < 3; c++) grid.push(box(`${row}${c + 1}`, c * 120, r * 70));
  const center = rect(120, 70);
  const others = grid.filter((b) => b.name !== 'b2');

  it('grille : voisin direct dans chaque direction', () => {
    assert.equal(pick(center, others, 'up'), 'a2');
    assert.equal(pick(center, others, 'down'), 'c2');
    assert.equal(pick(center, others, 'left'), 'b1');
    assert.equal(pick(center, others, 'right'), 'b3');
  });

  it('grille : depuis un coin, rien au-delà du bord', () => {
    const others = grid.filter((b) => b.name !== 'a1');
    assert.equal(pick(rect(0, 0), others, 'up'), null);
    assert.equal(pick(rect(0, 0), others, 'left'), null);
    assert.equal(pick(rect(0, 0), others, 'right'), 'a2');
    assert.equal(pick(rect(0, 0), others, 'down'), 'b1');
  });

  it("rangées décalées : on reste dans l'axe, puis on prend la tuile la mieux alignée", () => {
    // Rangée du haut : 0, 120, 240 ; rangée du bas décalée de 60 px : 60, 180.
    const top = [box('a1', 0, 0), box('a2', 120, 0), box('a3', 240, 0)];
    const bottom = [box('d1', 60, 70), box('d2', 180, 70)];
    assert.equal(pick(rect(0, 0), bottom, 'down'), 'd1');
    assert.equal(pick(rect(240, 0), bottom, 'down'), 'd2');
    // Deux tuiles à cheval, également décalées : la première dans l'ordre du document.
    assert.equal(pick(rect(120, 0), bottom, 'down'), 'd1');
    assert.equal(pick(rect(180, 70), top, 'up'), 'a2');
    assert.equal(pick(rect(60, 70), top, 'up'), 'a1');
  });

  it("une tuile plus loin mais dans l'axe l'emporte sur une tuile proche mais hors de l'axe", () => {
    const items = [box('near', 300, 60), box('far', 0, 200)];
    assert.equal(pick(rect(0, 0), items, 'down'), 'far');
    // Dans l'axe toutes les deux : la plus proche.
    assert.equal(pick(rect(0, 0), [box('far', 0, 300), box('near', 0, 100)], 'down'), 'near');
  });

  it('tolérance de 2 px sur le bord de départ', () => {
    assert.equal(pick(rect(0, 0), [box('touching', 98, 0)], 'right'), 'touching');
    assert.equal(pick(rect(0, 0), [box('inside', 97, 0)], 'right'), null);
    assert.equal(pick(rect(0, 100), [box('above', 0, 52)], 'up'), 'above');
    assert.equal(pick(rect(0, 100), [box('above', 0, 53)], 'up'), null);
  });

  it('éléments masqués ou désactivés : jamais choisis, même plus proches', () => {
    const items = [box('hidden', 120, 0, 100, 50, { hidden: true }), box('disabled', 120, 0, 100, 50, { disabled: true }), box('shown', 300, 0)];
    assert.equal(pick(rect(0, 0), items, 'right'), 'shown');
    // Un élément masqué a une boîte vide en (0, 0) : il ne doit pas attirer le focus vers le haut à gauche.
    assert.equal(pick(rect(200, 200), [box('hidden', 0, 0, 0, 0, { hidden: true })], 'up'), null);
  });

  it('aucun voisin : liste vide, ou rien dans la direction', () => {
    assert.equal(pick(center, [], 'right'), null);
    assert.equal(pick(rect(0, 0), [box('left', -200, 0)], 'right'), null);
  });

  it("égalité : le premier dans l'ordre du document", () => {
    const items = [box('first', 120, -25), box('second', 120, 25)];
    assert.equal(pick(rect(0, 0), items, 'right'), 'first');
    assert.equal(pick(rect(0, 0), [...items].reverse(), 'right'), 'second');
  });

  it('isShown : affiché et actif', () => {
    assert.equal(isShown(box('a', 0, 0)), true);
    assert.equal(isShown(box('a', 0, 0, 100, 50, { hidden: true })), false);
    assert.equal(isShown(box('a', 0, 0, 100, 50, { disabled: true })), false);
    // Élément sans propriété `disabled` (lien, composant personnalisé) : actif.
    assert.equal(isShown({ getBoundingClientRect: () => rect(0, 0), getClientRects: () => ({ length: 1 }) }), true);
  });

  // Copie du calcul de moveFocus (app.js avant P1-24) : même choix sur des dispositions tirées au hasard.
  function legacyPick(r: Rect, els: Box[], dir: Direction): Box | null {
    const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.max(a1, b1) - Math.min(a2, b2));
    let best: Box | null = null;
    let bestScore = Infinity;
    for (const el of els.filter((e) => e.getClientRects().length > 0 && !e.disabled)) {
      const b = el.getBoundingClientRect();
      let main;
      let cross;
      if (dir === 'right') {
        if (b.left < r.right - 2) continue;
        main = b.left - r.right;
        cross = overlap(r.top, r.bottom, b.top, b.bottom);
      } else if (dir === 'left') {
        if (b.right > r.left + 2) continue;
        main = r.left - b.right;
        cross = overlap(r.top, r.bottom, b.top, b.bottom);
      } else if (dir === 'down') {
        if (b.top < r.bottom - 2) continue;
        main = b.top - r.bottom;
        cross = overlap(r.left, r.right, b.left, b.right);
      } else {
        if (b.bottom > r.top + 2) continue;
        main = r.top - b.bottom;
        cross = overlap(r.left, r.right, b.left, b.right);
      }
      const align = dir === 'left' || dir === 'right' ? Math.abs(b.top - r.top) : Math.abs(b.left - r.left);
      const score = Math.max(0, main) + cross * 3 + align * 0.02;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  it("même décision que l'ancien calcul sur 2 000 dispositions aléatoires", () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * n);
    };
    for (let t = 0; t < 2000; t++) {
      const items = Array.from({ length: 2 + rand(14) }, (_, k) =>
        box(`e${k}`, rand(1200), rand(800), 20 + rand(200), 20 + rand(150), { hidden: rand(10) === 0, disabled: rand(15) === 0 }),
      );
      const from = rect(rand(1200), rand(800), 20 + rand(200), 20 + rand(150));
      for (const dir of ['up', 'down', 'left', 'right'] as const) assert.equal(pickNeighbor(from, items, dir), legacyPick(from, items, dir));
    }
  });
});

describe('nav/spatial : focusSelectorOf', () => {
  it('rien en dehors du contenu', () => {
    const view = { contains: () => false };
    const saved = globalThis.document;
    (globalThis as { document?: unknown }).document = { querySelector: () => view };
    try {
      assert.equal(focusSelectorOf({ dataset: { action: 'x' } } as unknown as Element), null);
      assert.equal(focusSelectorOf(null), null);
    } finally {
      (globalThis as { document?: unknown }).document = saved;
    }
  });
});

describe('nav/keyboard', () => {
  it('flèches → directions', () => {
    assert.deepEqual(ARROW_KEYS, { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' });
  });

  it('listes : touche → action', () => {
    const cases: Array<[string, string]> = [
      ['ArrowUp', 'up'],
      ['ArrowRight', 'right'],
      ['Enter', 'activate'],
      ['Escape', 'back'],
      ['Backspace', 'back'],
      ['PageDown', 'page-down'],
      ['PageUp', 'page-up'],
      ['MediaPlayPause', 'play-pause'],
      ['/', 'search'],
      ['e', 'edit'],
      ['ContextMenu', 'edit'],
      ['Delete', 'delete'],
    ];
    for (const [key, action] of cases) assert.equal(keyAction(LIST_KEYS, key), action, key);
    for (const key of ['a', 'E', ' ', 'Tab', 'F5']) assert.equal(keyAction(LIST_KEYS, key), null, key);
  });

  it('lecteur vidéo : touche → action', () => {
    const cases: Array<[string, string]> = [
      [' ', 'play'],
      ['k', 'play'],
      ['Enter', 'play'],
      ['MediaPlayPause', 'play'],
      ['ArrowLeft', 'rewind'],
      ['ArrowRight', 'forward'],
      ['j', 'rewind-long'],
      ['l', 'forward-long'],
      ['ArrowUp', 'volume-up'],
      ['ArrowDown', 'volume-down'],
      ['m', 'mute'],
      ['f', 'fullscreen'],
      ['s', 'subtitles'],
      ['Y', 'subtitles'],
      ['n', 'next'],
      ['PageDown', 'next'],
      ['p', 'prev'],
      ['PageUp', 'prev'],
      ['Escape', 'close'],
      ['Backspace', 'close'],
    ];
    for (const [key, action] of cases) assert.equal(keyAction(VIDEO_KEYS, key), action, key);
    assert.equal(Object.keys(VIDEO_KEYS).length, cases.length);
    assert.equal(keyAction(VIDEO_KEYS, 'y'), null);
  });

  it('visionneuse : touche → action', () => {
    const cases: Array<[string, string]> = [
      ['ArrowLeft', 'prev'],
      ['PageUp', 'prev'],
      ['ArrowRight', 'next'],
      ['PageDown', 'next'],
      [' ', 'slideshow'],
      ['Enter', 'slideshow'],
      ['MediaPlayPause', 'slideshow'],
      ['f', 'fullscreen'],
      ['Escape', 'close'],
      ['Backspace', 'close'],
    ];
    for (const [key, action] of cases) assert.equal(keyAction(IMAGE_KEYS, key), action, key);
    assert.equal(Object.keys(IMAGE_KEYS).length, cases.length);
    assert.equal(keyAction(IMAGE_KEYS, 'ArrowUp'), null);
  });

  it("les noms hérités d'Object ne sont pas des touches", () => {
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal(keyAction(LIST_KEYS, key), null);
      assert.equal(keyAction(VIDEO_KEYS, key), null);
    }
  });

  it('isTyping : champs de saisie, sauf cases, réglettes et boutons', () => {
    assert.equal(isTyping({ tagName: 'TEXTAREA' }), true);
    assert.equal(isTyping({ tagName: 'SELECT' }), true);
    assert.equal(isTyping({ tagName: 'INPUT', type: 'text' }), true);
    assert.equal(isTyping({ tagName: 'INPUT', type: 'search' }), true);
    for (const type of ['checkbox', 'range', 'button']) assert.equal(isTyping({ tagName: 'INPUT', type }), false, type);
    assert.equal(isTyping({ tagName: 'BUTTON' }), false);
    assert.equal(isTyping(null), false);
  });

  it('activatesOnEnter : boutons et cases au clavier, tout à la manette', () => {
    assert.equal(activatesOnEnter({ tagName: 'BUTTON' }, false), true);
    assert.equal(activatesOnEnter({ tagName: 'INPUT', type: 'checkbox' }, false), true);
    assert.equal(activatesOnEnter({ tagName: 'A' }, false), false);
    assert.equal(activatesOnEnter({ tagName: 'INPUT', type: 'text' }, false), false);
    assert.equal(activatesOnEnter(null, false), false);
    assert.equal(activatesOnEnter({ tagName: 'A' }, true), true);
    assert.equal(activatesOnEnter(null, true), true);
  });
});

describe('nav/gamepad-data', () => {
  it("famille déduite de l'identifiant de la manette", () => {
    const cases: Array<[unknown, string]> = [
      ['Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 'xbox'],
      ['xinput', 'xbox'],
      ['045e-02ea-Microsoft Controller', 'xbox'],
      ['Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', 'ps'],
      ['DualSense Wireless Controller', 'ps'],
      ['Sony PLAYSTATION(R)3 Controller', 'ps'],
      ['Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)', 'nintendo'],
      ['Joy-Con (L/R)', 'nintendo'],
      ['Nintendo Switch Pro Controller', 'nintendo'],
      ['8BitDo SN30 Pro (Vendor: 2dc8)', 'xbox'],
      ['', 'xbox'],
      [undefined, 'xbox'],
      [null, 'xbox'],
    ];
    for (const [id, family] of cases) assert.equal(padFamily(id), family, String(id));
  });

  it('ordre de priorité : Xbox, puis PlayStation, puis Nintendo', () => {
    assert.deepEqual(
      PAD_FAMILIES.map((f) => f.family),
      ['xbox', 'ps', 'nintendo'],
    );
    // « Wireless Controller » ne désigne Sony qu'en début d'identifiant.
    assert.equal(padFamily('Xbox Wireless Controller'), 'xbox');
    assert.equal(padFamily('Generic Wireless Controller'), 'xbox');
  });

  it('chaque famille a un libellé pour chaque bouton du rappel', () => {
    for (const [family, glyphs] of Object.entries(PAD_GLYPHS)) {
      for (const hints of Object.values(PAD_HINTS)) {
        for (const [btns] of hints ?? []) for (const b of btns.split(' ')) assert.ok((glyphs as Record<string, string>)[b], `${family}.${b}`);
      }
    }
  });

  it('bouton → touche selon le contexte', () => {
    assert.equal(padKey(LIST_PAD, 'a'), 'Enter');
    assert.equal(padKey(LIST_PAD, 'b'), 'Escape');
    assert.equal(padKey(LIST_PAD, 'y'), '/');
    assert.equal(padKey(LIST_PAD, 'start'), 'MediaPlayPause');
    assert.equal(padKey(LIST_PAD, 'lt'), 'PageUp');
    assert.equal(padKey(LIST_PAD, 'x'), null);
    assert.equal(padKey(VIDEO_PAD, 'y'), 's');
    assert.equal(padKey(VIDEO_PAD, 'start'), ' ');
    assert.equal(padKey(VIDEO_PAD, 'lt'), 'j');
    assert.equal(padKey(VIDEO_PAD, 'rt'), 'l');
    assert.equal(padKey(IMAGE_PAD, 'lb'), 'ArrowLeft');
    assert.equal(padKey(IMAGE_PAD, 'a'), ' ');
    assert.equal(padKey(IMAGE_PAD, 'up'), null);
    assert.equal(padKey(WEB_PAD, 'b'), 'Back');
    assert.equal(padKey(WEB_PAD, 'lb'), 'ShiftTab');
    assert.equal(padKey(WEB_PAD, 'select'), null);
    assert.equal(padKey(LIST_PAD, 'constructor'), null);
  });

  it('chaque touche envoyée par la manette est comprise par le clavier du même contexte', () => {
    for (const key of Object.values(LIST_PAD)) assert.notEqual(keyAction(LIST_KEYS, key as string), null, key);
    for (const key of Object.values(VIDEO_PAD)) assert.notEqual(keyAction(VIDEO_KEYS, key as string), null, key);
    for (const key of Object.values(IMAGE_PAD)) assert.notEqual(keyAction(IMAGE_KEYS, key as string), null, key);
  });

  it('LB et RB parcourent les sections en boucle', () => {
    assert.equal(nextSection('home', 1), 'search');
    assert.equal(nextSection('home', -1), 'games');
    assert.equal(nextSection('games', 1), 'home');
    assert.equal(nextSection('videos', -1), 'search');
    // Section hors de la liste (réglages, téléchargements) : comme l'accueil.
    assert.equal(nextSection('settings', 1), 'search');
    assert.equal(nextSection('downloads', -1), 'games');
    assert.equal(SECTION_ORDER.length, 8);
  });

  it('readPad : disposition standard, sticks au-delà de 0,6, gâchettes au-delà de la moitié', () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    const gp = { buttons, axes: [0, 0, 0, 0] };
    assert.ok(Object.values(readPad(gp)).every((v) => v === false));
    buttons[0] = { pressed: true, value: 1 };
    buttons[6] = { pressed: false, value: 0.6 };
    buttons[16] = { pressed: true, value: 1 };
    const s = readPad({ buttons, axes: [-0.7, 0.65, 0, 0] });
    assert.equal(s.a, true);
    assert.equal(s.lt, true);
    assert.equal(s.home, true);
    assert.equal(s.left, true);
    assert.equal(s.down, true);
    assert.equal(s.right, false);
    assert.equal(s.up, false);
    assert.equal(readPad({ buttons: [], axes: [0.5, -0.5] }).right, false);
    assert.equal(readPad({ buttons: [], axes: [] }).home, false);
  });

  it('padPresses : un appui, puis répétition des directions et de LT/RT seulement', () => {
    const none = Object.fromEntries(Object.keys(readPad({ buttons: [], axes: [] })).map((k) => [k, false])) as PadState;
    const mem: PadMemory = { prev: {}, repeatAt: {} };
    const held = { ...none, down: true, a: true };
    assert.deepEqual(padPresses(held, mem, 1000), [
      { button: 'down', first: true },
      { button: 'a', first: true },
    ]);
    assert.deepEqual(padPresses(held, mem, 1000 + REPEAT_DELAY - 1), []);
    assert.deepEqual(padPresses(held, mem, 1000 + REPEAT_DELAY), [{ button: 'down', first: false }]);
    assert.deepEqual(padPresses(held, mem, 1000 + REPEAT_DELAY + REPEAT_RATE), [{ button: 'down', first: false }]);
    // Relâché puis de nouveau enfoncé : nouvel appui.
    assert.deepEqual(padPresses(none, mem, 2000), []);
    assert.deepEqual(padPresses({ ...none, a: true }, mem, 2001), [{ button: 'a', first: true }]);
  });

  it('barre de rappel : libellés de la famille ; rien hors des contextes prévus', () => {
    assert.equal(padHintsHtml('web', 'xbox'), null);
    assert.equal(padHintsHtml('', 'xbox'), null);
    assert.equal(
      padHintsHtml('dialog', 'ps'),
      '<span class="ph"><span class="pb">✕</span>Valider</span><span class="ph"><span class="pb">○</span>Annuler</span>',
    );
    assert.equal(
      padHintsHtml('image', 'nintendo'),
      '<span class="ph"><span class="pb">B</span>Diaporama</span><span class="ph"><span class="pb">L</span><span class="pb">R</span>Image</span><span class="ph"><span class="pb">A</span>Fermer</span>',
    );
    assert.match(padHintsHtml('video', 'xbox') as string, /<span class="pb">LT<\/span><span class="pb">RT<\/span>1 min/);
  });
});
