/**
 * Utilitaires texte partagés du Studio (4.5h, D-45-F10 / D-45-F11 — D-44-12, D-44-08 clos).
 * Corps unique des trois `slugify*` à préfixe (tables `f_`, vues `v_`, workflows `wf_`)
 * et de l'interpolation de libellés (`formatLabel` / `formatWorkflowLabel`).
 * Aucune dépendance : importable depuis n'importe quel chunk lazy du Studio.
 */

/**
 * Clé technique depuis un libellé : minuscules ASCII (accents retirés), `_` entre les mots,
 * 64 caractères max ; `prefix` ajouté si le premier caractère n'est pas une lettre ; '' si vide.
 */
export function slugifyKey(input: string, prefix: string): string {
  const base = (input || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!base) return '';
  return (/^[a-z]/.test(base) ? base : prefix + base).slice(0, 64);
}

/** Remplace les `{jetons}` d'un libellé ; une clé absente de `values` est laissée telle quelle. */
export function formatLabel(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (values[k] !== undefined ? String(values[k]) : `{${k}}`));
}
