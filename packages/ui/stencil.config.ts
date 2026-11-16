import type { Config } from '@stencil/core';

// Composants mire-* en light DOM, livrés en modules (dist-custom-elements) et intégrés au script de l'interface
// par esbuild (scripts/build.mjs) : ils partagent ainsi les modules de l'interface (état, client API). Les styles
// ne passent pas par Stencil : ils sont compilés avec le moteur SCSS de dot-stash (src/styles/index.scss).
export const config: Config = {
  namespace: 'mire-ui',
  srcDir: 'src',
  tsconfig: 'tsconfig.stencil.json',
  outputTargets: [
    {
      type: 'dist-custom-elements',
      dir: 'dist/components',
      customElementsExportBehavior: 'bundle',
      externalRuntime: false,
      generateTypeDeclarations: false,
    },
  ],
  // Les paquets de l'espace de travail (@mire/shared…) restent des importations : esbuild les résout en construisant
  // le script de l'interface, qui n'en contient ainsi qu'un exemplaire, partagé avec les composants.
  rollupConfig: { inputOptions: { external: [/^@mire\//] } },
  // Les composants ds-* sont définis par le chargeur de dot-stash, pas par ce paquet.
  validatePrimaryPackageOutputTarget: false,
};
