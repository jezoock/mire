'use strict';

function parseM3U(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
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

function qualityOf(label, url) {
  const s = `${label} ${url}`.toLowerCase();
  if (/flavour=hd|\b(hd|fhd|uhd|4k)\b/.test(s)) return 'hd';
  if (/flavour=ld|bas d[ée]bit|\bld\b/.test(s)) return 'ld';
  if (/flavour=sd|\bsd\b|standard/.test(s)) return 'sd';
  return 'other';
}

function groupChannels(entries) {
  const map = new Map();
  for (const e of entries) {
    let num = e.chno;
    let name = e.title || e.url;
    const m = /^(\d+)\s*[-.]\s*(.+)$/.exec(name);
    if (m) {
      num = num || m[1];
      name = m[2];
    }
    let label = '';
    const v = /\s*\(([^)]*)\)\s*$/.exec(name);
    if (v) {
      label = v[1].trim();
      name = name.slice(0, v.index).trim();
    }
    const key = `${num || ''}|${name.toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, { number: num ? Number.parseInt(num, 10) : null, name, logo: e.logo, group: e.group, variants: [] });
    }
    map.get(key).variants.push({ label, url: e.url, q: qualityOf(label, e.url) });
  }
  return [...map.values()].sort((a, b) => {
    if (a.number != null && b.number != null) return a.number - b.number;
    if (a.number != null) return -1;
    if (b.number != null) return 1;
    return a.name.localeCompare(b.name, 'fr');
  });
}

module.exports = { parseM3U, qualityOf, groupChannels };
