// Assistant du premier lancement (P4-23), logique sans DOM : choix d'après les catégories de l'index, pack de la
// langue du système, plugins à installer avec leurs dépendances, étapes, textes (catalogues réels).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AvailablePlugin } from '@mire/shared/ipc';
import { BUILTIN_CATALOGS, createI18n } from '@mire/shared/i18n';
import {
  assistantView,
  choicesOf,
  familiesOf,
  installPlan,
  languagePack,
  newSession,
  stepAfter,
  stepsOf,
  usableOffers,
  type Session,
} from '../../src/renderer/assistant/model.ts';

const i18n = createI18n({ locale: 'fr', catalogs: { ...BUILTIN_CATALOGS }, fallback: ['en'] });
const w = { t: (k: string, v?: Record<string, string | number>) => i18n.t(k, v), lang: 'fr' };

const offer = (id: string, categories: string[], over: Partial<AvailablePlugin> = {}): AvailablePlugin => ({
  id,
  repository: 'official',
  official: true,
  name: id.split('.').pop()!,
  description: null,
  version: '1.0.0',
  latest: '1.0.0',
  level: 'data',
  permissions: {},
  dependencies: {},
  contributes: ['packs'],
  categories,
  size: 100,
  installed: null,
  update: null,
  trust: 'official',
  sensitive: false,
  consented: true,
  conflict: false,
  ...over,
});

const OFFERS = [
  offer('mire.films', ['movies'], { dependencies: { 'mire.infos': '^1.0.0' } }),
  offer('mire.infos', [], { permissions: { hosts: ['api.exemple.org'] } }),
  offer('mire.musique', ['music'], { dependencies: { 'mire.infos': '^1.0.0' } }),
  offer('mire.free', ['tv-box'], { name: 'Freebox', dependencies: { 'mire.m3u': '^1.0.0' } }),
  offer('mire.orange', ['tv', 'tv-box'], { name: 'Orange' }),
  offer('mire.m3u', ['tv']),
  offer('mire.netflix', ['streaming-service'], { name: 'Netflix' }),
  offer('mire.lang.fr', ['language:fr'], { name: 'Français' }),
  offer('mire.lang.pt-br', ['language:pt-br'], { name: 'Português (Brasil)' }),
  offer('mire.vieux', ['games'], { version: null }),
  offer('org.tiers.jeux', ['games'], {
    repository: 'repo-0123456789abcdef',
    official: false,
    trust: 'third-party',
    sensitive: true,
    consented: false,
    level: 'privileged',
    permissions: { launch: true },
  }),
];

const session = (over: Partial<Session> = {}): Session => ({
  ...newSession(),
  offers: OFFERS,
  systemLanguages: ['fr-FR'],
  builtin: ['en', 'fr'],
  language: 'fr',
  ...over,
});

describe('assistant : choix d’après les catégories', () => {
  it('propose les familles présentes dans l’index, les box et les services', () => {
    const c = choicesOf(usableOffers(OFFERS));
    assert.deepEqual(c.families, ['movies', 'music', 'games', 'tv', 'streaming']);
    assert.deepEqual(
      c.boxes.map((p) => p.id),
      ['mire.free', 'mire.orange'],
    );
    assert.deepEqual(
      c.services.map((p) => p.id),
      ['mire.netflix'],
    );
    assert.deepEqual(familiesOf(offer('x.y', ['tv-box', 'streaming-service', 'inconnue'])), ['tv', 'streaming']);
    assert.deepEqual(choicesOf([]).families, []);
  });

  it('écarte les plugins sans version compatible ou fournis par un autre dépôt, préfère le dépôt officiel', () => {
    const list = usableOffers([
      offer('a.b', ['music'], { repository: 'repo-1', official: false }),
      offer('a.b', ['music']),
      offer('c.d', ['music'], { conflict: true }),
      offer('e.f', ['music'], { version: null }),
    ]);
    assert.deepEqual(
      list.map((p) => [p.id, p.repository]),
      [['a.b', 'official']],
    );
  });
});

describe('assistant : langue du système', () => {
  it('propose le pack de la langue exacte, sinon de sa langue de base, jamais pour l’anglais', () => {
    const offers = usableOffers(OFFERS);
    assert.equal(languagePack(offers, ['fr-FR', 'en']).pack?.id, 'mire.lang.fr');
    assert.equal(languagePack(offers, ['pt-BR']).pack?.id, 'mire.lang.pt-br');
    assert.equal(languagePack(offers, ['en-GB', 'fr']).pack, null);
    assert.deepEqual(languagePack(offers, ['de-DE']), { code: 'de-DE', pack: null });
    assert.deepEqual(languagePack(offers, []), { code: null, pack: null });
  });

  it('écrit l’étape Langue : pack à installer, langue intégrée, langue absente', () => {
    assert.match(assistantView(session({ step: 'language' }), w).paragraphs.join(' '), /Le pack de langue « Français » sera installé/);
    const noPack = session({ offers: OFFERS.filter((p) => p.id !== 'mire.lang.fr') });
    assert.match(assistantView({ ...noPack, step: 'language' }, w).paragraphs.join(' '), /déjà dans cette langue/);
    assert.match(assistantView(session({ step: 'language', systemLanguages: ['de'] }), w).paragraphs.join(' '), /pas encore traduit/);
  });
});

describe('assistant : plugins à installer', () => {
  it('le pack de langue seul quand rien n’est choisi', () => {
    assert.deepEqual(
      installPlan(session()).map((i) => i.offer.id),
      ['mire.lang.fr'],
    );
  });

  it('les plugins des familles choisies, la box, les services, puis leurs dépendances', () => {
    const plan = installPlan(session({ uses: ['movies', 'music', 'tv', 'streaming'], box: 'mire.free', services: ['mire.netflix'] }));
    assert.deepEqual(
      plan.map((i) => [i.offer.id, i.reason, i.root, i.requiredBy]),
      [
        ['mire.lang.fr', 'language', true, []],
        ['mire.films', 'movies', true, []],
        ['mire.musique', 'music', true, []],
        ['mire.m3u', 'tv', true, []],
        ['mire.free', 'box', true, []],
        ['mire.netflix', 'service', true, []],
        ['mire.infos', 'dependency', false, ['mire.films', 'mire.musique']],
      ],
    );
  });

  it('ni box sans télévision, ni services sans streaming, ni plugin déjà installé', () => {
    const offers = OFFERS.map((p) => (p.id === 'mire.infos' || p.id === 'mire.lang.fr' ? { ...p, installed: '1.0.0' } : p));
    const plan = installPlan(session({ offers, uses: ['movies'], box: 'mire.free', services: ['mire.netflix'] }));
    assert.deepEqual(
      plan.map((i) => i.offer.id),
      ['mire.films'],
    );
  });

  it('un plugin tiers qui demande l’accord le montre au récapitulatif, avec ses permissions', () => {
    const v = assistantView(session({ step: 'summary', uses: ['games'] }), w);
    const tiers = v.items.find((i) => i.key === 'org.tiers.jeux')!;
    assert.deepEqual(tiers.badges, ['Tiers', 'Accord demandé']);
    assert.ok(tiers.lines.some((l) => l.sensitive));
    assert.ok(v.buttons.install);
    // Les textes de l'index restent des textes.
    const html = assistantView(session({ step: 'services', uses: ['streaming'], offers: [offer('x.svc', ['streaming-service'], { name: '<b>Svc</b>' })] }), w);
    assert.equal(html.choices[0].label, '<b>Svc</b>');
  });
});

describe('assistant : étapes', () => {
  it('ne demande la box et les services que s’ils sont choisis et proposés', () => {
    assert.deepEqual(stepsOf(session()), ['welcome', 'language', 'uses', 'summary']);
    assert.deepEqual(stepsOf(session({ uses: ['tv', 'streaming'] })), ['welcome', 'language', 'uses', 'box', 'services', 'summary']);
    assert.deepEqual(stepsOf(session({ uses: ['tv'], offers: [offer('mire.m3u', ['tv'])] })), ['welcome', 'language', 'uses', 'summary']);
    assert.equal(stepAfter(session({ step: 'uses', uses: ['streaming'] }), 1), 'services');
    assert.equal(stepAfter(session({ step: 'summary', uses: ['streaming'] }), -1), 'services');
    assert.equal(stepAfter(session({ step: 'welcome' }), -1), 'welcome');
  });

  it('écrit chaque étape : progression, choix, boutons', () => {
    const uses = assistantView(session({ step: 'uses', uses: ['music'] }), w);
    assert.equal(uses.progress, 'Étape 2 sur 3');
    assert.deepEqual(uses.choices.map((c) => [c.key, c.pressed, c.action]).slice(0, 2), [
      ['movies', false, 'toggleUse'],
      ['music', true, 'toggleUse'],
    ]);
    const box = assistantView(session({ step: 'box', uses: ['tv'] }), w);
    assert.equal(box.choiceMode, 'radio');
    assert.deepEqual(
      box.choices.map((c) => [c.key, c.pressed]),
      [
        ['mire.free', false],
        ['mire.orange', false],
        ['', true],
      ],
    );
    assert.deepEqual(Object.keys(assistantView(session(), w).buttons), ['start', 'skip']);
    const offline = assistantView(session({ step: 'uses', offers: [], offline: true }), w);
    assert.deepEqual(offline.choices, []);
    assert.match(offline.paragraphs[0], /pas pu être lue/);
    const empty = assistantView(session({ step: 'summary', offers: [] }), w);
    assert.deepEqual(Object.keys(empty.buttons), ['back', 'finish']);
  });

  it('après l’installation : états, et un échec qui renvoie au Centre', () => {
    const s = session({
      step: 'done',
      uses: ['music'],
      results: { 'mire.lang.fr': { state: 'installed' }, 'mire.musique': { state: 'failed', message: 'Réseau indisponible' } },
    });
    const v = assistantView(s, w);
    assert.deepEqual(v.items.map((i) => [i.key, i.status, i.tone]).slice(0, 2), [
      ['mire.lang.fr', 'Installé', 'ok'],
      ['mire.musique', 'Réseau indisponible', 'error'],
    ]);
    assert.match(v.paragraphs[0], /réessayer dans le Centre/);
    assert.ok(v.buttons.openCentre && v.buttons.finish);
  });
});
