import { Component, Host, Prop, h } from '@stencil/core';
import { isLongGlyph, readProp } from '../../utils/shell.ts';
import type { PadHint } from '../../utils/shell.ts';

/**
 * Aide de la manette (P4-07) : en bas de l'écran, les boutons utiles dans le contexte affiché et ce qu'ils font.
 * Cachée sans aide (pas de manette, ou contexte sans rappel). Libellés des boutons et textes viennent de la page.
 */
@Component({ tag: 'mire-padbar', shadow: false })
export class MirePadbar {
  /** Aides (`PadHint`), en propriété ou en JSON. */
  @Prop() hints: PadHint[] | string = [];

  render() {
    const hints = readProp<PadHint[]>(this.hints, []);
    return (
      <Host class="mire-padbar padbar" hidden={!hints.length} aria-hidden="true">
        {hints.map((hint) => (
          <span class="ph">
            {hint.glyphs.map((g) => (
              <span class={{ pb: true, long: isLongGlyph(g) }}>{g}</span>
            ))}
            {hint.label}
          </span>
        ))}
      </Host>
    );
  }
}
