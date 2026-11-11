// Extensions des vues web (P1-13) : compositeur des événements webRequest et script d'avant-page agrégé.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { beforePageScriptOf, composeWebRequest, createWebExtensions, type RequestResponse, type WebExtension } from '../../src/main/web/index.ts';

type Any = any;

const ext = (id: string, more: Partial<WebExtension> = {}): WebExtension => ({ id, attach() {}, detach() {}, ...more });

// Appelle l'écouteur composé comme le ferait Electron.
function call(listener: Any, details: Any): Promise<RequestResponse> {
  return new Promise((resolve) => listener(details, resolve));
}

describe('compositeur webRequest', () => {
  test('deux extensions sur le même événement, appelées dans l’ordre', async () => {
    const seen: string[] = [];
    const listener = composeWebRequest(
      [
        ext('a', { webRequest: { onBeforeRequest: () => void seen.push('a') } }),
        ext('b', { webRequest: { onBeforeRequest: async () => void seen.push('b') } }),
      ],
      'onBeforeRequest',
    );
    assert.deepEqual(await call(listener, { url: 'https://site/' }), {});
    assert.deepEqual(seen, ['a', 'b']);
  });

  test('la première annulation l’emporte : les suivantes ne sont pas appelées', async () => {
    const seen: string[] = [];
    const listener = composeWebRequest(
      [
        ext('a', { webRequest: { onBeforeRequest: () => (seen.push('a'), {}) } }),
        ext('b', { webRequest: { onBeforeRequest: () => (seen.push('b'), { cancel: true }) } }),
        ext('c', { webRequest: { onBeforeRequest: () => (seen.push('c'), { redirectURL: 'data:,' }) } }),
      ],
      'onBeforeRequest',
    );
    assert.deepEqual(await call(listener, { url: 'https://pub/' }), { cancel: true });
    assert.deepEqual(seen, ['a', 'b']);
  });

  test('redirection : rend la main aussitôt', async () => {
    const listener = composeWebRequest(
      [
        ext('a', { webRequest: { onBeforeRequest: () => ({ redirectURL: 'data:text/javascript,' }) } }),
        ext('b', { webRequest: { onBeforeRequest: () => ({ cancel: true }) } }),
      ],
      'onBeforeRequest',
    );
    assert.deepEqual(await call(listener, { url: 'https://pub/x.js' }), { redirectURL: 'data:text/javascript,' });
  });

  test('en-têtes de requête modifiés par deux extensions : la seconde voit ceux de la première', async () => {
    const listener = composeWebRequest(
      [
        ext('a', { webRequest: { onBeforeSendHeaders: (d) => ({ requestHeaders: { ...d.requestHeaders, 'User-Agent': 'UA-A' } }) } }),
        ext('b', {
          webRequest: {
            onBeforeSendHeaders: (d) => ({ requestHeaders: { ...d.requestHeaders, 'X-Vu': String(d.requestHeaders?.['User-Agent']) } }),
          },
        }),
      ],
      'onBeforeSendHeaders',
    );
    const r = await call(listener, { url: 'https://site/', requestHeaders: { 'User-Agent': 'UA', Accept: '*/*' } });
    assert.deepEqual(r, { requestHeaders: { 'User-Agent': 'UA-A', Accept: '*/*', 'X-Vu': 'UA-A' } });
  });

  test('en-têtes de réponse modifiés par deux extensions ; aucun changement : réponse vide', async () => {
    const listener = composeWebRequest(
      [
        ext('a', {
          webRequest: { onHeadersReceived: (d) => ({ responseHeaders: { ...d.responseHeaders, 'content-security-policy': ['script-src none'] } }) },
        }),
        ext('b', { webRequest: { onHeadersReceived: (d) => ({ responseHeaders: { ...d.responseHeaders, 'x-b': ['1'] } }) } }),
      ],
      'onHeadersReceived',
    );
    const r = await call(listener, { url: 'https://site/', responseHeaders: { 'content-type': ['text/html'] } });
    assert.deepEqual(r, { responseHeaders: { 'content-type': ['text/html'], 'content-security-policy': ['script-src none'], 'x-b': ['1'] } });

    const idle = composeWebRequest([ext('a', { webRequest: { onHeadersReceived: () => ({}) } })], 'onHeadersReceived');
    assert.deepEqual(await call(idle, { url: 'https://site/', responseHeaders: { a: ['1'] } }), {});
  });

  test('une extension en erreur est ignorée ; aucune extension : pas d’écouteur', async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      const listener = composeWebRequest(
        [
          ext('a', {
            webRequest: {
              onBeforeRequest: () => {
                throw new Error('panne');
              },
            },
          }),
          ext('b', { webRequest: { onBeforeRequest: () => ({ cancel: true }) } }),
        ],
        'onBeforeRequest',
      );
      assert.deepEqual(await call(listener, { url: 'https://pub/' }), { cancel: true });
    } finally {
      console.error = original;
    }
    assert.equal(errors.length, 1);
    assert.equal(composeWebRequest([ext('a')], 'onBeforeRequest'), null);
  });
});

describe('hôte des extensions', () => {
  function fakeSession() {
    const listeners: Record<string, Any> = {};
    const on = (event: string) => (fn: Any) => (listeners[event] = fn);
    return {
      listeners,
      webRequest: { onBeforeRequest: on('onBeforeRequest'), onBeforeSendHeaders: on('onBeforeSendHeaders'), onHeadersReceived: on('onHeadersReceived') },
    };
  }

  test('un écouteur par événement utilisé, extensions branchées puis débranchées', () => {
    const log: string[] = [];
    const host = createWebExtensions([
      ext('a', { attach: () => void log.push('+a'), detach: () => void log.push('-a'), webRequest: { onBeforeRequest: () => {} } }),
      ext('b', { attach: () => void log.push('+b'), detach: () => void log.push('-b'), webRequest: { onHeadersReceived: () => {} } }),
    ]);
    const ses = fakeSession();
    host.attach(ses as Any);
    assert.deepEqual(Object.keys(ses.listeners).sort(), ['onBeforeRequest', 'onHeadersReceived']);
    assert.equal(typeof ses.listeners.onBeforeRequest, 'function');
    host.detach();
    assert.equal(ses.listeners.onBeforeRequest, null);
    assert.equal(ses.listeners.onHeadersReceived, null);
    assert.equal(ses.listeners.onBeforeSendHeaders, undefined);
    assert.deepEqual(log, ['+a', '+b', '-b', '-a']);
    assert.equal(host.get('b')?.id, 'b');
    assert.equal(host.get('z'), null);
  });

  test('garde de navigation, compteurs, bouclier et états', () => {
    const counts = new Map([[7, 3]]);
    const host = createWebExtensions([
      ext('a', {
        guardNavigation: (url) => url.includes('pub'),
        blockedCount: (id) => counts.get(id) || 0,
        resetPage: (id) => void counts.delete(id),
        status: () => ({ on: true }),
      }),
      ext('b', { blockedCount: () => 2, activeOn: (url) => url.startsWith('https:') }),
    ]);
    assert.equal(host.guardNavigation('https://pub.example/', 'https://site/'), true);
    assert.equal(host.guardNavigation('https://site/2', 'https://site/'), false);
    assert.equal(host.blockedCount(7), 5);
    host.resetPage(7);
    assert.equal(host.blockedCount(7), 2);
    assert.equal(host.activeOn('https://site/'), true);
    assert.equal(host.activeOn('http://site/'), false);
    assert.deepEqual(host.statuses(), { a: { on: true } });
  });
});

describe('script d’avant-page agrégé', () => {
  test('scripts des extensions dans l’ordre, chacun dans son bloc ; vides et erreurs ignorés', () => {
    const list = [
      ext('a', { beforePageScript: (url) => `a(${JSON.stringify(url)});` }),
      ext('vide', { beforePageScript: () => '' }),
      ext('sans'),
      ext('panne', {
        beforePageScript: () => {
          throw new Error('panne');
        },
      }),
      ext('b', { beforePageScript: (url, top) => `b(${JSON.stringify(top)});` }),
    ];
    const code = beforePageScriptOf(list, 'https://cadre/', 'https://page/');
    assert.equal(code, 'try {\na("https://cadre/");\n} catch (e) {}\ntry {\nb("https://page/");\n} catch (e) {}');
    assert.equal(createWebExtensions(list).beforePageScript('https://x/'), 'try {\na("https://x/");\n} catch (e) {}\ntry {\nb("https://x/");\n} catch (e) {}');
    assert.equal(beforePageScriptOf([ext('vide')], 'https://x/'), '');
  });

  test('l’échec d’un script n’arrête pas le suivant', () => {
    const code = beforePageScriptOf(
      [ext('a', { beforePageScript: () => 'throw new Error("a");' }), ext('b', { beforePageScript: () => 'globalThis.__vu = "b";' })],
      'https://x/',
    );
    new Function(code)();
    assert.equal((globalThis as Any).__vu, 'b');
    delete (globalThis as Any).__vu;
  });
});
