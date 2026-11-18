/**
 * Comparaison de versions et plages semver (`engines.mire`, plus tard `dependencies`), écrite à la main (D-03). Le
 * SDK vérifie l'écriture des plages (`isVersionRange`) ; ici on dit si une version y entre. Règles de npm reprises :
 * `^`, `~`, comparateurs, versions partielles et jokers (`1.x`, `*`), alternatives `||`, et une version de
 * pré-publication (`2.0.0-beta.1`) n'entre dans une plage que si un comparateur porte le même trio de nombres.
 */
// Sources du SDK plutôt que son paquet : son dist/ n'est construit que pour son archive (les tests lisent les sources).
import { isVersion, isVersionRange } from '../../../packages/plugin-sdk/src/semver.ts';

export interface Version {
  major: number;
  minor: number;
  patch: number;
  pre: (string | number)[];
}

/** Version exacte lue (`1.2.3-beta.1+build` ; la partie `+…` est ignorée), ou `null`. */
export function parseVersion(v: string): Version | null {
  if (!isVersion(v)) return null;
  const [core, pre = ''] = v.split('+')[0].split(/-(.*)/s);
  const [major, minor, patch] = core.split('.').map(Number);
  return { major, minor, patch, pre: pre ? pre.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [] };
}

function comparePre(a: Version['pre'], b: Version['pre']): number {
  // Une version sans pré-publication passe après la même avec (1.0.0-beta < 1.0.0).
  if (!a.length || !b.length) return b.length - a.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] === b[i]) continue;
    const na = typeof a[i] === 'number';
    const nb = typeof b[i] === 'number';
    if (na && nb) return (a[i] as number) - (b[i] as number);
    if (na !== nb) return na ? -1 : 1;
    return String(a[i]) < String(b[i]) ? -1 : 1;
  }
  return 0;
}

/** Ordre de deux versions : négatif, nul ou positif. */
export function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || comparePre(a.pre, b.pre);
}

type Op = '<' | '<=' | '>' | '>=' | '=';
interface Comparator {
  op: Op;
  v: Version;
}

const WILD = /^[xX*]$/;
const v3 = (major: number, minor: number, patch: number, pre: Version['pre'] = []): Version => ({ major, minor, patch, pre });

/** Un comparateur écrit (`^1.2`, `>=1.0.0`, `1.x`) ramené à des bornes simples. */
function expand(text: string): Comparator[] {
  const m = /^(\^|~|>=|<=|>|<|=)?v?(.*)$/.exec(text)!;
  const op = m[1] ?? '';
  const [body, preText = ''] = m[2].split(/-(.*)/s);
  const parts = body.split('.');
  const nums = parts.map((p) => (WILD.test(p) ? null : Number(p)));
  // Nombre de parties précises avant le premier joker.
  let n = nums.findIndex((x) => x === null);
  if (n === -1) n = nums.length;
  const [M = 0, m2 = 0, p = 0] = nums.map((x) => x ?? 0);
  const pre = preText ? preText.split('.').map((x) => (/^\d+$/.test(x) ? Number(x) : x)) : [];
  const low = v3(M, m2, p, n === 3 ? pre : []);
  if (n === 0) return op === '<' || op === '>' ? [{ op: '<', v: v3(0, 0, 0, [0]) }] : [];
  const bump = (k: number): Version => (k === 1 ? v3(M + 1, 0, 0, [0]) : k === 2 ? v3(M, m2 + 1, 0, [0]) : v3(M, m2, p + 1, [0]));
  switch (op) {
    case '^': {
      // ^1.2.3 → <2.0.0 ; ^0.2.3 → <0.3.0 ; ^0.0.3 → <0.0.4 ; ^0.x → <1.0.0.
      const k = M !== 0 || n === 1 ? 1 : m2 !== 0 || n === 2 ? 2 : 3;
      return [
        { op: '>=', v: low },
        { op: '<', v: bump(k) },
      ];
    }
    case '~':
      return [
        { op: '>=', v: low },
        { op: '<', v: bump(n === 1 ? 1 : 2) },
      ];
    case '>':
      return n === 3 ? [{ op: '>', v: low }] : [{ op: '>=', v: { ...bump(n), pre: [] } }];
    case '<=':
      return n === 3 ? [{ op: '<=', v: low }] : [{ op: '<', v: bump(n) }];
    case '>=':
    case '<':
      return [{ op, v: low }];
    default:
      return n === 3
        ? [{ op: '=', v: low }]
        : [
            { op: '>=', v: low },
            { op: '<', v: bump(n) },
          ];
  }
}

function test(c: Comparator, v: Version): boolean {
  const d = compareVersions(v, c.v);
  switch (c.op) {
    case '<':
      return d < 0;
    case '<=':
      return d <= 0;
    case '>':
      return d > 0;
    case '>=':
      return d >= 0;
    default:
      return d === 0;
  }
}

const sameTrio = (a: Version, b: Version) => a.major === b.major && a.minor === b.minor && a.patch === b.patch;

/** Vrai si `version` entre dans `range`. Une version ou une plage mal écrite ne satisfait rien. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v || !isVersionRange(range)) return false;
  return range.split('||').some((alt) => {
    const set = alt.trim().split(/\s+/).flatMap(expand);
    if (!set.every((c) => test(c, v))) return false;
    // Pré-publication : seulement si un comparateur en donne une sur le même trio (règle de npm). Les bornes
    // hautes ajoutées par `expand` (`[0]`) ne comptent pas.
    if (!v.pre.length) return true;
    return set.some((c) => c.v.pre.length && !(c.v.pre.length === 1 && c.v.pre[0] === 0) && sameTrio(c.v, v));
  });
}
