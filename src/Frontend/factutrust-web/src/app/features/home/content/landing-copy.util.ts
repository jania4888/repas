/**
 * Détache la marque d'activation (`cabinets.features.activationMark`, ex. « * ») en fin de
 * chaîne : le texte est nettoyé et `flagged` indique que le badge « à l'activation »
 * (`shared.common.uponActivation`) doit être affiché. Fonction pure, testable sans rendu.
 */
export function splitActivationMark(text: string, mark: string): { text: string; flagged: boolean } {
  const trimmed = text.trimEnd();
  if (mark && trimmed.endsWith(mark)) {
    return { text: trimmed.slice(0, trimmed.length - mark.length).trimEnd(), flagged: true };
  }
  return { text: trimmed, flagged: false };
}
