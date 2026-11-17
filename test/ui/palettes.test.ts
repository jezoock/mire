// Palettes du cœur (P4-02) : fichiers de jetons et métadonnées cohérents, contrastes de « Contraste élevé » chiffrés,
// chargeur de palette (bascule sans rechargement, « Automatique » qui suit le système).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PALETTE_OPTIONAL_TOKENS, PALETTE_TOKENS, parsePaletteMeta } from '@mire/shared';
import { createPaletteLoader, paletteHref } from '@mire/ui/palettes';
import type { PaletteHost } from '@mire/ui/palettes';

const ROOT = path.join(import.meta.dirname, '..', '..');
const PALETTES = path.join(ROOT, 'src', 'renderer', 'palettes');
const CORE = ['ecran', 'jour', 'minuit', 'velours', 'contraste'];

/** Déclarations d'un fichier de palette : son sélecteur et ses propriétés. */
function readPalette(id: string) {
  const css = fs.readFileSync(path.join(PALETTES, id, `${id}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  assert.equal(rules.length, 1, `${id} : une seule règle attendue`);
  const [, selector, body] = rules[0]!;
  const props = Object.fromEntries(
    body!
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => d.split(/:\s*/, 2) as [string, string]),
  );
  return { selector: selector!.trim(), props };
}

describe('palettes du cœur', () => {
  it('le dossier contient les cinq palettes', () => {
    assert.deepEqual(fs.readdirSync(PALETTES).sort(), [...CORE].sort());
  });

  for (const id of CORE) {
    it(`${id} : jetons complets, métadonnées cohérentes avec eux`, () => {
      const { selector, props } = readPalette(id);
      assert.equal(selector, `[data-palette='${id}']`);
      const known = new Set<string>(['color-scheme', ...[...PALETTE_TOKENS, ...PALETTE_OPTIONAL_TOKENS].map((t) => `--${t}`)]);
      for (const name of Object.keys(props)) assert.ok(known.has(name), `${id} : jeton inconnu ${name}`);
      for (const t of PALETTE_TOKENS) {
        const v = props[`--${t}`];
        assert.ok(v, `${id} : --${t} manque`);
        assert.match(v, t === 'ring-mix' ? /^\d+%$/ : /^#[0-9A-F]{6}$/i, `${id} : --${t}`);
      }
      const meta = parsePaletteMeta(JSON.parse(fs.readFileSync(path.join(PALETTES, id, 'palette.json'), 'utf8')));
      assert.ok(meta, `${id} : palette.json invalide`);
      assert.equal(meta.name, `palettes.${id}`);
      // La fenêtre s'ouvre de la couleur du fond de l'interface, sans éclair d'une autre teinte.
      assert.equal(meta.background.toLowerCase(), props['--bg']!.toLowerCase());
      assert.equal(meta.scheme, props['color-scheme']);
    });
  }

  it('nom de chaque palette en français et en anglais', () => {
    for (const lang of ['fr', 'en']) {
      const { messages } = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'src', 'i18n', 'locales', `${lang}.json`), 'utf8'));
      for (const id of CORE) assert.ok(messages.palettes[id], `${lang} : palettes.${id}`);
    }
  });

  it('les palettes du cœur sont liées par la page, après la feuille de @mire/ui', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
    assert.match(html, /<html [^>]*data-palette="ecran"/);
    const ui = html.indexOf('href="ui/mire-ui.css"');
    for (const id of CORE) {
      const at = html.indexOf(`href="${paletteHref(id)}" data-palette-tokens="${id}"`);
      assert.ok(at > ui, `${id} : lien absent ou avant mire-ui.css`);
    }
  });

  it("l'habillage donne une valeur par défaut à chaque jeton facultatif", () => {
    const scss = fs.readFileSync(path.join(ROOT, 'packages', 'ui', 'src', 'theme', '_palettes.scss'), 'utf8');
    for (const t of PALETTE_OPTIONAL_TOKENS) assert.match(scss, new RegExp(`^\\s*--${t}: `, 'm'), `--${t}`);
  });
});

// Contraste (WCAG 2.x) entre deux couleurs #rrggbb.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('contrastes de « Contraste élevé »', () => {
  const t = readPalette('contraste').props;
  const c = (fg: string, bg: string) => Math.round(contrast(t[`--${fg}`]!, t[`--${bg}`]!) * 100) / 100;
  const FONDS = ['bg', 'surface', 'surface-2'];
  const BARS = ['bar-white', 'bar-yellow', 'bar-cyan', 'bar-green', 'bar-magenta', 'bar-red', 'bar-blue'];

  it('calcul de référence', () => {
    assert.equal(contrast('#FFFFFF', '#000000'), 21);
    assert.equal(Math.round(contrast('#767676', '#FFFFFF') * 100) / 100, 4.54);
  });

  // Rapports mesurés, figés : un changement de couleur doit être un choix, relu.
  it('texte et texte secondaire sur les fonds : au moins 7:1 (AAA)', () => {
    const got = Object.fromEntries(['text', 'muted'].flatMap((fg) => FONDS.map((bg) => [`${fg}/${bg}`, c(fg, bg)])));
    assert.deepEqual(got, {
      'text/bg': 21,
      'text/surface': 18.42,
      'text/surface-2': 15.91,
      'muted/bg': 15.91,
      'muted/surface': 13.96,
      'muted/surface-2': 12.05,
    });
    for (const v of Object.values(got)) assert.ok(v >= 7);
  });

  it('anneau de focus sur les fonds : au moins 3:1 (WCAG 1.4.11), ici plus de 12:1', () => {
    const got = FONDS.map((bg) => c('ring-from', bg));
    assert.deepEqual(got, [16.57, 14.54, 12.55]);
    for (const v of got) assert.ok(v >= 3);
    assert.equal(t['--ring-w'], '4px');
  });

  it('bordures sur les fonds : au moins 3:1 (WCAG 1.4.11)', () => {
    const got = ['line', 'line-strong'].flatMap((fg) => FONDS.map((bg) => c(fg, bg)));
    assert.deepEqual(got, [6.08, 5.34, 4.61, 13.62, 11.94, 10.32]);
    for (const v of got) assert.ok(v >= 3);
  });

  it("couleurs des sections : au moins 4.5:1 en texte sur le fond et les surfaces, et sous l'encre des barres", () => {
    const got = Object.fromEntries(BARS.map((bar) => [bar, [c(bar, 'bg'), c(bar, 'surface'), c('ink', bar)]]));
    assert.deepEqual(got, {
      'bar-white': [21, 18.42, 21],
      'bar-yellow': [16.57, 14.54, 16.57],
      'bar-cyan': [14.91, 13.08, 14.91],
      'bar-green': [12.58, 11.04, 12.58],
      'bar-magenta': [7.43, 6.52, 7.43],
      'bar-red': [5.92, 5.19, 5.92],
      'bar-blue': [6.71, 5.89, 6.71],
    });
    for (const v of Object.values(got).flat()) assert.ok(v >= 4.5);
  });
});

/** Page simulée : feuilles liées, chargement à la demande, mode du système modifiable. */
function fakeHost(linked: string[], light = false) {
  const listeners: (() => void)[] = [];
  const pending: { id: string; href: string; ready: () => void }[] = [];
  const media = { matches: light, addEventListener: (_t: 'change', l: () => void) => void listeners.push(l) };
  const host: PaletteHost = {
    root: { dataset: { palette: 'ecran' } },
    hasTokens: (id) => linked.includes(id),
    addTokens: (id, href, ready) => void pending.push({ id, href, ready }),
    light: media,
  };
  const setLight = (v: boolean) => {
    media.matches = v;
    for (const l of listeners) l();
  };
  return { host, pending, setLight, shown: () => host.root.dataset.palette };
}

describe('chargeur de palette', () => {
  it('applique immédiatement une palette déjà liée', () => {
    const f = fakeHost(CORE);
    const loader = createPaletteLoader(f.host);
    loader.set('minuit');
    assert.equal(f.shown(), 'minuit');
    loader.set('contraste');
    assert.equal(f.shown(), 'contraste');
    assert.equal(loader.current(), 'contraste');
    assert.equal(f.pending.length, 0);
  });

  it('réglage absent : la palette par défaut', () => {
    const f = fakeHost(CORE);
    createPaletteLoader(f.host).set(undefined);
    assert.equal(f.shown(), 'ecran');
  });

  it('« Automatique » suit le mode du système, et ses changements', () => {
    const f = fakeHost(CORE, true);
    const loader = createPaletteLoader(f.host);
    loader.set('auto');
    assert.equal(f.shown(), 'jour');
    f.setLight(false);
    assert.equal(f.shown(), 'ecran');
    loader.set('velours');
    f.setLight(true);
    assert.equal(f.shown(), 'velours');
  });

  it('une autre palette : sa feuille est liée, puis appliquée une fois chargée', () => {
    const f = fakeHost(CORE);
    const loader = createPaletteLoader(f.host);
    loader.set('sepia');
    assert.equal(f.shown(), 'ecran');
    assert.deepEqual(
      f.pending.map((p) => [p.id, p.href]),
      [['sepia', 'palettes/sepia/sepia.css']],
    );
    f.pending[0]!.ready();
    assert.equal(f.shown(), 'sepia');
  });

  it("une demande plus récente l'emporte sur un chargement en cours", () => {
    const f = fakeHost(CORE);
    const loader = createPaletteLoader(f.host);
    loader.set('sepia');
    loader.set('minuit');
    f.pending[0]!.ready();
    assert.equal(f.shown(), 'minuit');
  });
});
