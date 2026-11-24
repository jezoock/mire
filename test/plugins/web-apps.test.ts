// Services de streaming des plugins (P5-05) : lecture des contributions `webApps` par le cœur (données vérifiées,
// invalides ignorées), synchronisation avec les sites de la configuration (ajout, reprise, plugin désactivé).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Config, WebSite } from '@mire/shared';
import { isSiteAvailable } from '@mire/shared';
import type { ContributionEntry } from '../../src/main/plugins/registry.ts';
import { checkSearchTemplate, readWebApp, readWebApps, syncWebApps, withWebApps } from '../../src/main/plugins/web-apps.ts';

const NETFLIX = {
  name: 'Netflix',
  url: 'https://www.netflix.com/browse',
  color: '#e50914',
  search: 'https://www.netflix.com/search?q={query}',
  providers: ['netflix'],
  category: 'video',
};
const entry = (data: unknown, pluginId = 'mire.web.netflix', id = 'netflix'): ContributionEntry => ({
  pluginId,
  kind: 'webApps',
  id,
  declaration: { id, file: 'app/site.json' },
  data,
});
const site0 = (o: Partial<WebSite>) => site({ id: 'netflix', ...o });
const site = (o: Partial<WebSite>): WebSite => ({ id: 'x', url: 'https://x.example/', mode: 'integrated', search: '', ...o });

describe('lecture des services des plugins', () => {
  it('lit le service : adresse, couleur en majuscules, recherche au jeton de la configuration, fournisseurs, rangement', () => {
    assert.deepEqual(readWebApp(entry(NETFLIX)), {
      id: 'netflix',
      plugin: 'mire.web.netflix',
      name: 'Netflix',
      url: 'https://www.netflix.com/browse',
      color: '#E50914',
      search: 'https://www.netflix.com/search?q={q}',
      providers: ['netflix'],
      background: false,
      category: 'video',
    });
    const music = readWebApp(
      entry({ name: 'Spotify', url: 'https://open.spotify.com', color: '#1ED760', background: true, category: 'music' }, 'mire.web.spotify', 'spotify'),
    );
    assert.deepEqual([music?.background, music?.category, music?.search, music?.providers], [true, 'music', '', []]);
  });

  it('données invalides ignorées : forme, adresse, couleur, nom, identifiant', () => {
    const bad: unknown[] = [
      null,
      'texte',
      [],
      {},
      { ...NETFLIX, url: 'http://www.netflix.com/' },
      { ...NETFLIX, url: 'javascript:alert(1)' },
      { ...NETFLIX, url: 'file:///etc/passwd' },
      { ...NETFLIX, url: 'https://user:mdp@www.netflix.com/' },
      { ...NETFLIX, url: 'https://www.netflix.com/ x' },
      { ...NETFLIX, url: undefined },
      { ...NETFLIX, color: 'red' },
      { ...NETFLIX, color: '#fff' },
      { ...NETFLIX, color: 'url(https://x)' },
      { ...NETFLIX, color: '#E50914; background:red' },
      { ...NETFLIX, name: '<img src=x onerror=alert(1)>' },
      { ...NETFLIX, name: '' },
      { ...NETFLIX, name: 'x'.repeat(81) },
      { ...NETFLIX, name: 3 },
    ];
    for (const data of bad) assert.equal(readWebApp(entry(data)), null, JSON.stringify(data));
    for (const id of ['', 'Netflix', '../x', 'a b', '-a']) assert.equal(readWebApp(entry(NETFLIX, 'mire.web.netflix', id)), null, id);
    assert.equal(readWebApp({ ...entry(NETFLIX), kind: 'apps' }), null);
  });

  it('valeurs facultatives mal formées ignorées, sans refuser le service', () => {
    const app = readWebApp(entry({ ...NETFLIX, providers: ['ok', '<b>', 3, 'x'.repeat(41)], category: 'Pas bien', background: 'oui' }));
    assert.deepEqual([app?.providers, app?.category, app?.background], [['ok'], 'video', false]);
    assert.equal(readWebApp(entry({ ...NETFLIX, providers: 'netflix' }))?.providers.length, 0);
  });

  it('modèle de recherche limité à sa forme : {query} une fois, https:, même site', () => {
    const url = 'https://www.netflix.com/browse';
    assert.equal(checkSearchTemplate('https://www.netflix.com/search?q={query}', url), 'https://www.netflix.com/search?q={q}');
    for (const bad of [
      'https://www.netflix.com/search',
      'https://www.netflix.com/search?q={query}&r={query}',
      'https://www.netflix.com/search?q={q}',
      'https://www.netflix.com/search?q={query}{x}',
      'http://www.netflix.com/search?q={query}',
      'https://autre.example/search?q={query}',
      'https://user:mdp@www.netflix.com/search?q={query}',
      'javascript:{query}',
      '{query}',
      42,
    ])
      assert.equal(checkSearchTemplate(bad, url), null, String(bad));
    // Un modèle mal formé n'enlève pas le service : sa recherche est à apprendre.
    assert.equal(readWebApp(entry({ ...NETFLIX, search: 'https://autre.example/?q={query}' }))?.search, '');
  });

  it('un identifiant de site n’est donné qu’une fois : le premier plugin l’emporte', () => {
    const apps = readWebApps([entry(NETFLIX), entry({ ...NETFLIX, name: 'Faux Netflix' }, 'org.tiers.netflix'), entry({ nope: 1 }, 'a.b', 'autre')]);
    assert.deepEqual(
      apps.map((a) => [a.id, a.name]),
      [['netflix', 'Netflix']],
    );
  });
});

describe('sites de la configuration d’après les plugins actifs', () => {
  const apps = readWebApps([entry(NETFLIX)]);

  it('un plugin actif ajoute son service ; le mode et la recherche apprise restent à l’utilisateur', () => {
    const added = syncWebApps([site({ id: 'arte', name: 'Arte' })], apps);
    assert.deepEqual(
      added.map((s) => s.id),
      ['arte', 'netflix'],
    );
    assert.deepEqual(added[1], {
      id: 'netflix',
      name: 'Netflix',
      url: 'https://www.netflix.com/browse',
      mode: 'integrated',
      search: 'https://www.netflix.com/search?q={q}',
      group: 'video',
      color: '#E50914',
      app: 'mire.web.netflix',
      providers: ['netflix'],
    });
    const mine = site({ id: 'netflix', mode: 'browser', search: 'https://www.netflix.com/title?x={q}', url: 'https://ancien.example/' });
    const [kept] = syncWebApps([mine], apps);
    assert.deepEqual(
      [kept.mode, kept.search, kept.url, kept.app],
      ['browser', 'https://www.netflix.com/title?x={q}', 'https://www.netflix.com/browse', 'mire.web.netflix'],
    );
  });

  it('continuité : un service déjà configuré (sans plugin) est repris par le plugin officiel, et garde ses réglages', () => {
    const before = site({ id: 'netflix', name: 'Netflix', mode: 'browser', color: '#000000', extra: 'gardé' });
    const [after] = syncWebApps([before], apps);
    assert.equal(after.app, 'mire.web.netflix');
    assert.equal(after.mode, 'browser');
    assert.equal(after.extra, 'gardé');
    assert.equal(after.id, 'netflix');
  });

  it('un plugin non officiel ne reprend ni un site de l’utilisateur ni le service d’un autre plugin', () => {
    const tiers = readWebApps([entry(NETFLIX, 'org.tiers.netflix')]);
    const mine = site({ id: 'netflix', name: 'Mon Netflix', url: 'https://moi.example/' });
    assert.deepEqual(syncWebApps([mine], tiers), [mine]);
    const owned = site({ id: 'netflix', app: 'mire.web.netflix' });
    const [out] = syncWebApps([owned], tiers);
    assert.equal(out.inactive, true);
    assert.equal(out.app, 'mire.web.netflix');
    // Un service de tiers sans conflit est ajouté, avec son propre plugin.
    assert.equal(syncWebApps([], tiers)[0].app, 'org.tiers.netflix');
  });

  it('plugin désactivé ou absent : le service est masqué sans erreur, rien n’est effacé ; il revient avec son plugin', () => {
    const [active] = syncWebApps([], apps);
    const [off] = syncWebApps([active], []);
    assert.equal(off.inactive, true);
    assert.equal(isSiteAvailable(off), false);
    assert.deepEqual({ ...off, inactive: undefined }, { ...active, inactive: undefined });
    const [back] = syncWebApps([off], apps);
    assert.equal(isSiteAvailable(back), true);
    assert.equal('inactive' in back, false);
    // Les sites de l'utilisateur ne sont jamais masqués.
    const mine = site({ id: 'arte' });
    assert.deepEqual(syncWebApps([mine], []), [mine]);
  });

  it('sans changement : la même configuration (aucune écriture) ; données du plugin changées : mises à jour', () => {
    const config = { web: syncWebApps([], apps) } as unknown as Config;
    assert.equal(withWebApps(config, apps), config);
    const next = withWebApps(config, readWebApps([entry({ ...NETFLIX, color: '#111111' })]));
    assert.notEqual(next, config);
    assert.equal(next.web[0].color, '#111111');
  });
});
