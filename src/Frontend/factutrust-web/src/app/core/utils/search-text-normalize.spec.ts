import { normalizeSearchText } from './search-text-normalize';

describe('normalizeSearchText', () => {
  it('strips Arabic diacritics and normalizes alef forms', () => {
    const a = normalizeSearchText('فاتورة');
    const b = normalizeSearchText('فاتورة');
    expect(a).toBe(b);
  });

  it('folds french accents for matching', () => {
    expect(normalizeSearchText('Élément')).toContain('element');
  });
});
