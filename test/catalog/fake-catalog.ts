// Générateur de catalogue factice (P2-04) : une bibliothèque réaliste (séries avec saisons et épisodes, films, albums,
// photos, et quelques flux M3U sans extension) pour les tests et les mesures du moteur de tags. Déterministe.
import type { ElementSourceRef } from '@mire/shared';
import { localFileKey, m3uEntryKey } from '../../src/main/catalog/keys.ts';
import type { Contributor } from '../../src/main/catalog/tags/engine.ts';
import type { ElementInput } from '../../src/main/catalog/types.ts';

export interface FakeSource {
  source: ElementSourceRef;
  elements: ElementInput[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `n` éléments répartis en cinq emplacements : 40 % d'épisodes, 20 % de films, 30 % de morceaux, ~10 % de photos. */
export function fakeCatalog(n: number, root = '/bib'): FakeSource[] {
  const at = (folder: string): FakeSource => ({ source: { plugin: 'src-local', instance: `${root}/${folder}` }, elements: [] });
  const series = at('Séries');
  const films = at('Films');
  const music = at('Musique');
  const photos = at('Photos');
  const tv: FakeSource = { source: { plugin: 'src-m3u', instance: 'http://box/liste.m3u' }, elements: [] };
  const file = (src: FakeSource, rel: string, name: string, folder: string) => {
    const p = `${src.source.instance}/${rel}`;
    src.elements.push({ key: localFileKey(p, 'linux'), name, open: { kind: 'file', path: p }, tags: ['local'], infos: { folder }, images: {} });
  };
  for (let i = 0; i < n; i++) {
    const slot = i % 10;
    if (slot < 4) {
      const show = `Série ${i % 97}`;
      const season = 1 + (i % 7);
      const name = `${show} S${pad(season)}E${pad(1 + (Math.floor(i / 10) % 24))} (${i})`;
      file(series, `${show}/Saison ${season}/${name}.mkv`, name, `Saison ${season}`);
    } else if (slot < 6) {
      const name = `Film ${i} (${1950 + (i % 75)})`;
      file(films, `${name}.mp4`, name, 'Films');
    } else if (slot < 9) {
      const album = `Album ${i % 211}`;
      const name = `${pad(1 + (i % 15))} - Morceau ${i}`;
      file(music, `Artiste ${i % 53}/${album}/${name}.mp3`, name, album);
    } else if (i % 50 === 9) {
      const url = `http://box/stream?id=${i}`;
      tv.elements.push({
        key: m3uEntryKey(tv.source.instance, url, 'linux'),
        name: `Chaîne ${i}`,
        open: { kind: 'stream', url },
        tags: ['remote'],
        infos: { playlist: 'liste', mediaType: 'video' },
        images: {},
      });
    } else file(photos, `2024/IMG_${i}.jpg`, `IMG_${i}`, '2024');
  }
  return [series, films, music, photos, tv];
}

/** Tags automatiques factices (en attendant P2-05) : `series`, saison et épisode d'après « S01E02 », `movie` sinon. */
export const fakeTagger: Contributor = {
  id: 'fake-tagger',
  origin: 'tagger',
  compute(e) {
    const m = /^(.*) S(\d{2})E(\d{2})/.exec(e.name);
    if (m) return { tags: ['series'], infos: { series: m[1], season: Number(m[2]), episode: Number(m[3]) } };
    return e.open.kind === 'file' && e.open.path.endsWith('.mp4') ? { tags: ['movie'] } : null;
  },
};
