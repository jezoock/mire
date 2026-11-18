// Centre (P4-18) : lignes des téléchargements et mises à jour fines, apps et rappels de BIOS, avancement des
// installations et annonces, rédigés par les catalogues (français et anglais) à partir des données du processus principal.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CATALOGS, createI18n } from '@mire/shared/i18n';
import { centreTab, idArgs, installerArgs } from '@mire/ui/utils';
import {
  applyDownload,
  appsView,
  downloadAddedNotice,
  downloadGroups,
  downloadMeta,
  downloadRow,
  downloadsHint,
  formatBytes,
  formatEta,
  progressText,
  romAddedNotice,
  romProgressNotice,
} from '../../src/renderer/centre/model.ts';
import type { Writer } from '../../src/renderer/centre/model.ts';
import { CENTRE_TARGET, CENTRE_VIEW, LEGACY_VIEWS, SCREEN_VIEWS, targetOfLegacyView, viewOf } from '../../src/renderer/shell/router.ts';

const writer = (lang: 'fr' | 'en'): Writer => {
  const i18n = createI18n({ locale: lang, catalogs: BUILTIN_CATALOGS });
  return { t: (key, vars) => i18n.t(key, vars), lang };
};
const fr = writer('fr');
const en = writer('en');
const MB = 1024 * 1024;

describe('Centre : ligne d’infos d’un téléchargement (textes de la vue historique en français)', () => {
  const meta = (d: Record<string, unknown>) => downloadMeta(d, fr);

  it('en cours : progression, débit, temps restant, destination', () => {
    assert.equal(
      meta({ state: 'downloading', total: 3 * MB, received: 1.5 * MB, speed: 200 * 1024, eta: 120000, dir: '/dl' }),
      'En cours · 1,5 Mo sur 3 Mo · 200 Ko/s · reste 2 min · vers Téléchargements',
    );
  });

  it('terminé : taille totale seule, vers une console, extras', () => {
    assert.equal(
      meta({ state: 'done', total: 2 * MB, received: 2 * MB, speed: 5, eta: 5, consoleName: 'Game Boy', group: 'Pack', companions: 2, extracted: true }),
      'Terminé · 2 Mo · vers Game Boy · fait partie de « Pack » · 2 fichiers du jeu ajoutés · archive décompressée',
    );
    assert.equal(meta({ state: 'done', companions: 1 }), 'Terminé · 1 fichier du jeu ajouté');
  });

  it('taille inconnue, torrent, débit seulement pendant le téléchargement', () => {
    assert.equal(meta({ state: 'paused', received: 1024 }), 'En pause · 1 Ko');
    assert.equal(meta({ state: 'paused', total: MB }), 'En pause · 0 o sur 1 Mo');
    assert.equal(meta({ state: 'waiting', kind: 'torrent' }), 'En attente · 0 pair');
    assert.equal(meta({ state: 'extracting', kind: 'torrent', peers: 3 }), 'Décompression · 3 pairs');
    assert.equal(meta({ state: 'paused', kind: 'torrent', peers: 3, speed: 1024, eta: 60000 }), 'En pause');
    assert.equal(meta({ state: 'downloading', eta: 10000 }), 'En cours · reste moins d’une minute');
  });

  it('état inconnu affiché tel quel, état absent ignoré', () => {
    assert.equal(meta({ state: 'bizarre' }), 'bizarre');
    assert.equal(meta({}), '');
  });

  it('en anglais : unités et nombres de la langue', () => {
    assert.equal(
      downloadMeta({ state: 'downloading', kind: 'torrent', peers: 1, total: 3 * MB, received: 1.5 * MB, eta: 65 * 60000, consoleName: 'Game Boy' }, en),
      'Downloading · 1.5 MB of 3 MB · 1 peer · 1 h 05 left · to Game Boy',
    );
    assert.equal(formatBytes(1536 * MB, en), '1.5 GB');
    assert.equal(formatEta(0, en), '');
    assert.equal(formatEta(12 * 60000, fr), '12 min');
  });
});

describe('Centre : lignes et listes des téléchargements', () => {
  it('boutons selon l’état, comme la vue historique', () => {
    const actions = (state: string) =>
      Object.entries(downloadRow({ id: 'x', state }, fr).actions)
        .filter(([, on]) => on)
        .map(([k]) => k);
    assert.deepEqual(actions('downloading'), ['pause', 'cancel']);
    assert.deepEqual(actions('extracting'), []);
    assert.deepEqual(actions('paused'), ['resume', 'cancel']);
    assert.deepEqual(actions('error'), ['retry', 'remove']);
    assert.deepEqual(actions('done'), ['remove', 'reveal']);
    assert.deepEqual(actions('pending'), ['remove', 'start']);
    assert.deepEqual(actions('external'), ['remove']);
  });

  it('ligne : nature, nom par défaut, barre, programmes d’installation (deux au plus)', () => {
    const done = downloadRow({ id: 'a', kind: 'torrent', state: 'done', installers: ['C:\\x\\setup.exe', '/y/b.exe', '/z/c.exe'] }, fr);
    assert.equal(done.kind, 'Torrent');
    assert.equal(done.name, 'Téléchargement');
    assert.equal(done.percent, 100);
    assert.deepEqual(
      done.installers.map((i) => i.label),
      ['Lancer setup.exe', 'Lancer b.exe'],
    );
    assert.equal(downloadRow({ id: 'b', state: 'external' }, en).percent, null);
    assert.equal(downloadRow({ id: 'c', state: 'downloading', total: 400, received: 100 }, en).percent, 25);
    assert.equal(downloadRow({ id: 'd', state: 'downloading', installers: ['/a.exe'] }, en).installers.length, 0);
  });

  it('en cours (actifs, en pause, en attente) puis les autres', () => {
    const list = [
      { id: '1', state: 'done' },
      { id: '2', state: 'paused' },
      { id: '3', state: 'pending' },
      { id: '4', state: 'error' },
      { id: '5', state: 'downloading' },
    ];
    const g = downloadGroups(list, fr);
    assert.deepEqual(
      g.running.map((r) => r.id),
      ['2', '3', '5'],
    );
    assert.deepEqual(
      g.others.map((r) => r.id),
      ['1', '4'],
    );
  });

  it('mise à jour fine : même état, seule la ligne change ; sinon la liste se redessine', () => {
    const list = [
      { id: 'a', state: 'downloading', received: 1 },
      { id: 'b', state: 'done' },
    ];
    const more = applyDownload(list, { id: 'a', state: 'downloading', received: 2 });
    assert.equal(more.fine, true);
    assert.equal(more.list[0]!.received, 2);
    assert.equal(list[0]!.received, 1, 'la liste reçue n’est pas modifiée');
    assert.equal(applyDownload(list, { id: 'a', state: 'paused' }).fine, false);
    assert.equal(applyDownload(list, { id: 'a', state: 'downloading', error: 'Coupure' }).fine, false);
    const added = applyDownload(list, { id: 'c', state: 'waiting' });
    assert.deepEqual([added.fine, added.list.map((d) => d.id)], [false, ['c', 'a', 'b']]);
    const removed = applyDownload(list, { id: 'b', removed: true });
    assert.deepEqual([removed.fine, removed.list.map((d) => d.id)], [false, ['a']]);
  });

  it('aide selon le client torrent ; arguments des actions par identifiant', () => {
    assert.match(downloadsHint('system', fr.t), /confiés à votre logiciel de torrent/);
    assert.match(downloadsHint('mire', en.t), /built-in client/);
    assert.equal(idArgs('dl-1'), '[{"id":"dl-1"}]');
    assert.equal(installerArgs('dl-1', '/a/setup.exe'), '[{"id":"dl-1","file":"/a/setup.exe"}]');
    assert.equal(centreTab('apps'), 'apps');
    assert.equal(centreTab('boutique'), 'downloads');
  });
});

describe('Centre : apps', () => {
  const catalog = {
    platform: 'linux',
    romsRoot: '/jeux',
    emulators: [
      {
        id: 'retroarch',
        name: 'RetroArch',
        desc: 'Plusieurs consoles.',
        retroarch: true,
        available: true,
        installed: true,
        version: 'v1.19.1',
        bios: { dir: '/bios', hint: 'Mettez ici les BIOS.', files: ['scph1001.bin', 'gba_bios.bin'] },
        systems: [
          { id: 'snes', name: 'Super Nintendo', installed: true },
          { id: 'gba', name: 'Game Boy Advance', installed: false },
        ],
      },
      {
        id: 'duckstation',
        name: 'DuckStation',
        desc: 'PlayStation.',
        available: true,
        installed: false,
        version: '',
        bios: null,
        systems: [{ id: 'psx', name: 'PlayStation' }],
      },
      { id: 'dolphin', name: 'Dolphin', desc: 'GameCube.', available: false, installed: false, bios: null, systems: [] },
    ],
    games: [
      { id: 'a', name: 'Jeu A', system: 'snes', systemName: 'Super Nintendo', author: 'Ana', desc: 'Un jeu.', ready: true, installed: false },
      { id: 'b', name: 'Jeu B', system: 'gba', systemName: 'Game Boy Advance', author: 'Bob', desc: 'Un autre.', ready: false, installed: false },
      { id: 'c', name: 'Jeu C', system: 'snes', systemName: 'Super Nintendo', author: 'Cy', desc: '', ready: true, installed: true },
    ],
  };
  const state = { picks: new Set<string>(), progress: {}, consoles: [{ id: '1', romsDir: '/jeux/snes' }] };

  it('émulateurs : état, version, boutons ; RetroArch demande des consoles', () => {
    const v = appsView(catalog, state, fr)!;
    assert.equal(v.root, '/jeux');
    assert.equal(v.canImport, true);
    const [ra, duck, dolphin] = v.emulators;
    assert.equal(ra!.status, 'Installé, version 1.19.1');
    assert.deepEqual(ra!.install, { label: 'Choisissez des consoles', disabled: true, primary: true });
    assert.deepEqual(ra!.uninstall, { label: 'Désinstaller', disabled: false });
    assert.equal(ra!.systemsLabel, 'Consoles de RetroArch');
    assert.deepEqual(duck!.install, { label: 'Installer', disabled: false, primary: true });
    assert.equal(duck!.uninstall, null);
    assert.equal(dolphin!.status, 'Non disponible sur ce système');
    assert.equal(dolphin!.install.disabled, true);

    const picked = appsView(catalog, { ...state, picks: new Set(['gba']) }, en)!.emulators[0]!;
    assert.deepEqual(picked.install, { label: 'Add 1 console', disabled: false, primary: true });
    assert.deepEqual(
      picked.systems.map((s) => [s.id, s.picked, s.installed]),
      [
        ['snes', false, true],
        ['gba', true, false],
      ],
    );
  });

  it('rappel des BIOS : texte, fichiers présents, dossier', () => {
    assert.deepEqual(appsView(catalog, state, fr)!.emulators[0]!.bios, {
      hint: 'Mettez ici les BIOS.',
      files: 'Présents : scph1001.bin, gba_bios.bin',
      dir: 'Dossier : /bios',
    });
    const empty = { ...catalog, emulators: [{ ...catalog.emulators[0]!, bios: { dir: '/b', hint: '', files: [] } }] };
    assert.equal(appsView(empty, state, en)!.emulators[0]!.bios!.files, 'No files yet.');
  });

  it('jeux libres : prêt, console à ajouter, déjà dans la ludothèque', () => {
    const [a, b, c] = appsView(catalog, state, fr)!.games;
    assert.deepEqual([a!.status, a!.meta, a!.monogram], ['', 'Super Nintendo, par Ana', 'J']);
    assert.equal(b!.status, 'Ajoutez d’abord la console Game Boy Advance');
    assert.equal(c!.status, 'Dans votre ludothèque');
    assert.match(a!.color, /^var\(--bar-/);
  });

  it('pendant une installation : boutons désactivés, avancement rédigé', () => {
    const busy = {
      ...state,
      progress: {
        duckstation: {
          id: 'duckstation',
          phase: 'download' as const,
          step: 'program' as const,
          name: 'DuckStation',
          version: 'v0.1',
          received: MB,
          total: 4 * MB,
        },
      },
    };
    const duck = appsView(catalog, busy, fr)!.emulators[1]!;
    assert.equal(duck.install.disabled, true);
    assert.deepEqual(duck.progress, { text: 'DuckStation 0.1, 1 Mo sur 4 Mo', percent: 25 });
    const game = appsView(
      catalog,
      { ...state, progress: { 'game:a': { id: 'game:a', phase: 'download' as const, step: 'game' as const, name: 'Jeu A' } } },
      en,
    )!.games[0]!;
    assert.deepEqual([game.busy, game.progress], [true, { text: 'Jeu A', percent: null }]);
    assert.equal(appsView(null, state, fr), null);
    assert.equal(appsView({ ...catalog, platform: 'other' }, { ...state, consoles: [] }, fr)!.unavailable, true);
  });

  it('avancement : chaque étape, fin et erreur sans texte', () => {
    const p = (x: Record<string, unknown>, w = fr) => progressText({ id: 'e', phase: 'resolve', ...x } as never, w);
    assert.deepEqual(p({}), { text: 'Préparation…', percent: null });
    assert.deepEqual(p({ step: 'latestVersion' }, en), { text: 'Looking for the latest version', percent: null });
    assert.deepEqual(p({ phase: 'download', step: 'core', core: 'snes9x' }), { text: 'Module snes9x', percent: null });
    assert.deepEqual(p({ phase: 'extract', step: 'extracting', name: 'RetroArch' }, en), { text: 'Extracting RetroArch', percent: null });
    assert.equal(p({ phase: 'done' }), null);
    assert.equal(p({ phase: 'error', message: 'x' }), null);
    assert.equal(progressText(undefined, fr), null);
  });
});

describe('Centre : annonces', () => {
  it('jeu ajouté : console, fichiers d’un jeu sur disque, archive décompressée', () => {
    assert.equal(
      romAddedNotice({ name: 'Jeu', consoleName: 'Super Nintendo', extracted: false }, fr.t),
      'Jeu ajouté à Super Nintendo. Il apparaît dans la liste des jeux de la console.',
    );
    assert.equal(
      romAddedNotice({ name: 'Disque', consoleName: 'PlayStation', files: 3, extracted: true }, fr.t),
      'Disque ajouté à PlayStation (3 fichiers, archive décompressée). Il apparaît dans la liste des jeux de la console.',
    );
    assert.equal(
      romAddedNotice({ name: 'Disk', consoleName: 'PlayStation', files: 1, extracted: true }, en.t),
      'Disk added to PlayStation (archive extracted). It appears in the console’s game list.',
    );
  });

  it('jeu en ligne : avancement puis lancement', () => {
    assert.equal(romProgressNotice({ name: 'Jeu', received: 50, total: 200 }, fr.t), 'Téléchargement de Jeu : 25 %');
    assert.equal(romProgressNotice({ name: 'Game' }, en.t), 'Downloading Game…');
    assert.equal(romProgressNotice({ name: 'Jeu', phase: 'done' }, fr.t), 'Jeu est prêt, lancement…');
  });

  it('ajout d’un téléchargement : erreur du processus principal, logiciel de torrent, ajouté', () => {
    assert.equal(downloadAddedNotice({ ok: false, error: 'Adresse invalide.' }, fr.t), 'Adresse invalide.');
    assert.equal(downloadAddedNotice({ ok: false }, en.t), 'This download could not start.');
    assert.equal(downloadAddedNotice({ ok: true, external: true }, fr.t), 'Lien confié à votre logiciel de torrent.');
    assert.equal(downloadAddedNotice({ ok: true }, en.t), 'Download added: follow it in the Centre.');
  });
});

describe('Centre : coquille', () => {
  it('le Centre a sa vue, il n’est plus une vue historique', () => {
    assert.equal(CENTRE_TARGET, 'screen:center');
    assert.equal(viewOf('screen:center'), CENTRE_VIEW);
    assert.ok(SCREEN_VIEWS.some(([t]) => t === CENTRE_TARGET));
    assert.ok(!LEGACY_VIEWS.some(([t]) => t === CENTRE_TARGET));
    assert.equal(targetOfLegacyView(CENTRE_VIEW), CENTRE_TARGET);
  });
});
