// Centre, plugins et dépôts (P4-19) : permissions, niveaux, états, cartes et fiches des plugins, cartes des dépôts,
// contrôle de la saisie d'un dépôt et texte de l'accord, rédigés par les catalogues (français et anglais).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CATALOGS, createI18n } from '@mire/shared/i18n';
import type { AvailablePlugin, PluginSummary, RepositoryInfo } from '@mire/shared/ipc';
import { groupFingerprint, offerKey } from '@mire/ui/utils';
import {
  consentHelp,
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
