/** Récupération d'infos (scraping). */
import type { MainContext } from '../context.ts';
import type { IpcImplementations } from '../register.ts';

export function scrapeHandlers(ctx: MainContext) {
  return {
    scrapeData: () => ctx.scraper.data(),
    scrapeRun: (opts) => ctx.scraper.run(opts || {}),
    scrapeOne: (job) => ctx.scraper.one(job || {}),
    scrapeCandidates: (job) => ctx.scraper.candidates(job || {}),
    scrapeCancel: () => ctx.scraper.cancel(),
    scrapeForget: (key) => ctx.scraper.forget(key),
    scrapeClear: () => ctx.scraper.clear(),
  } satisfies Partial<IpcImplementations>;
}
