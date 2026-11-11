// Service de configuration : lecture au démarrage (fichier absent, ancien, illisible), modifications, abonnés,
// fichier écrit. Fichiers dans un dossier temporaire.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG_VERSION, createConfigService, DEFAULT_CONFIG, normalizeConfig } from '../../src/main/config/index.ts';
import type { Config } from '@mire/shared';

type Any = any;

let tmp: string;
let file: string;
let logs: string[];
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mire-config-'));
  file = path.join(tmp, 'config.json');
  logs = [];
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const service = () => createConfigService({ file, log: (m) => logs.push(m), now: () => 1234 });
const readFile = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const siblings = () => fs.readdirSync(tmp).sort();

describe('lecture au démarrage', () => {
  it('fichier absent : créé avec les valeurs par défaut', () => {
    const s = service();
    const c = s.load();
    assert.deepEqual(c, normalizeConfig(DEFAULT_CONFIG));
    assert.deepEqual(readFile(), c);
    assert.equal(s.get(), c);
  });

  it('fichier à jour : lu sans être réécrit', () => {
    const text = JSON.stringify({ version: CONFIG_VERSION, ui: { theme: 'minuit' } });
    fs.writeFileSync(file, text);
    const c = service().load();
    assert.equal(c.ui.theme, 'minuit');
    assert.equal(fs.readFileSync(file, 'utf8'), text);
  });

  it('ancienne version : migrée, normalisée et réenregistrée', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 4, freebox: { playlist: 'http://box/p.m3u' }, ui: { webFullscreen: true } }));
    const c = service().load();
    assert.equal(c.version, CONFIG_VERSION);
    assert.equal(c.tv.active, 'freebox');
    assert.equal(c.tv.services[0].url, 'http://box/p.m3u');
    assert.deepEqual(readFile(), c);
  });

  for (const [label, text] of [
    ['JSON invalide', '{ "version": 5,'],
    ['pas un objet', '[1, 2]'],
  ]) {
    it(`fichier illisible (${label}) : mis de côté, puis remplacé par les valeurs par défaut`, () => {
      fs.writeFileSync(file, text);
      const c = service().load();
      assert.deepEqual(c, normalizeConfig(DEFAULT_CONFIG));
      assert.deepEqual(siblings(), ['config.json', 'config.json.illisible-1234']);
      assert.equal(fs.readFileSync(`${file}.illisible-1234`, 'utf8'), text);
      assert.deepEqual(readFile(), c);
      assert.equal(logs.length, 1);
      assert.match(logs[0], /^config\.json illisible : /);
    });
  }

  it('la lecture ne prévient pas les abonnés', () => {
    const s = service();
    let calls = 0;
    s.onChange(() => calls++);
    s.load();
    assert.equal(calls, 0);
  });
});

describe('modifications', () => {
  it('update : un abonné est appelé une fois par modification, avec la suivante et la précédente', () => {
    const s = service();
    s.load();
    const calls: Array<[Config, Config]> = [];
    s.onChange((next, prev) => calls.push([next, prev]));
    const before = s.get();
    const next = s.update((c) => {
      c.ui.theme = 'jour';
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], next);
    assert.equal(calls[0][1], before);
    assert.equal(before.ui.theme, 'ecran', 'la configuration précédente n’est pas modifiée');
    assert.equal(s.get(), next);
    assert.equal(readFile().ui.theme, 'jour');
    s.update((c) => ({ ...c, scrape: { auto: false } }));
    assert.equal(calls.length, 2);
    assert.equal(s.get().scrape.auto, false);
    assert.equal(s.get().ui.theme, 'jour');
  });

  it('replace : normalise la configuration reçue', () => {
    const s = service();
    s.load();
    let calls = 0;
    s.onChange(() => calls++);
    const c = s.replace({ ui: { theme: 'fluo' }, web: [{ name: 'Mon Site', url: 'https://a/' }] });
    assert.equal(calls, 1);
    assert.equal(c.ui.theme, 'ecran');
    assert.deepEqual(
      c.web.map((w) => w.id),
      ['mon-site'],
    );
    assert.deepEqual(readFile(), c);
  });

  it('désabonnement ; un abonné en échec n’empêche ni l’enregistrement ni les autres abonnés', () => {
    const s = service();
    s.load();
    const seen: string[] = [];
    const off = s.onChange(() => seen.push('a'));
    s.onChange(() => {
      throw new Error('boum');
    });
    s.onChange(() => seen.push('c'));
    s.update((c) => {
      c.ui.theme = 'jour';
    });
    off();
    s.update((c) => {
      c.ui.theme = 'minuit';
    });
    assert.deepEqual(seen, ['a', 'c', 'c']);
    assert.equal(readFile().ui.theme, 'minuit');
    assert.deepEqual(logs, ['Abonné à la configuration en échec : boum', 'Abonné à la configuration en échec : boum']);
  });

  it('écriture impossible : l’erreur remonte, la configuration et les abonnés restent inchangés', () => {
    const s = service();
    s.load();
    let calls = 0;
    s.onChange(() => calls++);
    const before = s.get();
    // Un dossier à la place du fichier : le renommage final échoue.
    fs.rmSync(file);
    fs.mkdirSync(file);
    assert.throws(() =>
      s.update((c) => {
        c.ui.theme = 'jour';
      }),
    );
    assert.equal(s.get(), before);
    assert.equal(calls, 0);
  });

  it('fichier écrit : même JSON qu’avant (indentation de 2, pas de saut de ligne final), sans fichier temporaire', () => {
    const s = service();
    s.load();
    const c = s.update((draft: Any) => {
      draft.games.push({ name: 'Jeu', path: '/jeu.exe' });
    });
    assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(c, null, 2));
    assert.deepEqual(siblings(), ['config.json']);
  });
});
