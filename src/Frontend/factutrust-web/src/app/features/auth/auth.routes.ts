import { Routes } from '@angular/router';
import { authGuard } from '@core/guards/auth.guard';
import { accountingFirmsFeatureGuard } from '@core/guards/accounting-firms.guard';
import { publicRegistrationGuard } from '@core/guards/public-registration.guard';
import { environment } from '@environments/environment';

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login/login.component').then(m => m.LoginComponent),
    title: 'Connexion - InstaFact'
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent),
    title: 'Mot de passe oublié - InstaFact'
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./reset-password/reset-password.component').then(m => m.ResetPasswordComponent),
    title: 'Réinitialiser le mot de passe - InstaFact'
  },
  {
    path: 'select-warehouse',
    loadComponent: () =>
      import('./select-warehouse/select-warehouse.component').then(
        (m) => m.SelectWarehouseComponent
      ),
    canActivate: [authGuard],
    title: 'Choisir un entrepôt - InstaFact'
  },
  {
    path: 'register',
    canActivate: [publicRegistrationGuard('company')],
    loadComponent: () =>
      environment.featureFlags.registrationWizardV2
        ? import('./register-wizard/register-wizard.component').then(m => m.RegisterWizardComponent)
        : import('./register/register.component').then(m => m.RegisterComponent),
    title: 'Inscription - InstaFact'
  },
  {
    path: 'register-firm',
    canActivate: [publicRegistrationGuard('firm'), accountingFirmsFeatureGuard],
    loadComponent: () => import('./register-firm/register-firm.component').then(m => m.RegisterFirmComponent),
    title: 'Inscription cabinet - InstaFact'
  },
  {
    path: 'accept-portal-invite',
    loadComponent: () =>
      import('./accept-portal-invite/accept-portal-invite.component').then(
        m => m.AcceptPortalInviteComponent
      ),
    title: 'Activer l’espace client - InstaFact'
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  }
];
