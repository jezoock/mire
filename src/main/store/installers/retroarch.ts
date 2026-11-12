/**
 * RetroArch : le programme vient du buildbot de libretro (version de la dernière publication GitHub), puis un
 * cœur par console choisie (dernière compilation nocturne). Le programme déjà installé est réutilisé.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { RETROARCH_SYSTEMS, type InstallPlatform, type StoreEmulator } from '../catalog/index.ts';
import { download, findFile, type InstallContext } from './files.ts';
import { githubLatest } from './github-release.ts';
import { t } from '../../i18n/current.ts';

const BUILDBOT = 'https://buildbot.libretro.com';

/** Dossier du buildbot pour la plateforme. */
const buildbotDir = (platform: InstallPlatform) => (platform === 'win32' ? 'windows/x86_64' : 'linux/x86_64');

/** Extension des cœurs pour la plateforme. */
export const coreExt = (platform: InstallPlatform) => (platform === 'win32' ? 'dll' : 'so');

export const retroarchUrl = (version: string, platform: InstallPlatform) => `${BUILDBOT}/stable/${version}/${buildbotDir(platform)}/RetroArch.7z`;

export const coreUrl = (core: string, platform: InstallPlatform) =>
  `${BUILDBOT}/nightly/${buildbotDir(platform)}/latest/${core}_libretro.${coreExt(platform)}.zip`;

async function installProgram(ctx: InstallContext, emu: StoreEmulator, dir: string): Promise<string> {
  const { tag } = await githubLatest('libretro/RetroArch');
  const version = tag.replace(/^v/, '');
  const file = path.join(ctx.tmpRoot, `RetroArch-${version}.7z`);
  const label = `RetroArch ${version}`;
  ctx.progress(emu.id, 'download', { label });
  await download(retroarchUrl(version, ctx.platform), file, (received, total) => ctx.progress(emu.id, 'download', { label, received, total }));
  ctx.progress(emu.id, 'extract', { label: t('store.progress.extractingRetroarch') });
  await ctx.extract(file, dir);
  await fsp.unlink(file).catch(() => {});
  const pattern = emu.exe[ctx.platform];
  const exe = pattern ? await findFile(dir, pattern) : null;
  if (!exe) throw new Error(t('store.errors.retroarchNotFound'));
  if (ctx.platform !== 'win32') await fsp.chmod(exe, 0o755);
  ctx.meta.retroarch = { version, exe, systems: [], at: Date.now() };
  return exe;
}

export async function installRetroArch(ctx: InstallContext, emu: StoreEmulator, systemIds: string[]): Promise<void> {
  const dir = path.join(ctx.emuRoot, 'retroarch');
  const known = ctx.meta.retroarch?.exe;
  const exe = known && fs.existsSync(known) ? known : await installProgram(ctx, emu, dir);
  const coresDir = path.join(dir, 'cores');
  const ext = coreExt(ctx.platform);
  const systems = RETROARCH_SYSTEMS.filter((s) => systemIds.includes(s.id));
  for (const core of [...new Set(systems.map((s) => s.core))]) {
    const coreFile = path.join(coresDir, `${core}_libretro.${ext}`);
    if (fs.existsSync(coreFile)) continue;
    const zip = path.join(ctx.tmpRoot, `${core}.zip`);
    const label = t('store.progress.core', { core: String(core) });
    ctx.progress(emu.id, 'download', { label });
    await download(coreUrl(String(core), ctx.platform), zip, (received, total) => ctx.progress(emu.id, 'download', { label, received, total }));
    await ctx.extract(zip, coresDir);
    await fsp.unlink(zip).catch(() => {});
  }
  ctx.registerConsoles(emu, systems, exe, (sys) => ['-f', '-L', path.join(coresDir, `${sys.core}_libretro.${ext}`), '{rom}']);
  ctx.meta.retroarch.systems = [...new Set([...(ctx.meta.retroarch.systems || []), ...systemIds])];
}
