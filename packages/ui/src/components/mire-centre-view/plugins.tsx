import { h } from '@stencil/core';
import type { CentreLabels } from '../../utils/centre.ts';
import type { AppProgress } from '../../utils/centre.ts';
import type { PluginAction, PluginButton, PluginCard, PluginSheet, PluginsView, RepoCard, ReposView } from '../../utils/plugins.ts';
import { actionArgs } from '../../utils/plugins.ts';

/**
 * Onglets Plugins et Dépôts du Centre (P4-19), rendus par `mire-centre-view`. Tous les textes (noms, descriptions,
 * hôtes, adresses venus d'un index ou d'un manifeste) sont placés comme contenu : jamais comme HTML, ni en lien, ni en
 * image. Les actions vont au contrôleur `mire-centre`, avec la clé du plugin ou l'identifiant du dépôt.
 */

// Le nom de chaque action est écrit tel quel (`npm run check:actions` le vérifie) ; seuls ses arguments sont calculés.
const TRIGGERS: Record<PluginAction, (b: PluginButton, cls: string) => unknown> = {
  openPlugin: (b, cls) => (
    <ds-trigger class={cls} type="button" mods={`${b.style},sm`} disabled={b.disabled} target="mire-centre" action={`openPlugin:${b.args}`}>
      {b.label}
    </ds-trigger>
  ),
  installPlugin: (b, cls) => (
    <ds-trigger class={cls} type="button" mods={`${b.style},sm`} disabled={b.disabled} target="mire-centre" action={`installPlugin:${b.args}`}>
      {b.label}
    </ds-trigger>
  ),
  updatePlugin: (b, cls) => (
    <ds-trigger class={cls} type="button" mods={`${b.style},sm`} disabled={b.disabled} target="mire-centre" action={`updatePlugin:${b.args}`}>
      {b.label}
    </ds-trigger>
  ),
  enablePlugin: (b, cls) => (
    <ds-trigger class={cls} type="button" mods={`${b.style},sm`} disabled={b.disabled} target="mire-centre" action={`enablePlugin:${b.args}`}>
      {b.label}
    </ds-trigger>
  ),
  disablePlugin: (b, cls) => (
    <ds-trigger class={cls} type="button" mods={`${b.style},sm`} disabled={b.disabled} target="mire-centre" action={`disablePlugin:${b.args}`}>
      {b.label}
    </ds-trigger>
  ),
  uninstallPlugin: (b, cls) => (
    <ds-trigger class={cls} type="button" mods={`${b.style},sm`} disabled={b.disabled} target="mire-centre" action={`uninstallPlugin:${b.args}`}>
      {b.label}
    </ds-trigger>
  ),
};

const trigger = (b: PluginButton, cls = '') => TRIGGERS[b.action]?.(b, `mire-centre-view__act --${b.action} ${cls}`.trim()) ?? null;

function progress(p: AppProgress | null) {
  if (!p) return null;
  return (
    <div class="mire-centre-view__progress">
      <div class={{ 'mire-centre-view__bar': true, '--indeterminate': p.percent === null }}>
        <i style={{ width: `${p.percent ?? 35}%` }} />
      </div>
      <p class="mire-centre-view__status" role="status">
        {p.text}
      </p>
    </div>
  );
}

const badges = (list: string[]) =>
  list.length > 0 && (
    <span class="mire-centre-view__badges">
      {list.map((b) => (
        <span class="mire-centre-view__badge">{b}</span>
      ))}
    </span>
  );

function pluginCard(c: PluginCard) {
  return (
    <article key={c.key} class="mire-centre-view__card mire-centre-view__plugin" data-key={c.key}>
      <div class="mire-centre-view__card-head">
        <h3 class="mire-centre-view__name">{c.name}</h3>
        {c.status && <span class={{ 'mire-centre-view__state': true, [`--${c.tone}`]: !!c.tone }}>{c.status}</span>}
      </div>
      {badges(c.badges)}
      <p class="mire-centre-view__meta">{c.meta}</p>
      {c.desc && <p class="mire-centre-view__desc">{c.desc}</p>}
      {progress(c.progress)}
      <div class="mire-centre-view__actions">{c.buttons.map((b) => trigger(b))}</div>
    </article>
  );
}

function group(name: string, title: string | undefined, cards: PluginCard[], empty: string | undefined) {
  return (
    <section class="mire-centre-view__group" data-group={name}>
      <h2 class="mire-centre-view__heading">
        {title} <span class="mire-centre-view__count">{cards.length}</span>
      </h2>
      {cards.length ? <div class="mire-centre-view__cards">{cards.map(pluginCard)}</div> : <p class="mire-centre-view__hint">{empty}</p>}
    </section>
  );
}

function list(title: string | undefined, items: { text: string; sensitive?: boolean }[], empty: string | undefined, name: string) {
  return (
    <section class="mire-centre-view__sheet-part" data-part={name}>
      <h3 class="mire-centre-view__sheet-title">{title}</h3>
      {items.length ? (
        <ul class="mire-centre-view__sheet-list">
          {items.map((i) => (
            <li class={{ '--sensitive': !!i.sensitive }}>{i.text}</li>
          ))}
        </ul>
      ) : (
        <p class="mire-centre-view__help">{empty}</p>
      )}
    </section>
  );
}

function sheet(s: PluginSheet, l: CentreLabels) {
  return (
    <article class="mire-centre-view__sheet" data-key={s.key} aria-label={l.sheetLabel || undefined}>
      <ds-trigger class="mire-centre-view__sheet-back" type="button" mods="stl-3,sm" target="mire-centre" action="closePlugin">
        {l.back}
      </ds-trigger>
      <div class="mire-centre-view__card-head">
        <h2 class="mire-centre-view__sheet-name">{s.name}</h2>
        {badges(s.badges)}
      </div>
      {s.desc && <p class="mire-centre-view__desc">{s.desc}</p>}
      {s.warning && (
        <p class="mire-centre-view__warning" role="note">
          {s.warning}
        </p>
      )}
      {s.message && <p class="mire-centre-view__error">{s.message}</p>}
      <dl class="mire-centre-view__facts">{s.facts.map((f) => [<dt>{f.label}</dt>, <dd>{f.value}</dd>])}</dl>
      {list(l.sheetPermissions, s.permissions, l.noPermissions, 'permissions')}
      {list(
        l.sheetContributes,
        s.contributes.map((text) => ({ text })),
        l.noContributes,
        'contributes',
      )}
      {list(
        l.sheetDependencies,
        s.dependencies.map((text) => ({ text })),
        l.noDependencies,
        'dependencies',
      )}
      {progress(s.progress)}
      <div class="mire-centre-view__actions">{s.buttons.map((b) => trigger(b, 'mire-centre-view__sheet-action'))}</div>
    </article>
  );
}

export function renderPlugins(v: PluginsView | null, l: CentreLabels) {
  if (!v) return <p class="mire-centre-view__hint">{l.pluginsLoading}</p>;
  if (v.sheet) return sheet(v.sheet, l);
  return [
    <section class="mire-centre-view__add">
      <div class="mire-centre-view__buttons">
        <ds-trigger class="mire-centre-view__refresh" type="button" mods="stl-1" target="mire-centre" action="refreshRepos">
          {l.pluginsRefresh}
        </ds-trigger>
      </div>
      <p class="mire-centre-view__hint">{v.checked}</p>
      <p class="mire-centre-view__help">{l.pluginsIntro}</p>
    </section>,
    v.updates.length > 0 && group('updates', l.updates, v.updates, ''),
    group('installed', l.installed, v.installed, l.noInstalled),
    group('available', l.available, v.available, l.noAvailable),
  ];
}

function repoCard(r: RepoCard, l: CentreLabels) {
  return (
    <article key={r.id} class="mire-centre-view__card mire-centre-view__repo" data-key={r.id}>
      <div class="mire-centre-view__card-head">
        <h3 class="mire-centre-view__name">{r.name}</h3>
        <span class="mire-centre-view__badge">{r.badge}</span>
      </div>
      <dl class="mire-centre-view__facts">
        <dt>{l.reposIndex}</dt>
        <dd class="mire-centre-view__address">{r.index}</dd>
        <dt>{l.reposFingerprint}</dt>
        <dd class="mire-centre-view__fingerprint">{r.fingerprint}</dd>
      </dl>
      <p class="mire-centre-view__meta">{r.date}</p>
      {r.error && <p class="mire-centre-view__error">{r.error}</p>}
      {r.removable && (
        <div class="mire-centre-view__actions">
          <ds-trigger type="button" mods="stl-3,sm" target="mire-centre" action={`removeRepository:${actionArgs({ id: r.id })}`}>
            {l.reposRemove}
          </ds-trigger>
        </div>
      )}
    </article>
  );
}

export function renderRepos(v: ReposView | null, l: CentreLabels) {
  if (!v) return <p class="mire-centre-view__hint">{l.reposLoading}</p>;
  return [
    <section class="mire-centre-view__add">
      <div class="mire-centre-view__buttons">
        <ds-trigger class="mire-centre-view__add-repo" type="button" mods="stl-1" target="mire-centre" action="addRepository">
          {l.reposAdd}
        </ds-trigger>
        <ds-trigger type="button" mods="stl-2" target="mire-centre" action="refreshRepos">
          {l.reposRefresh}
        </ds-trigger>
      </div>
      <p class="mire-centre-view__help">{l.reposIntro}</p>
    </section>,
    <section class="mire-centre-view__group" data-group="repos">
      {v.repos.length ? <div class="mire-centre-view__cards">{v.repos.map((r) => repoCard(r, l))}</div> : <p class="mire-centre-view__hint">{l.reposNone}</p>}
    </section>,
  ];
}
