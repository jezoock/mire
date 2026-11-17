// @mire/shared réexporte les types d'élément et la notation des cibles du SDK des plugins, sans les recopier : les
// deux ne peuvent pas diverger. Ce test le garde (mêmes fonctions à l'exécution, mêmes types pour `npm run typecheck`).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '@mire/shared';
import * as sdk from '../../packages/plugin-sdk/src/index.ts';

/** Égalité stricte de deux types : vaut `true` seulement s'ils sont identiques. */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const same = <A, B>(ok: Same<A, B>): boolean => ok;

describe('@mire/shared et @mire/plugin-sdk', () => {
  it('partagent la notation des cibles', () => {
    assert.equal(shared.parseTarget, sdk.parseTarget);
    assert.equal(shared.formatTarget, sdk.formatTarget);
    assert.equal(shared.isTarget, sdk.isTarget);
    assert.equal(shared.CORE_SCREENS, sdk.CORE_SCREENS);
    assert.equal(shared.PAGE_ID_RE, sdk.PAGE_ID_RE);
    assert.equal(shared.LIST_PAGE_PREFIX, sdk.LIST_PAGE_PREFIX);
  });

  it('partagent les types de l’élément', () => {
    assert.ok(same<shared.Element, sdk.Element>(true));
    assert.ok(same<shared.OpenSpec, sdk.OpenSpec>(true));
    assert.ok(same<shared.InfoValue, sdk.InfoValue>(true));
    assert.ok(same<shared.InfoType, sdk.InfoType>(true));
    assert.ok(same<shared.ElementSourceRef, sdk.ElementSourceRef>(true));
    assert.ok(same<shared.ValueOrigin, sdk.ValueOrigin>(true));
    assert.ok(same<shared.Target, sdk.Target>(true));
    assert.ok(same<shared.CoreScreen, sdk.CoreScreen>(true));
  });
});
