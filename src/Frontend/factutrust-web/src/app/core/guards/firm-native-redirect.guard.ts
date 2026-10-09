import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { FIRM_DELEGATED_AI_ASSISTANT_SLUG } from '@core/config/firm-navigation.registry';
import { AuthService } from '@core/services/auth.service';

/** First path segments blocked for accounting firms in native (non-delegated) mode. */
const FIRM_NATIVE_BLOCKED_SEGMENTS = new Set([
  'dashboard',
  'invoices',
  'quotes',
  'delivery-notes',
  'return-notes',
  'clients',
  'products',
  'product-categories',
  'reports',
  'payments',
  'stock',
  'inventory',
  'transfers',
  'settings',
  'suppliers',
  'purchase-orders',
  'supplier-invoices',
  'crm',
  'forecasting',
  'studio',
  'audit',
  'documentation'
]);

/** Segments allowed only when the firm user has switched into a client dossier. */
export const FIRM_DELEGATED_ONLY_SEGMENTS = new Set(['accounting', 'withholding-tax']);

function pathWithoutQuery(url: string): string {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

/**
 * Redirects accounting firm users away from company ERP routes when not in delegated mode.
 * Must run after authGuard.
 */
export const firmNativeRedirectGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAccountingFirm()) {
    return true;
  }

  const path = pathWithoutQuery(state.url);
  const segments = path.split('/').filter(Boolean);
  const first = segments[0];

  if (!first) {
    return router.createUrlTree(['/firm/dashboard']);
  }

  if (first === 'firm') {
    return true;
  }

  if (first === 'access-denied') {
    return true;
  }

  if (path === '/settings/profile' || path.startsWith('/settings/profile/')) {
    return true;
  }

  if (FIRM_DELEGATED_ONLY_SEGMENTS.has(first)) {
    if (auth.isDelegatedMode()) {
      return true;
    }
    return router.createUrlTree(['/firm/dashboard']);
  }

  if (first === 'ai-assistant') {
    if (!auth.isDelegatedMode()) {
      return router.createUrlTree(['/firm/dashboard']);
    }
    if (segments.length === 1) {
      return router.createUrlTree(['/ai-assistant', FIRM_DELEGATED_AI_ASSISTANT_SLUG]);
    }
    return true;
  }

  if (FIRM_NATIVE_BLOCKED_SEGMENTS.has(first)) {
    return router.createUrlTree(['/firm/dashboard']);
  }

  // Allow read-only operational routes in delegated mode (invoices, payments, etc.)
  if (auth.isDelegatedMode()) {
    return true;
  }

  return router.createUrlTree(['/firm/dashboard']);
};
