// Vue web (P4-16) : barre d'un site rédigée d'après l'état publié par le processus principal, place de la vue native
// (menu automatique déplié par-dessus), page d'où vient une vue.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { navArgs, slotBounds } from '@mire/ui/utils';
import { adLabel, kindOf, webBarView, webHome } from '../../src/renderer/web/model.ts';

// Traduction factice : la clé et ses variables, pour vérifier ce qui est demandé aux catalogues.
const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}${JSON.stringify(vars)}` : key);

describe('barre d’un site', () => {
  test('nom, couleur et genre viennent de l’état publié', () => {
    const bar = webBarView({ id: 'tv:sfr', kind: 'tv', name: 'SFR', color: '#E23B3B', title: 'Direct', canGoBack: true, loading: true }, { t, adblock: false });
    assert.deepEqual(bar, {
      id: 'tv:sfr',
      kind: 'tv',
      name: 'SFR',
      color: '#E23B3B',
      title: 'Direct',
      loading: true,
      canGoBack: true,
      canGoForward: false,
      hasSearch: false,
      adblock: null,
      rom: null,
    });
  });

  test('sites de jeux : liste des sites et site choisi, sans titre de page', () => {
    const bar = webBarView(
      { id: 'rom:snes', kind: 'rom', name: 'Jeux : Super Nintendo', title: 'Page', rom: { site: 1, sites: [{ name: 'A' }, { name: 'B' }] } },
      { t, adblock: false },
    );
    assert.equal(bar?.title, '');
    assert.deepEqual(bar?.rom, { sites: ['A', 'B'], site: 1 });
  });

  test('bloqueur : actif avec le nombre bloqué, ou désactivé sur ce site', () => {
    const on = webBarView({ id: 'netflix', adOn: true, blocked: 3 }, { t, adblock: true });
    assert.deepEqual(on?.adblock, {
      on: true,
      blocked: 3,
      label: 'webView.bar.adBlocked{"count":3}',
      title: 'webView.bar.adHint{"state":"webView.bar.adBlocked{\\"count\\":3}"}',
    });
    const off = webBarView({ id: 'netflix', adOn: false, blocked: 3 }, { t, adblock: true });
    assert.equal(off?.adblock?.on, false);
    assert.equal(off?.adblock?.label, 'webView.bar.adOff');
    assert.equal(adLabel(t, true, 0), 'webView.bar.adBlocked{"count":0}');
  });

  test('un état sans identifiant ne donne pas de barre ; des champs mal formés sont ignorés', () => {
    assert.equal(webBarView(null, { t, adblock: true }), null);
    assert.equal(webBarView({ name: 'x' }, { t, adblock: true }), null);
    const bar = webBarView({ id: 'bm:1', name: 42, color: null, blocked: 'beaucoup', rom: { sites: [] } }, { t, adblock: true });
    assert.equal(bar?.kind, 'bookmark');
    assert.equal(bar?.name, '');
    assert.equal(bar?.color, '');
    assert.equal(bar?.adblock?.blocked, 0);
    assert.equal(bar?.rom, null);
  });

  test('genre : publié, sinon déduit du préfixe', () => {
    assert.equal(kindOf('netflix', 'tv'), 'tv');
    assert.equal(kindOf('rom:x', undefined), 'rom');
    assert.equal(kindOf('bm:x', 'inconnu'), 'bookmark');
    assert.equal(kindOf('tv:x', null), 'tv');
    assert.equal(kindOf('netflix', null), 'site');
  });

  test('page d’origine : Jeux, Télévision ou Streaming', () => {
    assert.equal(webHome('rom:snes'), 'games');
    assert.equal(webHome('tv:sfr'), 'tv');
    assert.equal(webHome('bm:1'), 'streaming');
    assert.equal(webHome('netflix'), 'streaming');
    assert.equal(webHome(null), 'streaming');
  });

  test('arguments de navigation', () => {
    assert.equal(navArgs('back'), '[{"id":"back"}]');
  });
});

describe('place de la vue native', () => {
  const slot = { x: 100, y: 64, width: 900, height: 600 };

  test('sans menu déplié : la zone réservée', () => {
    assert.deepEqual(slotBounds(slot, null), slot);
  });

  test('menu automatique déplié : la vue native ne le recouvre pas', () => {
    assert.deepEqual(slotBounds(slot, { side: 'left', box: { x: 0, y: 0, width: 300, height: 800 } }), { x: 300, y: 64, width: 700, height: 600 });
    assert.deepEqual(slotBounds(slot, { side: 'right', box: { x: 800, y: 0, width: 300, height: 800 } }), { x: 100, y: 64, width: 700, height: 600 });
    assert.deepEqual(slotBounds(slot, { side: 'top', box: { x: 0, y: 0, width: 1200, height: 164 } }), { x: 100, y: 164, width: 900, height: 500 });
    assert.deepEqual(slotBounds(slot, { side: 'bottom', box: { x: 0, y: 564, width: 1200, height: 200 } }), { x: 100, y: 64, width: 900, height: 500 });
  });

  test('un menu qui couvre tout : taille nulle, jamais négative', () => {
    assert.deepEqual(slotBounds(slot, { side: 'left', box: { x: 0, y: 0, width: 1200, height: 800 } }), { x: 1200, y: 64, width: 0, height: 600 });
  });
});
