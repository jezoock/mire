// Télévision (P1-15) : lecture des listes M3U, qualité des flux, regroupement des variantes d'une chaîne.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseM3U, qualityOf, groupChannels } from '../../src/main/tv/index.ts';
import type { M3uEntry } from '../../src/main/tv/index.ts';

test.describe('parseM3U', () => {
  test('titre après la première virgule hors guillemets, attributs', () => {
    const text = ['#EXTM3U', '#EXTINF:-1 tvg-chno="2" tvg-logo="http://logo/f2.png" group-title="Nationales, TNT",France 2, la chaîne', 'rtsp://box/f2'].join(
      '\r\n',
    );
    assert.deepEqual(parseM3U(text), [{ title: 'France 2, la chaîne', logo: 'http://logo/f2.png', group: 'Nationales, TNT', chno: '2', url: 'rtsp://box/f2' }]);
  });

  test('attributs insensibles à la casse, sans virgule : titre vide', () => {
    assert.deepEqual(parseM3U('#EXTINF:-1 TVG-LOGO="l"\nhttp://x'), [{ title: '', logo: 'l', group: '', chno: '', url: 'http://x' }]);
  });

  test('lignes sans #EXTINF : l’adresse sert de titre ; commentaires et lignes vides ignorés', () => {
    const text = '#EXTM3U\n\n  http://a/1.ts  \n#EXTVLCOPT:x\n#EXTINF:-1,Chaîne\n\nhttp://a/2.ts\nhttp://a/3.ts';
    assert.deepEqual(parseM3U(text), [
      { title: 'http://a/1.ts', url: 'http://a/1.ts', logo: '', group: '', chno: '' },
      { title: 'Chaîne', logo: '', group: '', chno: '', url: 'http://a/2.ts' },
      { title: 'http://a/3.ts', url: 'http://a/3.ts', logo: '', group: '', chno: '' },
    ]);
  });
});

test('qualityOf', () => {
  assert.equal(qualityOf('HD', ''), 'hd');
  assert.equal(qualityOf('', 'rtsp://box/?flavour=hd'), 'hd');
  assert.equal(qualityOf('4K', ''), 'hd');
  assert.equal(qualityOf('bas débit', ''), 'ld');
  assert.equal(qualityOf('', 'http://x?flavour=ld'), 'ld');
  assert.equal(qualityOf('SD', ''), 'sd');
  assert.equal(qualityOf('Standard', ''), 'sd');
  assert.equal(qualityOf('', 'http://x/'), 'other');
  // « hd » doit être un mot entier.
  assert.equal(qualityOf('Shdw', ''), 'other');
});

test.describe('groupChannels', () => {
  const e = (title: string, url: string, extra: Partial<M3uEntry> = {}): M3uEntry => ({ title, url, logo: '', group: '', chno: '', ...extra });

  test('numéro dans tvg-chno ou dans le titre, variantes « (HD) » regroupées', () => {
    const out = groupChannels([
      e('2 - France 2 (HD)', 'http://f2?flavour=hd'),
      e('2 - France 2 (SD)', 'http://f2?flavour=sd'),
      e('TF1', 'http://tf1', { chno: '1', logo: 'tf1.png' }),
    ]);
    assert.deepEqual(out, [
      { number: 1, name: 'TF1', logo: 'tf1.png', group: '', variants: [{ label: '', url: 'http://tf1', q: 'other' }] },
      {
        number: 2,
        name: 'France 2',
        logo: '',
        group: '',
        variants: [
          { label: 'HD', url: 'http://f2?flavour=hd', q: 'hd' },
          { label: 'SD', url: 'http://f2?flavour=sd', q: 'sd' },
        ],
      },
    ]);
  });

  test('tvg-chno prioritaire sur le numéro du titre', () => {
    assert.equal(groupChannels([e('5. Arte', 'http://a', { chno: '7' })])[0].number, 7);
    assert.equal(groupChannels([e('5. Arte', 'http://a')])[0].name, 'Arte');
  });

  test('tri : numérotées d’abord, puis par nom (ordre français)', () => {
    const out = groupChannels([e('Zèbre', 'z'), e('Éclair', 'e'), e('10 - Dix', 'd'), e('Abeille', 'a'), e('3 - Trois', 't')]);
    assert.deepEqual(
      out.map((c) => c.name),
      ['Trois', 'Dix', 'Abeille', 'Éclair', 'Zèbre'],
    );
  });

  test('sans titre : l’adresse sert de nom', () => {
    assert.equal(groupChannels([e('', 'http://x')])[0].name, 'http://x');
  });
});

test.describe('playlist Freebox d’exemple', () => {
  const text = readFileSync(new URL('../fixtures/tv/freebox.m3u', import.meta.url), 'utf8');
  const channels = groupChannels(parseM3U(text));

  test('une chaîne par numéro, variantes HD, standard et bas débit regroupées', () => {
    assert.deepEqual(
      channels.map((c) => [c.number, c.name, c.variants.map((v) => v.q)]),
      [
        [2, 'France 2', ['hd', 'sd', 'ld']],
        [3, 'France 3', ['hd', 'ld']],
        [5, 'France 5', ['other']],
        [7, 'Arte', ['sd', 'hd']],
        [999, 'Radio FIP', ['other']],
      ],
    );
  });

  test('libellés et adresses rtsp conservés', () => {
    assert.deepEqual(channels[0].variants[2], {
      label: 'bas débit',
      url: 'rtsp://mafreebox.freebox.fr/fbxtv_pub/stream?namespace=1&service=201&flavour=ld',
      q: 'ld',
    });
    assert.equal(channels[2].variants[0].label, '');
  });
});
