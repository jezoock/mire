/**
 * Lecture d'une liste M3U (reprise de `parseM3U` du cœur de Mire, `src/main/tv/channels.ts`) : une entrée par ligne
 * qui n'est pas un commentaire, avec le titre, le logo, le groupe et le numéro de chaîne de la ligne `#EXTINF` qui la
 * précède.
 */
export function parseM3U(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      // Le titre suit la première virgule hors guillemets.
      let inQuotes = false;
      let comma = -1;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') inQuotes = !inQuotes;
        else if (line[i] === ',' && !inQuotes) {
          comma = i;
          break;
        }
      }
      const head = comma >= 0 ? line.slice(0, comma) : line;
      const attrs = {};
      head.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => {
        attrs[k.toLowerCase()] = v;
        return '';
      });
      cur = {
        title: comma >= 0 ? line.slice(comma + 1).trim() : '',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
        chno: attrs['tvg-chno'] || '',
      };
    } else if (!line.startsWith('#')) {
      if (cur) {
        out.push({ ...cur, url: line });
        cur = null;
      } else out.push({ title: line, url: line, logo: '', group: '', chno: '' });
    }
  }
  return out;
}
