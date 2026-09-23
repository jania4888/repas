import { Routes } from '@angular/router';
import { environment } from '@environments/environment';
import { landingCopyGuard } from './i18n/landing-copy.guard';

/**
 * Pages publiques partagées par les montages FR (`''`) et AR (`ar`).
 * Pas de `title` statique : `LandingSeoService` fixe le titre selon la langue (repli conservé pour l'accessibilité).
 */
export const LANDING_CHILD_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./home.component').then(m => m.HomeComponent),
    title: 'InstaFact — Facturation, comptabilité et paie en Tunisie',
    data: { seoPage: 'home', contactSubject: 'acces-entreprise' }
  },
  {
    path: 'cabinets-comptables',
    loadComponent: () => import('./cabinets/cabinets-page.component').then(m => m.CabinetsPageComponent),
    title: 'Version Cabinet comptable — InstaFact',
    data: { seoPage: 'cabinets', contactSubject: 'demo-cabinet' }
  }
];

const shell = () => import('./landing-shell.component').then(m => m.LandingShellComponent);

/**
 * `/auth/login` → shell `''` → aucun enfant ne consomme `auth` → le routeur poursuit vers `AUTH_ROUTES`
 * (comportement identique à l'ancien montage). `/ar/**` n'existe que si `environment.landing.arabicEnabled`,
 * sinon redirection vers l'équivalent FR (rollback sans suppression de fichier).
 */
export const HOME_ROUTES: Routes = [
  {
    path: '',
    loadComponent: shell,
    data: { locale: 'fr' },
    children: LANDING_CHILD_ROUTES
  },
  environment.landing.arabicEnabled
    ? {
        path: 'ar',
        loadComponent: shell,
        canActivate: [landingCopyGuard],
        data: { locale: 'ar' },
        children: LANDING_CHILD_ROUTES
      }
    : {
        path: 'ar',
        children: [
          { path: '', pathMatch: 'full', redirectTo: '/' },
          { path: '**', redirectTo: (redirect) => `/${redirect.url.map(s => s.path).join('/')}` }
        ]
      }
];
