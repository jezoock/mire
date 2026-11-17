/**
 * Page de démonstration interne de l'interface (P4-01), cachée : aucune entrée du menu n'y mène. On l'ouvre avec
 * l'adresse `#demo` (dans les outils de développement, F12 : `location.hash = 'demo'`). Elle montre le composant
 * `mire-demo` de `@mire/ui` dans le gabarit historique, et les composants ds-* utilisés par Mire dans les cinq
 * thèmes actuels (palettes en P4-02). Ses textes viennent des catalogues, dans la langue de l'interface.
 */
import { esc } from '../core/dom.ts';
import { i18n, t } from '../i18n/index.ts';

export const DEMO_SECTION = 'demo';

/** Les cinq thèmes actuels, futurs jeux de jetons (palettes, P4-02). */
const PALETTES = ['ecran', 'jour', 'minuit', 'velours', 'contraste'] as const;

let countForms = '';

/** Vrai si l'adresse de la page demande la démonstration. */
export const isDemoHash = (hash: string): boolean => hash.replace(/^#/, '') === DEMO_SECTION;

/** Attend les textes de la page (service de traduction de l'interface), avant son premier affichage. */
export async function loadDemoTexts(): Promise<void> {
  await i18n.ready();
  // Catalogues indisponibles : la page affiche les clés, elle reste utilisable.
  const forms = i18n.raw('demo.component.count');
  countForms = forms && typeof forms === 'object' ? JSON.stringify(forms) : '';
}

export const demoTitle = (): string => t('demo.title');

function palette(id: (typeof PALETTES)[number], index: number): string {
  const range = `demo-range-${index}`;
  return `<section class="mire-ui-demo__palette" data-theme="${id}" aria-labelledby="demo-palette-${index}">
    <p class="mire-ui-demo__name" id="demo-palette-${index}">${esc(t(`demo.palettes.${id}`))}</p>
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

/** Contenu de la page, inséré dans la vue de l'interface historique. */
export function viewDemo(): string {
  return `<div class="mire-ui-demo" lang="${esc(i18n.language || 'fr')}">
    <mire-demo heading="${esc(t('demo.component.heading'))}" action-label="${esc(t('demo.component.action'))}" count-labels="${esc(countForms)}"></mire-demo>
    <div class="mire-ui-demo__palettes">${PALETTES.map(palette).join('')}</div>
  </div>`;
}
