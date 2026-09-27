#!/usr/bin/env node
/**
 * Porte : un ID i18n (`@@id`) ne désigne qu'un seul texte source.
 * Deux textes sous le même ID reçoivent la même traduction : en arabe, l'un des deux affiche un message faux.
 *
 * Usage : node scripts/i18n/gate/check-ids.mjs [--json]
 */
import { collectMessages, findIdCollisions } from './_messages.mjs';

const messages = collectMessages();
const collisions = findIdCollisions(messages);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ messages: messages.length, collisions }, null, 2));
} else {
  for (const c of collisions) {
    console.error(`[collision] @@${c.id}`);
    for (const v of c.variants) console.error(`    « ${v.text.slice(0, 80)} » ← ${v.files.slice(0, 3).join(', ')}`);
  }
  const withId = messages.filter(m => m.id).length;
  console.log(`[i18n:ids] ${messages.length} messages (${withId} avec @@id, ${messages.length - withId} sans) — ${collisions.length} collision(s)`);
}
process.exit(collisions.length ? 1 : 0);
