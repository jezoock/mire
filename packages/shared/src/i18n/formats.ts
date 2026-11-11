/** Formats propres à une langue, tous par `Intl` : dates, heures, nombres, tailles, durées, tri. */
import type { I18n } from './types.ts';

type Formats = Pick<I18n, 'formatDate' | 'formatTime' | 'formatNumber' | 'formatSize' | 'formatDuration' | 'compare'>;

const SIZE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

export function createFormats(locale: string): Formats {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const unit = (name: string, display: 'long' | 'short', maximumFractionDigits = 0) =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: display, maximumFractionDigits });

  const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options).format(value);

  // Octets en toutes lettres (« 512 octets », « 512 bytes ») ; au-delà, unités abrégées avec une décimale.
  function formatSize(bytes: number): string {
    const n = Math.max(0, Number(bytes) || 0);
    const k = n < 1 ? 0 : Math.min(SIZE_UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    if (k === 0) return unit('byte', 'long').format(n);
    return unit(SIZE_UNITS[k], 'short', k > 1 ? 1 : 0).format(n / 1024 ** k);
  }

  // Heures et minutes, ou minutes et secondes sous l'heure ; les unités nulles sont omises.
  function formatDuration(seconds: number): string {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts: [string, number][] = h
      ? [
          ['hour', h],
          ['minute', m],
        ]
      : [
          ['minute', m],
          ['second', s],
        ];
    const shown = parts.filter(([, v]) => v > 0).map(([name, v]) => unit(name, 'short').format(v));
    if (!shown.length) return unit('second', 'short').format(0);
    return new Intl.ListFormat(locale, { type: 'unit', style: 'narrow' }).format(shown);
  }

  return {
    formatDate: (date, options = { day: 'numeric', month: 'long', year: 'numeric' }) => new Intl.DateTimeFormat(locale, options).format(date),
    formatTime: (date, options = { hour: '2-digit', minute: '2-digit' }) => new Intl.DateTimeFormat(locale, options).format(date),
    formatNumber,
    formatSize,
    formatDuration,
    compare: collator.compare,
  };
}
