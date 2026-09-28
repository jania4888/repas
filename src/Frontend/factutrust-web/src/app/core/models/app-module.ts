/**
 * Mirrors backend <c>InstaFact.Domain.Enums.AppModule</c> (integer values must stay aligned).
 */
export enum AppModule {
  Clients = 0,
  Products = 1,
  Sales = 2,
  Treasury = 3,
  Reports = 4,
  Administration = 5,
  Purchases = 6,
  Stock = 7,
  Accounting = 8,
  CRM = 9,
  Fiscal = 10,
  AI = 11,
  Forecasting = 12,
  Studio = 13,
  Payroll = 14,
  Honoraires = 15,
  Projects = 16,
  RecurringContracts = 17
}

export const APP_MODULE_OPTIONS: { value: AppModule; label: string }[] = [
  { value: AppModule.Clients, label: $localize`:@@core.app-module.ts.clients.28e22fe3:Clients` },
  { value: AppModule.Products, label: $localize`:@@core.app-module.ts.produits.et.services.9e065b58:Produits et services` },
  { value: AppModule.Sales, label: $localize`:@@core.app-module.ts.ventes.factures.7fa617b2:Ventes (factures)` },
  { value: AppModule.Treasury, label: $localize`:@@core.app-module.ts.tresorerie.paiements.983c8bd1:Trésorerie (paiements)` },
  { value: AppModule.Reports, label: $localize`:@@core.app-module.ts.rapports.db7d9fbb:Rapports` },
  { value: AppModule.Administration, label: $localize`:@@core.app-module.ts.parametres.et.utilisateurs.af047cf5:Paramètres et utilisateurs` },
  { value: AppModule.Purchases, label: $localize`:@@core.app-module.ts.achats.ee5b078c:Achats` },
  { value: AppModule.Stock, label: $localize`:@@core.app-module.ts.stock.bcecf456:Stock` },
  { value: AppModule.Accounting, label: $localize`:@@core.app-module.ts.comptabilite.20af7266:Comptabilité` },
  { value: AppModule.CRM, label: $localize`:@@core.app-module.ts.crm.commercial.96a9fcf3:CRM Commercial` },
  { value: AppModule.Fiscal, label: $localize`:@@core.app-module.ts.fiscal.tej.1a1e125b:Fiscal / TEJ` },
  { value: AppModule.AI, label: $localize`:@@core.app-module.ts.assistant.ia.94f6f208:Assistant IA` },
  { value: AppModule.Forecasting, label: $localize`:@@core.app-module.ts.previsions.ia.2cbfbe7a:Prévisions IA` },
  { value: AppModule.Studio, label: $localize`:@@core.app-module.ts.studio.low.code.55109c77:Studio (low-code)` },
  { value: AppModule.Payroll, label: $localize`:@@core.app-module.ts.rh.paie.615f4eb1:RH & Paie` },
  { value: AppModule.Honoraires, label: $localize`:@@core.app-module.ts.honoraires.4358b051:Honoraires` },
  { value: AppModule.Projects, label: $localize`:@@core.app-module.ts.projets.b1e8cd4d:Projets` },
  { value: AppModule.RecurringContracts, label: $localize`:@@core.app-module.ts.contrats.recurrents.e773e54a:Contrats récurrents` }
];
