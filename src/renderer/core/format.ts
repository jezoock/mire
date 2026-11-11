/** Mise en forme des durées, tailles et quantités affichées. */

/** Accorde le mot avec le nombre : `plural(3, 'film')` → « 3 films ». */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n > 1 ? many : one}`;

/** Ramène `v` entre `lo` et `hi`. */
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Position de lecture : « 3:07 », « 1:02:09 » ; une valeur invalide ou négative donne « 0:00 ». */
export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Taille d'un téléchargement, en multiples de 1024 : « 1,5 Mo ». */
export const fmtBytes = (n: number): string => {
  if (!n) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const k = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** k).toLocaleString('fr-FR', { maximumFractionDigits: k > 1 ? 1 : 0 })} ${u[k]}`;
};

/** Temps restant d'un téléchargement (en millisecondes) : « 12 min », « 1 h 05 ». */
export const fmtEta = (ms: number): string => {
  if (!ms || !Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  return m < 1 ? 'moins d’une minute' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

/** Taille d'un jeu de la boutique, en multiples de 1000 : « 750 Mo », « 2,4 Go » ; vide si inconnue. */
export function fmtSize(n: number): string {
  if (!n) return '';
  if (n > 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} Go`;
  return `${Math.round(n / 1e6)} Mo`;
}
