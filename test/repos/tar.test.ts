// Lecture des paquets `.tgz` (P3-07) : fichiers ordinaires seulement, chemins sûrs, archives piégées refusées.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';
import { isArchivePath, readTgz } from '../../src/main/repos/tar.ts';
import { tgz } from './helpers.ts';

const archive = (code: string) => (err: Error & { code?: string }) => err.code === code;

describe('readTgz', () => {
  it('lit les fichiers ordinaires', () => {
    const files = readTgz(
      tgz([
        { path: 'a.json', data: '{}' },
        { path: 'dir/b.txt', data: 'b'.repeat(600) },
      ]),
    );
    assert.deepEqual(
      files.map((f) => [f.path, f.data.length]),
      [
        ['a.json', 2],
        ['dir/b.txt', 600],
      ],
    );
  });

  it('refuse les chemins absolus, `..`, `.`, `\\` et `:`', () => {
    for (const p of ['/etc/passwd', '../x', 'a/../../x', './a', 'a\\b', 'C:x', 'a//b']) {
      assert.equal(isArchivePath(p), false, p);
      assert.throws(() => readTgz(tgz([{ path: p, data: 'x' }])), archive('archive'), p);
    }
  });

  it('refuse les liens symboliques et physiques, les dossiers, les fichiers spéciaux et les en-têtes étendus', () => {
    for (const type of ['1', '2', '3', '4', '5', '6', '7', 'x', 'g', 'L', 'K']) {
      assert.throws(() => readTgz(tgz([{ path: 'lien', type, link: '../../etc/passwd' }])), archive('archive'), type);
    }
  });

  it('refuse les doublons (casse comprise), un fichier qui sert aussi de dossier, une archive tronquée ou illisible', () => {
    assert.throws(
      () =>
        readTgz(
          tgz([
            { path: 'a', data: '1' },
            { path: 'A', data: '2' },
          ]),
        ),
      archive('archive'),
    );
    assert.throws(
      () =>
        readTgz(
          tgz([
            { path: 'a', data: '1' },
            { path: 'a/b', data: '2' },
          ]),
        ),
      archive('archive'),
    );
    const truncated = gzipSync(tgzTar().subarray(0, 700));
    assert.throws(() => readTgz(truncated), archive('archive'));
    assert.throws(() => readTgz(Buffer.from('pas une archive')), archive('archive'));
  });

  it('refuse un en-tête dont la somme de contrôle est fausse', () => {
    const tar = tgzTar();
    tar[0] = 'z'.charCodeAt(0);
    assert.throws(() => readTgz(gzipSync(tar)), /Somme de contrôle/);
  });
});

/** Tar non compressé d'un fichier de 600 octets. */
function tgzTar(): Buffer {
  return gunzipSync(tgz([{ path: 'a.txt', data: 'a'.repeat(600) }]));
}
