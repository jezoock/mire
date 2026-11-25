/**
 * Page de démonstration interne de l'interface (P4-01), cachée : aucune entrée du menu n'y mène. On l'ouvre avec
 * l'adresse `#demo` (dans les outils de développement, F12 : `location.hash = 'demo'`). Elle montre le composant
 * `mire-demo` de `@mire/ui` dans le gabarit historique, et les composants ds-* utilisés par Mire dans les cinq
 * palettes (P4-02). Ses textes viennent des catalogues, dans la langue de l'interface.
 */
import { CORE_PALETTES } from '@mire/shared';
import type { CardElement, GridGroup } from '@mire/ui/utils';
import { esc } from '../core/dom.ts';
import { i18n, t } from '../i18n/index.ts';
import { S } from '../state/index.ts';
import { confirmDialog, notify, openForm, pickCandidate } from '../ui/dialogs.ts';

export const DEMO_SECTION = 'demo';

/** Les palettes du cœur (celles des plugins, P5-02, n'y figurent pas) ; nom : clé `palettes.<id>` des catalogues. */
const PALETTES = CORE_PALETTES;

let countForms = '';
/** Textes des composants d'éléments (P4-05), tirés des catalogues : JSON des attributs. */
const forms = { card: '', group: '', more: '', scroller: '' };
let watching = false;

/** Vrai si l'adresse de la page demande la démonstration. */
export const isDemoHash = (hash: string): boolean => hash.replace(/^#/, '') === DEMO_SECTION;

/** Attend les textes de la page (service de traduction de l'interface), avant son premier affichage. */
export async function loadDemoTexts(): Promise<void> {
  await i18n.ready();
  // Catalogues indisponibles : la page affiche les clés, elle reste utilisable.
  const json = (key: string) => {
    const value = i18n.raw(key);
    return value && typeof value === 'object' ? JSON.stringify(value) : '';
  };
  countForms = json('demo.component.count');
  forms.card = json('elements.card');
  forms.group = json('elements.group.count');
  forms.more = json('elements.grid.more');
  forms.scroller = json('elements.row');
  watchFocus();
}

export const demoTitle = (): string => t('demo.title');

function palette(id: (typeof PALETTES)[number], index: number): string {
  const range = `demo-range-${index}`;
  return `<section class="mire-ui-demo__palette" data-palette="${id}" aria-labelledby="demo-palette-${index}">
    <p class="mire-ui-demo__name" id="demo-palette-${index}">${esc(t(`palettes.${id}`))}</p>
    <div class="mire-ui-demo__row">
      <ds-trigger type="button" mods="stl-1">${esc(t('demo.samples.button'))}</ds-trigger>
      <ds-trigger type="link">${esc(t('demo.samples.link'))}</ds-trigger>
      <ds-badge type="info">${esc(t('demo.samples.badge'))}</ds-badge>
    </div>
    <div class="mire-ui-demo__row">
      <ds-toggle type="switch" checked label="${esc(t('demo.samples.toggle'))}"></ds-toggle>
      <span aria-hidden="true">${esc(t('demo.samples.toggle'))}</span>
      <ds-range><input type="range" id="${range}" min="0" max="100" value="40" aria-label="${esc(t('demo.samples.range'))}"></ds-range>
    </div>
    <div class="mire-ui-demo__row">
      <ds-loader value="60" label="${esc(t('demo.samples.loader'))}" inline></ds-loader>
      <ds-thumb class="mire-ui-demo__thumb" ratio="2/3" label="${esc(t('demo.samples.thumb'))}"></ds-thumb>
    </div>
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Composants d'éléments (P4-05)                                        */
/* ------------------------------------------------------------------ */

/** Éléments de démonstration ; leurs images, s'il y en a, sont celles de la bibliothèque d'images (media://). */
export function sampleElements(count: number, prefix: string): CardElement[] {
  const pictures = S.images.map((it) => it.path).filter(Boolean);
  const picture = (i: number) => (pictures.length ? pictures[i % pictures.length] : undefined);
  return Array.from({ length: count }, (_, i) => {
    const infos: CardElement['infos'] = { year: 1990 + (i % 30), genres: [t('demo.elements.genre')], summary: t('demo.elements.summary') };
    if (i % 3 === 1) Object.assign(infos, { season: 1 + (i % 4), episode: 1 + i });
    const images: CardElement['images'] = {};
    if (picture(i)) Object.assign(images, { poster: picture(i), background: picture(i + 1) });
    const el: CardElement = { key: `demo:${prefix}/${i + 1}`, name: t('demo.elements.sample', { n: i + 1 }), images, infos, tags: [] };
    if (i === 4) el.unavailable = true;
    return el;
  });
}

const byKey = new Map<string, CardElement>();
const keep = (list: CardElement[]) => (list.forEach((el) => byKey.set(el.key, el)), list);
const attr = (value: unknown) => esc(JSON.stringify(value));

/** Le panneau d'infos et le fond suivent la carte qui a le focus. */
function watchFocus(): void {
  if (watching) return;
  watching = true;
  document.addEventListener('focusin', (e) => {
    const key = (e.target as Element).closest?.('.mire-ui-demo mire-card [data-key]')?.getAttribute('data-key');
    const el = key ? byKey.get(key) : undefined;
    if (!el) return;
    for (const tag of ['mire-focus-info', 'mire-backdrop']) {
      const target = document.querySelector<HTMLElement & { element: CardElement | null }>(`.mire-ui-demo ${tag}`);
      if (target) target.element = el;
    }
  });
}

function elementsDemo(): string {
  const row = keep(sampleElements(12, 'rangee'));
  const groups: GridGroup[] = [1, 2, 3].map((n) => ({
    key: `groupe-${n}`,
    name: t('demo.elements.group', { n }),
    elements: keep(sampleElements(30, `groupe-${n}`)),
  }));
  const lines = keep(sampleElements(4, 'ligne'));
  const progress = Object.fromEntries(row.slice(0, 3).map((el, i) => [el.key, 0.25 * (i + 1)]));
  const groupCards = [1, 2, 3, 4].map((n) => ({
    value: n === 4 ? null : t('demo.elements.group', { n }),
    name: t('demo.elements.group', { n }),
    count: n * 7,
    poster: row[n]?.images.poster,
  }));
  const labels = esc(forms.card);
  return `<section class="mire-ui-demo__elements" aria-label="${esc(t('demo.elements.heading'))}">
    <p class="mire-ui-demo__name">${esc(t('demo.elements.heading'))}</p>
    <div class="mire-ui-demo__stage">
      <mire-backdrop class="mire-ui-demo__backdrop"></mire-backdrop>
      <mire-focus-info class="mire-ui-demo__info" infos="year,genres" labels="${esc(forms.card)}"></mire-focus-info>
    </div>
    <mire-row heading="${esc(t('demo.elements.row'))}" target="mire-demo" action="pick" labels="${labels}" elements="${attr(row)}" progress="${attr(progress)}" scroller-labels="${esc(forms.scroller)}"></mire-row>
    <p class="mire-ui-demo__name">${esc(t('demo.elements.groups'))}</p>
    <div class="mire-ui-demo__row">
      ${groupCards.map((g) => `<mire-group-card class="mire-ui-demo__group" target="mire-demo" action="pick" group="${attr(g)}" count-labels="${esc(forms.group)}"></mire-group-card>`).join('')}
    </div>
    <p class="mire-ui-demo__name">${esc(t('demo.elements.lines'))}</p>
    <mire-grid variant="line" target="mire-demo" action="pick" labels="${labels}" elements="${attr(lines)}"></mire-grid>
    <p class="mire-ui-demo__name">${esc(t('demo.elements.grid'))}</p>
    <mire-grid target="mire-demo" action="pick" labels="${labels}" limit="12" more-labels="${esc(forms.more)}" groups="${attr(groups)}"></mire-grid>
  </section>`;
}

/* ------------------------------------------------------------------ */
/* Boîtes de dialogue (P4-06)                                           */
/* ------------------------------------------------------------------ */

const DIALOG_KINDS = ['form', 'confirm', 'pick', 'tabs', 'notify'] as const;
type DialogKind = (typeof DIALOG_KINDS)[number];

function showResult(result: unknown): void {
  const el = document.querySelector('.mire-ui-demo__result');
  const text = result === null || (result as { action?: string })?.action === 'cancel' ? t('demo.dialogs.cancelled') : JSON.stringify(result);
  if (!(el instanceof HTMLElement)) return;
  el.textContent = t('demo.dialogs.result', { result: text });
  el.dataset.result = JSON.stringify(result ?? null);
}

const d = (key: string) => t(`demo.dialogs.${key}`);
const pictures = (): string[] => S.images.map((it) => String(it.path ?? '')).filter(Boolean);

function demoForm(): Promise<unknown> {
  return openForm({
    title: d('form.title'),
    help: d('form.help'),
    fields: [
      { id: 'name', label: d('form.name'), value: d('form.title'), required: true },
      { id: 'year', label: d('form.year'), value: '1902', options: ['1902', '1903'] },
      {
        id: 'kind',
        type: 'select',
        label: d('form.kind'),
        value: 'film',
        options: [
          ['film', d('form.film')],
          ['series', d('form.series')],
        ],
      },
      { id: 'summary', type: 'textarea', label: d('form.summary'), rows: 3 },
      { id: 'poster', type: 'image', label: d('form.poster'), value: pictures()[0] ?? '' },
      { id: 'program', label: d('form.program'), browse: 'file' },
      { id: 'subtitles', type: 'toggle', label: d('form.subtitles'), value: true },
      { id: 'sources', type: 'list', label: d('form.sources'), placeholder: d('form.sourcesHint'), value: ['/films'] },
    ],
    actions: [
      { id: 'save', label: d('form.save'), kind: 'primary' },
      { id: 'nested', label: d('form.nested') },
      { id: 'cancel', label: t('common.cancel'), kind: 'ghost' },
    ],
    async onAction(action, form) {
      if (action === 'nested') {
        showResult({ nested: await confirmDialog(d('confirm.title'), d('confirm.help'), d('confirm.yes')) });
        return true;
      }
      if (action === 'pick:poster') form.setImage('poster', pictures()[1] ?? pictures()[0] ?? '');
      if (action === 'clear:poster') form.setImage('poster', '');
      return action.includes(':');
    },
  });
}

function demoTabs(): Promise<unknown> {
  return openForm({
    title: d('tabs.title'),
    tabs: [
      { id: 'general', label: d('tabs.general'), fields: [{ id: 'name', label: d('form.name'), value: d('form.title') }] },
      {
        id: 'playback',
        label: d('tabs.playback'),
        fields: [
          { id: 'subtitles', type: 'toggle', label: d('form.subtitles') },
          {
            id: 'quality',
            type: 'select',
            label: d('tabs.quality'),
            options: [
              ['auto', d('tabs.auto')],
              ['high', d('tabs.high')],
            ],
          },
        ],
      },
    ],
    actions: [
      { id: 'save', label: d('form.save'), kind: 'primary' },
      { id: 'cancel', label: t('common.cancel'), kind: 'ghost' },
    ],
  });
}

// Fiches : une image qui ne se charge pas (la vignette de secours la remplace), une sans image (l'initiale), une image.
function demoPick(): Promise<unknown> {
  const [first, second] = pictures();
  return pickCandidate(
    [
      { id: 'tmdb:1', title: d('form.title'), year: 1902, image: 'media://local/?p=%2Fintrouvable.jpg', fallback: first },
      { id: 'tmdb:2', title: d('tabs.title'), year: 1903 },
      { id: 'tmdb:3', title: d('form.film'), sub: d('form.series'), image: second },
    ],
    { title: d('pick.title'), help: d('pick.help') },
  );
}

const OPENERS: Record<DialogKind, () => Promise<unknown>> = {
  form: demoForm,
  confirm: () => confirmDialog(d('confirm.title'), d('confirm.help'), d('confirm.yes')),
  pick: demoPick,
  tabs: demoTabs,
  notify: () => notify(d('notice')).then(() => ({ notice: true })),
};

/** Branche les boutons de la démonstration des boîtes (`mireDemoDialog` de `mire-demo`). */
export function initDemoDialogs(): void {
  document.addEventListener('mireDemoDialog', (e) => {
    const kind = (e as CustomEvent<{ kind: string }>).detail?.kind as DialogKind;
    if ((DIALOG_KINDS as readonly string[]).includes(kind)) void OPENERS[kind]().then(showResult);
  });
}

function dialogsDemo(): string {
  const button = (kind: DialogKind) =>
    `<ds-trigger type="button" mods="stl-2" data-demo-dialog="${kind}" target="mire-demo" action='openDialog:[{"kind":"${kind}"}]'>${esc(d(`open.${kind}`))}</ds-trigger>`;
  return `<section class="mire-ui-demo__dialogs" aria-labelledby="demo-dialogs">
    <p class="mire-ui-demo__name" id="demo-dialogs">${esc(d('heading'))}</p>
    <div class="mire-ui-demo__row">${DIALOG_KINDS.map(button).join('')}</div>
    <p class="mire-ui-demo__result" role="status"></p>
  </section>`;
}

/** Contenu de la page, inséré dans la vue de l'interface historique. */
export function viewDemo(): string {
  return `<div class="mire-ui-demo" lang="${esc(i18n.language || 'fr')}">
    <mire-demo heading="${esc(t('demo.component.heading'))}" action-label="${esc(t('demo.component.action'))}" count-labels="${esc(countForms)}" picked-label="${esc(t('demo.elements.picked'))}"></mire-demo>
    ${elementsDemo()}
    <div class="mire-ui-demo__palettes">${PALETTES.map(palette).join('')}</div>
    ${dialogsDemo()}
  </div>`;
}
