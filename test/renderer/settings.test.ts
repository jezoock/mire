// Écran Réglages (P4-20) : panneaux générés depuis le schéma, réglages d'un plugin depuis son manifeste, textes d'état,
// contrôleur (enregistrement immédiat, listes, ordre, éditeur JSON) et place dans la coquille.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_CATALOGS, createI18n } from '@mire/shared/i18n';
import { SETTINGS_SCHEMA } from '@mire/shared/settings/schema';
import type { PluginSettingsInfo } from '@mire/shared/ipc';
import { parsePluginFieldKey, pluginFieldKey, settingsArgs, settingsDomId } from '@mire/ui/utils';
import type { SettingsFieldView } from '@mire/ui/utils';
import {
  adblockStatusText,
  advancedJson,
  drmStatusText,
  pluginPanels,
  providerOrder,
  schemaPanels,
  settingsLabels,
  settingsPanels,
} from '../../src/renderer/settings/index.ts';
import type { PanelSources } from '../../src/renderer/settings/index.ts';
import { SettingsController } from '../../src/renderer/controllers/settings.ts';
import { SearchController } from '../../src/renderer/controllers/search.ts';
import type { ControllerContext, Data } from '../../src/renderer/controllers/types.ts';
import { SCREEN_VIEWS, SETTINGS_TARGET, SETTINGS_VIEW, targetOfLegacyView, viewOf } from '../../src/renderer/shell/router.ts';
import { PAGE, S } from '../../src/renderer/state/index.ts';
import { DEFAULT_CONFIG } from '../../src/main/config/index.ts';

const i18n = (lang: 'fr' | 'en') => createI18n({ locale: lang, catalogs: BUILTIN_CATALOGS });
const fr = i18n('fr');
const en = i18n('en');

function sources(over: Partial<PanelSources> = {}): PanelSources {
  return {
    t: fr.t,
    config: structuredClone(DEFAULT_CONFIG),
    languages: [
      { code: 'en', name: 'English' },
      { code: 'fr', name: 'Français' },
    ],
    sites: [{ id: 'arte', name: 'Arte' }],
    pageThemes: [{ id: 'mire', name: 'Mire', description: '' }],
    currentPageTheme: 'mire',
    homeLists: [{ kind: 'rows', label: 'Rangées', items: [{ id: 'bars', label: 'Barres', color: '#fff', on: true }] }],
    plugins: [],
    ...over,
  };
}

const fieldOf = (panels: ReturnType<typeof schemaPanels>, key: string): SettingsFieldView => {
  const f = panels.flatMap((p) => p.fields).find((x) => x.key === key);
  assert.ok(f, key);
  return f;
};

describe('panneaux générés depuis le schéma', () => {
  it('un panneau par bloc, dans l’ordre du schéma, avec ses textes traduits', () => {
    const panels = schemaPanels(sources());
    assert.deepEqual(
      panels.map((p) => p.id),
      SETTINGS_SCHEMA.map((b) => b.id),
    );
    const home = panels.find((p) => p.id === 'home')!;
    assert.equal(home.title, 'Page d’accueil');
    assert.equal(schemaPanels(sources({ t: en.t })).find((p) => p.id === 'home')!.title, 'Home page');
    // Aucun texte ne reste une clé : tous sont dans les catalogues.
    for (const t of [fr.t, en.t]) {
      for (const p of schemaPanels(sources({ t }))) {
        assert.ok(!p.title.startsWith('settings.'), p.title);
        for (const f of p.fields) assert.ok(!f.label.startsWith('settings.') && !f.help?.startsWith('settings.'), f.key);
      }
    }
  });

  it('chaque champ simple a sa valeur dans la configuration, et le contrôle de son type', () => {
    const config = structuredClone(DEFAULT_CONFIG) as Data;
    config.ui.home.clock = false;
    config.adblock.allowlist = ['exemple.com'];
    config.externalPlayer.path = '/usr/bin/mpv';
    const panels = schemaPanels(sources({ config }));
    assert.deepEqual(fieldOf(panels, 'ui.home.clock'), { key: 'ui.home.clock', kind: 'toggle', label: 'Afficher l’heure et la date', value: false });
    assert.deepEqual(fieldOf(panels, 'adblock.allowlist').value, ['exemple.com']);
    const player = fieldOf(panels, 'externalPlayer.path');
    assert.equal(player.kind, 'path');
    assert.equal(player.pick, 'program');
    assert.equal(player.placeholder, 'Détection automatique');
    // Clé TMDB et pays de « Où regarder » : réglages du plugin mire.tmdb (P5-15), plus du cœur.
    assert.equal(
      panels.flatMap((p) => p.fields ?? []).some((f) => String(f.key).startsWith('search.') && f.key !== 'search.language'),
      false,
    );
  });

  it('choix tirés de l’état : langues sous leur propre nom, sites de streaming groupés', () => {
    const panels = schemaPanels(sources());
    assert.deepEqual(
      fieldOf(panels, 'ui.language').options?.map((o) => o.label),
      ['Automatique (langue du système)', 'English', 'Français'],
    );
    assert.deepEqual(fieldOf(panels, 'search.language').options?.[0], { value: '', label: 'Comme l’interface' });
    const start = fieldOf(panels, 'ui.start').options!;
    assert.deepEqual(start.at(-1), { value: 'web:arte', label: 'Arte', group: 'Directement sur un service' });
  });

  it('blocs personnalisés : palettes avec aperçu, thèmes, listes ordonnables, réglages des pages', () => {
    const config = structuredClone(DEFAULT_CONFIG) as Data;
    config.ui.theme = 'jour';
    // Palettes des plugins actifs (P5-02) : après celles du cœur, nommées par leur texte ; une palette du cœur ne
    // s'ajoute pas une deuxième fois.
    const pluginPalettes = [
      { id: 'jour', name: 'pluginTexts.mire_palette_jour.palettes.jour.name' },
      { id: 'velours', name: 'pluginTexts.mire_palette_velours.palettes.velours.name' },
      { id: 'ecran', name: 'pluginTexts.org_x.palettes.ecran.name' },
    ];
    const panels = schemaPanels(sources({ config, pluginPalettes }));
    const theme = fieldOf(panels, 'appearance.theme');
    assert.equal(theme.kind, 'themes');
    assert.deepEqual(
      theme.palettes?.map((p) => [p.id, p.current, p.preview.join('+'), p.name]),
      [
        ['auto', false, 'ecran+jour', 'Automatique'],
        ['ecran', false, 'ecran', 'Écran éteint'],
        ['contraste', false, 'contraste', 'Contraste élevé'],
        ['jour', true, 'jour', 'pluginTexts.mire_palette_jour.palettes.jour.name'],
        ['velours', false, 'velours', 'pluginTexts.mire_palette_velours.palettes.velours.name'],
      ],
    );
    // Sans plugin : les palettes du cœur ; l'aperçu d'« Automatique » garde la palette par défaut en clair, et une
    // palette choisie absente n'est pas cochée.
    const core = fieldOf(schemaPanels(sources({ config })), 'appearance.theme');
    assert.deepEqual(
      core.palettes?.map((p) => [p.id, p.current, p.preview.join('+')]),
      [
        ['auto', false, 'ecran+ecran'],
        ['ecran', false, 'ecran'],
        ['contraste', false, 'contraste'],
      ],
    );
    assert.deepEqual(theme.pageThemes, [{ id: 'mire', name: 'Mire', description: '', current: true }]);
    const rows = fieldOf(panels, 'home.rows');
    assert.equal(rows.kind, 'order');
    assert.equal(rows.lists?.[0]?.toggle, true);
    const providers = fieldOf(panels, 'scrape.providers');
    assert.deepEqual(
      providers.lists?.[0]?.items.map((x) => x.id),
      ['musicbrainz', 'libretro', 'steam'],
    );
    assert.equal(providers.lists?.[0]?.toggle, false);
    // Plus aucun bouton « Régler dans … » : chaque bloc propre aux pages est un champ de l'écran.
    assert.ok(panels.every((p) => p.fields.every((f) => (f.kind as string) !== 'page')));
  });

  it('choix courts en boutons (position du menu), longs en liste de choix', () => {
    const panels = schemaPanels(sources());
    const menu = fieldOf(panels, 'ui.menu.position');
    assert.equal(menu.kind, 'segmented');
    assert.deepEqual(
      menu.options?.map((o) => o.label),
      ['À gauche', 'À droite', 'En haut', 'En bas'],
    );
    // Le même affichage dans toutes les langues.
    assert.equal(fieldOf(schemaPanels(sources({ t: en.t })), 'search.language').kind, 'segmented');
    assert.equal(fieldOf(panels, 'search.language').kind, 'segmented');
    assert.equal(fieldOf(panels, 'downloads.torrentClient').kind, 'choice');
    assert.equal(fieldOf(panels, 'ui.language').kind, 'choice');
  });

  it('ordre des fournisseurs : ceux de la configuration, puis les autres ; inconnus ignorés', () => {
    assert.deepEqual(providerOrder({ catalog: { metadataProviders: ['steam', 'inconnu', 'libretro'] } }), ['steam', 'libretro', 'musicbrainz']);
    // TMDB est un plugin (P5-15) : sans lui, son fournisseur n'est pas dans la liste.
    assert.deepEqual(providerOrder({}), ['musicbrainz', 'libretro', 'steam']);
  });

  it('les fournisseurs des plugins actifs rejoignent l’ordre, sous le nom de leur plugin', () => {
    const extra = ['org.films/infos'];
    assert.deepEqual(providerOrder({}, extra), ['musicbrainz', 'libretro', 'steam', 'org.films/infos']);
    assert.deepEqual(providerOrder({ catalog: { metadataProviders: ['org.films/infos', 'steam'] } }, extra), [
      'org.films/infos',
      'steam',
      'musicbrainz',
      'libretro',
    ]);
    // Un plugin désactivé : son fournisseur quitte la liste.
    assert.deepEqual(providerOrder({ catalog: { metadataProviders: ['org.films/infos', 'steam'] } }), ['steam', 'musicbrainz', 'libretro']);
    const providers = [{ id: 'org.films/infos', plugin: 'org.films', name: 'Films libres', kinds: ['video'] }];
    for (const [t, label] of [
      [fr.t, 'Films libres (plugin)'],
      [en.t, 'Films libres (plugin)'],
    ] as const) {
      const list = fieldOf(schemaPanels(sources({ t, providers })), 'scrape.providers').lists?.[0];
      assert.deepEqual(list?.items.at(-1), { id: 'org.films/infos', label, color: 'var(--muted)', on: true });
    }
  });

  it('informations et actions : bloqueur, lecture protégée, éditeur JSON, configuration', () => {
    const panels = settingsPanels(sources({ adblockStatus: 'Trois listes', drmStatus: 'Widevine', configPath: '/tmp/config.json' }));
    const byId = (id: string) => panels.find((p) => p.id === id)!;
    assert.deepEqual(byId('adblock').notes, ['Trois listes']);
    assert.deepEqual(
      byId('adblock').actions?.map((a) => a.action),
      ['updateFilterLists'],
    );
    assert.deepEqual(byId('drm').notes, ['Widevine']);
    assert.deepEqual(JSON.parse(byId('advanced').json!), JSON.parse(advancedJson(DEFAULT_CONFIG)));
    assert.deepEqual(
      byId('config').actions?.map((a) => `${a.action}${a.mode ? `:${a.mode}` : ''}`),
      ['exportConfig', 'importConfig:replace', 'importConfig:merge', 'revealConfig'],
    );
    assert.deepEqual(byId('config').notes, ['/tmp/config.json']);
  });
});

describe('blocs propres aux pages (P4-20, partie 2)', () => {
  const config = () => {
    const c = structuredClone(DEFAULT_CONFIG) as Data;
    c.library.sources = [
      { id: 's1', kind: 'video', location: '/films' },
      { id: 's2', kind: 'video', location: '\\\\NAS\\Films' },
      { id: 's3', kind: 'audio', location: 'http://serveur/musique/' },
    ];
    c.gameSources = [{ id: 'g1', location: 'C:\\Jeux' }];
    c.tv = {
      active: 'm3u',
      services: [
        { id: 'box', name: 'Box', kind: 'web', url: 'https://box' },
        { id: 'm3u', name: 'IPTV', kind: 'playlist', url: 'http://iptv/liste.m3u' },
      ],
    };
    c.web = [{ id: 'arte', name: 'Arte', url: 'https://www.arte.tv/fr/' }];
    c.games = [{ name: 'Jeu', path: 'C:\\Jeux\\jeu.exe' }];
    c.pcSites = [{ name: 'Libre', url: 'https://libre.example', search: 'https://libre.example/?q={q}' }];
    c.store = { romsRoot: '/roms' };
    return c;
  };
  const groupsOf = (panels: ReturnType<typeof schemaPanels>, key: string) => fieldOf(panels, key).groups ?? [];

  it('sources : une liste par nature, avec la nature de l’emplacement et l’état de l’analyse', () => {
    const panels = schemaPanels(
      sources({ config: config(), sourceStatus: { s1: { ok: true, count: 3 }, s2: { ok: false, error: 'Partage injoignable' } }, gameSourceStatus: {} }),
    );
    const groups = groupsOf(panels, 'sources.sources');
    assert.deepEqual(
      groups.map((g) => [g.key, g.label, g.entries.length]),
      [
        ['sources:video', 'Vidéos', 2],
        ['sources:audio', 'Musique', 1],
        ['sources:image', 'Images', 0],
        ['sources:game', 'Jeux PC', 1],
      ],
    );
    assert.deepEqual(groups[0]!.entries, [
      { id: 's1', label: '/films', sub: 'Dossier · 3 vidéos' },
      { id: 's2', label: '\\\\NAS\\Films', sub: 'Réseau · Partage injoignable', error: true },
    ]);
    assert.equal(groups[1]!.entries[0]!.sub, 'Web');
    assert.equal(groups[2]!.empty, 'Aucune source.');
    assert.deepEqual(
      groups[0]!.buttons?.map((b) => b.action),
      ['addSourceFolder', 'addSourceAddress'],
    );
    assert.ok(groups.every((g) => g.remove));
    const scanning = groupsOf(schemaPanels(sources({ config: config(), scanning: true })), 'sources.sources');
    assert.equal(scanning[0]!.entries[0]!.sub, 'Dossier · Analyse…');
    const english = groupsOf(schemaPanels(sources({ t: en.t, config: config(), sourceStatus: { s1: { ok: true, count: 1 } } })), 'sources.sources');
    assert.equal(english[0]!.entries[0]!.sub, 'Folder · 1 video');
  });

  it('télévision : un choix parmi les services, la détection ; l’adresse de la playlist active', () => {
    const panels = schemaPanels(sources({ config: config() }));
    const [group] = groupsOf(panels, 'tv.service');
    assert.equal(group!.choose, true);
    assert.deepEqual(group!.entries, [
      { id: 'box', label: 'Box', sub: 'Portail web', current: false },
      { id: 'm3u', label: 'IPTV', sub: 'Playlist M3U', current: true },
    ]);
    assert.deepEqual(
      group!.buttons?.map((b) => b.action),
      ['detectTvBox', 'reloadTv'],
    );
    const url = fieldOf(panels, 'tv.playlist');
    assert.equal(url.kind, 'text');
    assert.equal(url.value, 'http://iptv/liste.m3u');
    const c = config();
    c.tv.active = 'box';
    assert.ok(
      !schemaPanels(sources({ config: c }))
        .flatMap((p) => p.fields)
        .some((f) => f.key === 'tv.playlist'),
    );
  });

  it('sites, jeux PC, sites de jeux PC : listes avec « Retirer », et de quoi ajouter', () => {
    const panels = schemaPanels(sources({ config: config() }));
    const [web] = groupsOf(panels, 'streaming.sites');
    assert.deepEqual(web!.entries, [{ id: 'arte', label: 'Arte', sub: 'https://www.arte.tv/fr/' }]);
    assert.deepEqual(
      web!.inputs?.map((i) => i.id),
      ['name', 'url'],
    );
    assert.equal(web!.buttons?.[0]?.action, 'addEntry');
    const [games] = groupsOf(panels, 'games.pcGames');
    assert.deepEqual(games!.entries, [{ id: 'C:\\Jeux\\jeu.exe', label: 'Jeu', sub: 'C:\\Jeux\\jeu.exe' }]);
    assert.equal(games!.buttons?.[0]?.action, 'addPcGame');
    const [sites] = groupsOf(panels, 'games.pcSites');
    assert.deepEqual(sites!.entries, [{ id: 'https://libre.example', label: 'Libre', sub: 'https://libre.example · https://libre.example/?q={q}' }]);
    assert.deepEqual(
      sites!.inputs?.map((i) => i.id),
      ['name', 'url', 'search'],
    );
    for (const g of [web, games, sites]) assert.equal(g!.remove, true);
  });

  it('boutique : un dossier ; consoles : un lien vers l’onglet du Centre', () => {
    const panels = schemaPanels(sources({ config: config() }));
    const store = fieldOf(panels, 'store.romsRoot');
    assert.deepEqual([store.kind, store.value, store.pick, store.placeholder], ['path', '/roms', 'folder', 'Documents/Mire/ROMs']);
    const consoles = fieldOf(panels, 'games.consoles');
    assert.equal(consoles.kind, 'link');
    assert.deepEqual(consoles.link, { tab: 'consoles', label: 'Ouvrir les consoles du Centre' });
    assert.equal(fieldOf(schemaPanels(sources({ t: en.t, config: config() })), 'games.consoles').link?.label, 'Open the consoles of the Centre');
  });
});

describe('réglages d’un plugin depuis son manifeste', () => {
  const plugin: PluginSettingsInfo = {
    id: 'org.exemple.radios',
    name: 'Radios',
    settings: [
      { key: 'apiKey', type: 'secret' },
      { key: 'quality', type: 'choice', options: ['high', 'low'], default: 'high' },
      { key: 'night', type: 'toggle', default: false },
      { key: 'stations', type: 'list', default: [] },
      { key: 'folder', type: 'path' },
      { key: 'sansTexte', type: 'text' },
    ],
    values: { quality: 'low', night: true, stations: ['FIP'], folder: '/musique' },
    secrets: ['apiKey'],
  };
  // Textes du plugin dans les catalogues (`pluginTexts.<id>.…`), comme le processus principal les fusionne.
  const texts: Record<string, string> = {
    'pluginTexts.org_exemple_radios.settings.apiKey.label': 'Clé de l’API',
    'pluginTexts.org_exemple_radios.settings.quality.label': 'Qualité',
    'pluginTexts.org_exemple_radios.settings.quality.help': 'Qualité du flux.',
    'pluginTexts.org_exemple_radios.settings.quality.options.high': 'Haute',
    'pluginTexts.org_exemple_radios.settings.night.label': 'Mode nuit',
    'pluginTexts.org_exemple_radios.settings.stations.label': 'Stations',
    'pluginTexts.org_exemple_radios.settings.folder.label': 'Dossier',
  };
  const t = (key: string) => texts[key] ?? fr.t(key);

  it('un panneau par plugin, un champ par réglage déclaré, avec ses textes et ses valeurs', () => {
    const [panel] = pluginPanels([plugin], t);
    assert.equal(panel!.id, 'plugin:org.exemple.radios');
    assert.equal(panel!.title, 'Radios');
    assert.equal(panel!.help, 'Réglages de ce plugin. Ils s’appliquent tout de suite.');
    const f = Object.fromEntries(panel!.fields.map((x) => [x.key.split(':').pop(), x]));
    assert.deepEqual(f.apiKey, { key: 'plugin:org.exemple.radios:apiKey', kind: 'secret', label: 'Clé de l’API', value: '', secretSet: true });
    assert.deepEqual(f.quality!.options, [
      { value: 'high', label: 'Haute' },
      { value: 'low', label: 'low' },
    ]);
    assert.equal(f.quality!.value, 'low');
    assert.equal(f.quality!.help, 'Qualité du flux.');
    assert.equal(f.night!.value, true);
    assert.deepEqual(f.stations!.value, ['FIP']);
    assert.equal(f.folder!.kind, 'path');
    // Sans texte, le libellé est la clé du réglage.
    assert.equal(f.sansTexte!.label, 'sansTexte');
  });

  it('jamais la valeur d’un secret ; les panneaux des plugins suivent ceux du cœur', () => {
    const panels = settingsPanels(sources({ plugins: [plugin], t }));
    assert.equal(panels.at(-1)!.id, 'plugin:org.exemple.radios');
    assert.equal(panels.at(-2)!.id, 'config');
  });

  it('clé d’un réglage de plugin, aller et retour', () => {
    assert.equal(pluginFieldKey('org.a', 'b'), 'plugin:org.a:b');
    assert.deepEqual(parsePluginFieldKey('plugin:org.a:b'), { plugin: 'org.a', key: 'b' });
    assert.equal(parsePluginFieldKey('ui.home.clock'), null);
    assert.equal(settingsDomId('plugin:org.a:b'), 'set-plugin-org-a-b');
    assert.equal(settingsArgs({ id: 'jour' }), '[{"id":"jour"}]');
  });
});

describe('textes d’état', () => {
  const date = () => '3 novembre 2026';

  it('bloqueur : en cours, listes chargées (pluriel, date), jamais chargées, indisponibles', () => {
    assert.equal(adblockStatusText({ updating: true }, fr.t, date), 'Mise à jour des listes en cours…');
    assert.equal(adblockStatusText({ ready: true, loaded: 1 }, fr.t, date), '1 liste chargée.');
    assert.equal(adblockStatusText({ ready: true, loaded: 3, updated: 1 }, fr.t, date), '3 listes chargées, mises à jour le 3 novembre 2026.');
    assert.equal(
      adblockStatusText({ ready: true, loaded: 2, failed: ['https://x/easylist.txt'] }, fr.t, date),
      '2 listes chargées. Indisponible pour l’instant : easylist.txt.',
    );
    assert.equal(adblockStatusText(null, fr.t, date), 'Vérification…');
  });

  it('bloqueur désactivé et listes jamais chargées : elles se téléchargent quand il est activé (et non « au premier lancement »)', () => {
    assert.equal(adblockStatusText({ ready: false }, fr.t, date), 'Les listes se téléchargent quand le bloqueur est activé.');
    assert.equal(adblockStatusText({ ready: false }, en.t, date), 'The lists are downloaded when the blocker is on.');
  });

  it('lecture protégée', () => {
    assert.match(drmStatusText({ ecs: false }, fr.t), /ne contient pas Widevine/);
    assert.equal(drmStatusText({ ecs: true, widevine: { version: '4.10' }, platform: 'linux' }, fr.t), 'Widevine est installé (version 4.10).');
    assert.match(drmStatusText({ ecs: true, widevine: { version: '4.10' }, platform: 'win32' }, fr.t), /drm:signer/);
    assert.match(drmStatusText({ ecs: true, widevine: null }, en.t), /installed on first start/);
  });

  it('textes de la vue, dont ceux de ds-sortable', () => {
    const l = settingsLabels(en.t);
    assert.equal(l.browse, 'Browse…');
    assert.equal(JSON.parse(l.sortable!).moveBefore, 'Move {label} before {other}');
  });
});

/** Contexte de test : les appels au client API et à l'interface sont notés. */
function context(answers: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const toasts: string[] = [];
  const record = (prefix: string): unknown =>
    new Proxy(
      {},
      {
        get: (_t, name: string): unknown =>
          prefix === 'ui.' && (name === 'settings' || name === 'search')
            ? record(`ui.${name}.`)
            : (...args: unknown[]) => {
                calls.push([`${prefix}${name}`, ...args]);
                const a = answers[`${prefix}${name}`];
                return typeof a === 'function' ? a(...args) : a;
              },
      },
    );
  const ctx = {
    S,
    api: record('api.'),
    ui: record('ui.'),
    toast: (m: string) => toasts.push(m),
    t: fr.t,
    page: PAGE,
    dialogs: record('dialogs.'),
  } as unknown as ControllerContext;
  return { ctx, calls, toasts, named: (n: string) => calls.filter((c) => c[0] === n) };
}

describe('contrôleur mire-settings (P4-20)', () => {
  it('un champ s’enregistre dès qu’il change, puis l’écran se relit', async () => {
    const { ctx, named } = context();
    await new SettingsController(ctx).setValue({ key: 'search.language', value: 'en-US' });
    assert.deepEqual(named('ui.setCfg'), [['ui.setCfg', 'search.language', 'en-US']]);
    assert.equal(named('ui.settings.refresh').length, 1);
  });

  it('le bloqueur passe par son service, avec son message', async () => {
    const { ctx, named, toasts } = context({ 'api.adblockSetEnabled': { ready: false } });
    await new SettingsController(ctx).setValue({ key: 'adblock.enabled', value: true });
    assert.deepEqual(named('api.adblockSetEnabled'), [['api.adblockSetEnabled', true]]);
    assert.equal(named('ui.setCfg').length, 0);
    assert.deepEqual(toasts, ['Bloqueur activé. Les sites ouverts se rechargent.']);
  });

  it('réglage d’un plugin : par son IPC ; un secret laissé vide n’efface rien ; un refus est affiché', async () => {
    const { ctx, named, toasts } = context({
      'api.pluginsSetSetting': (_id: string, key: string) => (key === 'bad' ? { ok: false, error: 'Refusé.' } : { ok: true }),
    });
    const c = new SettingsController(ctx);
    await c.setValue({ key: 'plugin:org.a:night', value: true });
    await c.setValue({ key: 'plugin:org.a:apiKey', value: '' });
    await c.setValue({ key: 'plugin:org.a:bad', value: 'x' });
    assert.deepEqual(named('api.pluginsSetSetting'), [
      ['api.pluginsSetSetting', 'org.a', 'night', true],
      ['api.pluginsSetSetting', 'org.a', 'bad', 'x'],
    ]);
    assert.deepEqual(toasts, ['Enregistré', 'Refusé.']);
    assert.deepEqual(named('ui.settings.refresh')[0], ['ui.settings.refresh', { plugins: true }]);
  });

  it('nouvel ordre : fournisseurs d’infos (inconnus ignorés) et rangées de l’accueil', async () => {
    const home = { clock: true, recent: false, bars: [], services: [], rows: [{ kind: 'recent' }, { kind: 'bars', targets: [] }] } as Data;
    const { ctx, named } = context({ 'ui.saveUi': (mutate: (u: Data) => void) => mutate({ home }) });
    const c = new SettingsController(ctx);
    await c.setOrder({ kind: 'providers', keys: ['steam', 'x', 'libretro'] });
    assert.deepEqual(named('ui.setCfg'), [['ui.setCfg', 'catalog.metadataProviders', ['steam', 'libretro']]]);
    let saved: Data | null = null;
    const { ctx: ctx2 } = context({ 'ui.saveUi': (mutate: (u: Data) => void) => mutate((saved = { home })) });
    await new SettingsController(ctx2).setOrder({ kind: 'rows', keys: ['bars', 'recent'] });
    assert.deepEqual(
      (saved as unknown as Data).home.rows.map((r: Data) => r.kind),
      ['bars', 'recent'],
    );
    await assert.rejects(c.setOrder({ kind: 'nope', keys: [] }));
  });

  it('listes : ajout du texte tapé (bloqueur), retrait', async () => {
    S.adblock = { allowlist: ['a.com'], customLists: [] };
    const { ctx, named } = context({ 'ui.settings.draft': () => ' b.com ' });
    const c = new SettingsController(ctx);
    await c.addToList({ key: 'adblock.allowlist' });
    assert.deepEqual(named('api.adblockSetLists'), [['api.adblockSetLists', { allowlist: ['a.com', 'b.com'] }]]);
    assert.deepEqual(named('ui.settings.clearDraft'), [['ui.settings.clearDraft', 'adblock.allowlist']]);
    await c.removeFromList({ key: 'adblock.allowlist', value: 'a.com' });
    assert.deepEqual(named('api.adblockSetLists')[1], ['api.adblockSetLists', { allowlist: [] }]);
  });

  it('chemin : choisi puis enregistré', async () => {
    const { ctx, named } = context({ 'api.pickFolder': '/films' });
    await new SettingsController(ctx).pickPath({ key: 'downloads.dir', pick: 'folder' });
    assert.deepEqual(named('ui.setCfg'), [['ui.setCfg', 'downloads.dir', '/films']]);
  });

  it('éditeur JSON : refusé s’il est mal formé, enregistré sinon (le seul avec un bouton « Enregistrer »)', async () => {
    S.config = structuredClone(DEFAULT_CONFIG) as typeof S.config;
    const bad = context({ 'ui.settings.draft': () => '{ "web": 3 }' });
    await new SettingsController(bad.ctx).saveAdvanced();
    assert.deepEqual(bad.toasts, ['« web » doit être une liste entre crochets [ ].']);
    assert.equal(bad.named('api.saveConfig').length, 0);
    const good = context({ 'ui.settings.draft': () => '{ "web": [] }', 'api.saveConfig': (c: Data) => c });
    await new SettingsController(good.ctx).saveAdvanced();
    assert.deepEqual((good.named('api.saveConfig')[0]![1] as Data).web, []);
    assert.deepEqual(good.toasts, ['Sites, jeux et consoles enregistrés']);
  });

  it('nouvel ordre : les fournisseurs des plugins actifs sont gardés', async () => {
    const { ctx, named } = context({ 'api.pluginsMetadataProviders': [{ id: 'org.films/infos' }] });
    await new SettingsController(ctx).setOrder({ kind: 'providers', keys: ['org.films/infos', 'x', 'steam'] });
    assert.deepEqual(named('ui.setCfg'), [['ui.setCfg', 'catalog.metadataProviders', ['org.films/infos', 'steam']]]);
  });

  it('sources : un dossier choisi par le processus principal, une adresse, un retrait ; nature vérifiée', async () => {
    const { ctx, named } = context();
    const c = new SettingsController(ctx);
    await c.addSourceFolder({ key: 'sources:video' });
    await c.addSourceAddress({ key: 'sources:game' });
    await c.removeEntry({ key: 'sources:audio', id: 's3' });
    assert.deepEqual(named('ui.addSourceFolder'), [['ui.addSourceFolder', 'video']]);
    assert.deepEqual(named('ui.askSourceAddress'), [['ui.askSourceAddress', 'game']]);
    assert.deepEqual(named('ui.removeSource'), [['ui.removeSource', 'audio', 's3']]);
    assert.equal(named('ui.settings.refresh').length, 3);
    await assert.rejects(c.addSourceFolder({ key: 'sources:autre' }));
  });

  it('sites et sites de jeux PC : ajout d’après les champs remplis, puis champs vidés ; retrait', async () => {
    S.config = structuredClone(DEFAULT_CONFIG) as typeof S.config;
    const drafts: Record<string, string> = {
      'web.name': 'Arte',
      'web.url': 'www.arte.tv',
      'pcSites.url': 'https://libre.example',
      'pcSites.search': 'https://libre.example/?q={q}',
    };
    const { ctx, named, toasts } = context({ 'ui.settings.draft': (k: string) => drafts[k], 'api.saveConfig': (c: Data) => c });
    const c = new SettingsController(ctx);
    await c.addEntry({ key: 'web' });
    const web = (S.config as Data).web as Data[];
    assert.deepEqual([web.at(-1)!.name, web.at(-1)!.url], ['Arte', 'https://www.arte.tv']);
    assert.equal(toasts.at(-1), 'Arte ajouté dans Streaming');
    await c.addEntry({ key: 'pcSites' });
    assert.deepEqual((S.config as Data).pcSites, [{ name: 'libre.example', url: 'https://libre.example', search: 'https://libre.example/?q={q}' }]);
    assert.deepEqual(
      named('ui.settings.clearDraft').map((x) => x[1]),
      ['web.name', 'web.url', 'pcSites.name', 'pcSites.url', 'pcSites.search'],
    );
    await c.removeEntry({ key: 'pcSites', id: 'https://libre.example' });
    assert.deepEqual((S.config as Data).pcSites, []);
    (S.config as Data).games = [{ path: '/jeu' }, { path: '/autre' }];
    await c.removeEntry({ key: 'games', id: '/jeu' });
    assert.deepEqual((S.config as Data).games, [{ path: '/autre' }]);
    await c.removeEntry({ key: 'web', id: (web.at(-1) as Data).id });
    assert.ok(!((S.config as Data).web as Data[]).some((x) => x.name === 'Arte'));
    await assert.rejects(c.removeEntry({ key: 'autre', id: 'x' }));
  });

  it('site incomplet : rien n’est enregistré, les champs restent remplis', async () => {
    const { ctx, named, toasts } = context({ 'ui.settings.draft': (k: string) => (k === 'web.name' ? 'Arte' : '') });
    await new SettingsController(ctx).addEntry({ key: 'web' });
    assert.equal(named('api.saveConfig').length, 0);
    assert.equal(named('ui.settings.clearDraft').length, 0);
    assert.deepEqual(toasts, ['Indiquez un nom et une adresse.']);
  });

  it('télévision : choix du service, adresse de la playlist active, détection de la box', async () => {
    S.config = structuredClone(DEFAULT_CONFIG) as typeof S.config;
    (S.config as Data).tv = { active: 'm3u', services: [{ id: 'm3u', kind: 'playlist', url: '' }] };
    const { ctx, named, toasts } = context({
      'api.tvSetActive': () => S.config,
      'api.saveConfig': (c: Data) => c,
      'api.tvDetect': { id: 'box', name: 'Ma box' },
      'api.getConfig': { config: S.config },
    });
    const c = new SettingsController(ctx);
    await c.setValue({ key: 'tv.active', value: 'm3u' });
    assert.deepEqual(named('api.tvSetActive'), [['api.tvSetActive', 'm3u']]);
    await c.setValue({ key: 'tv.playlist', value: 'http://iptv/liste.m3u' });
    assert.equal(((S.config as Data).tv.services as Data[])[0]!.url, 'http://iptv/liste.m3u');
    assert.equal(named('ui.setCfg').length, 0);
    await c.detectTvBox();
    assert.deepEqual(toasts.slice(-2), ['Recherche de votre box sur le réseau…', 'Ma box détecté.']);
  });

  it('jeu PC ajouté à la main : par le processus principal, puis l’écran se relit', async () => {
    const { ctx, named } = context();
    await new SettingsController(ctx).addPcGame();
    assert.equal(named('ui.addGame').length, 1);
    assert.equal(named('ui.settings.refresh').length, 1);
  });

  it('consoles : le lien ouvre l’onglet « Consoles » du Centre', () => {
    const { ctx, named } = context({ 'ui.open': true });
    new SettingsController(ctx).openCentreTab({ tab: 'consoles' });
    assert.deepEqual(named('ui.open'), [['ui.open', 'downloads']]);
    assert.deepEqual(named('ui.showCentreTab'), [['ui.showCentreTab', 'consoles']]);
  });

  it('« Ouvrir ses réglages » de la Recherche mène au réglage qui manque au plugin « Où regarder »', async () => {
    const { ctx, named } = context({ 'ui.search.watchSetup': { plugin: 'mire.tmdb', setup: 'token' } });
    await new SearchController(ctx).addKey();
    assert.deepEqual(named('ui.go'), [['ui.go', 'settings', { focus: 'content' }]]);
    assert.deepEqual(named('ui.settings.focus'), [['ui.settings.focus', 'plugin:mire.tmdb:token']]);
    // Rien ne manque : rien ne s'ouvre.
    const none = context();
    await new SearchController(none.ctx).addKey();
    assert.deepEqual(none.named('ui.go'), []);
  });
});

describe('coquille', () => {
  it('screen:settings a sa vue (SCREEN_VIEWS) : plus aucun écran dans une vue historique', () => {
    assert.ok(SCREEN_VIEWS.some(([t, s]) => t === SETTINGS_TARGET && s === SETTINGS_VIEW));
    assert.equal(viewOf(SETTINGS_TARGET), SETTINGS_VIEW);
    assert.equal(targetOfLegacyView(SETTINGS_VIEW), SETTINGS_TARGET);
  });
});
