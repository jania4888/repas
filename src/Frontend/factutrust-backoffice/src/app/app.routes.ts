import { Routes } from '@angular/router';
import { platformAuthGuard } from '@core/guards/platform-auth.guard';
import { platformGuestGuard } from '@core/guards/platform-guest.guard';
import { platformPermissionGuard } from '@core/guards/platform-permission.guard';
import { PlatformPermission } from '@core/models/platform.models';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [platformGuestGuard],
    loadComponent: () =>
      import('./pages/login/platform-login.component').then(m => m.PlatformLoginComponent)
  },
  {
    path: '',
    loadComponent: () =>
      import('./layout/platform-shell.component').then(m => m.PlatformShellComponent),
    canActivate: [platformAuthGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'tenants' },
      {
        path: 'tenants',
        loadComponent: () =>
          import('./pages/tenants/platform-tenants-page.component').then(m => m.PlatformTenantsPageComponent)
      },
      {
        path: 'tenants/new/company',
        canActivate: [platformPermissionGuard(PlatformPermission.TenantsWrite)],
        loadComponent: () =>
          import('./pages/tenants/create-company/platform-tenant-create-company-page.component').then(
            m => m.PlatformTenantCreateCompanyPageComponent
          )
      },
      {
        path: 'tenants/new/firm',
        canActivate: [platformPermissionGuard(PlatformPermission.TenantsWrite)],
        loadComponent: () =>
          import('./pages/tenants/platform-tenant-create-firm-page.component').then(
            m => m.PlatformTenantCreateFirmPageComponent
          )
      },
      {
        path: 'tenants/:tenantId',
        loadComponent: () =>
          import('./pages/tenants/platform-tenant-detail-page.component').then(
            m => m.PlatformTenantDetailPageComponent
          )
      },
      {
        path: 'migrations',
        loadComponent: () =>
          import('./pages/migrations/platform-migrations-page.component').then(
            m => m.PlatformMigrationsPageComponent
          )
      },
      {
        path: 'storefronts',
        loadComponent: () =>
          import('./pages/storefronts/platform-storefronts-page.component').then(
            m => m.PlatformStorefrontsPageComponent
          )
      },
      {
        path: 'admins',
        canActivate: [platformPermissionGuard(PlatformPermission.AdminsRead)],
        loadComponent: () =>
          import('./pages/admins/platform-admins-page.component').then(
            m => m.PlatformAdminsPageComponent
          )
      },
      {
        path: 'plans',
        canActivate: [platformPermissionGuard(PlatformPermission.PlansManage)],
        loadComponent: () =>
          import('./pages/plans/platform-plans-page.component').then(
            m => m.PlatformPlansPageComponent
          )
      },
      {
        path: 'sector-rules',
        canActivate: [platformPermissionGuard(PlatformPermission.SectorRulesRead)],
        loadComponent: () =>
          import('./pages/sector-rules/platform-sector-rules-page.component').then(
            m => m.PlatformSectorRulesPageComponent
          )
      },
      {
        path: 'coupons',
        canActivate: [platformPermissionGuard(PlatformPermission.CouponsManage)],
        loadComponent: () =>
          import('./pages/coupons/platform-coupons-page.component').then(
            m => m.PlatformCouponsPageComponent
          )
      },
      {
        path: 'credits',
        canActivate: [platformPermissionGuard(PlatformPermission.CreditsManage)],
        loadComponent: () =>
          import('./pages/credits/platform-credits-page.component').then(
            m => m.PlatformCreditsPageComponent
          )
      },
      {
        path: 'invoices',
        canActivate: [platformPermissionGuard(PlatformPermission.InvoiceRead)],
        loadComponent: () =>
          import('./pages/invoices/platform-invoices-page.component').then(
            m => m.PlatformInvoicesPageComponent
          )
      },
      {
        path: 'invoices/new',
        canActivate: [platformPermissionGuard(PlatformPermission.InvoiceIssue)],
        loadComponent: () =>
          import('./pages/invoices/platform-invoice-create-page.component').then(
            m => m.PlatformInvoiceCreatePageComponent
          )
      },
      {
        path: 'invoices/fiscal-settings',
        canActivate: [platformPermissionGuard(PlatformPermission.InvoiceIssue)],
        loadComponent: () =>
          import('./pages/invoices/platform-fiscal-settings-page.component').then(
            m => m.PlatformFiscalSettingsPageComponent
          )
      },
      {
        path: 'invoices/:id',
        canActivate: [platformPermissionGuard(PlatformPermission.InvoiceRead)],
        loadComponent: () =>
          import('./pages/invoices/platform-invoice-detail-page.component').then(
            m => m.PlatformInvoiceDetailPageComponent
          )
      },
      {
        path: 'payments/providers',
        canActivate: [platformPermissionGuard(PlatformPermission.ProvidersConfigure)],
        loadComponent: () =>
          import('./pages/payments/platform-payment-providers-page.component').then(
            m => m.PlatformPaymentProvidersPageComponent
          )
      },
      {
        path: 'payments/intents',
        canActivate: [platformPermissionGuard(PlatformPermission.ProvidersConfigure)],
        loadComponent: () =>
          import('./pages/payments/platform-payment-intents-page.component').then(
            m => m.PlatformPaymentIntentsPageComponent
          )
      },
      {
        path: 'dunning',
        canActivate: [platformPermissionGuard(PlatformPermission.InvoiceIssue)],
        loadComponent: () =>
          import('./pages/dunning/platform-dunning-page.component').then(
            m => m.PlatformDunningPageComponent
          )
      },
      {
        path: 'audit',
        canActivate: [platformPermissionGuard(PlatformPermission.AuditRead)],
        loadComponent: () =>
          import('./pages/audit/platform-audit-page.component').then(
            m => m.PlatformAuditPageComponent
          )
      },
      {
        path: 'security',
        canActivate: [platformPermissionGuard(PlatformPermission.SecurityRead)],
        loadComponent: () =>
          import('./pages/security/platform-security-page.component').then(
            m => m.PlatformSecurityPageComponent
          )
      },
      {
        path: 'ops/health',
        canActivate: [platformPermissionGuard(PlatformPermission.SecurityRead)],
        loadComponent: () =>
          import('./pages/ops/platform-ops-health-page.component').then(
            m => m.PlatformOpsHealthPageComponent
          )
      },
      {
        path: 'emails',
        canActivate: [platformPermissionGuard(PlatformPermission.AuditRead)],
        loadComponent: () =>
          import('./pages/emails/platform-emails-page.component').then(
            m => m.PlatformEmailsPageComponent
          )
      },
      {
        path: 'company-support',
        canActivate: [platformPermissionGuard(PlatformPermission.CompanySupportRead)],
        loadComponent: () =>
          import('./pages/company-support/platform-company-support-page.component').then(
            m => m.PlatformCompanySupportPageComponent
          )
      },
      {
        path: 'ai-settings',
        canActivate: [platformPermissionGuard(PlatformPermission.AiManage)],
        loadComponent: () =>
          import('./pages/ai-settings/platform-ai-settings-page.component').then(
            m => m.PlatformAiSettingsPageComponent
          )
      },
      {
        path: 'me/2fa',
        loadComponent: () =>
          import('./pages/me/me-2fa-page.component').then(m => m.Me2faPageComponent)
      },
      {
        path: 'me',
        loadComponent: () =>
          import('./pages/me/me-profile-page.component').then(m => m.MeProfilePageComponent)
      },
      {
        path: 'me/audit',
        loadComponent: () =>
          import('./pages/me/me-audit-page.component').then(m => m.MeAuditPageComponent)
      },
      {
        path: 'preferences',
        loadComponent: () =>
          import('./pages/preferences/preferences-page.component').then(m => m.PreferencesPageComponent)
      }
    ]
  },
  { path: '**', redirectTo: 'tenants' }
];
