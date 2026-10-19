import { signal } from '@angular/core';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import {
  DATA_EXPORT_DATASETS,
  DATA_EXPORT_READ_PERMISSIONS,
  canExportBusinessData,
  visibleExportDatasets
} from './data-export.catalog';

function authWith(permissions: string[] | null): AuthService {
  return {
    user: signal(permissions === null ? {} : { effectivePermissions: permissions }),
    hasPermission: (permission: string) => (permissions ?? []).includes(permission),
    hasAnyPermission: (required: readonly string[]) => required.some(p => (permissions ?? []).includes(p))
  } as unknown as AuthService;
}

describe('data-export catalog (bons de réception)', () => {
  it('lists purchase receipts right after purchase orders', () => {
    const keys = DATA_EXPORT_DATASETS.map(d => d.key);
    expect(keys.indexOf('purchase-receipts')).toBe(keys.indexOf('purchase-orders') + 1);
    const option = DATA_EXPORT_DATASETS.find(d => d.key === 'purchase-receipts');
    expect(option?.permission).toBe(PERMISSIONS.purchaseReceipts.read);
  });

  it('opens "Mes données" to a user who can only read purchase receipts', () => {
    expect(DATA_EXPORT_READ_PERMISSIONS).toContain(PERMISSIONS.purchaseReceipts.read);
    const auth = authWith([PERMISSIONS.purchaseReceipts.read]);
    expect(canExportBusinessData(auth)).toBeTrue();
    expect(visibleExportDatasets(auth).map(d => d.key)).toEqual(['purchase-receipts']);
  });

  it('hides the purchase receipts option without the read permission', () => {
    const auth = authWith([PERMISSIONS.clients.read]);
    expect(visibleExportDatasets(auth).map(d => d.key)).not.toContain('purchase-receipts');
  });
});
