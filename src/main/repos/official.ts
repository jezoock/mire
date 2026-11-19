/**
 * Dépôt officiel des plugins (`jezoock/mire-addons`) : adresse de son index et clé publique qui le signe.
 *
 * C'est le SEUL endroit où cette clé est écrite. Elle est aussi versionnée dans `keys/mire-addons-signing.pub.pem` de
 * `mire-addons`. Empreintes (vérifiées par `test/repos/index-file.test.ts`) :
 * - sha256 de la forme DER (SPKI) : 37284e6151e1a56ee5d22da42cc545104168cb380ba1b66d5798ed46cf9dc993 ;
 * - sha256 des 32 octets bruts (`signature.keyId` de l'index) : 8aaa3d5816218d1ca8cbcb495175723a205f92b6e0727f71c62e9bb3e3396cd5.
 *
 * Changer de clé : publier un index signé par la nouvelle clé ET livrer une version de Mire qui la contient. Mire
 * n'accepte jamais l'index officiel sans vérifier sa signature avec cette clé.
 */
import type { RepositoryConfig } from './repositories.ts';

export const OFFICIAL_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAaezxKWt0NcgggTkaSaT9IRSJsc0YOTj8d+HAEKnm+8s=
-----END PUBLIC KEY-----
`;

export const OFFICIAL_REPOSITORY: RepositoryConfig = {
  id: 'official',
  index: 'https://github.com/jezoock/mire-addons/releases/download/index/index.json',
  publicKey: OFFICIAL_PUBLIC_KEY,
  official: true,
};
