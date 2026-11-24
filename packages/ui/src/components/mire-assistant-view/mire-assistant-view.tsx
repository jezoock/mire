import { Component, Element, Host, Prop, h } from '@stencil/core';
import type { AssistantChoice, AssistantItem, AssistantView } from '../../utils/assistant.ts';
import { readJson } from '../../utils/elements.ts';
import { actionArgs } from '../../utils/plugins.ts';

function choiceTrigger(c: AssistantChoice, cls: string) {
  const body = [
    <span class="mire-assistant-view__choice-label">{c.label}</span>,
    c.description ? <span class="mire-assistant-view__choice-help">{c.description}</span> : null,
  ];
  const pressed = String(c.pressed);
  if (c.action === 'chooseBox')
    return (
      <ds-trigger
        type="button"
        mods="stl-3"
        class={cls}
        target="mire-assistant"
        aria-pressed={pressed}
        data-key={c.key}
        action={`chooseBox:${actionArgs({ id: c.key })}`}
      >
        {body}
      </ds-trigger>
    );
  if (c.action === 'toggleService')
    return (
      <ds-trigger
        type="button"
        mods="stl-3"
        class={cls}
        target="mire-assistant"
        aria-pressed={pressed}
        data-key={c.key}
        action={`toggleService:${actionArgs({ id: c.key })}`}
      >
        {body}
      </ds-trigger>
    );
  return (
    <ds-trigger
      type="button"
      mods="stl-3"
      class={cls}
      target="mire-assistant"
      aria-pressed={pressed}
      data-key={c.key}
      action={`toggleUse:${actionArgs({ key: c.key })}`}
    >
      {body}
    </ds-trigger>
  );
}

function item(i: AssistantItem) {
  return (
    <li class={{ 'mire-assistant-view__item': true, [`--${i.tone}`]: !!i.tone }} data-key={i.key}>
      <div class="mire-assistant-view__item-head">
        <span class="mire-assistant-view__item-name">{i.name}</span>
        {i.badges.map((b) => (
          <span class="mire-assistant-view__badge">{b}</span>
        ))}
        <span class="mire-assistant-view__item-reason">{i.reason}</span>
      </div>
      <ul class="mire-assistant-view__lines">
        {i.lines.map((l) => (
          <li class={{ '--sensitive': l.sensitive }}>{l.text}</li>
        ))}
      </ul>
      {i.progress !== null ? (
        <div class="mire-assistant-view__bar">
          <i style={{ width: `${i.progress}%` }} />
        </div>
      ) : null}
      {i.status ? (
        <p class="mire-assistant-view__status" role="status">
          {i.status}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Assistant du premier lancement (P4-23) : une étape à la fois (titre, explications, choix, plugins à installer et
 * leurs permissions, boutons), déjà rédigée par la page (`src/renderer/assistant/`). Habillage du cœur ; aucun texte
 * écrit ici ; les noms et descriptions venus de l'index restent des textes. L'élément à focaliser après un changement
 * d'étape porte la classe `--focus` (premier choix, sinon le bouton principal).
 */
@Component({ tag: 'mire-assistant-view', shadow: false })
export class MireAssistantView {
  @Element() host!: HTMLElement;

  /** Étape affichée (`AssistantView`), en propriété ou en JSON. */
  @Prop() view: AssistantView | string | null = null;

  componentDidRender() {
    this.host.dispatchEvent(new CustomEvent('mireAssistantRender', { detail: { step: readJson<AssistantView>(this.view)?.step ?? '' } }));
  }

  private buttons(v: AssistantView) {
    const b = v.buttons;
    const focusPrimary = !v.choices.length;
    const primary = (name: string) => ({ 'mire-assistant-view__primary': true, [`--${name}`]: true, '--focus': focusPrimary });
    return (
      <div class="mire-assistant-view__buttons" key="buttons">
        {b.back ? (
          <ds-trigger type="button" mods="stl-3" class="mire-assistant-view__back" target="mire-assistant" action="back">
            {b.back}
          </ds-trigger>
        ) : null}
        {b.skip ? (
          <ds-trigger type="button" mods="stl-3" class="mire-assistant-view__skip" target="mire-assistant" action="skip">
            {b.skip}
          </ds-trigger>
        ) : null}
        {b.openCentre ? (
          <ds-trigger type="button" mods="stl-2" class="mire-assistant-view__centre" target="mire-assistant" action="openCentre">
            {b.openCentre}
          </ds-trigger>
        ) : null}
        {b.start ? (
          <ds-trigger type="button" mods="stl-1" class={primary('start')} target="mire-assistant" action="start">
            {b.start}
          </ds-trigger>
        ) : null}
        {b.next ? (
          <ds-trigger type="button" mods="stl-1" class={primary('next')} target="mire-assistant" action="next">
            {b.next}
          </ds-trigger>
        ) : null}
        {b.install ? (
          <ds-trigger type="button" mods="stl-1" class={primary('install')} target="mire-assistant" action="install">
            {b.install}
          </ds-trigger>
        ) : null}
        {b.finish ? (
          <ds-trigger type="button" mods="stl-1" class={primary('finish')} target="mire-assistant" action="finish">
            {b.finish}
          </ds-trigger>
        ) : null}
      </div>
    );
  }

  render() {
    const v = readJson<AssistantView>(this.view);
    if (!v) return <Host class="mire-assistant-view --empty" />;
    return (
      <Host class={{ 'mire-assistant-view': true, [`--${v.step}`]: true }} role="region" aria-label={v.title}>
        {v.progress ? <p class="mire-assistant-view__progress">{v.progress}</p> : null}
        <h2 class="mire-assistant-view__title">{v.title}</h2>
        {v.paragraphs.map((p) => (
          <p class="mire-assistant-view__help">{p}</p>
        ))}
        {v.choices.length ? (
          <div key={`choices-${v.step}`} class={{ 'mire-assistant-view__choices': true, [`--${v.choiceMode}`]: true }} role="group" aria-label={v.choicesLabel}>
            {v.choices.map((c, i) => choiceTrigger(c, i === 0 ? 'mire-assistant-view__choice --focus' : 'mire-assistant-view__choice'))}
          </div>
        ) : null}
        {v.items.length ? (
          <ul key="items" class="mire-assistant-view__items" aria-label={v.itemsLabel}>
            {v.items.map(item)}
          </ul>
        ) : null}
        {v.busy ? (
          <p class="mire-assistant-view__busy" role="status">
            {v.busy}
          </p>
        ) : (
          this.buttons(v)
        )}
      </Host>
    );
  }
}
