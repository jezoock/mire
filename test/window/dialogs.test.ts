// Boîtes de dialogue système (reprise de pickFolder / pickFile / openMediaDialog / pickMetaImage de l'ancien index.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDialogs, fileFilters, mediaExtensions } from '../../src/main/window/dialogs.ts';

const ALL = { name: 'Tous les fichiers', extensions: ['*'] };

describe('fileFilters', () => {
  it('programme et jeu : selon le système ; image : partout ; toujours « Tous les fichiers » en dernier', () => {
    assert.deepEqual(fileFilters('program', 'win32'), [{ name: 'Programmes', extensions: ['exe'] }, ALL]);
    assert.deepEqual(fileFilters('program', 'darwin'), [{ name: 'Applications', extensions: ['app'] }, ALL]);
    assert.deepEqual(fileFilters('program', 'linux'), [ALL]);
    assert.deepEqual(fileFilters('game', 'win32'), [{ name: 'Jeux et raccourcis', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }, ALL]);
    assert.deepEqual(fileFilters('game', 'darwin'), [{ name: 'Applications', extensions: ['app'] }, ALL]);
    assert.deepEqual(fileFilters('image', 'linux'), [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }, ALL]);
    assert.deepEqual(fileFilters('autre', 'win32'), [ALL]);
    assert.deepEqual(fileFilters(undefined, 'win32'), [ALL]);
  });

  it('extensions des médias : sans le point', () => {
    const ext = mediaExtensions();
    assert.ok(ext.includes('mkv') && ext.includes('mp3') && ext.includes('jpg'));
    assert.ok(ext.every((e) => !e.startsWith('.')));
  });
});

describe('createDialogs', () => {
  const setup = (answer: { canceled: boolean; filePaths: string[] }) => {
    const calls: [unknown, Record<string, any>][] = [];
    const win = { id: 'fenêtre' };
    const dialogs = createDialogs({
      dialog: {
        showOpenDialog: async (w, options) => {
          calls.push([w, options]);
          return answer;
        },
      },
      window: () => win,
      platform: 'win32',
      itemFromPath: async (p) => (p.endsWith('.mkv') ? ({ path: p } as never) : null),
    });
    return { calls, win, dialogs };
  };

  it('dossier et fichier : au-dessus de la fenêtre, null si annulé', async () => {
    const { calls, win, dialogs } = setup({ canceled: false, filePaths: ['/x'] });
    assert.equal(await dialogs.pickFolder(), '/x');
    assert.equal(await dialogs.pickFile('program'), '/x');
    assert.equal(calls[0][0], win);
    assert.deepEqual(calls[0][1], { title: 'Choisir un dossier', properties: ['openDirectory'] });
    assert.deepEqual(calls[1][1], { properties: ['openFile'], filters: [{ name: 'Programmes', extensions: ['exe'] }, ALL] });
    const canceled = setup({ canceled: true, filePaths: [] }).dialogs;
    assert.equal(await canceled.pickFolder(), null);
    assert.equal(await canceled.pickFile('image'), null);
  });

  it('médias : plusieurs fichiers, seuls ceux que Mire sait lire', async () => {
    const { calls, dialogs } = setup({ canceled: false, filePaths: ['/a.mkv', '/b.txt', '/c.mkv'] });
    assert.deepEqual(await dialogs.openMedia(), [{ path: '/a.mkv' }, { path: '/c.mkv' }]);
    assert.equal(calls[0][1].title, 'Ouvrir des fichiers');
    assert.deepEqual(calls[0][1].properties, ['openFile', 'multiSelections']);
    assert.deepEqual(calls[0][1].filters[1], ALL);
    assert.deepEqual(await setup({ canceled: true, filePaths: [] }).dialogs.openMedia(), []);
  });

  it('image d’un élément : titre selon le champ', async () => {
    const { calls, dialogs } = setup({ canceled: false, filePaths: ['/i.png'] });
    assert.equal(await dialogs.chooseMetaImage('image'), '/i.png');
    assert.equal(await dialogs.chooseMetaImage('backdrop'), '/i.png');
    assert.equal(calls[0][1].title, 'Choisir l’image');
    assert.equal(calls[1][1].title, 'Choisir le fond d’écran');
    assert.deepEqual(calls[0][1].filters, [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'] }]);
    assert.equal(await setup({ canceled: false, filePaths: [] }).dialogs.chooseMetaImage('image'), null);
  });
});
