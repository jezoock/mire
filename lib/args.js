'use strict';

// Remplace {rom}, {url}, {title}, {start}. Un argument dont la variable est vide est retiré.
function substitute(args, vars) {
  const out = [];
  for (const a of args || []) {
    const s = String(a);
    let drop = false;
    const v = s.replace(/\{(\w+)\}/g, (m, k) => {
      if (!(k in vars)) return m;
      const val = vars[k];
      if (val === '' || val == null) drop = true;
      return String(val ?? '');
    });
    if (!drop) out.push(v);
  }
  return out;
}

const isUrlTarget = (t) => /^[a-z][\w+.-]*:\/\//i.test(t); // steam://, http://… (pas C:\)

module.exports = { substitute, isUrlTarget };
