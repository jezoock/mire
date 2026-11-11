// Contexte de fournisseur pour les tests : dossier temporaire, faux fetch, configuration du scénario.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScrapeIo } from '../../src/main/scrape/io.ts';
import type { JobContext, ScrapeConfig } from '../../src/main/scrape/types.ts';
import { fakeFetch, type Routes } from './fake-fetch.ts';
import { config, listRoms } from './scenario.ts';

export function providerContext(t: { after: (fn: () => void) => void }, routes: Routes, cfg: Partial<ScrapeConfig> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-scrape-fournisseur-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const imgDir = path.join(dir, 'img');
  const cacheDir = path.join(dir, 'cache');
  fs.mkdirSync(imgDir);
  fs.mkdirSync(cacheDir);
  const fetch = fakeFetch(routes);
  const state = { cancel: false };
  const ctx = (key = 'k'): JobContext => ({
    key,
    getConfig: () => ({ ...config, ...cfg }) as ScrapeConfig,
    listRoms: listRoms as never,
    cacheDir,
    io: createScrapeIo({ imgDir, fetch }),
    cancelled: () => state.cancel,
  });
  return { ctx, fetch, state, imgDir, cacheDir };
}

/** Adresse d'origine d'une image copiée par le faux fetch. */
export const imageSource = (file: string | null | undefined) => (file ? fs.readFileSync(file, 'utf8').replace(/^image:/, '') : null);
