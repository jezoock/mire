// Centre, plugins et dépôts (P4-19) : permissions, niveaux, états, cartes et fiches des plugins, cartes des dépôts,
// contrôle de la saisie d'un dépôt et texte de l'accord, rédigés par les catalogues (français et anglais).
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CATALOGS, createI18n } from '@mire/shared/i18n';
import type { AvailablePlugin, PluginSummary, RepositoryInfo } from '@mire/shared/ipc';
import { groupFingerprint, offerKey } from '@mire/ui/utils';
import {
  consentHelp,
  continuityLines,
  contributesLines,
  levelText,
  permissionLines,
  pluginProgress,
  pluginSheet,
  pluginState,
  pluginsView,
  repoDate,
  repoInputError,
  reposView,
} from '../../src/renderer/centre/plugins.ts';
import type { PluginsState } from '../../src/renderer/centre/plugins.ts';
import type { Writer } from '../../src/renderer/centre/model.ts';
import { CentreController } from '../../src/renderer/controllers/centre.ts';
import type { ControllerContext } from '../../src/renderer/controllers/types.ts';
import { PAGE, S } from '../../src/renderer/state/index.ts';

const writer = (lang: 'fr' | 'en'): Writer => {
  const i18n = createI18n({ locale: lang, catalogs: BUILTIN_CATALOGS });
  return { t: (key, vars) => i18n.t(key, vars), lang };
};
const fr = writer('fr');
const en = writer('en');
const FP = '8aaa3d58'.repeat(8);

const summary = (over: Partial<PluginSummary> = {}): PluginSummary => ({
  id: 'mire.exemple.inclus',
  version: '1.0.0',
  origin: 'bundled',
  repository: null,
  trust: 'bundled',
  level: 'data',
  permissions: {},
  dependencies: {},
  name: 'Exemple inclus',
  enabled: true,
  status: 'active',
  message: null,
  contributions: [{ kind: 'packs', id: 'vide' }],
  restartRequired: false,
  ...over,
});

const offer = (over: Partial<AvailablePlugin> = {}): AvailablePlugin => ({
  id: 'org.tiers.outil',
  repository: 'repo-0123456789abcdef',
  official: false,
  name: 'Outil tiers',
  description: '<b>Pas du HTML</b>',
  version: '1.2.0',
  latest: '1.2.0',
  level: 'privileged',
  permissions: { launch: true, hosts: ['api.exemple.org'] },
  dependencies: { 'mire.exemple.inclus': '^1.0.0' },
  contributes: ['downloaders'],
  categories: [],
  size: 2048,
  installed: null,
  update: null,
  trust: 'third-party',
  sensitive: true,
  consented: false,
  conflict: false,
  ...over,
});

const repo = (over: Partial<RepositoryInfo> = {}): RepositoryInfo => ({
  id: 'official',
  official: true,
  trust: 'official',
  index: 'https://github.com/jezoock/mire-addons/releases/download/index/index.json',
  fingerprint: FP,
  name: 'Mire',
  generated: '2026-11-19T12:00:00.000Z',
  checkedAt: null,
  error: null,
  message: null,
  ...over,
});

const state = (over: Partial<PluginsState> = {}): PluginsState => ({
  installed: [summary()],
  available: [offer()],
  repos: [repo(), repo({ id: 'repo-0123456789abcdef', official: false, trust: 'third-party', name: 'Dépôt de test' })],
  progress: {},
  sheet: null,
  ...over,
});

describe('Centre (P4-19) : permissions et niveaux', () => {
  it('une ligne par permission, les accès étendus marqués sensibles', () => {
    assert.deepEqual(permissionLines({ hosts: ['a.org', 'b.org'], folders: true, launch: true, deleteFiles: false, webViews: true }, fr.t), [
      { text: 'Se connecter à : a.org, b.org', sensitive: false },
      { text: 'Vous demander l’accès à des dossiers de votre choix', sensitive: false },
      { text: 'Lancer des programmes de votre ordinateur', sensitive: true },
      { text: 'Ouvrir des sites web dans Mire', sensitive: true },
    ]);
    assert.deepEqual(permissionLines({ localNetwork: true }, en.t), [{ text: 'Reach the devices on your local network', sensitive: true }]);
  });

  it('rien à montrer : permissions vides, absentes, liste d’hôtes vide ou invalide', () => {
    assert.deepEqual(permissionLines({}, fr.t), []);
    assert.deepEqual(permissionLines(null, fr.t), []);
    assert.deepEqual(permissionLines({ hosts: [], folders: false }, fr.t), []);
    assert.deepEqual(permissionLines({ hosts: 'a.org' }, fr.t), []);
  });

  it('une permission inconnue est montrée par son nom, comme sensible ; une longue liste d’hôtes est abrégée', () => {
    assert.deepEqual(permissionLines({ camera: true }, fr.t), [{ text: 'Autre accès : camera', sensitive: true }]);
    const hosts = Array.from({ length: 22 }, (_, i) => `h${i}.org`);
    const [line] = permissionLines({ hosts }, fr.t);
    assert.match(line!.text, /h19\.org et 2 autres$/);
    assert.doesNotMatch(line!.text, /h20\.org/);
  });

  it('niveaux et apports en mots simples ; nature inconnue gardée telle quelle', () => {
    assert.equal(levelText('data', fr.t), 'Données seulement, sans code');
    assert.equal(levelText('privileged', en.t), 'Extended access to the computer');
    assert.equal(levelText(null, fr.t), 'Inconnu');
    assert.deepEqual(contributesLines(['palettes', 'palettes', 'bizarre'], fr.t), ['Des palettes de couleurs', 'bizarre']);
  });
});

describe('Centre (P4-19) : états et avancement', () => {
  it('état d’un plugin présent et son genre', () => {
    assert.deepEqual(pluginState(summary(), fr.t), { status: 'Actif', tone: 'ok' });
    assert.deepEqual(pluginState(summary({ status: 'disabled', enabled: false }), en.t), { status: 'Off', tone: 'off' });
    assert.deepEqual(pluginState(summary({ status: 'fault' }), fr.t), { status: 'Arrêté après une erreur', tone: 'error' });
    assert.deepEqual(pluginState(summary({ status: 'refused' }), fr.t).tone, 'error');
    assert.equal(pluginState(summary({ restartRequired: true }), fr.t).status, 'Actif (au prochain démarrage de Mire)');
  });

  it('avancement : étapes, quantité et barre pendant le téléchargement ; rien une fois terminé', () => {
    const names = (id: string) => (id === 'dep' ? 'Dépendance' : id);
    assert.deepEqual(pluginProgress({ id: 'x', phase: 'resolve' }, names, fr), { text: 'Préparation de x…', percent: null });
    assert.deepEqual(pluginProgress({ id: 'x', phase: 'download', plugin: 'dep', received: 512, total: 2048 }, names, fr), {
      text: 'Téléchargement de Dépendance · 512 o sur 2 Ko',
      percent: 25,
    });
    assert.equal(pluginProgress({ id: 'x', phase: 'verify', plugin: 'dep' }, names, en)?.text, 'Checking Dépendance');
    assert.equal(pluginProgress({ id: 'x', phase: 'done' }, names, fr), null);
    assert.equal(pluginProgress({ id: 'x', phase: 'error', message: 'non' }, names, fr), null);
    assert.equal(pluginProgress(undefined, names, fr), null);
  });
});

describe('Centre (P4-19) : listes des plugins', () => {
  it('sans listes lues : rien', () => {
    assert.equal(pluginsView(null, fr), null);
  });

  it('installés, disponibles (non installés seulement), mises à jour (de leur dépôt)', () => {
    const local = summary({ id: 'org.local', name: 'Local', origin: 'installed', trust: 'local', level: 'code' });
    const official = summary({ id: 'mire.films', name: 'Films', origin: 'installed', trust: 'official', repository: 'official', version: '1.0.0' });
    const v = pluginsView(
      state({
        installed: [summary(), local, official],
        available: [
          offer(),
          offer({ id: 'mire.films', repository: 'official', name: 'Films', installed: '1.0.0', update: '1.1.0', trust: 'official', sensitive: false }),
          offer({ id: 'mire.films', repository: 'repo-0123456789abcdef', installed: '1.0.0', update: null, conflict: true }),
        ],
      }),
      fr,
    )!;
    assert.deepEqual(
      v.installed.map((c) => c.key),
      ['mire.exemple.inclus', 'mire.films', 'org.local'],
    );
    assert.deepEqual(
      v.available.map((c) => c.key),
      [offerKey('repo-0123456789abcdef', 'org.tiers.outil')],
    );
    assert.deepEqual(
      v.updates.map((c) => c.key),
      ['mire.films'],
    );
    const films = v.installed.find((c) => c.key === 'mire.films')!;
    assert.equal(films.status, 'Mise à jour disponible : 1.1.0');
    assert.equal(films.meta, 'Version 1.0.0 · Dépôt officiel · Données seulement, sans code');
    assert.deepEqual(
      v.updates[0]!.buttons.map((b) => [b.action, b.args]),
      [
        ['openPlugin', '[{"key":"mire.films"}]'],
        ['updatePlugin', '[{"id":"mire.films"}]'],
      ],
    );
    const tiers = v.available[0]!;
    assert.deepEqual(tiers.badges, ['Tiers', 'Accès étendu']);
    assert.equal(tiers.meta, 'Version 1.2.0 · Dépôt « Dépôt de test » · Accès étendu à l’ordinateur');
    // Le texte d'un index reste un texte : il est rendu tel quel par la vue, jamais interprété.
    assert.equal(tiers.desc, '<b>Pas du HTML</b>');
    assert.match(v.checked, /n’ont pas encore été lues/);
  });

  it('bouton activer ou désactiver selon l’état voulu ; aucun pour un plugin refusé', () => {
    const on = pluginsView(state(), fr)!.installed[0]!;
    assert.deepEqual(
      on.buttons.map((b) => b.action),
      ['openPlugin', 'disablePlugin'],
    );
    const off = pluginsView(state({ installed: [summary({ enabled: false, status: 'disabled' })] }), fr)!.installed[0]!;
    assert.deepEqual(
      off.buttons.map((b) => b.action),
      ['openPlugin', 'enablePlugin'],
    );
    const refused = pluginsView(state({ installed: [summary({ status: 'refused', message: 'Refusé : version' })] }), fr)!.installed[0]!;
    assert.deepEqual(
      refused.buttons.map((b) => b.action),
      ['openPlugin'],
    );
  });
});

describe('Centre (P4-19) : fiche d’un plugin', () => {
  it('plugin proposé : permissions, apports, dépendances et avertissement, avant l’installation', () => {
    const s = pluginSheet(offerKey('repo-0123456789abcdef', 'org.tiers.outil'), state(), fr)!;
    assert.deepEqual(
      s.permissions.map((p) => [p.text, p.sensitive]),
      [
        ['Lancer des programmes de votre ordinateur', true],
        ['Se connecter à : api.exemple.org', false],
      ],
    );
    assert.deepEqual(s.contributes, ['Une façon de télécharger']);
    assert.deepEqual(s.dependencies, ['Exemple inclus (^1.0.0), déjà là']);
    assert.match(s.warning, /dépôt tiers/);
    assert.deepEqual(
      s.facts.map((f) => f.value),
      ['1.2.0', 'Dépôt « Dépôt de test »', 'Accès étendu à l’ordinateur', '2 Ko'],
    );
    assert.deepEqual(
      s.buttons.map((b) => [b.action, b.args, b.disabled]),
      [['installPlugin', '[{"id":"org.tiers.outil","repository":"repo-0123456789abcdef"}]', false]],
    );
  });

  it('installation impossible : aucune version compatible, déjà installé d’ailleurs, installation en cours', () => {
    const key = offerKey('repo-0123456789abcdef', 'org.tiers.outil');
    const none = pluginSheet(key, state({ available: [offer({ version: null, latest: '2.0.0' })] }), fr)!;
    assert.equal(none.buttons[0]!.disabled, true);
    assert.equal(none.facts[0]!.value, 'Aucune pour cette version de Mire (dernière : 2.0.0)');
    const conflict = pluginSheet(key, state({ available: [offer({ conflict: true })] }), fr)!;
    assert.equal(conflict.buttons[0]!.disabled, true);
    assert.match(conflict.message, /déjà installé depuis un autre dépôt/);
    const busy = pluginSheet(key, state({ progress: { 'org.tiers.outil': { id: 'org.tiers.outil', phase: 'verify' } } }), fr)!;
    assert.equal(busy.buttons[0]!.disabled, true);
    assert.equal(busy.progress?.text, 'Vérification de Outil tiers');
  });

  it('plugin présent : état, désinstaller (pas pour un plugin livré avec Mire), mise à jour proposée', () => {
    const bundled = pluginSheet('mire.exemple.inclus', state(), en)!;
    assert.deepEqual(
      bundled.buttons.map((b) => b.action),
      ['disablePlugin'],
    );
    assert.deepEqual(bundled.permissions, []);
    assert.deepEqual(bundled.contributes, ['Ready-made lists']);
    assert.equal(bundled.warning, '');
    const installed = summary({
      id: 'org.tiers.outil',
      name: 'Outil tiers',
      origin: 'installed',
      trust: 'third-party',
      repository: 'repo-0123456789abcdef',
      level: 'privileged',
      permissions: { launch: true },
      version: '1.0.0',
    });
    const s = pluginSheet('org.tiers.outil', state({ installed: [summary(), installed], available: [offer({ installed: '1.0.0', update: '1.2.0' })] }), fr)!;
    assert.deepEqual(
      s.buttons.map((b) => b.action),
      ['updatePlugin', 'disablePlugin', 'uninstallPlugin'],
    );
    assert.equal(s.buttons[0]!.label, 'Mettre à jour vers la 1.2.0');
    assert.match(s.warning, /avec votre accord/);
    assert.equal(s.desc, '<b>Pas du HTML</b>');
    assert.equal(pluginSheet('inconnu', state(), fr), null);
    assert.equal(pluginSheet(null, state(), fr), null);
  });

  it('programmes (lecteurs, émulateurs) d’un plugin ni livré avec Mire ni officiel : la fiche dit qu’ils ne servent pas (P5-19)', () => {
    const apps = [{ kind: 'apps', id: 'alpha' }];
    const sheet = (over: Partial<PluginSummary>) =>
      pluginSheet('org.essai.emu', state({ installed: [summary({ id: 'org.essai.emu', origin: 'installed', contributions: apps, ...over })] }), fr)!.message;
    for (const trust of ['third-party', 'local'] as const) assert.match(sheet({ trust }), /ne sont pas utilisés/, trust);
    for (const trust of ['bundled', 'official'] as const) assert.equal(sheet({ trust }), '', trust);
    assert.equal(sheet({ trust: 'local', contributions: [{ kind: 'packs', id: 'x' }] }), '');
    assert.match(sheet({ trust: 'local', message: 'Désactivé.' }), /^Désactivé\. Ses programmes/);
  });
});

describe('Centre (P4-19) : récapitulatif de la continuité (P5-01)', () => {
  it('une ligne par fonction reprise ; la raison d’une reprise impossible ; rien sans récapitulatif', () => {
    const lines = continuityLines(
      [
        { plugin: 'mire.a', name: 'A', bundled: true, status: 'installed', reason: null },
        { plugin: 'mire.b', name: 'B', bundled: false, status: 'installed', reason: null },
        { plugin: 'mire.c', name: 'C', bundled: false, status: 'pending', reason: null },
        { plugin: 'mire.d', name: 'D', bundled: true, status: 'failed', reason: 'Absent.' },
      ],
      fr.t,
    );
    assert.deepEqual(lines, [
      { text: '« A » : activé (livré avec Mire).', sensitive: false },
      { text: '« B » : installé.', sensitive: false },
      { text: '« C » : sera installé dès que la connexion le permettra.', sensitive: false },
      { text: '« D » : impossible. Absent.', sensitive: true },
    ]);
    assert.deepEqual(pluginsView(state(), fr)!.continuity, []);
  });
});

describe('Centre (P4-19) : dépôts', () => {
  it('cartes : l’officiel d’abord, empreinte groupée, date, erreur, retrait des seuls dépôts tiers', () => {
    const v = reposView([repo({ id: 'repo-1', official: false, trust: 'third-party', name: 'Tiers', generated: null, message: 'Injoignable.' }), repo()], fr)!;
    assert.deepEqual(
      v.repos.map((r) => [r.id, r.badge, r.removable]),
      [
        ['official', 'Officiel', false],
        ['repo-1', 'Tiers', true],
      ],
    );
    assert.equal(v.repos[0]!.fingerprint, '8aaa 3d58 8aaa 3d58 8aaa 3d58 8aaa 3d58 8aaa 3d58 8aaa 3d58 8aaa 3d58 8aaa 3d58');
    assert.equal(v.repos[0]!.date, 'Liste publiée le 19 novembre 2026');
    assert.equal(v.repos[1]!.date, 'Liste pas encore lue');
    assert.equal(v.repos[1]!.error, 'Injoignable.');
    assert.equal(reposView(null, fr), null);
    assert.equal(repoDate('pas une date', en), 'List not read yet');
    assert.equal(groupFingerprint('abcdef'), 'abcd ef');
  });

  it('saisie d’un dépôt : https seulement, sans identifiants, avec une clé publique PEM', () => {
    const key = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----';
    assert.equal(repoInputError('https://exemple.org/index.json', key), null);
    assert.equal(repoInputError('  https://exemple.org/index.json ', key), null);
    assert.equal(repoInputError('http://exemple.org/index.json', key), 'https');
    assert.equal(repoInputError('file:///etc/passwd', key), 'https');
    assert.equal(repoInputError('javascript:alert(1)', key), 'https');
    assert.equal(repoInputError('https://moi:secret@exemple.org/index.json', key), 'address');
    assert.equal(repoInputError('pas une adresse', key), 'address');
    assert.equal(repoInputError('https://exemple.org/index.json', 'clé'), 'key');
  });

  it('texte de l’accord : l’avertissement, puis chaque version et ce qu’elle demande', () => {
    const text = consentHelp(
      [
        { plugin: 'org.tiers.outil', repository: 'repo-1', version: '1.2.0', level: 'privileged', permissions: { launch: true } },
        { plugin: 'org.tiers.dep', repository: 'repo-1', version: '1.0.0', level: 'privileged', permissions: {} },
      ],
      (id) => (id === 'org.tiers.outil' ? 'Outil tiers' : id),
      fr.t,
    );
    const lines = text.split('\n');
    assert.match(lines[0]!, /dépôt tiers.*accès étendu/);
    assert.equal(lines[2], '« Outil tiers », version 1.2.0 (Accès étendu à l’ordinateur) :');
    assert.equal(lines[3], '• Lancer des programmes de votre ordinateur');
    assert.equal(lines[6], '• Aucune permission particulière.');
  });
});

// ---------- Contrôleur mire-centre : plugins et dépôts ----------

type Call = [string, ...unknown[]];

/** Contexte de test : chaque appel au client API, à l'interface et aux boîtes est noté ; `answers` donne les réponses. */
function fakeCentre(answers: Record<string, (...args: any[]) => unknown> = {}) {
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
            return answers[`${prefix}${name}`]?.(...args);
          },
      },
    );
  const ctx = {
    S,
    api: record('api.'),
    ui: record('ui.'),
    toast: (message: string) => toasts.push(message),
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    page: PAGE,
    dialogs: record('dialogs.'),
  } as unknown as ControllerContext;
  return { calls, toasts, centre: new CentreController(ctx) };
}

const names = (calls: Call[]) => calls.map((c) => c[0]);
const KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----';
const consentRequest = { plugin: 'org.tiers.outil', repository: 'repo-1', version: '1.2.0', level: 'privileged' as const, permissions: { launch: true } };

describe('Centre (P4-19) : contrôleur, plugins', () => {
  beforeEach(() => {
    S.plugins = { installed: [summary()], available: [offer({ repository: 'repo-1' })], repos: state().repos.slice() };
    S.pluginProgress = {};
    S.pluginSheet = null;
  });

  it('ouvre et referme une fiche par sa clé, le focus sur le retour puis sur la carte', () => {
    const { calls, centre } = fakeCentre();
    centre.openPlugin({ key: 'repo-1/org.tiers.outil' });
    assert.equal(S.pluginSheet, 'repo-1/org.tiers.outil');
    centre.closePlugin();
    assert.equal(S.pluginSheet, null);
    assert.deepEqual(calls, [
      ['ui.refreshCentre', 'ds-trigger.mire-centre-view__sheet-back'],
      ['ui.refreshCentre', '.mire-centre-view__plugin[data-key="repo-1/org.tiers.outil"] ds-trigger.--openPlugin'],
    ]);
  });

  it('accord : l’avertissement d’abord, l’accord seulement après confirmation, puis l’installation relancée', async () => {
    let installs = 0;
    const { calls, toasts, centre } = fakeCentre({
      'api.pluginsInstall': () => (++installs === 1 ? { ok: false, code: 'consent', error: 'accord', consent: [consentRequest] } : { ok: true, plugins: [] }),
      'dialogs.form': () => ({ action: 'accept', values: {} }),
      'api.pluginsConsent': () => consentRequest,
    });
    S.pluginSheet = 'repo-1/org.tiers.outil';
    await centre.installPlugin({ id: 'org.tiers.outil', repository: 'repo-1' });
    assert.deepEqual(names(calls), ['api.pluginsInstall', 'dialogs.form', 'api.pluginsConsent', 'api.pluginsInstall', 'ui.loadPlugins']);
    const form = calls[1]![1] as { help: string; actions: { id: string; kind: string }[] };
    assert.match(form.help, /centre\.plugins\.consent\.warning/);
    assert.match(form.help, /centre\.plugins\.permissions\.launch/);
    // Le bouton mis en avant (Entrée, A) est celui qui annule.
    assert.equal(form.actions.find((a) => a.kind === 'primary')?.id, 'cancel');
    assert.deepEqual(calls[2], ['api.pluginsConsent', 'org.tiers.outil', 'repo-1', '1.2.0']);
    assert.deepEqual(calls[3], ['api.pluginsInstall', 'org.tiers.outil', undefined, 'repo-1']);
    assert.equal(S.pluginSheet, 'org.tiers.outil');
    assert.match(toasts[0]!, /centre\.plugins\.messages\.installed/);
  });

  it('accord refusé ou boîte fermée : aucun accord donné, rien d’installé', async () => {
    for (const action of ['cancel', 'cancel-escape']) {
      const { calls, toasts, centre } = fakeCentre({
        'api.pluginsInstall': () => ({ ok: false, code: 'consent', error: 'accord', consent: [consentRequest] }),
        'dialogs.form': () => ({ action, values: {} }),
      });
      await centre.installPlugin({ id: 'org.tiers.outil', repository: 'repo-1' });
      assert.deepEqual(names(calls), ['api.pluginsInstall', 'dialogs.form']);
      assert.deepEqual(toasts, ['centre.plugins.messages.notConsented']);
    }
  });

  it('erreur d’installation : le message rédigé par le processus principal ; arguments refusés', async () => {
    const failed = fakeCentre({ 'api.pluginsInstall': () => ({ ok: false, code: 'network', error: 'Le dépôt n’a pas pu être joint.' }) });
    await failed.centre.installPlugin({ id: 'org.tiers.outil', repository: 'repo-1' });
    assert.deepEqual(failed.toasts, ['Le dépôt n’a pas pu être joint.']);
    const refused = fakeCentre({ 'api.pluginsUpdate': () => null });
    await refused.centre.updatePlugin({ id: 'org.tiers.outil' });
    assert.deepEqual(refused.toasts, ['centre.plugins.messages.refused']);
  });

  it('désinstaller en gardant ou non ses données ; un plugin dont un autre a besoin est gardé', async () => {
    for (const [action, keep] of [
      ['keep', true],
      ['erase', false],
    ] as const) {
      const { calls, centre } = fakeCentre({
        'dialogs.form': () => ({ action, values: {} }),
        'api.pluginsUninstall': () => ({ ok: true, keptData: keep, restored: null }),
      });
      S.pluginSheet = 'org.tiers.outil';
      await centre.uninstallPlugin({ id: 'org.tiers.outil' });
      assert.deepEqual(calls[1], ['api.pluginsUninstall', 'org.tiers.outil', keep]);
      assert.equal(S.pluginSheet, null);
    }
    const needed = fakeCentre({
      'dialogs.form': () => ({ action: 'keep', values: {} }),
      'api.pluginsUninstall': () => ({ ok: false, code: 'needed', by: ['x'], message: '« Outil » ne peut pas être désinstallé.' }),
    });
    await needed.centre.uninstallPlugin({ id: 'org.tiers.outil' });
    assert.deepEqual(needed.toasts, ['« Outil » ne peut pas être désinstallé.']);
    const cancel = fakeCentre({ 'dialogs.form': () => ({ action: 'cancel', values: {} }) });
    await cancel.centre.uninstallPlugin({ id: 'org.tiers.outil' });
    assert.deepEqual(names(cancel.calls), ['dialogs.form']);
  });

  it('activer, désactiver : un plugin qui ne démarre pas donne sa raison', async () => {
    const { calls, toasts, centre } = fakeCentre({
      'api.pluginsSetEnabled': (_id: string, on: boolean) => summary({ enabled: on, status: on ? 'fault' : 'disabled', message: on ? 'En panne.' : null }),
    });
    await centre.disablePlugin({ id: 'mire.exemple.inclus' });
    await centre.enablePlugin({ id: 'mire.exemple.inclus' });
    assert.deepEqual(
      calls.filter((c) => c[0] === 'api.pluginsSetEnabled'),
      [
        ['api.pluginsSetEnabled', 'mire.exemple.inclus', false],
        ['api.pluginsSetEnabled', 'mire.exemple.inclus', true],
      ],
    );
    assert.match(toasts[0]!, /messages\.disabled/);
    assert.equal(toasts[1], 'En panne.');
  });
});

describe('Centre (P4-19) : contrôleur, dépôts', () => {
  const preview = { id: 'repo-1', index: 'https://depot.exemple/index.json', fingerprint: FP, name: 'Dépôt de test', plugins: 3, sensitive: 1 };

  it('ajout en deux temps : adresse non https refusée sans appel, puis vérification, empreinte montrée, ajout avec elle', async () => {
    const helps: string[] = [];
    let step = 0;
    const { calls, toasts, centre } = fakeCentre({
      'dialogs.form': async (opts: { onAction?: (a: string, f: unknown) => Promise<boolean>; help: string }) => {
        if (++step === 2) return { action: 'add', values: {} };
        const form = (index: string, key: string) => ({ values: () => ({ index, key }), help: (text: string) => helps.push(text) });
        assert.equal(await opts.onAction!('check', form('http://depot.exemple/index.json', KEY)), true);
        assert.equal(await opts.onAction!('check', form('https://depot.exemple/index.json', 'pas une clé')), true);
        assert.equal(await opts.onAction!('check', form(' https://depot.exemple/index.json ', KEY)), false);
        return { action: 'check', values: {} };
      },
      'api.reposInspect': () => ({ ok: true, repository: preview, repositories: [] }),
      'api.reposAdd': () => ({ ok: true, repository: preview, repositories: [] }),
    });
    await centre.addRepository();
    assert.deepEqual(helps, ['centre.repos.form.errors.https', 'centre.repos.form.errors.key']);
    assert.deepEqual(
      calls.filter((c) => c[0].startsWith('api.')),
      [
        ['api.reposInspect', 'https://depot.exemple/index.json', KEY],
        ['api.reposAdd', 'https://depot.exemple/index.json', KEY, FP],
      ],
    );
    const confirm = calls.filter((c) => c[0] === 'dialogs.form')[1]![1] as { help: string };
    assert.match(confirm.help, /8aaa 3d58 8aaa/);
    assert.match(confirm.help, /centre\.repos\.confirm\.sensitive/);
    assert.match(toasts[0]!, /centre\.repos\.messages\.added/);
  });

  it('vérification refusée par le processus principal : son message, la boîte reste ouverte ; empreinte non confirmée : rien n’est ajouté', async () => {
    const helps: string[] = [];
    let step = 0;
    const { calls, centre } = fakeCentre({
      'dialogs.form': async (opts: { onAction?: (a: string, f: unknown) => Promise<boolean> }) => {
        if (++step === 2) return { action: 'cancel', values: {} };
        const form = { values: () => ({ index: 'https://depot.exemple/index.json', key: KEY }), help: (text: string) => helps.push(text) };
        assert.equal(await opts.onAction!('check', form), true);
        assert.equal(await opts.onAction!('check', form), false);
        return { action: 'check', values: {} };
      },
      'api.reposInspect': (() => {
        let n = 0;
        return () => (++n === 1 ? { ok: false, code: 'signature', error: 'Mauvaise signature.' } : { ok: true, repository: preview, repositories: [] });
      })(),
    });
    await centre.addRepository();
    assert.deepEqual(helps, ['Mauvaise signature.']);
    assert.ok(!names(calls).includes('api.reposAdd'));
  });

  it('retrait : garder les plugins, ou les désinstaller avec ou sans leurs données ; plugins gardés listés', async () => {
    for (const [action, uninstall, keepData] of [
      ['keep', false, true],
      ['uninstall', true, true],
      ['erase', true, false],
    ] as const) {
      const { calls, toasts, centre } = fakeCentre({
        'dialogs.form': () => ({ action, values: {} }),
        'api.reposRemove': () => ({ ok: true, uninstalled: ['org.tiers.outil'], kept: [{ id: 'mire.exemple.inclus', by: ['x'] }], repositories: [] }),
      });
      await centre.removeRepository({ id: 'repo-0123456789abcdef' });
      assert.deepEqual(calls[1], ['api.reposRemove', 'repo-0123456789abcdef', uninstall, keepData]);
      assert.match(toasts[0]!, /Exemple inclus/);
    }
  });

  it('mise à jour des listes : lecture en ligne, puis les plugins relus', async () => {
    const { calls, toasts, centre } = fakeCentre({ 'api.reposRefresh': () => [repo({ error: 'network', message: 'Injoignable.' })] });
    await centre.refreshRepos();
    assert.deepEqual(names(calls), ['api.reposRefresh', 'ui.loadPlugins']);
    assert.deepEqual(toasts, ['centre.repos.messages.refreshErrors']);
  });
});
