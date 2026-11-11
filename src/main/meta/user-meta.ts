/**
 * Infos modifiées à la main (titre, année, genre, résumé, artiste, images) : meta/meta.json, lu au démarrage.
 * Les images choisies sur le disque sont copiées dans meta/img.
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { UserMeta } from '@mire/shared/ipc';
import { createJsonStore } from '../storage/json-store.ts';

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
  /** meta/meta.json */
  file: string;
  /** meta/img : copies des images choisies. */
  imgDir: string;
  /** Demande une image à l'utilisateur (boîte de dialogue) : son chemin, ou `null`. */
  chooseImage(field: ImageField): Promise<string | null>;
  now?: () => number;
}

export function createUserMeta({ file, imgDir, chooseImage, now = Date.now }: UserMetaOptions) {
  const store = createJsonStore<Record<string, UserMeta>>(file, { defaults: {}, space: 2 });
  let all: Record<string, UserMeta> = {};

  const save = () => store.set(all);

  function set(key: unknown, patch: unknown): UserMeta | null {
    if (typeof key !== 'string' || !key) return null;
    const next = patchMeta(all[key], patch);
    if (next) all[key] = next;
    else delete all[key];
    save();
    return all[key] || null;
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
    load() {
      all = store.load();
    },
    /** Toutes les infos, par clé (l'objet lui-même : `metaReset` le modifie puis appelle `save`). */
    all: () => all,
    save,
    set,
    pickImage,
  };
}

export type UserMetaService = ReturnType<typeof createUserMeta>;
