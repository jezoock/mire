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

  it('« Afficher plus » rend la position du premier élément ajouté', () => {
    assert.equal(c.app.showMore(), PAGE);
    assert.equal(S.limit, PAGE * 2);
  });

  it('les actions asynchrones attendent le processus principal et prévient par un message', async () => {
    assert.equal(await c.centre.addDownload({ url: '' }), false);
    assert.equal(named(calls, 'api.downloadsAddUrl').length, 0);
    assert.equal(await c.centre.addDownload({ url: 'https://exemple.fr/a.zip', console: '3' }), true);
    assert.deepEqual(named(calls, 'api.downloadsAddUrl')[0], ['api.downloadsAddUrl', 'https://exemple.fr/a.zip', { console: '3' }]);
    assert.deepEqual(toasts, ['Collez d’abord un lien (https://… ou magnet:?…).', 'Téléchargement ajouté.']);
  });

  it('la manette passe à l’écran suivant (depuis un site, à partir de sa page d’origine)', () => {
    const { calls: log, c: ctl } = fakeContext({ 'ui.nextSection': () => 'search', 'ui.webHome': () => 'games' });
    S.section = 'web';
    ctl.app.cycleSection({ step: 1 });
    assert.deepEqual(named(log, 'ui.nextSection')[0], ['ui.nextSection', 'games', 1]);
    assert.deepEqual(named(log, 'ui.go')[0], ['ui.go', 'search', { focus: 'keep' }]);
    S.section = 'home';
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

  it('npm run check:actions ne trouve aucun problème, et relie les ~100 actions historiques', () => {
    const { errors, legacy, triggers } = checkActions();
    assert.deepEqual(errors, []);
    assert.ok(legacy >= 100, `${legacy} actions`);
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
