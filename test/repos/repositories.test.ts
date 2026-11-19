// Index des dépôts (P3-07) : téléchargement https seulement (redirections comprises), tailles et délais, signature,
// cache hors ligne vérifié de nouveau à la lecture, retour en arrière refusé.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { downloadBytes, httpsUrl } from '../../src/main/repos/download.ts';
import { createRepositories, type RepositoryConfig } from '../../src/main/repos/repositories.ts';
import { keys, pem, INDEX_URL, tempDir, testRepo, type TestRepo } from './helpers.ts';

const quiet = () => {};
const config = (repo: TestRepo, extra: Partial<RepositoryConfig> = {}): RepositoryConfig => ({
  id: 'test',
  index: INDEX_URL,
  publicKey: repo.publicKey,
  official: false,
  ...extra,
});
const open = (repo: TestRepo, cacheDir: string, extra: Partial<RepositoryConfig> = {}) =>
  createRepositories({ cacheDir, repositories: () => [config(repo, extra)], fetch: repo.fetch, log: quiet });

describe('téléchargement', () => {
  it('n’accepte que https, y compris après une redirection', async () => {
    assert.equal(httpsUrl('http://x.example/a'), null);
    assert.equal(httpsUrl('file:///etc/passwd'), null);
    assert.equal(httpsUrl('https://u:p@x.example/a'), null);
    assert.equal(httpsUrl('/b', 'https://x.example/a'), 'https://x.example/b');
    await assert.rejects(downloadBytes('http://x.example/a', { maxBytes: 10, timeout: 1000 }), { code: 'url' });
    const redirect = async () => new Response(null, { status: 302, headers: { location: 'http://x.example/b' } });
    await assert.rejects(downloadBytes('https://x.example/a', { maxBytes: 10, timeout: 1000, fetch: redirect }), { code: 'url' });
    const loop = async (url: string) => new Response(null, { status: 302, headers: { location: `${url}x` } });
    await assert.rejects(downloadBytes('https://x.example/a', { maxBytes: 10, timeout: 1000, fetch: loop }), { code: 'network' });
  });

  it('refuse une réponse trop grosse, annoncée ou non', async () => {
    const big = async () => new Response('x'.repeat(100), { headers: { 'content-length': '100' } });
    await assert.rejects(downloadBytes('https://x.example/a', { maxBytes: 10, timeout: 1000, fetch: big }), { code: 'too-big' });
    const stream = async () => new Response(new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(8)) }));
    await assert.rejects(downloadBytes('https://x.example/a', { maxBytes: 100, timeout: 1000, fetch: stream }), { code: 'too-big' });
  });

  it('abandonne après le délai, corps compris, et signale un code d’erreur', async () => {
    // Le minuteur du délai ne retient pas le processus : un vrai socket le ferait, ce minuteur-ci le remplace.
    const keepAlive = setTimeout(() => {}, 1000);
    const slow = async (_url: string, init?: RequestInit) =>
      new Response(new ReadableStream({ start: (c) => init?.signal?.addEventListener('abort', () => c.error(new Error('aborted'))) }));
    await assert.rejects(downloadBytes('https://x.example/a', { maxBytes: 100, timeout: 50, fetch: slow }), { code: 'network' });
    clearTimeout(keepAlive);
    const missing = async () => new Response('absent', { status: 404 });
    await assert.rejects(downloadBytes('https://x.example/a', { maxBytes: 100, timeout: 1000, fetch: missing }), { code: 'network' });
  });
});

describe('index des dépôts', () => {
  it('lit l’index signé, le garde en cache et s’en sert hors ligne', async () => {
    const repo = testRepo([{ id: 'org.exemple.a', version: '1.0.0' }]);
    const dir = tempDir();
    const repos = open(repo, dir);
    assert.deepEqual(repos.indexes(), []);
    const [status] = await repos.refresh();
    assert.equal(status.error, null);
    assert.equal(status.generated, '2026-11-19T12:00:00.000Z');
    assert.deepEqual(status.name, { en: 'Test repository', fr: 'Dépôt de test' });
    assert.ok(fs.existsSync(path.join(dir, 'test', 'index.json')));

    repo.offline = true;
    const again = open(repo, dir);
    assert.equal(again.indexes()[0].index.plugins[0].id, 'org.exemple.a');
    const [offline] = await again.refresh();
    assert.equal(offline.error, 'network');
    assert.equal(again.indexes().length, 1);
  });

  it('refuse un index mal signé et garde le précédent', async () => {
    const repo = testRepo([{ id: 'org.exemple.a', version: '1.0.0' }]);
    const repos = open(repo, tempDir());
    await repos.refresh();
    repo.publish([{ id: 'org.exemple.a', version: '2.0.0' }], { generated: '2026-11-20T00:00:00.000Z', sign: keys().privateKey });
    const [status] = await repos.refresh();
    assert.equal(status.error, 'signature');
    assert.equal(repos.indexes()[0].index.plugins[0].versions[0].version, '1.0.0');
  });

  it('refuse un index plus ancien que celui du cache (retour en arrière)', async () => {
    const repo = testRepo([{ id: 'org.exemple.a', version: '2.0.0' }], { generated: '2026-11-20T00:00:00.000Z' });
    const dir = tempDir();
    await open(repo, dir).refresh();
    repo.publish([{ id: 'org.exemple.a', version: '1.0.0' }], { generated: '2026-11-19T00:00:00.000Z' });
    const repos = open(repo, dir);
    const [status] = await repos.refresh();
    assert.equal(status.error, 'rollback');
    assert.equal(repos.indexes()[0].index.plugins[0].versions[0].version, '2.0.0');
  });

  it('ne croit pas un cache modifié sur le disque, ni signé par une autre clé', async () => {
    const repo = testRepo([{ id: 'org.exemple.a', version: '1.0.0' }]);
    const dir = tempDir();
    await open(repo, dir).refresh();
    const file = path.join(dir, 'test', 'index.json');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('1.0.0', '1.0.1'));
    assert.deepEqual(open(repo, dir).indexes(), []);
    await open(repo, dir).refresh();
    assert.deepEqual(open(repo, dir, { publicKey: pem(keys().publicKey) }).indexes(), []);
  });

  it('refuse un index trop gros et le préfixe mire. hors du dépôt officiel', async () => {
    const repo = testRepo([{ id: 'mire.exemple.a', version: '1.0.0' }]);
    const [prefix] = await open(repo, tempDir()).refresh();
    assert.equal(prefix.error, 'format');
    const [official] = await open(repo, tempDir(), { official: true }).refresh();
    assert.equal(official.error, null);
    const small = createRepositories({
      cacheDir: tempDir(),
      repositories: () => [config(repo, { official: true })],
      fetch: repo.fetch,
      log: quiet,
      maxIndexBytes: 100,
    });
    assert.equal((await small.refresh())[0].error, 'too-big');
  });
});
