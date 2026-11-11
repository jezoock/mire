// Fin d'un téléchargement vue des jeux (reprise du `onFinished` de l'ancien index.js) : marque-page de jeu,
// « download-finished » et annonce « jeu ajouté ».
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onDownloadFinished, romDownloadNotice } from '../../src/main/games/download-finished.ts';
import type { DownloadRecord } from '../../src/main/downloads/types.ts';

const rec = (over: Partial<DownloadRecord> = {}): DownloadRecord => ({
  id: 'd1',
  kind: 'http',
  createdAt: 0,
  name: 'Jeu.zip',
  source: 'https://ex.org/Jeu.zip',
  dir: '/roms/snes',
  console: 'snes',
  consoleName: 'Super Nintendo',
  state: 'done',
  received: 1,
  total: 1,
  speed: 0,
  error: '',
  installers: [],
  ...over,
});

describe('romDownloadNotice', () => {
  it('jeu d’une console : annoncé, avec « décompressé »', () => {
    assert.deepEqual(romDownloadNotice(rec({ extracted: true }), []), {
      phase: 'done',
      console: 'snes',
      consoleName: 'Super Nintendo',
      name: 'Jeu.zip',
      extracted: true,
    });
    assert.equal(romDownloadNotice(rec(), [])?.extracted, false);
  });

  it('téléchargement sans console : rien', () => {
    assert.equal(romDownloadNotice(rec({ console: null }), []), null);
  });

  it('index qui attend ses pistes : rien encore', () => {
    assert.equal(romDownloadNotice(rec({ name: 'Jeu.cue', companions: ['Jeu.bin'] }), []), null);
  });

  it('jeu sur disque : un seul message, quand le dernier fichier est arrivé, index compris', () => {
    const a = rec({ id: 'a', name: 'Jeu (Piste 1).bin', group: 'Jeu' });
    const b = rec({ id: 'b', name: 'Jeu (Piste 2).bin', group: 'Jeu', state: 'running' });
    const index = rec({ id: 'i', name: 'Jeu.cue', companions: ['Jeu (Piste 1).bin'] });
    const other = rec({ id: 'o', name: 'Autre.cue', companions: [] });
    assert.equal(romDownloadNotice(a, [a, b, index, other]), null);
    const done = { ...b, state: 'error', extracted: true };
    assert.deepEqual(romDownloadNotice(done, [a, done, index, other]), {
      phase: 'done',
      console: 'snes',
      consoleName: 'Super Nintendo',
      name: 'Jeu',
      files: 3,
      extracted: true,
    });
  });

  it('jeu sur disque : les fichiers d’une autre console ne comptent pas', () => {
    const a = rec({ id: 'a', group: 'Jeu' });
    const b = rec({ id: 'b', group: 'Jeu', console: 'psx', state: 'running' });
    assert.equal(romDownloadNotice(a, [a, b])?.files, 1);
  });
});

describe('onDownloadFinished', () => {
  const setup = (bookmark: () => Promise<void> = async () => {}) => {
    const sent: [string, unknown][] = [];
    const logs: string[] = [];
    const finished = onDownloadFinished({
      onBookmarkDownloaded: bookmark,
      list: () => [],
      toUi: (channel, payload) => sent.push([channel, payload]),
      log: (m) => logs.push(m),
    });
    return { sent, logs, finished };
  };

  it('téléchargement ordinaire : prévient l’interface, puis annonce le jeu', () => {
    const { sent, finished } = setup();
    const item = rec();
    finished(item);
    assert.deepEqual(
      sent.map(([c]) => c),
      ['download-finished', 'rom-download'],
    );
    assert.equal(sent[0][1], item);
  });

  it('marque-page de jeu : « download-finished » seulement une fois la fiche reportée, même en cas d’échec', async () => {
    let release!: () => void;
    const { sent, logs, finished } = setup(
      () =>
        new Promise<void>((_resolve, reject) => {
          release = () => reject(new Error('fiche introuvable'));
        }),
    );
    finished(rec({ console: null, gameBookmark: 'gb1' }));
    assert.equal(sent.length, 0);
    release();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(
      sent.map(([c]) => c),
      ['download-finished'],
    );
    assert.deepEqual(logs, ['Marque-page de jeu : fiche introuvable']);
  });
});
