/**
 * Jeux (P4-17), côté page et sans DOM : cartes des consoles de l'onglet « Consoles » du Centre, formulaire d'une
 * console créée à la main (dossiers, émulateur, arguments, sites de jeux), choix d'un émulateur pour une console ou
 * pour un jeu (D-21). Les textes viennent des catalogues (`games.ui.*`).
 */
import { isHttpUrl } from '@mire/shared';
import type { Emulator, LinkSite } from '@mire/shared';
import type { ConsoleInput, EmulatorChoice } from '@mire/shared/ipc';
import type { ConsoleCard, FieldSpec, FormValues } from '@mire/ui/utils';
import { joinArgs, parseArgs, parseSites, sitesToText, type Site } from '../domain/sites.ts';

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Clé d'élément d'un jeu de console, d'un jeu PC et d'un marque-page de jeu (`catalog/keys.ts`). */
export const isRomKey = (key: unknown): key is string => typeof key === 'string' && key.startsWith('rom:');
export const isPcKey = (key: unknown): key is string => typeof key === 'string' && key.startsWith('pc:');
export const isGameBookmarkKey = (key: unknown): key is string => typeof key === 'string' && key.startsWith('gamebm:');
export const isGameKey = (key: unknown): key is string => isRomKey(key) || isPcKey(key);

/**
 * Sources en ligne d'une console (pages web qui listent des fichiers) : les seules que le cœur lit lui-même
 * (`src/main/games/roms/list.ts`), et dont les jeux se téléchargent sur l'ordinateur (P4-29).
 */
export function onlineSources(emu: Emulator | null | undefined): string[] {
  return (emu?.sources ?? []).filter((s): s is string => typeof s === 'string' && isHttpUrl(s));
}

/** Jeu d'une liste de la console (`roms:listSource`) : son chemin ou son adresse, et s'il est en ligne. */
export interface ListedRom {
  path: string;
  remote?: boolean;
}

const fileName = (p: string, remote: boolean): string => {
  const last = (remote ? p.split('?')[0]!.split('/') : p.split(/[\\/]/)).pop() ?? '';
  if (!remote) return last.toLowerCase();
  try {
    return decodeURIComponent(last).toLowerCase();
  } catch {
    return last.toLowerCase();
  }
};

/** « Tout télécharger » : jeux en ligne dont aucun fichier du même nom n'est déjà sur l'ordinateur. */
export function onlineToDownload(listed: readonly ListedRom[], local: readonly ListedRom[] = []): ListedRom[] {
  const have = new Set([...listed, ...local].filter((r) => !r.remote).map((r) => fileName(String(r.path), false)));
  return listed.filter((r) => r.remote && !have.has(fileName(String(r.path), true)));
}

/** Nom du programme d'un émulateur, sans dossier ni extension. */
export function programName(file: unknown): string {
  const base =
    String(file || '')
      .split(/[\\/]/)
      .pop() || '';
  return base.replace(/\.(exe|appimage|app|sh|bat|cmd)$/i, '') || base;
}

/** Console dont l'émulateur lance les jeux d'une console : celle choisie, sinon elle-même. */
export function launcherConsole(list: readonly Emulator[], emu: Emulator): Emulator {
  return (emu.emulator && list.find((e) => e.id === emu.emulator)) || emu;
}

/** Cartes de l'onglet « Consoles » : nom, système et dossiers, émulateur qui lance les jeux. */
export function consoleCards(list: readonly Emulator[] | null | undefined, t: Translate): ConsoleCard[] {
  const all = list ?? [];
  return all.map((emu) => {
    const runner = launcherConsole(all, emu);
    const folders = (emu.romsDir ? 1 : 0) + (emu.sources?.length ?? 0);
    const meta = [emu.system || t('games.ui.consoles.noSystem'), t('games.ui.consoles.folders', { count: folders })];
    const name = programName(runner.path);
    return {
      id: emu.id,
      name: String(emu.name || emu.id),
      meta: meta.join(' · '),
      emulator:
        runner === emu ? t('games.ui.consoles.emulator', { name }) : t('games.ui.consoles.emulatorOf', { name, console: String(runner.name || runner.id) }),
      store: !!emu.store,
      // Jeux en ligne (P4-29) : proposés seulement pour une console qui a une source en ligne.
      ...(onlineSources(emu).length ? { online: true } : {}),
    };
  });
}

/** Champs du formulaire d'une console (P4-06) ; `emu` absent : nouvelle console. */
export function consoleFields(emu: Emulator | null, systems: readonly { id: string; name: string }[], sites: readonly Site[], t: Translate): FieldSpec[] {
  const k = (key: string) => t(`games.ui.form.${key}`);
  const known = systems.map((s): [string, string] => [s.id, s.name]);
  const current = emu?.system && !systems.some((s) => s.id === emu.system) ? [[emu.system, emu.system] as [string, string]] : [];
  return [
    { id: 'name', label: k('name'), value: emu?.name ?? '', required: true },
    { id: 'system', type: 'select', label: k('system'), value: emu?.system ?? '', options: [['', k('systemGuess')], ...current, ...known] },
    { id: 'path', label: k('path'), value: emu?.path ?? '', browse: 'file', full: true, required: true },
    { id: 'args', label: k('args'), value: joinArgs(emu?.args?.length ? emu.args : ['{rom}']), full: true },
    { id: 'romsDir', label: k('romsDir'), value: emu?.romsDir ?? '', browse: 'folder', full: true },
    { id: 'sources', type: 'list', label: k('sources'), value: emu?.sources ?? [], placeholder: k('sourcesHint') },
    { id: 'extensions', label: k('extensions'), value: (emu?.extensions ?? []).join(', '), placeholder: '.sfc, .smc', full: true },
    { id: 'romSites', type: 'textarea', rows: 4, label: k('sites'), value: sitesToText(sites as Site[]), placeholder: k('sitesHint') },
  ];
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Ce que le formulaire envoie au processus principal. Les sites ne sont gardés propres à la console que s'ils
 * diffèrent de ceux que Mire propose (`defaults`) ; un champ vidé revient à ceux-là.
 */
export function consoleInput(values: FormValues, defaults: readonly Site[]): ConsoleInput {
  const sites = parseSites(values.romSites);
  const same = JSON.stringify(sites) === JSON.stringify(defaults);
  return {
    name: text(values.name),
    system: text(values.system),
    path: text(values.path),
    args: parseArgs(values.args ?? ''),
    romsDir: text(values.romsDir),
    sources: Array.isArray(values.sources) ? values.sources.map(text).filter(Boolean) : [],
    extensions: String(values.extensions ?? '')
      .split(/[,;\s]+/)
      .filter(Boolean),
    romSites: !text(values.romSites) || same ? null : (sites as LinkSite[]),
  };
}

/** Libellé d'un émulateur proposé : son nom, et la console d'où il vient quand ce n'est pas celle du jeu. */
export function choiceLabel(c: EmulatorChoice, own: string, t: Translate): string {
  return c.id === own ? t('games.ui.emulators.own', { name: c.emulator }) : t('games.ui.emulators.other', { name: c.emulator, console: c.console });
}

/**
 * Options de la liste des émulateurs. Pour un jeu, la première option suit la console (`''`) ; pour une console, la
 * sienne passe en premier.
 */
export function emulatorOptions(
  choices: readonly EmulatorChoice[],
  own: string,
  t: Translate,
  forGame?: { consoleDefault: string | null },
): [string, string][] {
  const opts = choices.map((c): [string, string] => [c.id, choiceLabel(c, own, t)]);
  if (!forGame) return opts;
  const def = choices.find((c) => c.id === (forGame.consoleDefault ?? own)) ?? choices[0];
  const follow: [string, string] = ['', t('games.ui.emulators.followConsole', { name: def ? def.emulator : '' })];
  return [follow, ...opts];
}
