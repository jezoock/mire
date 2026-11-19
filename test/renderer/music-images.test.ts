// Lecteurs de musique et d'images (P4-15) : file d'attente, textes du mini-lecteur, liste parcourue par la visionneuse,
// image suivante en boucle et préchargement.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RESTART_AFTER, stepInQueue, trackSubheading } from '../../src/renderer/players/music-model.ts';
import { imageSubheading, preloadPath, viewerList, wrapStep } from '../../src/renderer/players/images-model.ts';
import fr from '../../packages/shared/src/i18n/locales/fr.json' with { type: 'json' };
import en from '../../packages/shared/src/i18n/locales/en.json' with { type: 'json' };

type Messages = Record<string, unknown>;
function translator(messages: Messages) {
  return (key: string, vars: Record<string, string | number> = {}) => {
    const v = key.split('.').reduce<unknown>((o, k) => (o as Messages | undefined)?.[k], messages);
    assert.equal(typeof v, 'string', key);
    return (v as string).replace(/\{(\w+)\}/g, (_, n: string) => String(vars[n]));
  };
}
const tFr = translator(fr.messages as Messages);
const tEn = translator(en.messages as Messages);

describe('lecteur de musique : file d’attente', () => {
  it('une file vide ne fait rien', () => {
    assert.equal(stepInQueue(-1, 0, 1, 0), null);
  });

  it('« suivant » lit le morceau suivant, et s’arrête après le dernier', () => {
    assert.deepEqual(stepInQueue(0, 3, 1, 50), { kind: 'play', index: 1 });
    assert.deepEqual(stepInQueue(2, 3, 1, 50), { kind: 'stop' });
  });

  it('« précédent » revient au début du morceau après 3 s de lecture', () => {
    assert.deepEqual(stepInQueue(1, 3, -1, RESTART_AFTER + 0.5), { kind: 'restart' });
    assert.deepEqual(stepInQueue(1, 3, -1, RESTART_AFTER), { kind: 'play', index: 0 });
  });

  it('« précédent » sur le premier morceau revient à son début', () => {
    assert.deepEqual(stepInQueue(0, 3, -1, 1), { kind: 'restart' });
  });

  it('le sous-titre donne la place dans la file quand elle a plusieurs morceaux', () => {
    assert.equal(trackSubheading('Premier album', 0, 1, tFr), 'Premier album');
    assert.equal(trackSubheading('Premier album', 1, 2, tFr), 'Premier album, 2 sur 2');
    assert.equal(trackSubheading('First album', 0, 3, tEn), 'First album, 1 of 3');
  });
});

describe('visionneuse d’images', () => {
  const a = { path: '/a.png', native: true };
  const b = { path: '/b.heic', native: false };
  const c = { path: '/c.jpg', native: true };
  const d = { path: '/d.webp', native: true };

  it('ne parcourt que les images qu’elle sait afficher', () => {
    assert.deepEqual(viewerList([a, b, c, d], c), { list: [a, c, d], index: 1 });
    assert.deepEqual(viewerList([a, b], b), { list: [a], index: 0 });
  });

  it('passe d’une image à l’autre en boucle', () => {
    assert.equal(wrapStep(2, 3, 1), 0);
    assert.equal(wrapStep(0, 3, -1), 2);
    assert.equal(wrapStep(1, 3, 1), 2);
    assert.equal(wrapStep(0, 0, 1), 0);
  });

  it('précharge l’image suivante, sauf après la dernière', () => {
    assert.equal(preloadPath([a, c, d], 0), '/c.jpg');
    assert.equal(preloadPath([a, c, d], 2), null);
    assert.equal(preloadPath([a, b], 0), null);
  });

  it('texte : place de l’image et dossier', () => {
    assert.equal(imageSubheading(0, 2, 'Vacances', tFr), '1 sur 2, Vacances');
    assert.equal(imageSubheading(1, 2, 'Holidays', tEn), '2 of 2, Holidays');
  });
});
