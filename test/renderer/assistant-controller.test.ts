// Assistant du premier lancement (P4-23), contrôleur `mire-assistant` : lecture des dépôts au départ, choix par clé,
// rien d'installé avant « Installer », accord jamais donné sans confirmation, échec qui n'empêche pas de terminer.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AvailablePlugin } from '@mire/shared/ipc';
import { newSession, type Session } from '../../src/renderer/assistant/model.ts';
import { AssistantController } from '../../src/renderer/controllers/assistant.ts';
import type { ControllerContext } from '../../src/renderer/controllers/types.ts';

const offer = (id: string, categories: string[], over: Partial<AvailablePlugin> = {}): AvailablePlugin => ({
  id,
  repository: 'official',
  official: true,
  name: id,
  description: null,
  version: '1.0.0',
  latest: '1.0.0',
  level: 'data',
  permissions: {},
  dependencies: {},
  contributes: ['packs'],
  categories,
  size: 1,
  installed: null,
  update: null,
  trust: 'official',
  sensitive: false,
  consented: true,
  conflict: false,
  ...over,
});

const OFFERS = [
  offer('mire.lang.fr', ['language:fr']),
  offer('mire.films', ['movies'], { dependencies: { 'mire.infos': '^1.0.0' } }),
  offer('mire.infos', []),
  offer('mire.free', ['tv-box']),
  offer('org.tiers.jeux', ['games'], {
    repository: 'repo-1',
    official: false,
    sensitive: true,
    consented: false,
    level: 'privileged',
    permissions: { launch: true },
  }),
];

type Call = [string, ...unknown[]];

function fake(answers: Record<string, (...args: any[]) => unknown> = {}) {
  const calls: Call[] = [];
  const toasts: string[] = [];
  let session: Session = newSession();
  const record = (prefix: string) =>
    new Proxy(
      {},
      {
        get:
          (_t, name: string) =>
          (...args: unknown[]) => {
            calls.push([`${prefix}${name}`, ...args]);
            const a = answers[`${prefix}${name}`];
            return a ? a(...args) : Promise.resolve(null);
          },
      },
    );
  const ui = new Proxy(record('ui.') as Record<string, unknown>, {
    get: (target, name: string) =>
      name === 'assistant'
        ? {
            session: () => session,
            refresh: (focus?: boolean) => calls.push(['assistant.refresh', !!focus]),
            open: () => (session = newSession()),
            close: (to: string) => calls.push(['assistant.close', to]),
          }
        : (target as Record<string, unknown>)[name],
  });
  const ctx = {
    S: {},
    api: record('api.'),
    ui,
    toast: (m: string) => toasts.push(m),
    t: (key: string) => key,
    page: 20,
    dialogs: record('dialogs.'),
  } as unknown as ControllerContext;
  return { calls, toasts, c: new AssistantController(ctx), session: () => session };
}

const ready = {
  'api.reposRefresh': async () => [{ id: 'official', error: null }],
  'api.reposPlugins': async () => OFFERS,
  'api.assistantState': async () => ({ open: true, systemLanguages: ['fr-FR'] }),
  'api.i18nGet': async () => ({ language: 'fr', available: [{ code: 'en' }, { code: 'fr' }] }),
};
const names = (calls: Call[]) => calls.map((c) => c[0]);

describe('assistant (P4-23) : contrôleur', () => {
  it('lit les dépôts en ligne au départ, puis passe à la langue', async () => {
    const f = fake(ready);
    await f.c.start();
    const s = f.session();
    assert.equal(s.step, 'language');
    assert.equal(s.offers?.length, OFFERS.length);
    assert.deepEqual(s.systemLanguages, ['fr-FR']);
    assert.deepEqual(s.builtin, ['en', 'fr']);
    assert.equal(s.offline, false);
    assert.ok(names(f.calls).includes('api.reposRefresh'));
    assert.ok(!names(f.calls).some((n) => n.startsWith('api.plugins')));
  });

  it('sans connexion : la lecture en échec ne bloque pas l’assistant', async () => {
    const f = fake({ ...ready, 'api.reposRefresh': async () => [{ id: 'official', error: 'network' }], 'api.reposPlugins': async () => [] });
    await f.c.start();
    assert.equal(f.session().step, 'language');
    assert.equal(f.session().offline, true);
    const g = fake({ ...ready, 'api.reposRefresh': async () => Promise.reject(new Error('IPC')) });
    await g.c.start();
    assert.equal(g.session().step, 'language');
    assert.deepEqual(g.session().offers, []);
  });

  it('choix par clé : familles connues, box et services proposés seulement', async () => {
    const f = fake(ready);
    await f.c.start();
    f.c.toggleUse({ key: 'movies' });
    f.c.toggleUse({ key: 'inconnue' });
    f.c.toggleUse({ key: 'tv' });
    assert.deepEqual(f.session().uses, ['movies', 'tv']);
    f.c.chooseBox({ id: 'mire.films' });
    assert.equal(f.session().box, null);
    f.c.chooseBox({ id: 'mire.free' });
    assert.equal(f.session().box, 'mire.free');
    f.c.chooseBox({ id: '' });
    assert.equal(f.session().box, null);
    f.c.toggleService({ id: 'mire.free' });
    assert.deepEqual(f.session().services, []);
    f.c.next();
    assert.equal(f.session().step, 'uses');
    f.c.next();
    assert.equal(f.session().step, 'box');
    f.c.back();
    assert.equal(f.session().step, 'uses');
  });

  it('rien n’est installé avant le récapitulatif', async () => {
    const f = fake(ready);
    await f.c.start();
    await f.c.install();
    assert.ok(!names(f.calls).includes('api.pluginsInstall'));
  });

  it('installe les plugins demandés (les dépendances viennent avec eux), puis termine', async () => {
    const f = fake({
      ...ready,
      'api.pluginsInstall': async (id: string) =>
        id === 'mire.films' ? { ok: true, plugins: [{ id: 'mire.films' }, { id: 'mire.infos' }] } : { ok: true, plugins: [{ id }] },
    });
    await f.c.start();
    f.c.toggleUse({ key: 'movies' });
    f.session().step = 'summary';
    await f.c.install();
    const installs = f.calls.filter((c) => c[0] === 'api.pluginsInstall').map((c) => [c[1], c[3]]);
    assert.deepEqual(installs, [
      ['mire.lang.fr', 'official'],
      ['mire.films', 'official'],
    ]);
    assert.equal(f.session().step, 'done');
    assert.deepEqual(Object.fromEntries(Object.entries(f.session().results).map(([k, v]) => [k, v.state])), {
      'mire.lang.fr': 'installed',
      'mire.films': 'installed',
      'mire.infos': 'installed',
    });
    await f.c.finish();
    assert.ok(names(f.calls).includes('api.assistantFinish'));
    assert.deepEqual(f.calls.at(-1), ['assistant.close', 'home']);
  });

  it('accord : refusé, rien n’est accepté ni installé ; l’échec d’un autre n’arrête rien', async () => {
    const f = fake({
      ...ready,
      'api.pluginsInstall': async (id: string) =>
        id === 'org.tiers.jeux'
          ? {
              ok: false,
              code: 'consent',
              error: 'accord',
              consent: [{ plugin: id, repository: 'repo-1', version: '1.0.0', level: 'privileged', permissions: { launch: true } }],
            }
          : { ok: false, code: 'network', error: 'Réseau indisponible' },
      'dialogs.form': async () => ({ action: 'cancel' }),
    });
    await f.c.start();
    f.c.toggleUse({ key: 'games' });
    f.session().step = 'summary';
    await f.c.install();
    assert.ok(!names(f.calls).includes('api.pluginsConsent'));
    assert.equal(f.calls.filter((c) => c[0] === 'api.pluginsInstall' && c[1] === 'org.tiers.jeux').length, 1);
    assert.deepEqual(f.session().results['org.tiers.jeux'], { state: 'declined' });
    assert.deepEqual(f.session().results['mire.lang.fr'], { state: 'failed', message: 'Réseau indisponible' });
    assert.equal(f.session().step, 'done');
    await f.c.openCentre();
    assert.deepEqual(f.calls.at(-1), ['assistant.close', 'centre']);
  });

  it('accord : confirmé, il est donné pour la version demandée, puis l’installation est relancée', async () => {
    let n = 0;
    const f = fake({
      ...ready,
      'api.pluginsInstall': async (id: string) =>
        id === 'org.tiers.jeux' && ++n === 1
          ? {
              ok: false,
              code: 'consent',
              error: 'accord',
              consent: [{ plugin: id, repository: 'repo-1', version: '1.0.0', level: 'privileged', permissions: {} }],
            }
          : { ok: true, plugins: [{ id }] },
      'api.pluginsConsent': async () => ({}),
      'dialogs.form': async () => ({ action: 'accept' }),
    });
    await f.c.start();
    f.c.toggleUse({ key: 'games' });
    f.session().step = 'summary';
    await f.c.install();
    assert.deepEqual(
      f.calls.filter((c) => c[0] === 'api.pluginsConsent'),
      [['api.pluginsConsent', 'org.tiers.jeux', 'repo-1', '1.0.0']],
    );
    assert.deepEqual(f.session().results['org.tiers.jeux'], { state: 'installed' });
  });

  it('passer : l’assistant est terminé sans rien installer', async () => {
    const f = fake(ready);
    await f.c.skip();
    assert.deepEqual(names(f.calls), ['api.assistantFinish', 'assistant.close']);
    assert.deepEqual(f.toasts, ['assistant.skipped']);
  });
});
