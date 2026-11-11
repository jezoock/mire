/** Accès réseau des fournisseurs : délais et messages habituels de la récupération d'infos, copie des images. */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as http from '../net/http.ts';
import type { ScrapeIo } from './types.ts';

/** Un code d'erreur garde le message habituel de la récupération (« api.themoviedb.org : code 500 »). */
export function scrapeError(err: unknown): unknown {
  if (err instanceof http.HttpError && err.kind === 'status') return new Error(`${err.host} : code ${err.status}`, { cause: err });
  return err;
}

const imageExt = (type: string) => (type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg');

export function createScrapeIo({ imgDir, fetch }: { imgDir: string; fetch?: http.FetchLike }): ScrapeIo {
  return {
    fetch,
    async getJson(url, headers = {}) {
      try {
        return await http.getJson(url, { headers, timeout: 12000, notFoundAsNull: true, fetch });
      } catch (err) {
        throw scrapeError(err);
      }
    },
    async getText(url) {
      try {
        return await http.getText(url, { timeout: 15000, fetch });
      } catch (err) {
        if (err instanceof http.HttpError && err.kind === 'status') return null;
        throw err;
      }
    },
    async saveImage(url, key) {
      const res = await http.request(url, { timeout: 20000, fetch });
      if (!res.ok) return null;
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) return null;
      const file = path.join(imgDir, crypto.createHash('sha1').update(key).digest('hex') + imageExt(type));
      await fsp.writeFile(file, Buffer.from(await res.arrayBuffer()));
      return file;
    },
  };
}
