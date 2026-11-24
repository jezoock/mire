// Le plugin inclus `mire.subtitles` branché comme dans Mire, sans hôte isolé : son module est appelé directement, avec
// le vrai contexte des plugins (`ctx.files`) et le vrai pont des sous-titres (dossier de la vidéo prêté pendant l'appel).
import { createPluginBridges, type BridgeService } from '../../src/main/plugins/bridges.ts';
import { createContextHandler } from '../../src/main/plugins/context.ts';
import createSidecar from '../../plugins/mire.subtitles/src/subtitles.mjs';

export function bundledSubtitles() {
  const ref: { bridges?: ReturnType<typeof createPluginBridges> } = {};
  const forPlugin = createContextHandler({
    pickFolder: async () => null,
    folders: { list: (id) => ref.bridges?.lentFolders(id) ?? [], add: () => {} },
    storage: () => ({}) as never,
  });
  const handler = forPlugin({ id: 'mire.subtitles', manifest: { level: 'code', permissions: { folders: true } } });
  const call =
    (method: string) =>
    (...args: unknown[]) =>
      handler.handle(method, args, new AbortController().signal);
  const plugin = createSidecar({ id: 'mire.subtitles', files: { walk: call('files.walk') } });
  const entry = { pluginId: 'mire.subtitles', kind: 'subtitles' as const, id: 'sidecar', declaration: {} };
  const service: BridgeService = {
    contributions: (kind) => (kind === 'subtitles' ? [entry] : []),
    onContributionsChange: () => () => {},
    call: async (_id, _k, _c, _m, args) => plugin.find(args?.[0]),
    levelOf: () => 'code',
    folders: () => [],
    hosts: () => [],
    sourceRights: () => ({ trusted: true, folders: true }),
  };
  const bridges = createPluginBridges({ service, catalog: { setSource: () => {}, removeSource: () => {} }, log: () => {} });
  ref.bridges = bridges;
  return { bridges, call };
}
