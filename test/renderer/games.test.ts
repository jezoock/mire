// Jeux (P4-17), côté page : cartes des consoles, formulaire d'une console, choix d'un émulateur, et contrôleur
// `mire-games` avec un faux client (consoles, émulateur d'une console et d'un jeu, lancement, suppression par la clé,
// marque-pages).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Element, Emulator } from '@mire/shared';
import type { EmulatorChoice } from '@mire/shared/ipc';
import { normalizeField, CENTRE_TABS, centreTab } from '@mire/ui/utils';
import { GamesController } from '../../src/renderer/controllers/games.ts';
import type { ControllerContext } from '../../src/renderer/controllers/types.ts';
import type { FormOptions } from '../../src/renderer/ui/dialogs.ts';
import {
  consoleCards,
  consoleFields,
  consoleInput,
  emulatorOptions,
  isGameBookmarkKey,
  isGameKey,
  onlineSources,
  onlineToDownload,
  programName,
} from '../../src/renderer/games/model.ts';
import { PageController } from '../../src/renderer/controllers/page.ts';
import { registerController } from '../../src/renderer/controllers/registry.ts';
import fr from '../../packages/shared/src/i18n/locales/fr.json' with { type: 'json' };
import en from '../../packages/shared/src/i18n/locales/en.json' with { type: 'json' };

type Any = any;
type Messages = Record<string, unknown>;
function translator(messages: Messages) {
  return (key: string, vars: Record<string, string | number> = {}) => {
    let v = key.split('.').reduce<unknown>((o, k) => (o as Messages | undefined)?.[k], messages);
    if (v && typeof v === 'object' && 'count' in vars) v = (v as Messages)[vars.count === 1 ? 'one' : 'other'];
    assert.equal(typeof v, 'string', key);
    return (v as string).replace(/\{(\w+)\}/g, (_, n: string) => String(vars[n]));
  };
}
const tFr = translator(fr.messages as Messages);
const tEn = translator(en.messages as Messages);

const PS1 = 'Sony - PlayStation';
const consoles = (): Emulator[] =>
  [
    {
      id: 'duck',
      name: 'PlayStation',
      path: '/emu/duckstation/DuckStation.AppImage',
      args: ['{rom}'],
      sources: ['/jeux/ps1b'],
      romsDir: '/jeux/ps1',
      system: PS1,
      store: 'duckstation:ps1',
    },
    { id: 'ra', name: 'PlayStation (RetroArch)', path: 'C:\\RetroArch\\retroarch.exe', sources: [], system: PS1, emulator: 'duck' },
  ] as Emulator[];
const choices: EmulatorChoice[] = [
  { id: 'duck', emulator: 'DuckStation', console: 'PlayStation' },
  { id: 'ra', emulator: 'RetroArch', console: 'PlayStation (RetroArch)' },
];

describe('Jeux : modèle (P4-17)', () => {
  it('reconnaît les clés des jeux et des marque-pages', () => {
    assert.equal(isGameKey('rom:snes|/jeux/a.sfc'), true);
    assert.equal(isGameKey('pc:/jeux/a.exe'), true);
    assert.equal(isGameKey('local:/films/a.mkv'), false);
    assert.equal(isGameBookmarkKey('gamebm:abc'), true);
    assert.equal(programName('C:\\RetroArch\\retroarch.exe'), 'retroarch');
  });

  it('rédige les cartes des consoles : système, dossiers et émulateur qui lance les jeux', () => {
    assert.deepEqual(consoleCards(consoles(), tFr), [
      { id: 'duck', name: 'PlayStation', meta: `${PS1} · 2 dossiers`, emulator: 'Émulateur : DuckStation', store: true },
      {
        id: 'ra',
        name: 'PlayStation (RetroArch)',
        meta: `${PS1} · 0 dossiers`,
        emulator: 'Émulateur : DuckStation, celui de la console PlayStation',
        store: false,
      },
    ]);
    assert.equal(consoleCards(consoles(), tEn)[1].emulator, 'Emulator: DuckStation, from the PlayStation console');
    assert.deepEqual(consoleCards(null, tFr), []);
  });

  it('remplit le formulaire d’une console et lit ses valeurs', () => {
    const systems = [{ id: PS1, name: 'PlayStation' }];
    const fields = consoleFields(consoles()[0], systems, [{ name: 'Site', url: 'https://site.test', search: 'https://site.test/?q={q}' }], tFr);
    assert.deepEqual(
      fields.map((f) => f.id),
      ['name', 'system', 'path', 'args', 'romsDir', 'sources', 'extensions', 'romSites'],
    );
    const values = Object.fromEntries(fields.map((f) => [f.id, normalizeField(f).value]));
    assert.equal(values.system, PS1);
    assert.equal(values.romSites, 'Site | https://site.test | https://site.test/?q={q}');
    const input = consoleInput({ ...values, args: '-f "{rom}"', extensions: 'cue, .BIN' }, [
      { name: 'Site', url: 'https://site.test', search: 'https://site.test/?q={q}' },
    ]);
    assert.deepEqual(input, {
      name: 'PlayStation',
      system: PS1,
      path: '/emu/duckstation/DuckStation.AppImage',
      args: ['-f', '{rom}'],
      romsDir: '/jeux/ps1',
      sources: ['/jeux/ps1b'],
      extensions: ['cue', '.BIN'],
      // Les mêmes sites que ceux que Mire propose : la console n'en garde pas de propres.
      romSites: null,
    });
    assert.deepEqual(consoleInput({ name: 'X', path: '/x', romSites: 'Autre | https://autre.test' }, []).romSites, [
      { name: 'Autre', url: 'https://autre.test', search: '' },
    ]);
    // Nouvelle console : champs vides, {rom} proposé.
    const blank = consoleFields(null, systems, [], tFr);
    assert.equal(normalizeField(blank[3]).value, '{rom}');
    assert.equal(normalizeField(blank[1]).value, '');
  });

  it('propose les émulateurs d’une console, puis ceux d’un jeu après « celui de la console »', () => {
    assert.deepEqual(emulatorOptions(choices, 'duck', tFr), [
      ['duck', 'DuckStation'],
      ['ra', 'RetroArch (console PlayStation (RetroArch))'],
    ]);
    assert.deepEqual(emulatorOptions(choices, 'duck', tFr, { consoleDefault: 'ra' })[0], ['', 'Celui de la console (RetroArch)']);
    assert.deepEqual(emulatorOptions(choices, 'duck', tEn, { consoleDefault: null })[0], ['', "The console's (DuckStation)"]);
  });

  it('le Centre a un onglet des consoles (puis ceux des plugins et des dépôts, P4-19)', () => {
    assert.deepEqual([...CENTRE_TABS], ['downloads', 'apps', 'consoles', 'plugins', 'repos']);
    assert.equal(centreTab('consoles'), 'consoles');
  });
});

describe('Jeux : contrôleur mire-games (P4-17)', () => {
  const rom: Element = {
    key: 'rom:duck|/jeux/ps1/Jeu.cue',
    name: 'Jeu',
    open: { kind: 'game', console: 'duck', path: '/jeux/ps1/Jeu.cue' },
    tags: [],
    infos: {},
    images: {},
  } as unknown as Element;
  const bm: Element = { ...rom, key: 'gamebm:b1', name: 'À venir', open: { kind: 'site', url: 'https://jeux.test/a' } } as unknown as Element;

  function harness(clicks: { action: string; values?: Record<string, unknown> }[], api: Record<string, unknown> = {}, confirm = true) {
    const calls: unknown[][] = [];
    const toasts: string[] = [];
    const forms: FormOptions[] = [];
    const fakeApi: Any = {
      gameSystems: async () => [{ id: PS1, name: 'PlayStation' }],
      romSites: async () => ({ sites: [], defaults: [] }),
      consoleSave: async (input: unknown, id?: string) => (
        calls.push(['consoleSave', input, id]),
        { ok: true, id: id ?? 'neuve-1', config: { emulators: [] } }
      ),
      consoleRemove: async (id: string) => (calls.push(['consoleRemove', id]), { ok: true, config: { emulators: [] } }),
      consoleEmulators: async () => choices,
      consoleSetEmulator: async (id: string, e: unknown) => (calls.push(['consoleSetEmulator', id, e]), { ok: true, config: {} }),
      catalogElement: async (key: string) => ({ [rom.key]: rom, [bm.key]: bm })[key] ?? null,
      gameEmulators: async () => ({ ok: true, console: 'duck', choices, consoleDefault: null, game: null }),
      gameSetEmulator: async (key: string, e: unknown) => (calls.push(['gameSetEmulator', key, e]), { ok: true, config: {} }),
      gameLaunch: async (key: string, e: unknown) => (calls.push(['gameLaunch', key, e]), { ok: true }),
      gameDeleteElement: async (key: string) => (calls.push(['gameDeleteElement', key]), { ok: true }),
      gameBookmarkRemove: async (id: string) => (calls.push(['gameBookmarkRemove', id]), { ok: true, config: {} }),
      ...api,
    };
    const ctx = {
      S: { config: { emulators: consoles() } },
      api: fakeApi,
      t: tFr,
      toast: (m: string) => toasts.push(m),
      ui: {
        afterConsolesChange: () => calls.push(['afterConsolesChange']),
        openRomBrowser: (id: unknown) => calls.push(['openRomBrowser', id]),
        pauseAudio: () => calls.push(['pauseAudio']),
        launchEntry: (g: unknown) => calls.push(['launchEntry', g]),
        downloadGameBookmark: (id: unknown) => calls.push(['downloadGameBookmark', id]),
      },
      dialogs: {
        async form(opts: FormOptions): Promise<{ action: string; values: Record<string, unknown> }> {
          forms.push(opts);
          // Question oui / non : notée, puis la réponse du test.
          if (opts.actions?.[0]?.id === 'yes') {
            calls.push(['confirm', opts.title]);
            return { action: confirm ? 'yes' : 'no', values: {} };
          }
          let values: Record<string, unknown> = Object.fromEntries((opts.fields ?? []).map((f) => [f.id, normalizeField(f).value]));
          const form = { values: () => values, set: () => {}, setImage: () => {}, help: () => {} };
          const click = clicks.shift();
          if (!click) return { action: 'cancel', values };
          values = { ...values, ...click.values };
          const keep = opts.onAction ? await opts.onAction(click.action, form as never) : false;
          if (keep) return this.form(opts);
          return { action: click.action, values };
        },
      },
    } as unknown as ControllerContext;
    return { ctrl: new GamesController(ctx), calls, toasts, forms };
  }

  it('crée une console à la main ; un refus du processus principal garde la boîte ouverte', async () => {
    let first = true;
    const h = harness(
      [
        { action: 'save', values: { name: 'Mega Drive' } },
        { action: 'save', values: { name: 'Mega Drive', path: '/emu/genesis' } },
      ],
      {
        consoleSave: async (input: Any) => {
          if (first) {
            first = false;
            return { ok: false, error: 'Choisissez le programme de l’émulateur.' };
          }
          return { ok: true, id: 'mega-drive-1', config: { emulators: [] }, input };
        },
      },
    );
    assert.equal(await h.ctrl.newConsole(), 'mega-drive-1');
    assert.equal(h.forms.length, 2);
    assert.equal(h.forms[0].title, 'Créer une console');
    assert.deepEqual(h.toasts, ['Choisissez le programme de l’émulateur.', 'Console créée']);
    assert.deepEqual(h.calls, [['afterConsolesChange']]);
  });

  it('modifie une console désignée par son identifiant, et la retire après confirmation', async () => {
    const h = harness([{ action: 'save', values: { name: 'PS1' } }]);
    assert.equal(await h.ctrl.editConsole({ id: 'duck' }), 'duck');
    assert.equal((h.calls[0] as Any[])[2], 'duck');
    assert.equal((h.calls[0] as Any[])[1].name, 'PS1');
    assert.equal(await h.ctrl.removeConsole({ id: 'ra' }), true);
    assert.deepEqual(h.calls.slice(-3), [['confirm', 'Retirer la console PlayStation (RetroArch) ?'], ['consoleRemove', 'ra'], ['afterConsolesChange']]);
    assert.equal(await h.ctrl.editConsole({ id: 'inconnue' }), null);
    assert.equal(h.toasts.at(-1), 'Cette console n’existe plus.');
  });

  it('choisit l’émulateur d’une console : celui d’une autre console, ou le sien (null)', async () => {
    const h = harness([
      { action: 'save', values: { emulator: 'ra' } },
      { action: 'save', values: { emulator: 'duck' } },
    ]);
    assert.equal(await h.ctrl.chooseEmulator({ id: 'duck' }), true);
    assert.equal(await h.ctrl.chooseEmulator({ id: 'duck' }), true);
    assert.deepEqual(
      h.calls.filter((c) => c[0] === 'consoleSetEmulator'),
      [
        ['consoleSetEmulator', 'duck', 'ra'],
        ['consoleSetEmulator', 'duck', null],
      ],
    );
    assert.equal(h.toasts.at(-1), 'Émulateur enregistré');
  });

  it('boîte d’un jeu : l’émulateur choisi est enregistré, puis le jeu est lancé par sa clé', async () => {
    const h = harness([{ action: 'launch', values: { emulator: 'ra' } }]);
    assert.equal(await h.ctrl.gameOptions({ key: rom.key }), 'launch');
    assert.deepEqual(h.forms[0].fields?.[0].options?.[0], ['', 'Celui de la console (DuckStation)']);
    assert.deepEqual(
      h.calls.filter((c) => c[0] !== 'afterConsolesChange'),
      [['gameSetEmulator', rom.key, 'ra'], ['pauseAudio'], ['gameLaunch', rom.key, undefined]],
    );
  });

  it('boîte d’un jeu : supprimer passe par la clé, après confirmation ; un refus est affiché', async () => {
    const h = harness([{ action: 'delete' }], {
      gameDeleteElement: async () => ({ ok: false, error: 'Ce fichier ne se trouve pas dans les dossiers de PS1 : il n’a pas été supprimé.' }),
    });
    assert.equal(await h.ctrl.gameOptions({ key: rom.key }), 'delete');
    assert.deepEqual(h.calls, [['confirm', 'Supprimer « Jeu » ?']]);
    assert.match(h.toasts.at(-1)!, /ne se trouve pas dans les dossiers/);
    const ok = harness([]);
    assert.equal(await ok.ctrl.deleteGame({ key: rom.key }), true);
    assert.deepEqual(ok.calls.at(-1), ['gameDeleteElement', rom.key]);
    assert.equal(ok.toasts.at(-1), 'Jeu supprimé');
  });

  it('marque-page « à télécharger » : télécharger, ou retirer après confirmation', async () => {
    const h = harness([{ action: 'download' }, { action: 'remove' }]);
    assert.equal(await h.ctrl.gameOptions({ key: bm.key }), 'download');
    assert.equal(await h.ctrl.bookmark({ key: bm.key }), 'remove');
    assert.deepEqual(h.calls, [['downloadGameBookmark', 'b1'], ['confirm', 'Retirer « À venir » ?'], ['gameBookmarkRemove', 'b1'], ['afterConsolesChange']]);
    assert.equal(h.toasts.at(-1), 'Jeu retiré');
  });

  it('ouvre les sites de jeux d’une console existante', () => {
    const h = harness([]);
    h.ctrl.openSites({ id: 'duck' });
    h.ctrl.openSites({ id: 'inconnue' });
    assert.deepEqual(h.calls, [['openRomBrowser', 'duck']]);
  });
});

// P4-29 : jeux en ligne d'une console, téléchargement d'un jeu en ligne par sa clé, nettoyage de la base, touche Suppr
// sur une carte de jeu et « Tout lire » d'une page de musique.
describe('Jeux : fonctions reprises de l’interface historique (P4-29)', () => {
  const online: Emulator = {
    id: 'snes',
    name: 'Super Nintendo',
    path: '/emu/snes',
    sources: ['/jeux/snes', 'https://a.test/snes/', 'http://b.test/'],
  } as Emulator;
  const remote: Element = {
    key: 'rom:snes|https://a.test/snes/Jeu%20Un.sfc',
    name: 'Jeu Un',
    open: { kind: 'game', console: 'snes', path: 'https://a.test/snes/Jeu%20Un.sfc' },
    tags: [],
    infos: {},
    images: {},
  } as unknown as Element;
  const listing = {
    ok: true,
    errors: [],
    roms: [
      { path: '/jeux/snes/Jeu Un.sfc', remote: false },
      { path: 'https://a.test/snes/Jeu%20Un.sfc', remote: true },
      { path: 'https://a.test/snes/Jeu%20Deux.sfc?x=1', remote: true },
    ],
  };

  it('trouve les sources en ligne d’une console et les jeux en ligne qui ne sont pas déjà sur l’ordinateur', () => {
    assert.deepEqual(onlineSources(online), ['https://a.test/snes/', 'http://b.test/']);
    assert.deepEqual(onlineSources(null), []);
    assert.deepEqual(
      onlineToDownload(listing.roms).map((r) => r.path),
      ['https://a.test/snes/Jeu%20Deux.sfc?x=1'],
    );
    // Une seule source lue : les jeux locaux viennent de la liste des dossiers.
    assert.deepEqual(
      onlineToDownload(listing.roms.slice(1), [{ path: 'C:\\Jeux\\JEU DEUX.sfc' }]).map((r) => r.path),
      ['https://a.test/snes/Jeu%20Un.sfc'],
    );
    assert.equal(consoleCards([online], tFr)[0].online, true);
    assert.equal('online' in consoleCards(consoles(), tFr)[0], false);
  });

  function harness(clicks: string[], api: Record<string, unknown> = {}, values: Record<string, unknown> = {}) {
    const calls: unknown[][] = [];
    const toasts: string[] = [];
    const forms: FormOptions[] = [];
    const ctx = {
      S: { config: { emulators: [online] } },
      api: {
        catalogElement: async (key: string) => (key === remote.key ? remote : null),
        romListSource: async (id: string, only?: string) => (calls.push(['romListSource', id, only]), listing),
        listRoms: async (id: string) => (calls.push(['listRoms', id]), { ok: true, roms: [] }),
        romDownload: async (id: string, url: string) => (calls.push(['romDownload', id, url]), { ok: true, count: 1 }),
        gamesCleanup: async (o: boolean) => (calls.push(['gamesCleanup', o]), { ok: true, removedManual: 2, missingRemote: ['x'], config: { emulators: [] } }),
        gameEmulators: async () => ({ ok: true, console: 'snes', choices: [], consoleDefault: null, game: null }),
        ...api,
      },
      t: tFr,
      toast: (m: string) => toasts.push(m),
      ui: {
        open: (target: string) => calls.push(['open', target]),
        afterConsolesChange: () => calls.push(['afterConsolesChange']),
      },
      dialogs: {
        async form(opts: FormOptions) {
          forms.push(opts);
          return { action: clicks.shift() ?? 'cancel', values };
        },
      },
    } as unknown as ControllerContext;
    return { ctrl: new GamesController(ctx), calls, toasts, forms };
  }

  it('lit les jeux en ligne d’une console, puis ouvre la page Jeux', async () => {
    const h = harness(['show'], {}, { source: 'http://b.test/' });
    assert.equal(await h.ctrl.onlineGames({ id: 'snes' }), 'show');
    assert.equal(h.forms[0].title, 'Jeux en ligne de Super Nintendo');
    assert.deepEqual(h.forms[0].fields?.[0].options?.[0], ['', 'Toutes les sources']);
    assert.deepEqual(h.calls, [
      ['romListSource', 'snes', 'http://b.test/'],
      ['open', 'games'],
    ]);
    assert.equal(h.toasts.at(-1), '2 jeux en ligne dans la page Jeux');
    assert.equal(await harness([]).ctrl.onlineGames({ id: 'inconnue' }), null);
  });

  it('« Tout télécharger » : confirmation, puis seulement les jeux absents de l’ordinateur', async () => {
    const h = harness(['downloadAll', 'yes']);
    assert.equal(await h.ctrl.onlineGames({ id: 'snes' }), 'downloadAll');
    assert.equal(h.forms[1].title, 'Télécharger 1 jeu dans le dossier de Super Nintendo ?');
    assert.deepEqual(h.calls, [
      ['romListSource', 'snes', undefined],
      ['romDownload', 'snes', 'https://a.test/snes/Jeu%20Deux.sfc?x=1'],
    ]);
    assert.equal(h.toasts.at(-1), '1 téléchargement ajouté. Suivez-le dans le Centre.');
    const none = harness(['downloadAll'], { romListSource: async () => ({ ok: true, roms: listing.roms.slice(0, 2) }) });
    await none.ctrl.onlineGames({ id: 'snes' });
    assert.equal(none.toasts.at(-1), 'Tous les jeux en ligne de cette console sont déjà sur l’ordinateur.');
  });

  it('télécharge un jeu en ligne désigné par sa clé ; la boîte du jeu le propose', async () => {
    const h = harness(['download']);
    assert.equal(await h.ctrl.gameOptions({ key: remote.key }), 'download');
    assert.ok(h.forms[0].actions?.some((a) => a.id === 'download' && a.label === 'Télécharger sur cet ordinateur'));
    assert.deepEqual(h.calls, [['romDownload', 'snes', 'https://a.test/snes/Jeu%20Un.sfc']]);
    assert.match(h.toasts.at(-1)!, /Téléchargement ajouté/);
    assert.equal(await h.ctrl.downloadGame({ key: 'rom:snes|/jeux/snes/a.sfc' }), false);
  });

  it('nettoie la base de jeux, en ligne si on le demande, et résume ce qui a changé', async () => {
    const h = harness(['online']);
    assert.equal(await h.ctrl.cleanup(), true);
    assert.deepEqual(h.calls, [['gamesCleanup', true], ['afterConsolesChange']]);
    assert.equal(h.toasts.at(-1), 'Nettoyage terminé : 2 jeux PC retirés (fichier absent), 1 source en ligne injoignable.');
    const cancel = harness([]);
    assert.equal(await cancel.ctrl.cleanup(), false);
    assert.deepEqual(cancel.calls, []);
    const en = harness(['check'], { gamesCleanup: async () => ({ ok: true, removedManual: 0, missingRemote: [] }) });
    await en.ctrl.cleanup();
    assert.equal(en.toasts.at(-1), 'Nettoyage terminé : tous les jeux sont disponibles.');
  });

  it('touche Suppr sur une carte de jeu : la suppression de la boîte du jeu, par sa clé', async () => {
    const called: unknown[] = [];
    class FakeGames {
      async deleteGame(args: unknown) {
        called.push(args);
      }
    }
    registerController('mire-games', new FakeGames());
    const page = new PageController({
      ui: { selectedKey: () => remote.key, selectedRef: () => null, deletableGame: () => false },
    } as unknown as ControllerContext);
    assert.equal(page.deleteSelection(), true);
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(called, [{ key: remote.key }]);
    const other = new PageController({
      ui: { selectedKey: () => 'local:/films/a.mkv', selectedRef: () => null, deletableGame: () => false },
    } as unknown as ControllerContext);
    assert.equal(other.deleteSelection(), false);
  });

  it('« Tout lire » lit à la suite les fichiers affichés, dans l’ordre de la page', async () => {
    const track = (n: number) => ({ key: `local:/m/${n}.mp3`, name: `Piste ${n}`, open: { kind: 'file', path: `/m/${n}.mp3` }, tags: ['audio'] });
    const queued: unknown[][] = [];
    const page = new PageController({
      S: { videos: [], tracks: [], images: [] },
      api: {
        catalogElement: async (k: string) => (k.startsWith('local:') ? track(Number(k.slice(9, -4))) : null),
        fromPaths: async (paths: string[]) => paths.filter((p) => p === '/m/1.mp3').map((p) => ({ path: p, name: 'Un', kind: 'audio', native: true })),
      },
      ui: { playQueue: (list: unknown[], i: number) => queued.push([list, i]) },
    } as unknown as ControllerContext);
    assert.equal(await page.playAll({ keys: ['local:/m/2.mp3', 'site:x', 'local:/m/1.mp3'] }), 2);
    assert.deepEqual(queued, [
      [
        [
          { path: '/m/2.mp3', name: 'Piste 2', kind: 'audio' },
          { path: '/m/1.mp3', name: 'Un', kind: 'audio', native: true },
        ],
        0,
      ],
    ]);
  });
});
