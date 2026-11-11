/** Valeurs des variables d'une ligne de commande ; une valeur vide ou absente retire l'argument. */
export type ArgVars = Record<string, string | number | null | undefined>;

// Remplace {rom}, {url}, {title}, {start}. Un argument dont la variable est vide est retiré.
export function substitute(args: readonly unknown[] | null | undefined, vars: ArgVars): string[] {
  const out: string[] = [];
  for (const a of args || []) {
    const s = String(a);
    let drop = false;
    const v = s.replace(/\{(\w+)\}/g, (m, k: string) => {
      if (!(k in vars)) return m;
      const val = vars[k];
      if (val === '' || val == null) drop = true;
      return String(val ?? '');
    });
    if (!drop) out.push(v);
  }
  return out;
}
