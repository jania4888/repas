import { ANNUAL_SAVING_PERCENT, ANNUAL_SAVING_TND, LANDING_PRICING } from './landing-pricing';

describe('landing-pricing', () => {
  it('reproduit les tarifs affichés aujourd’hui (0 / 49 / 39 TND, 468 TND/an)', () => {
    expect(LANDING_PRICING.free.priceMonthly).toBe(0);
    expect(LANDING_PRICING.monthly.priceMonthly).toBe(49);
    expect(LANDING_PRICING.annual.priceMonthly).toBe(39);
    expect(LANDING_PRICING.annual.priceAnnual).toBe(468);
    expect(LANDING_PRICING.annual.priceAnnual as number).toBe(LANDING_PRICING.annual.priceMonthly * 12);
  });

  it('calcule l’économie annuelle : 120 TND soit 20 %', () => {
    expect(ANNUAL_SAVING_TND).toBe(120);
    expect(ANNUAL_SAVING_PERCENT).toBe(20);
  });

  it('conserve les quotas du plan gratuit', () => {
    expect(LANDING_PRICING.free).toEqual(
      jasmine.objectContaining({ maxInvoicesPerMonth: 10, maxQuotesPerMonth: 10, maxClients: 20, maxProducts: 50, maxUsers: 5, storageLabel: '100 Mo' })
    );
    expect(LANDING_PRICING.monthly.storageLabel).toBe('5 Go');
    expect(LANDING_PRICING.annual.storageLabel).toBe('20 Go');
  });
});
