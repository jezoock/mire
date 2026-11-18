// Lecteur vidéo (P4-14) : reprise, sous-titres, son absent, textes de l'affichage sur la vidéo, contrôleur
// `mire-video-player`, réglette de position et textes de la manette.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SEEK_STEPS, seekValue } from '@mire/ui/utils';
import {
  defaultSubtitle,
  isSilent,
  keepsResume,
  nextSubtitle,
  playedRatio,
  resumeAt,
  seekOsd,
  subtitleLabel,
  subtitleOsd,
  timeText,
  videoHeading,
  videoSubheading,
} from '../../src/renderer/players/video-model.ts';
import { VideoController } from '../../src/renderer/controllers/video.ts';
import { CONTROLLER_CLASSES } from '../../src/renderer/controllers/index.ts';
import type { ControllerContext } from '../../src/renderer/controllers/types.ts';
import { PAD_GLYPHS, isGlyphKey } from '../../src/renderer/nav/gamepad-data.ts';
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

describe('lecteur vidéo : reprise', () => {
  it('une vidéo de moins de cinq minutes ne garde pas sa position', () => {
    assert.equal(keepsResume(299), false);
    assert.equal(keepsResume(300), true);
    assert.equal(keepsResume(NaN), false);
    assert.equal(keepsResume(Infinity), false);
  });

  it('reprend après 30 s et avant les 90 dernières secondes', () => {
    assert.equal(resumeAt(0, 3600), null);
    assert.equal(resumeAt(30, 3600), null);
    assert.equal(resumeAt(31, 3600), 31);
    assert.equal(resumeAt(1234.5, 3600), 1234.5);
    assert.equal(resumeAt(3509, 3600), 3509);
    assert.equal(resumeAt(3510, 3600), null);
    // Position absente ou illisible : depuis le début.
    assert.equal(resumeAt(undefined, 3600), null);
    assert.equal(resumeAt('abc', 3600), null);
    assert.equal(resumeAt('120', 3600), 120);
  });
});

describe('lecteur vidéo : sous-titres', () => {
  it('les premiers sous-titres en français sont activés d’office, sinon aucun', () => {
    assert.equal(defaultSubtitle([{ label: 'en', lang: 'en' }, { label: 'fr', lang: 'fr' }]), 1);
    assert.equal(defaultSubtitle([{ label: 'fre', lang: 'fre' }]), 0);
    assert.equal(defaultSubtitle([{ label: 'Anglais', lang: 'en' }, { label: 'Français', lang: '' }]), 1);
    assert.equal(defaultSubtitle([{ label: 'en', lang: 'en' }, { label: 'de', lang: 'de' }]), -1);
    assert.equal(defaultSubtitle([]), -1);
  });

  it('chaque piste à son tour, puis aucune, puis la première', () => {
    assert.equal(nextSubtitle(-1, 2), 0);
    assert.equal(nextSubtitle(0, 2), 1);
    assert.equal(nextSubtitle(1, 2), -1);
    assert.equal(nextSubtitle(-1, 0), -1);
  });

  it('libellé du bouton et message affiché, en français et en anglais', () => {
    const labels = ['fr', 'en'];
    assert.equal(subtitleLabel(labels, 0, tFr), 'Sous-titres : fr');
    assert.equal(subtitleLabel(labels, -1, tFr), 'Sous-titres : non');
    assert.equal(subtitleOsd(labels, 1, tFr), 'Sous-titres : en');
    assert.equal(subtitleOsd(labels, -1, tFr), 'Sous-titres désactivés');
    assert.equal(subtitleLabel(labels, 1, tEn), 'Subtitles: en');
    assert.equal(subtitleLabel(labels, -1, tEn), 'Subtitles: off');
    assert.equal(subtitleOsd(labels, -1, tEn), 'Subtitles off');
  });
});

describe('lecteur vidéo : son absent', () => {
  it('aucun octet de son décodé après plus de 2 s de lecture', () => {
    assert.equal(isSilent(0, 2.5), true);
    assert.equal(isSilent(0, 2), false);
    assert.equal(isSilent(1024, 10), false);
    // Hors de Chromium, le compteur manque : on ne conclut rien.
    assert.equal(isSilent(undefined, 10), false);
  });

  it('le message propose le lecteur externe, en français et en anglais', () => {
    assert.match(tFr('player.video.silent.message'), /^Pas de son \?/);
    assert.equal(tFr('player.video.silent.action'), 'Ouvrir dans le lecteur externe');
    assert.equal(tEn('player.video.silent.action'), 'Open in the external player');
  });
});

describe('lecteur vidéo : affichage sur la vidéo', () => {
  it('titre de la fiche avec l’année, sinon le nom du fichier', () => {
    assert.equal(videoHeading({ name: 'film', sTitle: 'Le Voyage dans la Lune', sYear: 1902 }), 'Le Voyage dans la Lune (1902)');
    assert.equal(videoHeading({ name: 'film', sTitle: 'Sans année' }), 'Sans année');
    assert.equal(videoHeading({ name: 'film' }), 'film');
  });

  it('dossier, et place dans la liste quand elle a plusieurs vidéos', () => {
    assert.equal(videoSubheading('Saison 1', 0, 1, tFr), 'Saison 1');
    assert.equal(videoSubheading('Saison 1', 1, 3, tFr), 'Saison 1, 2 sur 3');
    assert.equal(videoSubheading('Season 1', 1, 3, tEn), 'Season 1, 2 of 3');
  });

  it('position, sauts et proportion lue', () => {
    assert.equal(timeText(83, 2700), '1:23 / 45:00');
    assert.equal(timeText(0, NaN), '0:00 / 0:00');
    assert.equal(seekOsd(10, 83, tFr), '+10 s  1:23');
    assert.equal(seekOsd(-60, 23, tFr), '−60 s  0:23');
    assert.equal(playedRatio(30, 120), 0.25);
    assert.equal(playedRatio(30, NaN), 0);
    assert.equal(playedRatio(200, 120), 1);
    assert.equal(seekValue(0.25), 250);
    assert.equal(seekValue(2), SEEK_STEPS);
    assert.equal(seekValue(Number.NaN), 0);
  });
});

describe('contrôleur mire-video-player', () => {
  function setup() {
    const calls: string[] = [];
    const ctx = {
      api: { toggleFullscreen: () => calls.push('fullscreen') },
      ui: {
        video: {
          close: () => calls.push('close'),
          togglePlay: () => calls.push('play'),
          step: (d: number) => calls.push(`step ${d}`),
          cycleSubtitles: () => calls.push('subs'),
          openExternally: () => calls.push('external'),
        },
      },
    } as unknown as ControllerContext;
    return { calls, c: new VideoController(ctx) };
  }

  it('est la seule balise de son contrôleur', () => {
    assert.equal(CONTROLLER_CLASSES['mire-video-player'], VideoController);
  });

  it('chaque action appelle le lecteur', () => {
    const { calls, c } = setup();
    c.close();
    c.togglePlay();
    c.previous();
    c.next();
    c.cycleSubtitles();
    c.toggleFullscreen();
    c.openExternal();
    assert.deepEqual(calls, ['close', 'play', 'step -1', 'step 1', 'subs', 'fullscreen', 'external']);
  });
});

describe('manette : textes', () => {
  it('les boutons qui portent un mot sont traduits par les catalogues', () => {
    for (const glyphs of Object.values(PAD_GLYPHS)) {
      for (const g of Object.values(glyphs)) if (isGlyphKey(g)) assert.ok(tFr(g) && tEn(g), g);
    }
    assert.equal(tFr(PAD_GLYPHS.xbox.select), 'Affichage');
    assert.equal(tEn(PAD_GLYPHS.ps.select), 'Create');
    assert.equal(isGlyphKey('LB'), false);
  });

  it('manette détectée ou déconnectée, en français et en anglais', () => {
    assert.equal(tFr('shell.pad.detected', { name: 'Xbox' }), 'Manette Xbox détectée. Les commandes s’affichent en bas de l’écran.');
    assert.equal(tEn('shell.pad.disconnected'), 'Controller disconnected');
  });
});
