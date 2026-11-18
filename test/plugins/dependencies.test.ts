// Dépendances entre plugins (P3-05, D-19) : vérification des plugins présents, résolution d'une installation
// (versions compatibles, conflits, cycles, dépendance introuvable), plugins qui en ont besoin d'un autre.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkPresent, dependentsOf, resolveInstall, type DependencyNode } from '../../src/main/plugins/dependencies.ts';

const node = (id: string, version: string, dependencies: Record<string, string> = {}): DependencyNode => ({ id, version, dependencies });

/** Dépôt fictif : toutes les versions connues de chaque plugin. */
function repo(...nodes: DependencyNode[]) {
  return (id: string) => nodes.filter((n) => n.id === id);
}
const ids = (r: ReturnType<typeof resolveInstall>) => (r.ok ? r.order.map((n) => `${n.id}@${n.version}`) : r.problem);

describe('checkPresent (démarrage)', () => {
  it('rend les plugins dans l’ordre d’activation : dépendances d’abord', () => {
    const r = checkPresent([node('c', '1.0.0', { b: '^1.0.0' }), node('b', '1.2.0', { a: '~1.0.0' }), node('a', '1.0.3'), node('z', '1.0.0')]);
    assert.deepEqual(r.order, ['a', 'b', 'c', 'z']);
    assert.equal(r.problems.size, 0);
  });

  it('refuse une dépendance absente ou dans une version qui ne convient pas, et de proche en proche', () => {
    const r = checkPresent([node('a', '1.0.0'), node('b', '1.0.0', { a: '^2.0.0' }), node('c', '1.0.0', { b: '*' }), node('d', '1.0.0', { x: '*' })]);
    assert.deepEqual(r.order, ['a']);
    assert.deepEqual(r.problems.get('b'), { code: 'missing', id: 'b', dependency: 'a', range: '^2.0.0' });
    assert.deepEqual(r.problems.get('c'), { code: 'refused', id: 'c', dependency: 'b' });
    assert.deepEqual(r.problems.get('d'), { code: 'missing', id: 'd', dependency: 'x', range: '*' });
  });

  it('refuse un plugin qui dépend d’un plugin refusé pour une autre raison', () => {
    const r = checkPresent([node('a', '1.0.0'), node('b', '1.0.0', { a: '*' })], new Set(['a']));
    assert.deepEqual(r.order, []);
    assert.deepEqual(r.problems.get('b'), { code: 'refused', id: 'b', dependency: 'a' });
  });

  it('refuse une dépendance circulaire, et ce qui en dépend', () => {
    const r = checkPresent([node('a', '1.0.0', { b: '*' }), node('b', '1.0.0', { a: '*' }), node('c', '1.0.0', { a: '*' }), node('d', '1.0.0')]);
    assert.deepEqual(r.order, ['d']);
    assert.deepEqual(r.problems.get('a'), { code: 'cycle', cycle: ['a', 'b', 'a'] });
    assert.deepEqual(r.problems.get('b'), { code: 'cycle', cycle: ['a', 'b', 'a'] });
    assert.deepEqual(r.problems.get('c'), { code: 'refused', id: 'c', dependency: 'a' });
  });

  it('refuse un plugin qui dépend de lui-même', () => {
    const r = checkPresent([node('a', '1.0.0', { a: '*' })]);
    assert.deepEqual(r.problems.get('a'), { code: 'cycle', cycle: ['a', 'a'] });
  });
});

describe('resolveInstall (installation)', () => {
  it('choisit la plus haute version compatible et installe dans l’ordre', () => {
    const available = repo(
      node('pack', '1.0.0', { m3u: '^1.2.0', epg: '~2.1.0' }),
      node('m3u', '1.1.0'),
      node('m3u', '1.4.2'),
      node('m3u', '2.0.0'),
      node('epg', '2.1.5', { m3u: '>=1.3.0' }),
      node('epg', '2.2.0'),
    );
    assert.deepEqual(ids(resolveInstall('pack', '*', { available })), ['m3u@1.4.2', 'epg@2.1.5', 'pack@1.0.0']);
  });

  it('garde la version installée si elle convient, la remplace sinon', () => {
    const available = repo(node('a', '1.0.0', { b: '^1.0.0' }), node('b', '1.1.0'), node('b', '1.5.0'), node('c', '1.0.0', { b: '>=1.3.0' }));
    assert.deepEqual(ids(resolveInstall('a', '*', { available, installed: (id) => (id === 'b' ? '1.1.0' : null) })), ['b@1.1.0', 'a@1.0.0']);
    assert.deepEqual(ids(resolveInstall('c', '*', { available, installed: (id) => (id === 'b' ? '1.1.0' : null) })), ['b@1.5.0', 'c@1.0.0']);
  });

  it('reprend un choix écarté par une demande plus tardive', () => {
    // a demande b (^1) et c ; c demande b >=1.2 <1.4 : b 1.9.0, d'abord choisi, est remplacé par 1.3.0.
    const available = repo(
      node('a', '1.0.0', { b: '^1.0.0', c: '*' }),
      node('b', '1.3.0'),
      node('b', '1.9.0', { x: '*' }),
      node('c', '1.0.0', { b: '>=1.2.0 <1.4.0' }),
    );
    assert.deepEqual(ids(resolveInstall('a', '*', { available })), ['b@1.3.0', 'c@1.0.0', 'a@1.0.0']);
  });

  it('refuse des demandes qui se contredisent (conflit)', () => {
    const available = repo(node('a', '1.0.0', { b: '^1.0.0', c: '*' }), node('b', '1.0.0'), node('b', '2.0.0'), node('c', '1.0.0', { b: '^2.0.0' }));
    const r = resolveInstall('a', '*', { available });
    assert.equal(r.ok, false);
    assert.deepEqual(!r.ok && r.problem, {
      code: 'conflict',
      dependency: 'b',
      requirements: [
        { by: 'a', range: '^1.0.0' },
        { by: 'c', range: '^2.0.0' },
      ],
    });
  });

  it('refuse une dépendance introuvable, ou sans version compatible', () => {
    const absent = resolveInstall('a', '*', { available: repo(node('a', '1.0.0', { x: '^1.0.0' })) });
    assert.deepEqual(!absent.ok && absent.problem, { code: 'missing', id: 'a', dependency: 'x', range: '^1.0.0' });
    const tooOld = resolveInstall('a', '*', { available: repo(node('a', '1.0.0', { x: '^2.0.0' }), node('x', '1.0.0')) });
    assert.deepEqual(!tooOld.ok && tooOld.problem, { code: 'missing', id: 'a', dependency: 'x', range: '^2.0.0' });
    const self = resolveInstall('a', '^3.0.0', { available: repo(node('a', '1.0.0')) });
    assert.deepEqual(!self.ok && self.problem, { code: 'missing', id: null, dependency: 'a', range: '^3.0.0' });
  });

  it('refuse une dépendance circulaire', () => {
    const r = resolveInstall('a', '*', {
      available: repo(node('a', '1.0.0', { b: '*' }), node('b', '1.0.0', { c: '*' }), node('c', '1.0.0', { a: '^1.0.0' })),
    });
    assert.deepEqual(!r.ok && r.problem, { code: 'cycle', cycle: ['a', 'b', 'c', 'a'] });
  });

  it('s’arrête au-delà du nombre de choix permis', () => {
    const available = repo(node('a', '1.0.0', { b: '*' }), node('b', '1.0.0', { c: '*' }), node('c', '1.0.0'));
    assert.equal(resolveInstall('a', '*', { available }).ok, true);
    assert.equal(resolveInstall('a', '*', { available, maxSteps: 2 }).ok, false);
  });
});

describe('dependentsOf (désinstallation)', () => {
  it('dit quels plugins ont besoin d’un autre', () => {
    const nodes = [node('m3u', '1.0.0'), node('freebox', '1.0.0', { m3u: '^1.0.0' }), node('orange', '1.0.0', { m3u: '*' }), node('autre', '1.0.0')];
    assert.deepEqual(dependentsOf('m3u', nodes), ['freebox', 'orange']);
    assert.deepEqual(dependentsOf('autre', nodes), []);
  });
});
