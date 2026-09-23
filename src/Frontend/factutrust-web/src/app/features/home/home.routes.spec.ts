import { Route } from '@angular/router';
import { environment } from '@environments/environment';
import { HOME_ROUTES, LANDING_CHILD_ROUTES } from './home.routes';

describe('HOME_ROUTES', () => {
  it("expose l'accueil (pathMatch full) et la page cabinets comme enfants du shell FR", () => {
    const root = HOME_ROUTES[0];
    expect(root.path).toBe('');
    expect(root.data?.['locale']).toBe('fr');
    expect(root.children).toBe(LANDING_CHILD_ROUTES);

    const home = LANDING_CHILD_ROUTES[0];
    expect(home.path).toBe('');
    expect(home.pathMatch).toBe('full');
    expect(home.data?.['seoPage']).toBe('home');

    const cabinets = LANDING_CHILD_ROUTES[1];
    expect(cabinets.path).toBe('cabinets-comptables');
    expect(cabinets.data?.['seoPage']).toBe('cabinets');
    expect(cabinets.data?.['contactSubject']).toBe('demo-cabinet');
  });

  it("le montage 'ar' suit environment.landing.arabicEnabled (évalué au chargement du module)", () => {
    const ar = HOME_ROUTES[1] as Route;
    expect(ar.path).toBe('ar');
    if (environment.landing.arabicEnabled) {
      expect(ar.loadComponent).toBeDefined();
      expect(ar.canActivate?.length).toBe(1);
      expect(ar.data?.['locale']).toBe('ar');
      expect(ar.children).toBe(LANDING_CHILD_ROUTES);
    } else {
      expect(ar.loadComponent).toBeUndefined();
      const [exact, wildcard] = ar.children ?? [];
      expect(exact.redirectTo).toBe('/');
      expect(wildcard.path).toBe('**');
      expect(typeof wildcard.redirectTo).toBe('function');
    }
  });

  it("les enfants ne déclarent aucun composant de shell eux-mêmes (un seul cycle de vie thème)", () => {
    for (const child of LANDING_CHILD_ROUTES) {
      expect(child.children).toBeUndefined();
      expect(child.loadComponent).toBeDefined();
    }
  });
});
