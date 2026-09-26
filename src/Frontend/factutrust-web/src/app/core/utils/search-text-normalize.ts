/** Latin + Arabic normalization for global search matching. */
export function normalizeSearchText(text: string): string {
  let s = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  s = normalizeArabicForSearch(s);
  return s.trim();
}

export function normalizeArabicForSearch(text: string): string {
  return text
    .replace(/\u0640/g, '')
    .replace(/[\u0622\u0623\u0625]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A')
    .replace(/[\u064B-\u065F\u0670]/g, '');
}
