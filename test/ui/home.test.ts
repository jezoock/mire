// Logique sans DOM de l'accueil (P4-12) : mise en page du thème, arguments des actions, rangées vides.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupAction, homeIsEmpty, homeLayout, keyArgs, sectionHasContent, targetArgs } from '../../packages/ui/src/utils/index.ts';
import type { HomeSection } from '../../packages/ui/src/utils/index.ts';

describe('accueil (@mire/ui)', () => {
  it('mise en page du thème : rangées par défaut, grille sur demande', () => {
    assert.equal(homeLayout('grid'), 'grid');
    for (const v of ['rows', '', null, undefined, 'autre']) assert.equal(homeLayout(v), 'rows');
  });

  it('les actions désignent une cible, un chemin, une clé ; un regroupement garde sa page', () => {
    assert.equal(targetArgs('movies'), '[{"target":"movies"}]');
    assert.equal(targetArgs('series', ['Friends', 1]), '[{"target":"series","path":["Friends",1]}]');
    assert.equal(keyArgs('web:arte'), '[{"key":"web:arte"}]');
    assert.equal(groupAction('openGroup', 'Drame', { target: 'movies' }), 'openGroup:[{"target":"movies","value":"Drame"}]');
    assert.equal(groupAction('openGroup', null), 'openGroup:[{"value":null}]');
  });

  it('une rangée vide n’est pas affichée ; l’accueil est vide sans horloge ni rangée remplie', () => {
    const empty: HomeSection[] = [
      { kind: 'bars', id: 'bars', bars: [] },
      { kind: 'sites', id: 'sites', heading: 'Sites', sites: [] },
      { kind: 'elements', id: 'recent', heading: 'Reprendre', action: 'resume', variant: 'poster', elements: [] },
      { kind: 'groups', id: 'page:movies', heading: 'Films', target: 'movies', variant: 'poster', groups: [] },
    ];
    assert.ok(empty.every((s) => !sectionHasContent(s)));
    assert.equal(homeIsEmpty(false, empty), true);
    assert.equal(homeIsEmpty(true, empty), false);
    const bars: HomeSection = { kind: 'bars', id: 'bars', bars: [{ target: 'music', label: 'Musique', meta: '', color: 'var(--bar-cyan)' }] };
    assert.equal(homeIsEmpty(false, [...empty, bars]), false);
  });
});
