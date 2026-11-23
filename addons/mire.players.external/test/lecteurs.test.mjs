import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ID = 'mire.players.external';
const dir = new URL('../', import.meta.url);
const lire = (rel) => JSON.parse(readFileSync(new URL(rel, dir), 'utf8'));
const LECTEURS = ['mpv', 'vlc'];
const OPTION = '--?[A-Za-z][A-Za-z0-9-]{0,39}';
const FORMES = {
  fullscreen: new RegExp(`^${OPTION}$`),
  title: new RegExp(`^${OPTION}=\\{title\\}$`),
  start: new RegExp(`^${OPTION}=\\{start\\}$`),
};
const DOSSIERS_WINDOWS = ['{programFiles}', '{programFilesX86}', '{localAppData}'];

// Nom du programme d'un emplacement, en minuscules, sans « .exe » (ce que Mire compare à `names`).
const nomDe = (chemin) =>
  chemin
    .split(/[\\/]/)
    .pop()
    .toLowerCase()
    .replace(/\.exe$/, '');

describe(ID, () => {
  const manifeste = lire('mire-plugin.json');

  it('est un plugin de données sans permission, en 1.0.0, avec mpv puis VLC', () => {
    assert.equal(manifeste.id, ID);
    assert.equal(manifeste.version, '1.0.0');
    assert.equal(manifeste.level, 'data');
    assert.equal(manifeste.permissions, undefined);
    assert.deepEqual(
      manifeste.contributes.apps.map((a) => a.id),
      LECTEURS,
    );
  });

  for (const id of LECTEURS) {
    describe(id, () => {
      const app = lire(`apps/${id}.json`);

      it('est un lecteur, avec son nom et une priorité bornée', () => {
        assert.equal(app.kind, 'player');
        assert.deepEqual(app.names, [id]);
        assert.ok(Number.isInteger(app.priority) && app.priority >= 0 && app.priority <= 100);
      });

      it('a des emplacements absolus pour Windows, macOS et Linux, qui désignent bien ce programme', () => {
        for (const systeme of ['windows', 'mac', 'linux']) {
          const liste = app.locations[systeme];
          assert.ok(Array.isArray(liste) && liste.length > 0 && liste.length <= 8, systeme);
          for (const l of liste) {
            assert.ok(!l.split(/[\\/]/).includes('..'), l);
            assert.equal(nomDe(l), id, l);
            if (systeme === 'windows') assert.ok(DOSSIERS_WINDOWS.some((d) => l.startsWith(d + '\\')) || /^[A-Z]:\\/.test(l), l);
            else assert.ok(l.startsWith('/') && !l.includes('{'), l);
          }
        }
      });

      it('a les trois options, chacune dans sa forme', () => {
        assert.deepEqual(Object.keys(app.options).sort(), ['fullscreen', 'start', 'title']);
        for (const [k, v] of Object.entries(app.options)) assert.match(v, FORMES[k], k);
      });
    });
  }

  it('fournit les textes en anglais et en français', () => {
    for (const code of ['en', 'fr']) {
      const cat = lire(`i18n/${code}.json`);
      assert.equal(cat.meta.code, code);
      assert.ok(cat.messages.plugin.name && cat.messages.plugin.description);
      for (const id of LECTEURS) assert.ok(cat.messages.apps[id].name, `${code}: ${id}`);
    }
  });

  it('garde les emplacements et options de Mire d’avant le plugin', () => {
    const mpv = lire('apps/mpv.json');
    const vlc = lire('apps/vlc.json');
    assert.deepEqual(mpv.options, {
      fullscreen: '--fs',
      title: '--force-media-title={title}',
      start: '--start={start}',
    });
    assert.deepEqual(vlc.options, {
      fullscreen: '--fullscreen',
      title: '--meta-title={title}',
      start: '--start-time={start}',
    });
    assert.deepEqual(mpv.locations.linux, ['/usr/bin/mpv', '/usr/local/bin/mpv']);
    assert.deepEqual(vlc.locations.windows, ['{programFiles}\\VideoLAN\\VLC\\vlc.exe', '{programFilesX86}\\VideoLAN\\VLC\\vlc.exe']);
    assert.ok(mpv.priority < vlc.priority);
  });
});
