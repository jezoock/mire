// Index signé d'un dépôt (P3-07) : mêmes vecteurs que la vérification de référence de `mire-addons`
// (`test/index-file.test.mjs`), plus l'index officiel publié, vérifié avec la clé intégrée à Mire.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  checkIndexContent,
  keyId,
  loadPublicKey,
  parseIndex,
  rawPublicKey,
  sha256,
  signedBytes,
  verifyIndex,
  type RepoIndex,
} from '../../src/main/repos/index-file.ts';
import { OFFICIAL_PUBLIC_KEY, OFFICIAL_REPOSITORY } from '../../src/main/repos/official.ts';
import { readTgz } from '../../src/main/repos/tar.ts';
import { keys, pem, signIndex, testRepo } from './helpers.ts';

const fixtures = path.join(import.meta.dirname, '..', 'fixtures', 'repos');

const repoIndex = () =>
  testRepo([
    { id: 'org.exemple.a', version: '1.0.0' },
    { id: 'org.exemple.a', version: '1.10.0' },
    { id: 'org.exemple.a', version: '1.2.0' },
  ]);

describe('JSON canonique', () => {
  it('trie les clés, sans espace, et ignore les champs non définis', () => {
    assert.equal(canonicalJson({ b: [1, 'é', true, null], a: { d: 1, c: undefined } }), '{"a":{"d":1},"b":[1,"é",true,null]}');
  });
  it('refuse les nombres non entiers et les types inconnus', () => {
    assert.throws(() => canonicalJson({ a: 1.5 }), /entier/);
    assert.throws(() => canonicalJson({ a: () => 1 }));
  });
  it('signe un en-tête de contexte avant l’index canonique', () => {
    assert.match(signedBytes({ b: 1, a: 2, signature: { x: 1 } }).toString(), /^mire-addons-index:1\n\{"a":2,"b":1\}$/);
  });
});

describe('clé officielle', () => {
  it('est intégrée avec l’empreinte attendue (sha256 de la forme DER)', () => {
    const key = loadPublicKey(OFFICIAL_PUBLIC_KEY);
    const der = key.export({ type: 'spki', format: 'der' });
    assert.equal(createHash('sha256').update(der).digest('hex'), '37284e6151e1a56ee5d22da42cc545104168cb380ba1b66d5798ed46cf9dc993');
    assert.equal(keyId(key), '8aaa3d5816218d1ca8cbcb495175723a205f92b6e0727f71c62e9bb3e3396cd5');
    assert.equal(OFFICIAL_REPOSITORY.publicKey, OFFICIAL_PUBLIC_KEY);
    assert.ok(OFFICIAL_REPOSITORY.official);
  });

  it('vérifie l’index officiel publié, et son paquet d’exemple', () => {
    const index = parseIndex(fs.readFileSync(path.join(fixtures, 'official-index.json')), loadPublicKey(OFFICIAL_PUBLIC_KEY), { official: true });
    const v = index.plugins.find((p) => p.id === 'mire.exemple.donnees')!.versions[0];
    assert.equal(v.version, '1.0.0');
    const tgz = fs.readFileSync(path.join(fixtures, 'mire.exemple.donnees-1.0.0.tgz'));
    assert.equal(sha256(tgz), v.package.sha256);
    assert.equal(tgz.length, v.package.size);
    assert.deepEqual(
      readTgz(tgz).map((f) => f.path),
      ['i18n/en.json', 'i18n/fr.json', 'mire-plugin.json', 'packs/exemple.json'],
    );
    // Hors du dépôt officiel, le préfixe `mire.` est refusé.
    assert.throws(() => parseIndex(fs.readFileSync(path.join(fixtures, 'official-index.json')), loadPublicKey(OFFICIAL_PUBLIC_KEY)), /réservé/);
  });
});

describe('signature', () => {
  it('vérifie ; l’ordre des clés et la mise en forme du fichier ne comptent pas', () => {
    const repo = repoIndex();
    const key = loadPublicKey(repo.publicKey);
    assert.equal(rawPublicKey(key).length, 32);
    assert.ok(verifyIndex(JSON.parse(JSON.stringify(repo.index, null, 4)), key));
    assert.deepEqual(
      parseIndex(repo.files.get('https://github.com/o/r/releases/download/index/index.json')!, key).plugins[0].versions.map((v) => v.version),
      ['1.10.0', '1.2.0', '1.0.0'],
    );
  });

  it('refuse un index altéré : nom, version, empreinte, adresse, niveau, date', () => {
    const alter: ((i: RepoIndex) => void)[] = [
      (i) => (i.plugins[0].id = 'org.exemple.b'),
      (i) => (i.plugins[0].versions[0].version = '9.0.0'),
      (i) => (i.plugins[0].versions[0].package.sha256 = 'b'.repeat(64)),
      (i) => (i.plugins[0].versions[0].package.url = 'https://ailleurs.example/x.tgz'),
      (i) => (i.plugins[0].versions[0].level = 'privileged'),
      (i) => (i.generated = '2030-01-01T00:00:00.000Z'),
    ];
    for (const change of alter) {
      const repo = repoIndex();
      const signed = structuredClone(repo.index);
      change(signed);
      assert.throws(
        () => verifyIndex(signed, loadPublicKey(repo.publicKey)),
        (err: Error & { code?: string }) => err.code === 'signature' && /invalide/.test(err.message),
      );
    }
  });

  it('refuse un index signé par une autre clé, non signé, forgé ou d’un format inconnu', () => {
    const a = keys();
    const b = keys();
    const body = { format: 1, repository: { name: { en: 'R' } }, generated: '2026-11-19T12:00:00.000Z', plugins: [] };
    assert.throws(() => verifyIndex(signIndex(body, a.privateKey, a.publicKey), b.publicKey), /autre clé/);
    assert.throws(() => verifyIndex(body, a.publicKey), /non signé/);
    assert.throws(() => verifyIndex(signIndex(body, b.privateKey, a.publicKey), a.publicKey), /invalide/);
    assert.throws(
      () =>
        verifyIndex(
          { ...signIndex(body, a.privateKey, a.publicKey), signature: { algorithm: 'ed25519', keyId: keyId(a.publicKey), value: '!!' } },
          a.publicKey,
        ),
      /invalide/,
    );
    assert.throws(() => verifyIndex(signIndex({ ...body, format: 2 }, a.privateKey, a.publicKey), a.publicKey), /Format/);
    assert.throws(
      () => parseIndex(Buffer.from('pas du JSON'), a.publicKey),
      (err: Error & { code?: string }) => err.code === 'format',
    );
  });
});

describe('structure', () => {
  it('signale le préfixe mire. hors du dépôt officiel et les champs mal formés', () => {
    const i = structuredClone(repoIndex().index);
    i.plugins[0].id = 'mire.a';
    assert.match(checkIndexContent(i).join(), /réservé/);
    assert.deepEqual(checkIndexContent(i, { official: true }), []);
    i.plugins[0].versions[0].package.url = 'http://non.chiffre/x.tgz';
    i.plugins[0].versions[1].package.size = 0;
    i.plugins[0].versions[2].dependencies = { '../x': '*' };
    assert.equal(checkIndexContent(i, { official: true }).length, 3);
  });
});

describe('clés', () => {
  it('lit une clé publique PEM ou base64, refuse le reste', () => {
    const { publicKey } = keys();
    assert.equal(keyId(loadPublicKey(pem(publicKey))), keyId(publicKey));
    assert.equal(keyId(loadPublicKey(rawPublicKey(publicKey).toString('base64'))), keyId(publicKey));
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
    assert.throws(() => loadPublicKey(rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString()), /ed25519/);
    assert.throws(() => loadPublicKey('QUJD'), /illisible/);
  });
});
