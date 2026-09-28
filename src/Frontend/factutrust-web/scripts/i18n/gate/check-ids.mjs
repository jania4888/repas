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
  // Un ICU imbriqué dans un message reçoit toujours un ID calculé par le compilateur (on ne peut pas
  // lui en donner un) ; il est extrait et traduit comme les autres. Seuls les autres « sans ID » comptent.
  const nestedIcu = messages.filter(m => !m.id && m.text === '{$ICU}').length;
  const withoutId = messages.length - withId - nestedIcu;
  console.log(
    `[i18n:ids] ${messages.length} messages (${withId} avec @@id, ${nestedIcu} ICU imbriqué(s) à ID calculé, ` +
      `${withoutId} sans) — ${collisions.length} collision(s)`
  );
}
process.exit(collisions.length ? 1 : 0);
