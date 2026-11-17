// Gestion des fichiers (P2-10) : renommer, déplacer, mettre à la corbeille, seulement sous les dossiers locaux de la
// configuration. Refus : chemins hors des dossiers, `..`, liens symboliques qui en sortent, racines, écrasement, noms
// invalides ; sous Windows (casse, `\`, lecteurs) par un disque simulé.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFilesService, type FilesOps } from '../../src/main/files/service.ts';
import { managedRoots } from '../../src/main/files/roots.ts';
import { isValidName } from '../../src/main/files/guard.ts';

const POSIX = process.platform !== 'win32';

function setup() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mire-files-')));
  const films = path.join(base, 'films');
  const series = path.join(base, 'series');
  const outside = path.join(base, 'ailleurs');
  for (const d of [films, series, outside, path.join(films, 'Saga')]) fs.mkdirSync(d, { recursive: true });
  for (const f of [path.join(films, 'a.mkv'), path.join(films, 'b.mkv'), path.join(films, 'Saga', 'c.mkv'), path.join(outside, 'secret.txt')])
    fs.writeFileSync(f, 'x');
  const trashed: string[] = [];
  const events: string[] = [];
  const svc = createFilesService({
    roots: () => [films, series],
    ops: {
      trash: async (p) => {
        trashed.push(p);
        fs.rmSync(p, { recursive: true });
      },
    },
    follow: { moved: (from, to) => events.push(`moved ${from} -> ${to}`), removed: (p) => events.push(`removed ${p}`) },
  });
  return { base, films, series, outside, svc, trashed, events };
}

describe('gestion des fichiers : opérations permises', { skip: !POSIX }, () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => (s = setup()));

  it('renomme un fichier dans son dossier, et le catalogue suit', async () => {
    const from = path.join(s.films, 'a.mkv');
    const r = await s.svc.rename(from, 'Intouchables.mkv');
    assert.deepEqual(r, { ok: true, path: path.join(s.films, 'Intouchables.mkv') });
    assert.ok(fs.existsSync(path.join(s.films, 'Intouchables.mkv')));
    assert.deepEqual(s.events, [`moved ${from} -> ${path.join(s.films, 'Intouchables.mkv')}`]);
  });

  it('renomme un dossier', async () => {
    const r = await s.svc.rename(path.join(s.films, 'Saga'), 'Trilogie');
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(s.films, 'Trilogie', 'c.mkv')));
  });

  it("déplace un fichier vers un autre dossier autorisé, ou vers la racine d'un dossier", async () => {
    assert.deepEqual(await s.svc.move(path.join(s.films, 'a.mkv'), s.series), { ok: true, path: path.join(s.series, 'a.mkv') });
    assert.deepEqual(await s.svc.move(path.join(s.films, 'Saga', 'c.mkv'), s.films), { ok: true, path: path.join(s.films, 'c.mkv') });
  });

  it('met un fichier ou un dossier à la corbeille', async () => {
    assert.deepEqual(await s.svc.remove(path.join(s.films, 'Saga')), { ok: true, path: path.join(s.films, 'Saga') });
    assert.deepEqual(s.trashed, [path.join(s.films, 'Saga')]);
    assert.deepEqual(s.events, [`removed ${path.join(s.films, 'Saga')}`]);
  });

  it('un lien symbolique qui reste dans les dossiers est traité comme un fichier (sa cible ne bouge pas)', async () => {
    const link = path.join(s.films, 'lien.mkv');
    fs.symlinkSync(path.join(s.films, 'b.mkv'), link);
    assert.equal((await s.svc.rename(link, 'autre.mkv')).ok, true);
    assert.ok(fs.lstatSync(path.join(s.films, 'autre.mkv')).isSymbolicLink());
    assert.ok(fs.existsSync(path.join(s.films, 'b.mkv')));
  });
});

describe('gestion des fichiers : refus', { skip: !POSIX }, () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => (s = setup()));

  const refused = async (p: Promise<{ ok: boolean; code?: string }>, code: string) => {
    const r = await p;
    assert.equal(r.ok, false);
    assert.equal(r.code, code);
  };
  const untouched = (t: ReturnType<typeof setup>) => {
    assert.deepEqual(t.events, []);
    assert.deepEqual(t.trashed, []);
    assert.ok(fs.existsSync(path.join(t.outside, 'secret.txt')));
  };

  it('chemin hors des dossiers', async () => {
    const secret = path.join(s.outside, 'secret.txt');
    await refused(s.svc.rename(secret, 'x.txt'), 'outside');
    await refused(s.svc.move(secret, s.films), 'outside');
    await refused(s.svc.remove(secret), 'outside');
    await refused(s.svc.remove('/etc/passwd'), 'outside');
    untouched(s);
  });

  it('chemin relatif, vide, non texte, avec `..` (même resté dans les dossiers) ou un caractère nul', async () => {
    await refused(s.svc.remove('films/a.mkv'), 'invalid');
    await refused(s.svc.remove(''), 'invalid');
    await refused(s.svc.remove(42), 'invalid');
    await refused(s.svc.remove(`${s.films}/../ailleurs/secret.txt`), 'invalid');
    await refused(s.svc.remove(`${s.films}/Saga/../a.mkv`), 'invalid');
    await refused(s.svc.remove(`${s.films}/a.mkv\0`), 'invalid');
    await refused(s.svc.move(path.join(s.films, 'a.mkv'), `${s.films}/../ailleurs`), 'invalid');
    untouched(s);
  });

  it('partage réseau, même écrit sous une racine', async () => {
    await refused(s.svc.remove('//nas/films/a.mkv'), 'invalid');
    untouched(s);
  });

  it('lien symbolique (fichier) qui mène hors des dossiers', async () => {
    const link = path.join(s.films, 'piege.txt');
    fs.symlinkSync(path.join(s.outside, 'secret.txt'), link);
    await refused(s.svc.remove(link), 'link');
    await refused(s.svc.rename(link, 'x.txt'), 'link');
    await refused(s.svc.move(link, s.series), 'link');
    untouched(s);
  });

  it('dossier parent qui est un lien symbolique hors des dossiers', async () => {
    fs.symlinkSync(s.outside, path.join(s.films, 'raccourci'));
    await refused(s.svc.remove(path.join(s.films, 'raccourci', 'secret.txt')), 'link');
    await refused(s.svc.rename(path.join(s.films, 'raccourci', 'secret.txt'), 'x'), 'link');
    // Ni comme destination d'un déplacement.
    await refused(s.svc.move(path.join(s.films, 'a.mkv'), path.join(s.films, 'raccourci')), 'link');
    untouched(s);
    assert.ok(fs.existsSync(path.join(s.films, 'a.mkv')));
  });

  it('lien symbolique vers une racine elle-même', async () => {
    fs.symlinkSync(s.series, path.join(s.films, 'vers-series'));
    await refused(s.svc.remove(path.join(s.films, 'vers-series')), 'root');
  });

  it('une racine elle-même, et la racine du disque', async () => {
    await refused(s.svc.remove(s.films), 'root');
    await refused(s.svc.remove(`${s.films}/`), 'root');
    await refused(s.svc.rename(s.series, 'x'), 'root');
    await refused(s.svc.move(s.films, s.series), 'root');
    await refused(s.svc.remove('/'), 'root');
    assert.ok(fs.existsSync(s.films));
  });

  it('racine du disque dans la configuration : ignorée, rien ne devient modifiable', async () => {
    const svc = createFilesService({ roots: () => ['/', s.films], ops: { trash: async () => assert.fail('corbeille') } });
    assert.equal((await svc.remove(path.join(s.outside, 'secret.txt'))).ok, false);
  });

  it('destination hors des dossiers, absente, ou qui est un fichier', async () => {
    const a = path.join(s.films, 'a.mkv');
    await refused(s.svc.move(a, s.outside), 'outside');
    await refused(s.svc.move(a, '/tmp'), 'outside');
    await refused(s.svc.move(a, path.join(s.films, 'nulle-part')), 'missing');
    await refused(s.svc.move(a, path.join(s.films, 'b.mkv')), 'notFolder');
    assert.ok(fs.existsSync(a));
  });

  it("pas d'écrasement : renommage ou déplacement vers un nom qui existe déjà", async () => {
    await refused(s.svc.rename(path.join(s.films, 'a.mkv'), 'b.mkv'), 'exists');
    await refused(s.svc.rename(path.join(s.films, 'a.mkv'), 'a.mkv'), 'exists');
    fs.writeFileSync(path.join(s.series, 'a.mkv'), 'autre');
    await refused(s.svc.move(path.join(s.films, 'a.mkv'), s.series), 'exists');
    await refused(s.svc.move(path.join(s.films, 'a.mkv'), s.films), 'exists');
    assert.equal(fs.readFileSync(path.join(s.series, 'a.mkv'), 'utf8'), 'autre');
    assert.deepEqual(s.events, []);
  });

  it('un dossier ne se déplace pas dans lui-même ni dans ce qu’il contient', async () => {
    fs.mkdirSync(path.join(s.films, 'Saga', 'Bonus'));
    await refused(s.svc.move(path.join(s.films, 'Saga'), path.join(s.films, 'Saga')), 'into');
    await refused(s.svc.move(path.join(s.films, 'Saga'), path.join(s.films, 'Saga', 'Bonus')), 'into');
  });

  it('nouveau nom vide, `.`, `..` ou avec un séparateur', async () => {
    for (const name of ['', '   ', '.', '..', 'a/b', '../x', 'a\\b', 'x\0', 42]) await refused(s.svc.rename(path.join(s.films, 'a.mkv'), name), 'name');
    untouched(s);
  });

  it('fichier absent', async () => {
    await refused(s.svc.remove(path.join(s.films, 'absent.mkv')), 'missing');
  });

  it("échec de la corbeille : rien n'est annoncé au catalogue", async () => {
    const svc = createFilesService({
      roots: () => [s.films],
      ops: { trash: async () => Promise.reject(new Error('corbeille pleine')) },
      follow: { moved: () => assert.fail(), removed: () => assert.fail() },
    });
    assert.deepEqual(await svc.remove(path.join(s.films, 'a.mkv')), { ok: false, code: 'failed', reason: 'corbeille pleine' });
  });
});

describe('gestion des fichiers : règles de Windows (disque simulé)', () => {
  // Disque simulé, sans casse : chemins réels écrits avec la casse du disque.
  const disk = new Map<string, { dir: boolean; ino: number; real?: string }>();
  const k = (p: string) => path.win32.resolve(p).toLowerCase();
  const add = (p: string, dir = false, real?: string) => disk.set(k(p), { dir, ino: disk.size + 1, real });
  for (const d of ['C:\\', 'C:\\Films', 'C:\\Films\\Saga', 'D:\\Series', 'C:\\Windows']) add(d, true);
  add('C:\\Films\\a.mkv');
  add('C:\\Films\\B.mkv');
  add('C:\\Windows\\system.ini');
  add('C:\\Films\\Jonction', true, 'C:\\Windows');
  const found = (p: string) => {
    const e = disk.get(k(p));
    if (!e) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return e;
  };
  const renamed: string[] = [];
  const ops: FilesOps = {
    realpath: async (p) => {
      // Un dossier parent jonction mène ailleurs.
      const j = 'c:\\films\\jonction';
      if (k(p).startsWith(j)) return 'C:\\Windows' + path.win32.resolve(p).slice(j.length);
      found(p);
      return path.win32.resolve(p);
    },
    lstat: async (p) => {
      const e = found(p);
      return { dev: 1, ino: e.ino, isDirectory: () => e.dir };
    },
    rename: async (from, to) => void renamed.push(`${from} -> ${to}`),
    trash: async () => {},
  };
  const svc = createFilesService({ roots: () => ['C:\\Films', 'd:/series', 'C:\\', '\\\\nas\\films'], ops, platform: 'win32' });
  const code = async (p: Promise<{ ok: boolean; code?: string }>) => {
    const r = await p;
    return r.ok ? 'ok' : r.code;
  };

  it('casse et séparateurs indifférents ; lecteurs distincts', async () => {
    assert.equal(await code(svc.remove('c:/films/A.MKV')), 'ok');
    assert.equal(await code(svc.move('C:\\Films\\a.mkv', 'D:\\SERIES')), 'ok');
    assert.equal(await code(svc.remove('E:\\Films\\a.mkv')), 'outside');
    assert.equal(await code(svc.remove('C:\\Windows\\system.ini')), 'outside');
  });

  it('racines refusées : dossier configuré, racine du lecteur (ignorée même configurée), partage réseau', async () => {
    assert.equal(await code(svc.remove('c:\\FILMS\\')), 'root');
    assert.equal(await code(svc.remove('C:\\')), 'root');
    assert.equal(await code(svc.remove('\\\\nas\\films\\a.mkv')), 'invalid');
    assert.equal(await code(svc.remove('//nas/films/a.mkv')), 'invalid');
  });

  it('`..` écrit avec `\\` ou `/`, et chemin sans lecteur', async () => {
    assert.equal(await code(svc.remove('C:\\Films\\..\\Windows\\system.ini')), 'invalid');
    assert.equal(await code(svc.remove('C:/Films/Saga/../a.mkv')), 'invalid');
    assert.equal(await code(svc.remove('Films\\a.mkv')), 'invalid');
  });

  it('dossier parent (jonction) qui mène hors des dossiers', async () => {
    assert.equal(await code(svc.remove('C:\\Films\\Jonction\\system.ini')), 'link');
  });

  it('noms refusés par Windows ; changement de casse permis', async () => {
    for (const name of ['a:b', 'a?', 'a*', 'a<b', 'nom.', 'nom ', 'a/b', 'a\\b']) assert.equal(await code(svc.rename('C:\\Films\\a.mkv', name)), 'name');
    assert.equal(await code(svc.rename('C:\\Films\\a.mkv', 'b.mkv')), 'exists');
    assert.equal(await code(svc.rename('C:\\Films\\a.mkv', 'A.mkv')), 'ok');
    assert.equal(renamed.at(-1), 'C:\\Films\\a.mkv -> C:\\Films\\A.mkv');
  });
});

describe('gestion des fichiers : noms et dossiers gérés', () => {
  it('isValidName : un nom ordinaire passe', () => {
    assert.equal(isValidName('Le Film (2010).mkv', 'linux'), true);
    assert.equal(isValidName('a:b', 'linux'), true);
    assert.equal(isValidName('a:b', 'win32'), false);
  });

  it('dossiers gérés : locaux seulement (ni serveur web, ni partage réseau)', () => {
    const cfg = {
      library: { sources: [{ location: '/films' }, { location: 'https://nas/films/' }, { location: 'smb://nas/films' }] },
      gameSources: [{ location: '/jeux' }],
      emulators: [{ romsDir: '/roms/snes', sources: ['/roms/autres', 'smb://nas/roms'] }],
    } as any;
    assert.deepEqual(managedRoots(cfg, 'linux'), ['/films', '/jeux', '/roms/snes', '/roms/autres']);
    const win = {
      library: { sources: [{ location: 'C:\\Films' }, { location: '\\\\nas\\films' }, { location: '//nas/series' }] },
      gameSources: [],
      emulators: [],
    } as any;
    assert.deepEqual(managedRoots(win, 'win32'), ['C:\\Films']);
  });
});
