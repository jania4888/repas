import { PERMISSIONS } from '@core/config/permission-keys';
import { AuthService } from '@core/services/auth.service';
import { canImportPurchaseReceipt } from './purchase-receipt-import.permissions';

describe('canImportPurchaseReceipt', () => {
  function makeAuth(overrides: {
    isFirmDelegatedReadonly?: boolean;
    permissions?: string[];
  } = {}): AuthService {
    const permissions = new Set(overrides.permissions ?? [PERMISSIONS.purchaseReceipts.create, 'ai:chat']);
    return {
      isFirmDelegatedReadonly: () => overrides.isFirmDelegatedReadonly ?? false,
      hasPermission: (p: string) => permissions.has(p),
      hasAllPermissions: (ps: readonly string[]) => ps.every(p => permissions.has(p))
    } as unknown as AuthService;
  }

  it('refuse sans le droit de création des bons de réception', () => {
    const auth = makeAuth({ permissions: ['ai:chat'] });
    expect(canImportPurchaseReceipt(auth)).toBeFalse();
  });

  it('refuse sans le droit "ai:chat"', () => {
    const auth = makeAuth({ permissions: [PERMISSIONS.purchaseReceipts.create] });
    expect(canImportPurchaseReceipt(auth)).toBeFalse();
  });

  it('refuse pour un cabinet délégué en lecture seule, même avec tous les droits', () => {
    const auth = makeAuth({ isFirmDelegatedReadonly: true });
    expect(canImportPurchaseReceipt(auth)).toBeFalse();
  });

  it('autorise quand tout est accordé', () => {
    const auth = makeAuth();
    expect(canImportPurchaseReceipt(auth)).toBeTrue();
  });
});
