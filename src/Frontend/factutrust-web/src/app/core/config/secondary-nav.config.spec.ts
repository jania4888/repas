import { NAV_ID } from './nav-item-ids';
import {
  SECONDARY_NAV_SECTION_ORDER,
  secondaryNavDisplayLabel
} from './secondary-nav.config';

describe('secondary-nav.config', () => {
  it('keeps the validated desktop section order', () => {
    expect([...SECONDARY_NAV_SECTION_ORDER]).toEqual([
      NAV_ID.sales,
      NAV_ID.purchases,
      NAV_ID.stock,
      NAV_ID.treasury,
      NAV_ID.records,
      NAV_ID.hrPayroll,
      NAV_ID.accounting,
      NAV_ID.fiscalTej
    ]);
  });

  it('maps Fiscal / TEJ to TEJ for display only', () => {
    expect(secondaryNavDisplayLabel(NAV_ID.fiscalTej, 'Fiscal / TEJ')).toBe('TEJ');
    expect(secondaryNavDisplayLabel(NAV_ID.sales, 'Ventes')).toBe('Ventes');
  });
});
