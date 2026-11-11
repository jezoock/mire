/**
 * Service d'archives : décompresse un `.zip` ou un `.7z` avec le 7za livré par `7zip-bin`.
 * Utilisé par la boutique (émulateurs, cœurs RetroArch) et par les téléchargements.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface ArchiveOptions {
  /** Programme 7za livré avec Mire (hors de `app.asar` dans une application empaquetée). */
  sevenZipPath: string;
  /** Copie exécutable de 7za, faite si le programme livré ne peut pas être rendu exécutable. */
  copyPath: string;
  platform?: NodeJS.Platform;
}

export interface Archive {
  extract(archive: string, dest: string): Promise<void>;
}

export function createArchive({ sevenZipPath, copyPath, platform = process.platform }: ArchiveOptions): Archive {
  let sevenZip: string | null = null;

  // 7za doit être exécutable ; dans une application empaquetée, on en fait une copie si besoin.
  async function seven(): Promise<string> {
    if (sevenZip) return sevenZip;
    let bin = sevenZipPath;
    if (platform !== 'win32') {
      try {
        await fsp.chmod(bin, 0o755);
      } catch {
        await fsp.mkdir(path.dirname(copyPath), { recursive: true });
        await fsp.copyFile(bin, copyPath);
        await fsp.chmod(copyPath, 0o755);
        bin = copyPath;
      }
    }
    sevenZip = bin;
    return bin;
  }

  async function extract(archive: string, dest: string): Promise<void> {
    const bin = await seven();
    await fsp.mkdir(dest, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const p = spawn(bin, ['x', '-y', `-o${dest}`, archive], { stdio: 'ignore', windowsHide: true });
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Extraction impossible (code ${code}).`))));
    });
  }

  return { extract };
}
