/** Émulateur autonome : dernière version (GitHub ou page de téléchargement), extraction, consoles. */
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { InstallPlatform, StoreEmulator } from '../catalog/index.ts';
import { resolveFromPage } from './download-page.ts';
import { download, findFile, type InstallContext, type ResolvedSource } from './files.ts';
import { githubLatest } from './github-release.ts';
import { t } from '../../i18n/current.ts';

export async function resolveSource(emu: StoreEmulator, platform: InstallPlatform): Promise<ResolvedSource> {
  const src = emu.source;
  const pattern = src?.[platform];
  if (!src || !pattern) throw new Error(t('store.errors.notForThisSystem', { name: emu.name }));
  if ('github' in src) {
    const { tag, assets } = await githubLatest(src.github);
    const asset = assets.find((a) => pattern.test(a.name));
    if (!asset) throw new Error(t('store.errors.assetNotFound', { name: emu.name, version: tag }));
    return { url: asset.url, name: asset.name, version: tag };
  }
  if ('page' in src) return resolveFromPage(src.page, pattern, emu.name, emu.site);
  throw new Error(t('store.errors.unknownSource'));
}

export async function installStandalone(ctx: InstallContext, emu: StoreEmulator): Promise<void> {
  const dir = path.join(ctx.emuRoot, emu.id);
  ctx.progress(emu.id, 'resolve', { label: t('store.progress.latestVersion') });
  const src = await resolveSource(emu, ctx.platform);
  const file = path.join(ctx.tmpRoot, src.name);
  const label = `${emu.name} ${src.version}`;
  ctx.progress(emu.id, 'download', { label });
  await download(src.url, file, (received, total) => ctx.progress(emu.id, 'download', { label, received, total }));
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  if (/\.(zip|7z)$/i.test(src.name)) {
    ctx.progress(emu.id, 'extract', { label: t('store.progress.extracting') });
    await ctx.extract(file, dir);
    await fsp.unlink(file).catch(() => {});
  } else {
    await fsp.rename(file, path.join(dir, src.name)).catch(async () => {
      await fsp.copyFile(file, path.join(dir, src.name));
      await fsp.unlink(file);
    });
  }
  const pattern = emu.exe[ctx.platform];
  const exe = pattern ? await findFile(dir, pattern) : null;
  if (!exe) throw new Error(t('store.errors.programNotFound', { name: emu.name }));
  if (ctx.platform !== 'win32') await fsp.chmod(exe, 0o755);
  ctx.registerConsoles(emu, emu.systems, exe, () => emu.args || []);
  ctx.meta[emu.id] = { version: src.version, exe, at: Date.now() };
}
