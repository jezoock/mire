// Contrôleurs de l'interface (P4-04) : méthodes appelées avec des clés stables, erreurs signalées, état « en cours »,
// pont des data-action historiques et vérification des ds-trigger (npm run check:actions).
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONTROLLER_CLASSES, createControllers } from '../../src/renderer/controllers/index.ts';
import type { Controllers } from '../../src/renderer/controllers/index.ts';
import { LEGACY_ACTIONS } from '../../src/renderer/controllers/bridge.ts';
import { actionNames, callAction, controller, invokeAction, setActionErrorHandler } from '../../src/renderer/controllers/registry.ts';
import type { ControllerContext, Data, LegacyUi } from '../../src/renderer/controllers/types.ts';
import { PAGE, S } from '../../src/renderer/state/index.ts';
import { checkActions, checkBridge, checkTriggers, findTriggers, targetMethods } from '../../scripts/check-actions.mjs';

type Call = [string, ...unknown[]];

/** Contexte de test : chaque opération de l'interface historique et du client API est enregistrée. */
function fakeContext(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const toasts: string[] = [];
  const record = (prefix: string) =>
    new Proxy(
      {},
      {
        get:
          (_t, name: string) =>
          (...args: unknown[]) => {
            calls.push([`${prefix}${name}`, ...args]);
            const answer = answers[`${prefix}${name}`];
            return typeof answer === 'function' ? answer(...args) : answer;
          },
      },
    );
  const ctx: ControllerContext = {
    S,
    api: record('api.') as ControllerContext['api'],
    ui: record('ui.') as LegacyUi,
    toast: (message) => toasts.push(message),
    t: (key) => key,
    page: PAGE,
    dialogs: record('dialogs.') as ControllerContext['dialogs'],
  };
  return { ctx, calls, toasts, c: createControllers(ctx) };
}

const named = (calls: Call[], name: string) => calls.filter((c) => c[0] === name);

describe('contrôleurs', () => {
  let calls: Call[];
  let toasts: string[];
  let c: Controllers;
  beforeEach(() => {
    ({ calls, toasts, c } = fakeContext({ 'api.downloadsAddUrl': async () => ({ ok: true }), 'ui.confirm': async () => true }));
    S.list = [
      { path: '/v/a.mkv', name: 'A', dir: '/v', kind: 'video' },
      { path: '/v/b.mkv', name: 'B', dir: '/v', kind: 'video' },
      { path: '/m/c.flac', name: 'C', dir: '/m', kind: 'audio' },
    ];
    S.query = '';
    S.limit = PAGE;
  });

  it('chaque balise a un contrôleur enregistré, et ses actions sont ses méthodes publiques', () => {
    for (const tag of Object.keys(CONTROLLER_CLASSES)) assert.ok(controller(tag), tag);
    assert.deepEqual(actionNames(c.app).slice(0, 3), ['go', 'back', 'cycleSection']);
    // L'accesseur du contexte n'est pas une action.
    assert.ok(!actionNames(c.app).includes('ctx'));
  });

  it('désigne les éléments par une clé stable, pas par leur position', () => {
    c.page.playVideo({ path: '/v/b.mkv' });
    assert.deepEqual(named(calls, 'ui.openVideo')[0]!.slice(2), [1]);
    c.page.playTrack({ path: '/m/c.flac' });
    const [, album, index] = named(calls, 'ui.playQueue')[0]!;
    assert.deepEqual(
      (album as Data[]).map((x) => x.path),
      ['/m/c.flac'],
    );
    assert.equal(index, 0);
    c.page.playAlbum({ dir: '/v' });
    assert.equal((named(calls, 'ui.playQueue')[1]![1] as Data[]).length, 2);
  });

  it('un élément inconnu ne lance rien de faux', () => {
    S.recent = [{ path: '/v/a.mkv' }];
    c.home.playRecent({ path: '/autre' });
    assert.equal(named(calls, 'ui.playRecent').length, 0);
    c.home.playRecent({ path: '/v/a.mkv' });
    assert.equal(named(calls, 'ui.playRecent').length, 1);
  });

  it('la coquille ouvre une cible et un site par leur clé (P4-07)', () => {
    c.app.open({ target: 'movies', path: ['Friends', 1], focus: 'keep' });
    c.app.open({ target: 'screen:search' });
    c.app.openSite({ id: 'tv:sfr' });
    assert.deepEqual(named(calls, 'ui.open'), [
      ['ui.open', 'movies', { path: ['Friends', 1], focus: 'keep' }],
      ['ui.open', 'screen:search', { path: [], focus: 'content' }],
    ]);
    assert.deepEqual(named(calls, 'ui.openSite'), [['ui.openSite', 'tv:sfr']]);
  });

  it('« Afficher plus » rend la position du premier élément ajouté', () => {
    assert.equal(c.app.showMore(), PAGE);
    assert.equal(S.limit, PAGE * 2);
  });

  it('les actions asynchrones attendent le processus principal et prévient par un message', async () => {
    assert.equal(await c.centre.addDownload({ url: '' }), false);
    assert.equal(named(calls, 'api.downloadsAddUrl').length, 0);
    assert.equal(await c.centre.addDownload({ url: 'https://exemple.fr/a.zip', console: '3' }), true);
    assert.deepEqual(named(calls, 'api.downloadsAddUrl')[0], ['api.downloadsAddUrl', 'https://exemple.fr/a.zip', { console: '3' }]);
    assert.deepEqual(toasts, ['centre.downloads.messages.needUrl', 'centre.downloads.messages.added']);
  });

  it('la manette passe à l’écran ou à la page suivante du menu (P4-11 : la coquille choisit)', () => {
    const { calls: log, c: ctl } = fakeContext();
    ctl.app.cycleSection({ step: -1 });
    assert.deepEqual(named(log, 'ui.cycle'), [['ui.cycle', -1]]);
  });

  it('vue de page : regroupements, chemin, tranches et ancienne vue', async () => {
    const { calls: log, c: ctl } = fakeContext({ 'ui.openPageGroup': () => true, 'ui.pageLegacySection': () => 'videos' });
    assert.equal(ctl.page.openGroup({ value: null }), true);
    ctl.page.openPath({ path: ['Friends'] });
    ctl.page.openPath({ path: 'pas un chemin' as never });
    await ctl.page.loadMore();
    ctl.page.openLegacy();
    assert.deepEqual(
      log.filter((c) => c[0] !== 'ui.pageLegacySection'),
      [['ui.openPageGroup', null], ['ui.openPagePath', ['Friends']], ['ui.openPagePath', []], ['ui.loadMorePage'], ['ui.go', 'videos', { focus: 'content' }]],
    );
  });

  it('openElement : chaque façon de s’ouvrir, l’élément désigné par sa clé', async () => {
    const elements: Record<string, unknown> = {
      'local:/v/a.mkv': { key: 'local:/v/a.mkv', name: 'A', tags: ['video'], open: { kind: 'file', path: '/v/a.mkv' } },
      'local:/n.mp3': { key: 'local:/n.mp3', name: 'N', tags: ['audio'], open: { kind: 'file', path: '/n.mp3' } },
      'web:arte': { key: 'web:arte', name: 'Arte', tags: ['stream'], open: { kind: 'site', url: 'https://arte.tv', site: 'arte' } },
      'rom:3|/r/z.sfc': { key: 'rom:3|/r/z.sfc', name: 'Zelda', tags: ['game'], open: { kind: 'game', console: '3', path: '/r/z.sfc' } },
      'pc:/g/a.exe': { key: 'pc:/g/a.exe', name: 'Jeu', tags: ['game'], open: { kind: 'program', path: '/g/a.exe' } },
      'tv:x|1': { key: 'tv:x|1', name: 'Une', tags: ['tv'], open: { kind: 'stream', url: 'http://box/1' } },
    };
    const { calls: log, c: ctl } = fakeContext({ 'api.catalogElement': async (k: string) => elements[k] ?? null });
    S.videos = [{ path: '/v/a.mkv', name: 'A', dir: '/v', kind: 'video' }];
    S.tracks = [];
    S.images = [];
    S.channels = [];
    for (const key of Object.keys(elements)) await ctl.page.openElement({ key });
    await assert.rejects(ctl.page.openElement({ key: 'local:/absent' }), /introuvable/);
    assert.deepEqual(
      log.filter((c) => !c[0].startsWith('api.')),
      [
        ['ui.playInContext', { path: '/v/a.mkv', name: 'A', dir: '/v', kind: 'video' }],
        ['ui.playInContext', { path: '/n.mp3', name: 'N', kind: 'audio' }],
        ['ui.openWeb', 'arte', 'https://arte.tv'],
        ['ui.launchRom', { path: '/r/z.sfc', displayName: 'Zelda' }, '3'],
        ['ui.launchEntry', { name: 'Jeu', path: '/g/a.exe' }],
        ['ui.playChannel', { name: 'Une', variants: [{ q: 'hd', url: 'http://box/1' }] }],
      ],
    );
    S.videos = [];
  });

  it('accueil (P4-12) : barres et titres ouvrent des cibles, regroupements, éléments, sites et « Reprendre » par leur clé', async () => {
    const elements: Record<string, unknown> = {
      'web:arte': { key: 'web:arte', name: 'Arte', tags: ['stream'], open: { kind: 'site', url: 'https://arte.tv', site: 'arte' } },
    };
    const { calls: log, c: ctl } = fakeContext({ 'ui.open': () => true, 'api.catalogElement': async (k: string) => elements[k] ?? null });
    assert.equal(ctl.home.open({ target: 'movies' }), true);
    ctl.home.open({ target: 'screen:search' });
    ctl.home.openGroup({ target: 'movies', value: 'Drame' });
    ctl.home.openGroup({ target: 'movies', value: null });
    await ctl.home.openElement({ key: 'web:arte' });
    S.config = { web: [{ id: 'netflix', name: 'Netflix' }] } as unknown as typeof S.config;
    ctl.home.openSite({ key: 'web:netflix' });
    assert.throws(() => ctl.home.openSite({ key: 'web:retire' }), /introuvable/);
    S.recent = [
      { path: '/v/a.mkv', key: 'local:/v/a.mkv' },
      { path: 'magnet:?xt=1', key: null },
    ];
    ctl.home.resume({ key: 'local:/v/a.mkv' });
    ctl.home.resume({ key: 'magnet:?xt=1' });
    assert.throws(() => ctl.home.resume({ key: 'local:/absent' }), /Reprendre/);
    assert.deepEqual(
      log.filter((c) => !c[0].startsWith('api.')),
      [
        ['ui.open', 'movies', { path: [], focus: 'content' }],
        ['ui.open', 'screen:search', { path: [], focus: 'keep' }],
        ['ui.open', 'movies', { path: ['Drame'], focus: 'content' }],
        ['ui.open', 'movies', { path: [null], focus: 'content' }],
        ['ui.openWeb', 'arte', 'https://arte.tv'],
        ['ui.openWeb', 'netflix'],
        ['ui.playRecent', { path: '/v/a.mkv', key: 'local:/v/a.mkv' }],
        ['ui.playRecent', { path: 'magnet:?xt=1', key: null }],
      ],
    );
    S.recent = [];
  });

  it('réglages de l’accueil (P4-12) : rangées, barres et sites, montrés ou cachés et déplacés par leur identifiant', async () => {
    const ui: Data = { home: { clock: true, recent: true, bars: [], services: [], rows: [{ kind: 'bars', targets: ['movies'] }, { kind: 'recent' }] } };
    const { c: ctl } = fakeContext({ 'ui.saveUi': async (mutate: (u: Data) => void) => mutate(ui) });
    await ctl.settings.toggleHomeItem({ kind: 'bars', id: 'screen:search', on: true });
    await ctl.settings.moveHomeItem({ kind: 'bars', id: 'screen:search', dir: -1 });
    await ctl.settings.moveHomeItem({ kind: 'rows', id: 'recent', dir: -1 });
    await ctl.settings.toggleHomeItem({ kind: 'sites', id: 'web:arte', on: true });
    await ctl.settings.setHomeClock({ on: false });
    assert.deepEqual(ui.home.rows, [{ kind: 'recent' }, { kind: 'bars', targets: ['screen:search', 'movies'] }, { kind: 'sites', keys: ['web:arte'] }]);
    assert.equal(ui.home.clock, false);
    await assert.rejects(ctl.settings.moveHomeItem({ kind: 'services', id: 'x', dir: 1 }), /inconnue/);
  });
});

describe('registre : appel des actions', () => {
  it('une erreur est signalée (message), sans rejeter', async () => {
    fakeContext({
      'ui.openVideo': () => {
        throw new Error('panne');
      },
    });
    const errors: unknown[] = [];
    setActionErrorHandler((error, context) => errors.push([(error as Error).message, context]));
    const r = await invokeAction('mire-page', 'playVideo', { path: '/v/a.mkv' });
    assert.deepEqual(r, { ok: false });
    assert.deepEqual(errors, [['panne', { tag: 'mire-page', method: 'playVideo' }]]);
  });

  it('une action inconnue, ou qui n’est pas publique, est refusée et signalée', async () => {
    fakeContext();
    const errors: string[] = [];
    setActionErrorHandler((error) => errors.push((error as Error).message));
    assert.equal(await callAction('mire-page', 'nexistePas'), undefined);
    assert.equal(await callAction('mire-page', 'constructor'), undefined);
    assert.equal(await callAction('mire-rien', 'go'), undefined);
    assert.equal(errors.length, 3);
  });

  it('pendant une action, son déclencheur est « en cours » et ne la relance pas', async () => {
    let release!: () => void;
    fakeContext({ 'api.downloadsPause': () => new Promise<void>((r) => (release = r)) });
    const attrs = new Map<string, string>();
    const trigger = {
      getAttribute: (n: string) => attrs.get(n) ?? null,
      setAttribute: (n: string, v: string) => attrs.set(n, v),
      removeAttribute: (n: string) => attrs.delete(n),
    } as unknown as Element;
    const first = invokeAction('mire-centre', 'pauseDownload', { id: 'x' }, trigger);
    assert.equal(attrs.get('aria-busy'), 'true');
    assert.deepEqual(await invokeAction('mire-centre', 'pauseDownload', { id: 'x' }, trigger), { ok: false });
    release();
    assert.deepEqual(await first, { ok: true, value: undefined });
    assert.equal(attrs.has('aria-busy'), false);
  });
});

describe('pont des data-action historiques', () => {
  it('chaque entrée désigne une méthode existante de son contrôleur', () => {
    const methods = targetMethods();
    for (const [name, { tag, method }] of Object.entries(LEGACY_ACTIONS)) {
      assert.ok(methods[tag]?.includes(method), `${name} → ${tag}.${method}`);
    }
  });

  it('traduit la position d’un élément en sa clé', () => {
    S.list = [{ path: '/a' }, { path: '/b', consoleId: 4 }];
    const args = (name: string, d: Record<string, string>) => LEGACY_ACTIONS[name]!.args!(d, {} as HTMLElement);
    assert.deepEqual(args('play-video', { index: '1' }), { path: '/b' });
    assert.deepEqual(args('launch-rom-u', { index: '1' }), { path: '/b', consoleId: 4 });
    assert.deepEqual(args('scrape-section', { kind: 'videos', force: '1' }), { kind: 'videos', force: true });
    assert.deepEqual(args('go', { go: 'settings' }), { section: 'settings' });
  });

  it('npm run check:actions ne trouve aucun problème, et relie les ~70 actions historiques', () => {
    const { errors, legacy, triggers } = checkActions();
    assert.deepEqual(errors, []);
    // Le nombre baisse à mesure que les vues historiques sont remplacées (P4-12 : l'accueil en retire deux ; P4-18 : le
    // Centre en retire dix-huit ; P4-13 : la Recherche en retire neuf).
    assert.ok(legacy >= 70, `${legacy} actions`);
    assert.ok(triggers >= 1);
  });

  it('boîtes de dialogue (P4-06) : un gabarit dont le nom de l’action est écrit tel quel est vérifié par ce nom', () => {
    const boxes = findTriggers().filter((tr: { file: string }) => /packages\/ui\/src\/components\/mire-(form|pick)\//.test(tr.file));
    assert.ok(boxes.length >= 3);
    assert.ok(boxes.every((tr: { target: unknown; action: unknown }) => tr.target === 'mire-dialogs' && tr.action === 'act:…'));
    assert.deepEqual(checkTriggers(boxes, targetMethods()), []);
    assert.equal(checkTriggers([{ file: 'a.tsx', line: 1, target: 'mire-dialogs', action: 'vole:…' }], targetMethods()).length, 1);
  });

  it('vérifie aussi la cible et l’action passées aux composants d’éléments, pas celles qu’ils transmettent (P4-05)', () => {
    const triggers = findTriggers();
    // Les boutons de la démonstration des boîtes (P4-06) appellent openDialog ; les composants d'éléments, pick.
    const demo = triggers.filter((tr: { file: string; action?: string }) => tr.file === 'src/renderer/demo/index.ts' && !tr.action?.startsWith('openDialog:'));
    assert.ok(demo.length >= 4, `${demo.length} composants d'éléments dans la démonstration`);
    assert.ok(demo.every((tr: { target: unknown; action: unknown }) => tr.target === 'mire-demo' && tr.action === 'pick'));
    assert.ok(!triggers.some((tr: { file: string }) => /packages\/ui\/src\/components\/mire-(card|grid|row|group-card)\//.test(tr.file)));
  });

  it('signale une action inconnue, une cible qui n’est pas un mire-*, un data-action sans entrée', () => {
    const methods = { 'mire-app': ['go'] };
    const errors = checkTriggers(
      [
        { file: 'a.ts', line: 1, target: 'mire-app', action: 'go:[{"section":"home"}]' },
        { file: 'a.ts', line: 2, target: 'mire-app', action: 'vole' },
        { file: 'a.ts', line: 3, target: '#slider', action: 'next' },
        { file: 'a.ts', line: 4, target: 'mire-rien', action: 'go' },
        { file: 'a.ts', line: 5, target: 'mire-app', action: undefined },
      ],
      methods,
    );
    assert.equal(errors.length, 4);
    assert.match(errors[0]!, /a\.ts:2 .*vole/);
    const bridgeErrors = checkBridge(new Map([['inconnue', 'b.js:9']]), { go: { tag: 'mire-app', method: 'partir' } }, methods);
    assert.equal(bridgeErrors.length, 3);
  });
});
