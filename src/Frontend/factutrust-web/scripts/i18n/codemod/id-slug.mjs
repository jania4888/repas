/**
 * Suffixe d'ID i18n : slug ASCII du texte + 8 caractères du SHA-1 du texte complet.
 * Le hash rend l'ID propre au texte : deux textes différents ne partagent jamais un ID.
 */
import crypto from 'node:crypto';

export function i18nSlug(text) {
  const base = String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\{\$[^}]+\}/g, ' ')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 48)
    .replace(/\.+$/, '');
  const hash = crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 8);
  return base ? `${base}.${hash}` : `text.${hash}`;
}
