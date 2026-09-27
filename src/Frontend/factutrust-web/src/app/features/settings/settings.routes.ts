/// <reference types="@angular/localize" />
import { Routes } from '@angular/router';
import { adminGuard } from '@core/guards/admin.guard';
import { permissionGuard } from '@core/guards/permission.guard';
import { platformSettingsGuard } from '@core/guards/platform-settings.guard';
import { storefrontManageGuard } from '@core/guards/storefront-manage.guard';
import { PERMISSIONS } from '@core/config/permission-keys';

export const SETTINGS_ROUTES: Routes = [
  {
    path: '',
    canActivate: [platformSettingsGuard],
    loadComponent: () => import('./settings.component').then(m => m.SettingsComponent),
    title: $localize`:@@settings.routes.title.Param_tres_InstaFact:Paramètres - InstaFact`
  },
  {
    path: 'profile',
    loadComponent: () => import('./profile/profile.component').then(m => m.ProfileComponent),
    title: $localize`:@@settings.routes.title.Mon_profil_InstaFact:Mon profil - InstaFact`
  },
  {
    path: 'company',
    canActivate: [platformSettingsGuard],
    loadComponent: () => import('./company/company.component').then(m => m.CompanyComponent),
    title: $localize`:@@settings.routes.title.Mon_entreprise_InstaFa:Mon entreprise - InstaFact`
  },
  {
    path: 'modules',
    canActivate: [platformSettingsGuard, permissionGuard],
    data: { permissions: [PERMISSIONS.settings.update] },
    loadComponent: () => import('./modules/modules-settings.component').then(m => m.ModulesSettingsComponent),
    title: $localize`:@@settings.routes.title.Modules_InstaFact:Modules - InstaFact`
  },
  {
    path: 'subscription',
    canActivate: [platformSettingsGuard],
    loadComponent: () => import('./subscription/subscription.component').then(m => m.SubscriptionComponent),
    title: $localize`:@@settings.routes.title.Mon_abonnement_InstaFa:Mon abonnement - InstaFact`
  },
  {
    path: 'numbering',
    canActivate: [platformSettingsGuard],
    loadComponent: () => import('./numbering/numbering.component').then(m => m.NumberingComponent),
    title: $localize`:@@settings.routes.title.Num_rotations_InstaFac:Numérotations - InstaFact`
  },
  {
    path: 'templates',
    canActivate: [platformSettingsGuard],
    loadComponent: () => import('./templates/templates.component').then(m => m.DocumentTemplatesComponent),
    title: $localize`:@@settings.routes.title.Mod_les_de_documents_I:Modèles de documents - InstaFact`
  },
  {
    path: 'payment-terms',
    canActivate: [platformSettingsGuard],
    loadComponent: () =>
      import('./payment-terms/payment-terms.component').then(m => m.PaymentTermsComponent),
    title: $localize`:@@settings.routes.title.Conditions_de_r_glement_:Conditions de règlement - InstaFact`
  },
  {
    path: 'taxes',
    canActivate: [platformSettingsGuard],
    loadComponent: () => import('./taxes/taxes.component').then(m => m.TaxesComponent),
    title: $localize`:@@settings.routes.title.Taxes_et_TVA_InstaFact:Taxes et TVA - InstaFact`
  },
  {
    path: 'promotions',
    canActivate: [permissionGuard],
    data: { permissions: [PERMISSIONS.pricing.read] },
    loadComponent: () =>
      import('./promotions/promotions-page.component').then(m => m.PromotionsPageComponent),
    title: $localize`:@@settings.routes.title.Promotions_InstaFact:Promotions - InstaFact`
  },
  {
    path: 'variant-axes',
    canActivate: [platformSettingsGuard],
    loadChildren: () =>
      import('./variant-axes/variant-axes.routes').then(m => m.VARIANT_AXES_ROUTES)
  },
  {
    path: 'warehouses',
    canActivate: [platformSettingsGuard],
    loadComponent: () => import('./warehouses/warehouses.component').then(m => m.WarehousesComponent),
    title: $localize`:@@settings.routes.title.Entrep_ts_InstaFact:Entrepôts - InstaFact`
  },
  {
    path: 'users',
    canActivate: [platformSettingsGuard, adminGuard],
    loadComponent: () => import('./users/tenant-users-list.component').then(m => m.TenantUsersListComponent),
    title: $localize`:@@settings.routes.title.Utilisateurs_InstaFact:Utilisateurs - InstaFact`
  },
  {
    path: 'users/add',
    canActivate: [platformSettingsGuard, adminGuard],
    loadComponent: () => import('./users/tenant-users-bulk.component').then(m => m.TenantUsersBulkComponent),
    title: $localize`:@@settings.routes.title.Ajouter_des_utilisateurs:Ajouter des utilisateurs - InstaFact`
  },
  {
    path: 'storefront',
    canActivate: [platformSettingsGuard, storefrontManageGuard],
    loadComponent: () =>
      import('./storefront/storefront-settings.component').then(m => m.StorefrontSettingsComponent),
    title: $localize`:@@settings.routes.title.Vitrine_publique_Insta:Vitrine publique - InstaFact`
  },
  {
    path: 'accounting-firm',
    canActivate: [platformSettingsGuard, adminGuard],
    loadComponent: () =>
      import('./accounting-firm/accounting-firm-settings.component').then(m => m.AccountingFirmSettingsComponent),
    title: $localize`:@@settings.routes.title.Cabinet_comptable_Inst:Cabinet comptable - InstaFact`
  },
  {
    // Page personnelle (chaque utilisateur gère SA liaison WhatsApp) : pas de platformSettingsGuard,
    // même patron que la route `profile`.
    path: 'channels',
    loadComponent: () =>
      import('./channels/channels-settings.component').then(m => m.ChannelsSettingsComponent),
    title: $localize`:@@settings.routes.title.WhatsApp_InstaFact:WhatsApp - InstaFact`
  }
];
