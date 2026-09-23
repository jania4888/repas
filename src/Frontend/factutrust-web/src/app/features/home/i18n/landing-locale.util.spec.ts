import {
  cabinetsPath,
  homePath,
  isLandingCabinets,
  isLandingHome,
  localeFromUrl,
  localizedPath,
  stripLocalePrefix
} from './landing-locale.util';

describe('landing-locale.util', () => {
  it('localizedPath bascule le préfixe /ar dans les deux sens', () => {
    expect(localizedPath('/', 'ar')).toBe('/ar');
    expect(localizedPath('/ar', 'fr')).toBe('/');
    expect(localizedPath('/ar/cabinets-comptables', 'fr')).toBe('/cabinets-comptables');
    expect(localizedPath('/cabinets-comptables', 'ar')).toBe('/ar/cabinets-comptables');
    expect(localizedPath('/ar', 'ar')).toBe('/ar');
    expect(localizedPath('', 'fr')).toBe('/');
  });

  it('localizedPath ignore la query et le fragment', () => {
    expect(localizedPath('/cabinets-comptables?x=1#contact', 'ar')).toBe('/ar/cabinets-comptables');
    expect(localizedPath('/ar?objet=demo-cabinet#contact', 'fr')).toBe('/');
  });

  it('isLandingHome reconnaît / et /ar uniquement', () => {
    expect(isLandingHome('/')).toBeTrue();
    expect(isLandingHome('/ar')).toBeTrue();
    expect(isLandingHome('/#tarifs')).toBeTrue();
    expect(isLandingHome('/ar?x=1')).toBeTrue();
    expect(isLandingHome('/ar/cabinets-comptables')).toBeFalse();
    expect(isLandingHome('/cabinets-comptables')).toBeFalse();
    expect(isLandingHome('/auth/login')).toBeFalse();
  });

  it('isLandingCabinets reconnaît les deux variantes', () => {
    expect(isLandingCabinets('/cabinets-comptables#contact')).toBeTrue();
    expect(isLandingCabinets('/ar/cabinets-comptables')).toBeTrue();
    expect(isLandingCabinets('/ar')).toBeFalse();
  });

  it('stripLocalePrefix ne confond pas /arbre avec le préfixe /ar', () => {
    expect(stripLocalePrefix('/arbre')).toEqual({ locale: 'fr', rest: '/arbre' });
    expect(stripLocalePrefix('/ar')).toEqual({ locale: 'ar', rest: '/' });
    expect(stripLocalePrefix('/ar/')).toEqual({ locale: 'ar', rest: '/' });
    expect(stripLocalePrefix('ar/cabinets-comptables')).toEqual({ locale: 'ar', rest: '/cabinets-comptables' });
  });

  it('homePath / cabinetsPath / localeFromUrl', () => {
    expect(homePath('fr')).toBe('/');
    expect(homePath('ar')).toBe('/ar');
    expect(cabinetsPath('fr')).toBe('/cabinets-comptables');
    expect(cabinetsPath('ar')).toBe('/ar/cabinets-comptables');
    expect(localeFromUrl('/ar/cabinets-comptables?x')).toBe('ar');
    expect(localeFromUrl('/arbre')).toBe('fr');
  });
});
