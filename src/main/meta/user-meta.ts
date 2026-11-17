/**
 * Infos modifiées à la main (titre, année, genre, résumé, artiste, images), telles que l'interface historique les
 * lit et les écrit. Depuis P2-04, elles sont gardées dans `catalog/overrides.json` ; l'ancien `meta/meta.json` est
 * repris au premier démarrage puis laissé en place. Les images choisies sur le disque sont copiées dans meta/img.
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { UserMeta } from '@mire/shared/ipc';
import type { Overrides } from '../catalog/overrides.ts';

export const META_FIELDS = ['title', 'year', 'genre', 'overview', 'artist', 'image', 'backdrop'];

export type ImageField = 'image' | 'backdrop';

/**
 * Infos d'un élément après modification : seuls les champs connus sont pris, un texte est débarrassé de ses
 * espaces, une valeur vide efface le champ. `null` quand il ne reste rien.
 */
export function patchMeta(current: UserMeta | undefined, patch: unknown): UserMeta | null {
  const cur: UserMeta = { ...(current || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!META_FIELDS.includes(k)) continue;
    const val = typeof v === 'string' ? v.trim() : v;
    if (val === '' || val == null) delete cur[k];
    else cur[k] = val;
  }
  return Object.keys(cur).length ? cur : null;
}

export interface UserMetaOptions {
  /** Modifications faites à la main (`catalog/overrides.json`), qui gardent ces infos depuis P2-04. */
  overrides: Pick<Overrides, 'legacyAll' | 'legacySet'>;
  /** meta/img : copies des images choisies. */
  imgDir: string;
  /** Demande une image à l'utilisateur (boîte de dialogue) : son chemin, ou `null`. */
  chooseImage(field: ImageField): Promise<string | null>;
  now?: () => number;
}

/**
 * Façade de l'interface historique sur les modifications faites à la main : mêmes clés (`v:<chemin>`, `a:<dossier>`…)
 * et mêmes champs qu'avant, rangés dans `overrides.json` sous la clé de chaque élément (`catalog/overrides.ts`).
 */
export function createUserMeta({ overrides, imgDir, chooseImage, now = Date.now }: UserMetaOptions) {
  function set(key: unknown, patch: unknown): UserMeta | null {
    if (typeof key !== 'string' || !key) return null;
    const next = patchMeta(overrides.legacyAll()[key], patch);
    overrides.legacySet(key, next);
    return next;
  }

  // Image choisie sur le disque, copiée dans meta/img sous un nom unique.
  async function pickImage(key: string, field: unknown): Promise<UserMeta | null> {
    if (field !== 'image' && field !== 'backdrop') return null;
    const src = await chooseImage(field);
    if (!src) return null;
    const dest = path.join(imgDir, `${crypto.createHash('sha1').update(`${key}|${field}|${now()}`).digest('hex')}${path.extname(src).toLowerCase()}`);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
    return set(key, { [field]: dest });
  }

  return {
    /** Toutes les infos, par ancienne clé (copie : la modifier ne change rien). */
    all: (): Record<string, UserMeta> => structuredClone(overrides.legacyAll()),
    set,
    /** Efface les infos d'une clé (« Réinitialiser »). */
    reset(key: unknown): boolean {
      if (typeof key === 'string' && key) overrides.legacySet(key, null);
      return true;
    },
    pickImage,
  };
}

export type UserMetaService = ReturnType<typeof createUserMeta>;
