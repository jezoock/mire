// Protocole media:// : analyse des plages et gestionnaire (avec la vraie politique d'accès, sur dossier temporaire).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMediaHandler, parseRange } from '../../src/main/media-protocol/index.ts';
import { createAccessPolicy } from '../../src/main/security/access-policy.ts';

describe('parseRange', () => {
  it('plage simple, ouverte, bornée à la taille', () => {
    assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
    assert.deepEqual(parseRange(' bytes=500- ', 1000), { start: 500, end: 999 });
    assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
    assert.deepEqual(parseRange('bytes=-', 1000), { start: 0, end: 999 });
  });

  it('suffixe : les N derniers octets', () => {
    assert.deepEqual(parseRange('bytes=-500', 1000), { start: 500, end: 999 });
    assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
  });

  it('en-tête absent, invalide ou à plusieurs plages : fichier entier', () => {
    assert.equal(parseRange(null, 1000), null);
    assert.equal(parseRange('', 1000), null);
    assert.equal(parseRange('octets=0-10', 1000), null);
    assert.equal(parseRange('bytes=a-b', 1000), null);
    assert.equal(parseRange('bytes=0-1,5-9', 1000), null);
    assert.equal(parseRange('bytes=0-10', 0), null);
  });

  it('plage hors du fichier ou inversée : 416', () => {
    assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable');
    assert.equal(parseRange('bytes=1200-1300', 1000), 'unsatisfiable');
    assert.equal(parseRange('bytes=50-10', 1000), 'unsatisfiable');
    assert.equal(parseRange('bytes=-0', 1000), 'unsatisfiable');
  });
});

describe('createMediaHandler', () => {
  let tmp: string;
  let file: string;
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
  const request = (p: string, range?: string) => ({
    url: `media://local/?p=${encodeURIComponent(p)}`,
    headers: new Headers(range ? { range } : {}),
  });

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-media-'));
    fs.mkdirSync(path.join(tmp, 'films'));
    file = path.join(tmp, 'films', 'clip.mp4');
    fs.writeFileSync(file, bytes);
    fs.writeFileSync(path.join(tmp, 'secret.txt'), 'non');
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const make = (roots: () => string[]) => createMediaHandler({ isAllowed: createAccessPolicy({ roots }).isAllowed, mimeType: () => 'video/mp4' });

  it('sert le fichier entier, puis une plage (206, bons octets)', async () => {
    const handle = make(() => [path.join(tmp, 'films')]);
    const full = await handle(request(file));
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-length'), '1000');
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);

    const part = await handle(request(file, 'bytes=100-199'));
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000');
    assert.equal(part.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(100, 200));

    const tail = await handle(request(file, 'bytes=-500'));
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.subarray(500));

    const out = await handle(request(file, 'bytes=2000-'));
    assert.equal(out.status, 416);
    assert.equal(out.headers.get('content-range'), 'bytes */1000');
  });

  it('refuse hors des racines (403), dossier ou fichier absent (404), adresse invalide (400)', async () => {
    const handle = make(() => [path.join(tmp, 'films')]);
    assert.equal((await handle(request(path.join(tmp, 'secret.txt')))).status, 403);
    assert.equal((await handle(request(path.join(tmp, 'films', '..', 'secret.txt')))).status, 403);
    assert.equal((await handle({ url: 'media://local/', headers: new Headers() })).status, 403);
    assert.equal((await handle(request(path.join(tmp, 'films', 'absent.mp4')))).status, 404);
    assert.equal((await handle({ url: '::', headers: new Headers() })).status, 400);
  });

  it('1 000 requêtes : les racines ne sont calculées qu’une fois', async () => {
    let calls = 0;
    const handle = make(() => (calls++, [path.join(tmp, 'films')]));
    for (let i = 0; i < 1000; i++) {
      const res = await handle(request(file, 'bytes=0-0'));
      assert.equal(res.status, 206);
      await res.arrayBuffer();
    }
    assert.equal(calls, 1);
  });
});
