/**
 * Widevine (lecture protégée de Netflix, Prime Video…), fourni par castLabs Electron. L'API `components` est
 * absente d'Electron standard : sans elle, rien n'est attendu et l'état le signale.
 */

export interface Components {
  whenReady(): Promise<unknown>;
  status(): Record<string, { status: unknown; version: unknown } | undefined>;
  WIDEVINE_CDM_ID: string;
}

export interface DrmStatus {
  ecs: boolean;
  platform: string;
  widevine?: { status: unknown; version: unknown } | null;
}

export interface DrmOptions {
  components?: Components | null;
  platform?: string;
  /** Attente maximale de Widevine avant d'ouvrir un site quand même. */
  timeoutMs?: number;
  onError?: (err: unknown) => void;
}

export function createDrm({ components, platform = process.platform, timeoutMs = 15000, onError = () => {} }: DrmOptions) {
  let ready: Promise<boolean> = Promise.resolve(false);
  return {
    /** Lance le chargement de Widevine (une fois l'application prête). */
    start() {
      if (!components) return;
      ready = Promise.race([
        components.whenReady().then(
          () => true,
          (err) => {
            onError(err);
            return false;
          },
        ),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), timeoutMs).unref?.();
        }),
      ]);
    },
    /** Résolu quand Widevine est prêt (true), en échec ou trop lent (false). */
    whenReady: () => ready,
    status(): DrmStatus {
      if (!components) return { ecs: false, platform };
      let st: ReturnType<Components['status']> = {};
      try {
        st = components.status();
      } catch {
        /* pas encore prêt */
      }
      const w = st[components.WIDEVINE_CDM_ID];
      return { ecs: true, platform, widevine: w ? { status: w.status, version: w.version } : null };
    },
  };
}

export type Drm = ReturnType<typeof createDrm>;
