#!/usr/bin/env node
/**
 * Porte : aucun `$localize` dans ce qui part vers l'assistant IA. Le contexte d'écran
 * (`buildScreenAnalysisPayloadV2`, `buildNoDataPayload`, retours typés `ScreenAnalysisPayload`)
 * et les fichiers de prompts/payloads IA restent en français : traduits, ils changeraient la
 * requête envoyée au LLM (routage d'intention, outils, formulation), pas seulement l'affichage.
 *
 * Usage : node scripts/i18n/gate/check-ai-payload-messages.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { aiPayloadFunction } from '../codemod/_ts-literals.mjs';

const WEB = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const { listTsFiles } = await import(new URL('../inventory-ts-literals.mjs', import.meta.url).href);

/** Fichiers entièrement dédiés au contenu envoyé à l'IA. */
const AI_DATA_FILE = /features\/ai-assistant\/utils\/[^/]*(payload|prompt)[^/]*\.ts$/i;

const problems = [];
for (const rel of listTsFiles()) {
  const text = fs.readFileSync(path.join(WEB, rel), 'utf8');
  if (!text.includes('$localize')) continue;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const dataFile = AI_DATA_FILE.test(rel);
  const visit = node => {
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText(sf) === '$localize') {
      const where = dataFile ? 'fichier de payload/prompt IA' : aiPayloadFunction(node);
      if (where) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        problems.push(`${rel}:${line + 1} (${where}) ${node.getText(sf).slice(0, 100)}`);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (problems.length) {
  console.error(`[i18n:ai-payload] ${problems.length} $localize dans un contenu envoyé à l'IA :`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('[i18n:ai-payload] 0 $localize dans les payloads et prompts IA');
