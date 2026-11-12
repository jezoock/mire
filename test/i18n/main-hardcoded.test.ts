// P1-29 : plus aucun texte destiné à l'utilisateur écrit en dur dans le processus principal. ESLint ne lit pas
// encore le TypeScript : la règle est un test, qui parcourt les chaînes de src/main avec le compilateur TypeScript.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = path.join(import.meta.dirname, '..', '..');
const MAIN = path.join(ROOT, 'src', 'main');

// Une chaîne « en français » : une lettre accentuée, ou un mot courant du français (en minuscules, ou avec une
// majuscule en début de phrase : « DE » ou « US » ne comptent pas).
const ACCENTS = /[àâçéèêëîïôûùüÿœÀÂÇÉÈÊÎÔ]/;
const WORDS =
  /\b(le|la|les|de|des|du|un|une|est|sont|pas|ce|cette|ces|votre|vos|aucun|aucune|introuvable|impossible|inconnu|inconnue|invalide|fichier|fichiers|dossier|jeu|jeux|choisir|ouvrir|ajoutez|indiquez|installez|pour|avec|dans|sur|code|serveur|programmes|vidéos|extraction|module|film)\b/;
const isFrench = (text: string) => !/^https?:\/\//.test(text) && (ACCENTS.test(text) || WORDS.test(text.replace(/\b[A-Z](?=[a-z])/g, (c) => c.toLowerCase())));

// Textes qui ne s'adressent pas à l'utilisateur : journaux de la console, identité HTTP envoyée aux serveurs.
const LOG_CALLS = /^(console\.\w+|log|deps\.log|this\.log|warn)$/;
const ALLOWED = new Set([
  'Mire/1.0 (lecteur multimédia personnel)',
  // Erreurs de programmation, jamais montrées à l'utilisateur.
  'Contrat IPC : implémentation manquante ( … ), hors table ( … ).',
  'aucune',
  'Préfixe de vue web déjà utilisé :  … ',
  'Système inconnu :  … ',
  'Fenêtre principale absente.',
  // Fichier de données illisible : passé au journal (`onCorrupt`).
  'le contenu n’est pas un objet JSON',
  // Corps des réponses du protocole media:// : lus par le lecteur, jamais affichés.
  'Requête invalide',
  'Accès refusé',
  'pas un fichier',
  'Introuvable',
]);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : e.name.endsWith('.ts') ? [p] : [];
  });
}

function insideLog(node: ts.Node): boolean {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isCallExpression(n) && LOG_CALLS.test(n.expression.getText())) return true;
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return true;
  }
  return false;
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' … ');
  return null;
}

/** Chaînes en français écrites en dur dans un fichier, hors journaux : `fichier:ligne  texte`. */
export function hardcodedTexts(file: string): string[] {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const text = literalText(node);
    // Une clé de propriété (`'hip hop': …`) n'est pas un texte affiché.
    const isKey = node.parent && ts.isPropertyAssignment(node.parent) && node.parent.name === node;
    if (text !== null && !isKey && isFrench(text) && !ALLOWED.has(text) && !insideLog(node)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${path.relative(ROOT, file)}:${line + 1}  ${text}`);
    }
    if (!ts.isTemplateExpression(node)) ts.forEachChild(node, visit);
    else node.templateSpans.forEach((s) => visit(s.expression));
  };
  visit(source);
  return found;
}

describe('textes du processus principal', () => {
  it('aucun texte en français écrit en dur dans src/main (ils passent par les catalogues)', () => {
    const found = files(MAIN).flatMap(hardcodedTexts);
    assert.deepEqual(found, [], `Textes à passer dans les catalogues (@mire/shared/i18n) :\n${found.join('\n')}`);
  });

  it('le détecteur repère un texte en dur et ignore les journaux', () => {
    const tmp = path.join(fs.mkdtempSync(path.join(ROOT, 'node_modules', '.mire-i18n-')), 'x.ts');
    fs.writeFileSync(tmp, "console.error('Dossier introuvable');\nexport const e = { error: `Dossier introuvable : ${1}` };\n");
    try {
      assert.equal(hardcodedTexts(tmp).length, 1);
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  });
});
