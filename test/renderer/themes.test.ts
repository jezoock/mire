// Moteur de thèmes (P4-11) : thèmes intégrés, palette, polices, images, sons et mise en page transmise.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_THEMES, DEFAULT_PAGE_LAYOUT, activeTheme, createThemeEngine, readThemes, sharedScope } from '../../src/renderer/themes/index.ts';
import type { ThemeEntry, ThemeHost, ThemeScope } from '../../src/renderer/themes/index.ts';

function fakeHost(linked: string[] = ['ecran', 'jour']) {
  const props = new Map<string, string>();
  const pending: Array<() => void> = [];
  const fonts: string[] = [];
  const sounds: string[] = [];
  const host: ThemeHost & { props: Map<string, string>; pending: Array<() => void>; fonts: string[]; sounds: string[] } = {
    scope: { dataset: {}, style: { setProperty: (k, v) => void props.set(k, v), removeProperty: (k) => void props.delete(k) } },
    hasTokens: (id) => linked.includes(id),
    addTokens: (_id, ready) => void pending.push(ready),
    loadFont: async (family, url) => {
      fonts.push(`${family} ${url}`);
      return true;
    },
    playSound: (url) => void sounds.push(url),
    props,
    pending,
    fonts,
    sounds,
  };
  return host;
}

const entry = (theme: Record<string, unknown>): ThemeEntry => readThemes({ [theme.id as string]: { format: 1, name: 'x', ...theme } }, 'themes')[0]!;

describe('thèmes intégrés', () => {
  it('Mire (par défaut) et Papier, tous deux valides', () => {
    assert.deepEqual(
      BUILTIN_THEMES.map((e) => [e.theme.id, e.base]),
      [
        ['mire', 'themes/mire'],
        ['papier', 'themes/papier'],
      ],
    );
  });

  it('Mire garde la palette des réglages et la grille ; Papier change tout', () => {
    const [mire, papier] = BUILTIN_THEMES.map(activeTheme);
    assert.equal(mire!.theme.palette, undefined);
    assert.equal(mire!.menu, null);
    assert.deepEqual(mire!.page, { layout: 'grid', card: 'auto', size: 'm', background: 'backdrop' });
    assert.equal(papier!.theme.palette, 'jour');
    assert.equal(papier!.menu, 'top');
    assert.deepEqual(papier!.page, { layout: 'rows', card: 'thumbnail', size: 'l', background: 'image' });
    assert.equal(papier!.images.background, 'themes/papier/images/fond.svg');
  });

  it('un theme.json invalide est écarté', () => {
    const errors: unknown[] = [];
    const log = console.error;
    console.error = (m: unknown) => void errors.push(m);
    try {
      assert.deepEqual(readThemes({ casse: { format: 1, id: 'casse', name: 'x', images: { background: '../../secret.png' } } }), []);
    } finally {
      console.error = log;
    }
    assert.match(String(errors[0]), /casse.*images\.background/);
  });
});

describe('moteur', () => {
  it('une portée commune habille les pages et l’accueil ensemble (P4-12)', () => {
    const scope = (): ThemeScope & { props: Map<string, string> } => {
      const props = new Map<string, string>();
      return { dataset: {}, props, style: { setProperty: (k, v) => void props.set(k, v), removeProperty: (k) => void props.delete(k) } };
    };
    const [pages, home] = [scope(), scope()];
    const host = { ...fakeHost(), scope: sharedScope([pages, home]) };
    const engine = createThemeEngine(BUILTIN_THEMES, host);
    engine.set('papier');
    for (const s of [pages, home]) {
      assert.equal(s.dataset.theme, 'papier');
      assert.equal(s.dataset.palette, 'jour');
      assert.match(s.props.get('--mire-font-heading') ?? '', /Palatino/);
    }
    assert.equal(host.scope.dataset.palette, 'jour');
    engine.set('mire');
    for (const s of [pages, home]) {
      assert.equal(s.dataset.theme, 'mire');
      assert.equal(s.dataset.palette, undefined);
      assert.equal(s.props.has('--mire-font-heading'), false);
    }
  });

  it('sans thème, refuse de démarrer', () => {
    assert.throws(() => createThemeEngine([], fakeHost()));
  });

  it('applique le thème par défaut, et retombe dessus pour un réglage inconnu', () => {
    const host = fakeHost();
    const engine = createThemeEngine(BUILTIN_THEMES, host);
    assert.equal(engine.set('inconnu').id, 'mire');
    assert.equal(host.scope.dataset.theme, 'mire');
    assert.equal(host.scope.dataset.palette, undefined);
    assert.deepEqual(
      engine.list().map((t) => t.id),
      ['mire', 'papier'],
    );
  });

  it('change de thème sans recharger : palette, polices, fond, abonnés prévenus', () => {
    const host = fakeHost();
    const engine = createThemeEngine(BUILTIN_THEMES, host);
    const seen: string[] = [];
    engine.onChange((a) => seen.push(`${a.id}:${a.page.layout}`));
    engine.set('mire');
    engine.set('papier');
    assert.equal(host.scope.dataset.palette, 'jour');
    assert.match(host.props.get('--mire-font-body') ?? '', /Georgia/);
    assert.equal(host.props.get('--mire-theme-background'), 'url("themes/papier/images/fond.svg")');
    engine.set('papier');
    engine.set('mire');
    assert.equal(host.scope.dataset.palette, undefined);
    assert.equal(host.props.has('--mire-font-body'), false);
    assert.equal(host.props.has('--mire-theme-background'), false);
    assert.deepEqual(seen, ['mire:grid', 'papier:rows', 'mire:grid']);
  });

  it('palette non encore liée : appliquée une fois chargée, sauf si un autre thème l’a emporté', () => {
    const host = fakeHost([]);
    const engine = createThemeEngine([BUILTIN_THEMES[0]!, entry({ id: 'velours', palette: 'velours' })], host);
    engine.set('velours');
    assert.equal(host.scope.dataset.palette, undefined);
    host.pending.shift()!();
    assert.equal(host.scope.dataset.palette, 'velours');
    engine.set('mire');
    engine.set('velours');
    engine.set('mire');
    host.pending.shift()!();
    assert.equal(host.scope.dataset.palette, undefined);
  });

  it('police d’un fichier du thème : chargée, puis placée avant les familles de repli', async () => {
    const host = fakeHost();
    const engine = createThemeEngine([BUILTIN_THEMES[0]!, entry({ id: 'police', fonts: { heading: { file: 'fonts/titre.woff2', family: 'serif' } } })], host);
    engine.set('police');
    assert.equal(host.props.get('--mire-font-heading'), 'serif');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(host.fonts, ['mire-theme-police-heading themes/police/fonts/titre.woff2']);
    assert.equal(host.props.get('--mire-font-heading'), '"mire-theme-police-heading", serif');
  });

  it('sons : seulement ceux que le thème déclare', () => {
    const host = fakeHost();
    const engine = createThemeEngine(BUILTIN_THEMES, host);
    engine.play('move');
    engine.set('papier');
    engine.play('move');
    engine.play('back');
    assert.deepEqual(host.sounds, ['themes/papier/sons/deplacement.wav']);
  });

  it('mise en page : valeurs par défaut, fond « image » sans image ramené à « aucun »', () => {
    assert.deepEqual(activeTheme(entry({ id: 'vide' })).page, DEFAULT_PAGE_LAYOUT);
    const e = entry({ id: 'fond', page: { background: 'backdrop', size: 's' } });
    assert.deepEqual(activeTheme(e).page, { ...DEFAULT_PAGE_LAYOUT, background: 'backdrop', size: 's' });
    const broken: ThemeEntry = { base: 'themes/x', theme: { format: 1, id: 'x', name: 'x', page: { background: 'image' } } };
    assert.equal(activeTheme(broken).page.background, 'none');
  });
});
