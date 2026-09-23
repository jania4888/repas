/**
 * Source de vérité des chiffres tarifaires de la landing (plan A.5.8).
 * Doit rester alignée sur `FactuTrust.API/Controllers/SubscriptionController.cs` (GetAvailablePlans)
 * et `FactuTrust.Domain/Enums/SubscriptionPlan.cs` (SubscriptionLimits).
 * `GET api/subscription/plans` exige la permission SettingsRead : il n'est pas appelable en public.
 * Les libellés viennent du dictionnaire (`t().home.pricing`) ; ici uniquement des nombres.
 */
export const LANDING_PRICING = {
  currency: 'TND',
  free: {
    priceMonthly: 0,
    maxInvoicesPerMonth: 10,
    maxQuotesPerMonth: 10,
    maxClients: 20,
    maxProducts: 50,
    storageLabel: '100 Mo',
    maxUsers: 5,
    electronicSignature: false,
    xmlExport: false,
    prioritySupport: false
  },
  monthly: {
    priceMonthly: 49,
    storageLabel: '5 Go',
    electronicSignature: true,
    xmlExport: true,
    prioritySupport: false
  },
  annual: {
    priceMonthly: 39,
    priceAnnual: 468,
    storageLabel: '20 Go',
    electronicSignature: true,
    xmlExport: true,
    prioritySupport: true
  }
} as const;

/** 49 × 12 − 468 = 120 TND. */
export const ANNUAL_SAVING_TND = LANDING_PRICING.monthly.priceMonthly * 12 - LANDING_PRICING.annual.priceAnnual;

/** ≈ 20 %. */
export const ANNUAL_SAVING_PERCENT = Math.round((ANNUAL_SAVING_TND / (LANDING_PRICING.monthly.priceMonthly * 12)) * 100);
