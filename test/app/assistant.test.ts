// Assistant du premier lancement (P4-23), côté processus principal : ouvert au premier lancement seulement (pas pour
// une installation existante), jusqu'à ce qu'il soit terminé ou passé ; langues du système filtrées.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanLanguages, createAssistant } from '../../src/main/app/assistant.ts';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mire-assistant-'));
const make = (file: string, fresh: boolean, langs: readonly unknown[] = ['fr-FR', 'en-US']) =>
  createAssistant({ file, fresh, systemLanguages: () => langs as string[], log: () => {} });

describe('assistant du premier lancement (processus principal)', () => {
  it('s’ouvre au premier lancement, et encore au suivant tant qu’il n’est pas terminé', () => {
    const file = path.join(dir(), 'assistant.json');
    assert.equal(make(file, true).state().open, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { pending: true });
    // Mire quitté en plein assistant : la configuration existe désormais, l'assistant revient.
    const again = make(file, false);
    assert.equal(again.state().open, true);
    assert.equal(again.finish(), true);
    assert.equal(again.state().open, false);
    assert.equal(make(file, false).state().open, false);
    assert.equal(make(file, true).state().open, false);
  });

  it('ne s’ouvre pas pour une installation existante', () => {
    const file = path.join(dir(), 'assistant.json');
    assert.equal(make(file, false).state().open, false);
    assert.equal(fs.existsSync(file), false);
  });

  it('un fichier mal formé ne l’ouvre pas', () => {
    const file = path.join(dir(), 'assistant.json');
    fs.writeFileSync(file, '{oups');
    assert.equal(make(file, true).state().open, false);
    fs.writeFileSync(file, JSON.stringify({ pending: 'oui' }));
    assert.equal(make(file, true).state().open, false);
  });

  it('transmet les langues du système bien formées, sans doublon, au plus 8', () => {
    assert.deepEqual(make(path.join(dir(), 'a.json'), true).state().systemLanguages, ['fr-FR', 'en-US']);
    assert.deepEqual(cleanLanguages(['fr', 'fr', 3, '', '<b>', 'pt-BR', 'x'.repeat(30)]), ['fr', 'pt-BR']);
    assert.equal(cleanLanguages(Array.from({ length: 20 }, (_, i) => `l${String.fromCharCode(97 + i)}`)).length, 8);
    const broken = createAssistant({
      file: path.join(dir(), 'b.json'),
      fresh: true,
      systemLanguages: () => {
        throw new Error('non');
      },
      log: () => {},
    });
    assert.deepEqual(broken.state(), { open: true, systemLanguages: [] });
  });
});
