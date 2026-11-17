/**
 * Écriture des versions et des plages de versions (semver), vérifiée sans dépendance (D-03). Le validateur s'en
 * sert pour `version`, `engines.mire` et `dependencies` ; dire si une version satisfait une plage revient à l'hôte
 * de plugins (P3-03).
 */

const NUM = '(?:0|[1-9]\\d*)';
const IDENT = '[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*';
const VERSION_RE = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}(?:-${IDENT})?(?:\\+${IDENT})?$`);

const PART = `(?:${NUM}|[xX*])`;
// Comparateur : opérateur facultatif, puis une version éventuellement partielle (`1`, `1.2`, `1.x`) ou joker.
const COMPARATOR_RE = new RegExp(`^(?:\\^|~|>=|<=|>|<|=)?v?${PART}(?:\\.${PART}){0,2}(?:-${IDENT})?$`);

/** Version exacte : `1.2.0`, `2.0.0-beta.1`. */
export const isVersion = (v: unknown): v is string => typeof v === 'string' && v.length <= 64 && VERSION_RE.test(v);

/**
 * Plage de versions : comparateurs séparés par des espaces (tous doivent convenir), alternatives séparées par `||`.
 * `^1.0.0`, `~1.2`, `>=1.0.0 <2.0.0`, `1.x || 2.x`, `*`.
 */
export function isVersionRange(v: unknown): v is string {
  if (typeof v !== 'string' || !v.trim() || v.length > 256) return false;
  return v.split('||').every((alt) => {
    const parts = alt.trim().split(/\s+/);
    return parts[0] !== '' && parts.every((p) => COMPARATOR_RE.test(p));
  });
}
