'use strict';
/**
 * Dépôt tiers factice pour l'assistant du premier lancement (P4-23) : déclaration (`repos/trust.json`) et index signé
 * par une clé générée ici, rangé dans le cache des dépôts (`repos/<id>/index.json`) comme après une lecture en ligne.
 * Ses plugins (`org.essai.*`) portent des catégories (films, télévision, box, service de streaming) et des
 * dépendances ; leurs paquets n'existent pas : on peut parcourir l'assistant jusqu'au récapitulatif, pas installer.
 *
 * Utilisé par test/e2e/assistant.e2e.js, et à la main : node test/e2e/fake-repo.js <dossier de données vide>, puis
 * MIRE_USER_DATA=<ce dossier> npm start (voir docs/assistant.md).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_URL = 'https://depot.invalid/index.json';

// Forme canonique de l'index (clés triées, sans espace), comme `canonicalJson` de src/main/repos/index-file.ts.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

const version = (name, categories, dependencies = {}) => ({
  version: '1.0.0',
  engines: { mire: '>=0.0.0' },
  level: 'data',
  contributes: ['packs'],
  permissions: {},
  dependencies,
  name: { en: name, fr: name },
  categories,
  package: { url: 'https://depot.invalid/p.tgz', sha256: '0'.repeat(64), size: 10 },
});

// Dépôt tiers factice : sa déclaration (trust.json) et son index signé, en cache comme après une lecture en ligne.
function fakeRepository(data) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const fingerprint = crypto.createHash('sha256').update(raw).digest('hex');
  const id = `repo-${fingerprint.slice(0, 16)}`;
  const body = {
    format: 1,
    repository: { name: { en: 'Test repository', fr: 'Dépôt d’essai' }, index: INDEX_URL },
    generated: '2026-11-20T12:00:00.000Z',
    plugins: [
      { id: 'org.essai.box', versions: [version('Box d’essai', ['tv-box'], { 'org.essai.chaines': '^1.0.0' })] },
      { id: 'org.essai.chaines', versions: [version('Chaînes d’essai', ['tv'])] },
      { id: 'org.essai.films', versions: [version('Films d’essai', ['movies'], { 'org.essai.infos': '^1.0.0' })] },
      { id: 'org.essai.infos', versions: [version('Infos d’essai', [])] },
      { id: 'org.essai.service', versions: [version('Service d’essai', ['streaming-service'])] },
    ],
  };
  const value = crypto.sign(null, Buffer.from(`mire-addons-index:1\n${canonical(body)}`), privateKey).toString('base64');
  const index = { ...body, signature: { algorithm: 'ed25519', keyId: fingerprint, value } };
  fs.mkdirSync(path.join(data, 'repos', id), { recursive: true });
  fs.writeFileSync(path.join(data, 'repos', id, 'index.json'), JSON.stringify(index));
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const trust = { repositories: [{ id, index: INDEX_URL, publicKey: pem, fingerprint, addedAt: 1 }], consents: [] };
  fs.writeFileSync(path.join(data, 'repos', 'trust.json'), JSON.stringify(trust));
}

module.exports = { fakeRepository };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage : node test/e2e/fake-repo.js <dossier de données vide>');
    process.exit(1);
  }
  fakeRepository(path.resolve(dir));
  console.log(`Dépôt factice prêt dans ${path.resolve(dir)} : MIRE_USER_DATA="${path.resolve(dir)}" npm start`);
}
