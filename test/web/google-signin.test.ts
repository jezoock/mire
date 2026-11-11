// Extension « connexion Google » (P1-13) : identité Electron dans les requêtes et dans la page de connexion.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleSignin, userAgentScript } from '../../src/main/web/index.ts';

type Any = any;

const pages: Record<number, string> = { 1: 'https://accounts.google.com/v3/signin', 2: 'https://www.youtube.com/' };
const google = createGoogleSignin({
  nativeUserAgent: 'Mozilla/5.0 Electron/44',
  contentsFromId: (id) => (pages[id] ? { getURL: () => pages[id], isDestroyed: () => false } : null),
});

describe('connexion Google', () => {
  test('en-tête User-Agent : page de connexion et ce qu’elle charge, seulement', () => {
    const headers = (details: Any) =>
      (google.webRequest!.onBeforeSendHeaders!({ requestHeaders: { 'User-Agent': 'Chrome', Accept: '*/*' }, ...details }) as Any)?.requestHeaders;
    assert.deepEqual(headers({ resourceType: 'mainFrame', url: 'https://accounts.google.com/' }), { 'User-Agent': 'Mozilla/5.0 Electron/44', Accept: '*/*' });
    assert.equal(headers({ resourceType: 'xhr', url: 'https://www.gstatic.com/x', webContentsId: 1 })['User-Agent'], 'Mozilla/5.0 Electron/44');
    assert.equal(headers({ resourceType: 'xhr', url: 'https://www.gstatic.com/x', webContentsId: 2 }), undefined);
    assert.equal(headers({ resourceType: 'xhr', url: 'https://www.gstatic.com/x', webContentsId: 9 }), undefined);
    assert.equal(headers({ resourceType: 'mainFrame', url: 'https://www.google.com/' }), undefined);
    assert.equal(google.webRequest!.onBeforeRequest, undefined);
  });

  test('script de page : sur la page de connexion seulement, cadre et page', () => {
    assert.equal(google.beforePageScript!(pages[1], pages[1]), userAgentScript('Mozilla/5.0 Electron/44'));
    assert.equal(google.beforePageScript!(pages[2], pages[2]), '');
    // Cadre de connexion dans un autre site : ses requêtes gardent l'identité Chrome, la page aussi.
    assert.equal(google.beforePageScript!(pages[1], pages[2]), '');
  });

  test('le script aligne navigator.userAgent et appVersion', () => {
    class Navigator {}
    const nav = new Navigator() as Any;
    new Function('Navigator', userAgentScript('Mozilla/5.0 "Electron"/44'))(Navigator);
    assert.equal(nav.userAgent, 'Mozilla/5.0 "Electron"/44');
    assert.equal(nav.appVersion, '5.0 "Electron"/44');
  });
});
