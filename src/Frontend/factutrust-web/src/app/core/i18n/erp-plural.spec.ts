import { erpPlural } from './erp-plural';

describe('erpPlural', () => {
  const fileForms = {
    one: '{count} fichier',
    other: '{count} fichiers'
  };

  it('uses French one/other plural categories', () => {
    expect(erpPlural(1, fileForms, 'fr')).toBe('1 fichier');
    expect(erpPlural(3, fileForms, 'fr')).toBe('3 fichiers');
  });

  it('substitutes {n} placeholders', () => {
    expect(erpPlural(2, { other: '{n} éléments' }, 'fr')).toBe('2 éléments');
  });

  it('uses Arabic two category when provided', () => {
    expect(erpPlural(2, { two: 'اثنان', other: '{count} عناصر' }, 'ar')).toBe('اثنان');
    expect(erpPlural(5, { two: 'اثنان', other: '{count} عناصر' }, 'ar')).toBe('5 عناصر');
  });
});
