import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { normalizeHttpErrorResponse } from './http-error-normalize';
import { SKIP_ERROR_TOAST } from '@core/http-context';
import { ToastService } from '@core/services/toast.service';
import {
  ErrorHandlerService,
  DELEGATED_CONTEXT_INVALID_CODE,
  TENANT_CONTEXT_INVALID_CODE
} from '@core/services/error-handler.service';
import { HttpForbiddenDialogService } from '@core/services/http-forbidden-dialog.service';
import { HttpValidationDialogService } from '@core/services/http-validation-dialog.service';
import { HttpRateLimitDialogService } from '@core/services/http-rate-limit-dialog.service';
import { AuthService } from '@core/services/auth.service';
import { TenantSystemStatusService } from '@core/services/tenant-system-status.service';
import { CORE_COMMON, CORE_HTTP } from '@core/i18n/core-localize';

/** Returns true if the error is a "context/tenant/company" error requiring re-login.
 *
 * IMPORTANT: only HTTP 403 is unambiguous for a tenant/context failure.
 * `TenantMiddleware` (backend) intercepts an invalid tenant BEFORE the controller is reached
 * and returns 403 (or 401 when the JWT itself is missing/expired). A 400 is always a
 * business-level validation error from the application layer — it must NEVER trigger
 * an automatic logout, even if its message happens to contain the word "contexte".
 * Doing so used to mask real bugs (e.g. EF Core tracking conflicts on delivery notes)
 * and silently log the user out on a recoverable error.
 */
function apiErrorCode(error: HttpErrorResponse): string | undefined {
  const payload = error?.error;
  if (payload && typeof payload === 'object' && payload !== null && 'code' in payload) {
    return (payload as { code?: string }).code;
  }
  return undefined;
}

function isContextOrTenantError(error: HttpErrorResponse, message: string): boolean {
  const code = apiErrorCode(error);
  if (code === DELEGATED_CONTEXT_INVALID_CODE) {
    return false;
  }
  if (code === TENANT_CONTEXT_INVALID_CODE) {
    return true;
  }
  const m = (message || '').toLowerCase();
  if (error.status === 403) {
    return m.includes('contexte entreprise') || m.includes('tenant') || m.includes('entreprise invalide');
  }
  return false;
}

/**
 * Global HTTP error interceptor.
 * Handles all HTTP errors and displays user-friendly messages.
 * For 400/403 context/tenant errors, shows a clear message and triggers logout + redirect to login.
 *
 * Note: Some routes (like /auth/register) handle errors locally and may not need toast notifications.
 * The error is still propagated so components can handle it.
 *
 * Public virtual street (`GET .../api/public/street/...`) passes `SKIP_ERROR_TOAST` from
 * `StreetApiService`: 404 on an unknown or unpublished storefront slug is expected business behaviour,
 * not an application fault — the street pages show inline copy instead of a global error toast.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toastService = inject(ToastService);
  const errorHandler = inject(ErrorHandlerService);
  const forbiddenDialog = inject(HttpForbiddenDialogService);
  const validationDialog = inject(HttpValidationDialogService);
  const rateLimitDialog = inject(HttpRateLimitDialogService);
  const authService = inject(AuthService);
  const tenantSystemStatus = inject(TenantSystemStatusService);
  return next(req).pipe(
    catchError((error: HttpErrorResponse) =>
      normalizeHttpErrorResponse(error).pipe(
        switchMap(processedError => {
          const errorMessage = errorHandler.extractErrorMessage(processedError);
          const isLogoutCall = req.url.includes('/auth/logout');
          const isRegistrationEndpoint =
            req.url.includes('/auth/register-firm') ||
            req.url.endsWith('/auth/register') ||
            req.url.includes('/auth/forgot-password') ||
            req.url.includes('/auth/reset-password') ||
            req.url.includes('/auth/login') ||
            req.url.includes('/auth/portal/accept-invite');
          const skipGlobalErrorUi = req.context.get(SKIP_ERROR_TOAST);

          const willShowValidationDialog =
            processedError.status === 400 &&
            !skipGlobalErrorUi &&
            !isRegistrationEndpoint &&
            errorHandler.isStructuredValidationError(processedError);

          const willShowForbiddenDialog =
            processedError.status === 403 &&
            !isLogoutCall &&
            !isContextOrTenantError(processedError, errorMessage) &&
            !isRegistrationEndpoint &&
            !skipGlobalErrorUi;

          const skipConsoleErrorLog =
            skipGlobalErrorUi ||
            (processedError.status === 401 && req.url.includes('/auth/refresh'));

          if (!skipConsoleErrorLog) {
            errorHandler.logError(
              `HTTP ${processedError.status} - ${req.method} ${req.url}`,
              processedError,
              willShowForbiddenDialog || willShowValidationDialog ? { consoleLevel: 'warn' } : undefined
            );
          }

          // 400/403 context/tenant error: session has no valid company → show message and logout
          // Skip if this is the logout call itself to avoid loop
          if (!isLogoutCall && isContextOrTenantError(processedError, errorMessage)) {
            toastService.add({
              severity: 'warn',
              summary: CORE_COMMON.sessionInvalid,
              detail: CORE_HTTP.contextError,
              life: 6000
            });
            authService.logout();
            return throwError(() => processedError);
          }

          // Skip toast notification for 401 (handled by auth interceptor)
          if (processedError.status === 401) {
            return throwError(() => processedError);
          }

          // 429 rate-limit: show a single modal dialog (not a toast) — components no longer
          // need to render an inline banner since the modal is global and deduplicated.
          if (processedError.status === 429) {
            if (!skipGlobalErrorUi && !isRegistrationEndpoint) {
              const dedupeKey = `${req.method}|${req.url}|${errorMessage}`;
              rateLimitDialog.showRateLimitExceeded(errorMessage, dedupeKey);
            }
            return throwError(() => processedError);
          }

          // 403 permission / policy (not tenant context) : lecture (GET) → toast non bloquant ;
          // écriture (POST/PATCH/PUT/DELETE) → modale bloquante actuelle (conservée).
          // `SKIP_ERROR_TOAST` reste prioritaire dans les deux cas (silence total).
          if (
            processedError.status === 403 &&
            !isLogoutCall &&
            !isContextOrTenantError(processedError, errorMessage)
          ) {
            if (!isRegistrationEndpoint && !skipGlobalErrorUi) {
              if (req.method === 'GET') {
                toastService.add({
                  severity: 'warn',
                  summary: CORE_COMMON.accessDenied,
                  detail: errorMessage,
                  life: 5000
                });
              } else {
                const dedupeKey = `${req.method}|${req.url}|${errorMessage}`;
                forbiddenDialog.showAccessDenied(errorMessage, dedupeKey);
              }
            }
            return throwError(() => processedError);
          }

          // 400 ValidationErrorResponse — modale (pas de toast doublon)
          if (willShowValidationDialog) {
            const dedupeKey = `${req.method}|${req.url}|${errorMessage}`;
            validationDialog.showValidationFailed(processedError, dedupeKey);
            return throwError(() => processedError);
          }

          if (
            processedError.status === 409 &&
            req.method === 'PATCH' &&
            req.url.includes('/purchaseorders/') &&
            req.url.includes('/confirm')
          ) {
            toastService.add({
              severity: 'warn',
              summary: CORE_COMMON.conflictConfirm,
              detail: CORE_HTTP.purchaseOrderConflict,
              life: 6000
            });
            return throwError(() => processedError);
          }

          // Encaissement honoraires : la boîte de dialogue rend son propre message + recharge
          // la facture. On supprime le toast générique pour éviter le doublon (le composant
          // affiche déjà un toast « warn » spécifique et un message inline).
          if (
            processedError.status === 409 &&
            req.method === 'POST' &&
            /\/honoraires\/invoices\/[^/]+\/payments$/i.test(req.url)
          ) {
            return throwError(() => processedError);
          }

          // POS cart autosave: PosSessionSyncService handles conflicts silently.
          if (
            processedError.status === 409 &&
            (req.method === 'PUT' || req.method === 'DELETE') &&
            /\/pos\/cart(?:\?|$)/i.test(req.url)
          ) {
            return throwError(() => processedError);
          }

          if (errorHandler.isTenantMigrationFailure(processedError)) {
            tenantSystemStatus.reportTenantMigrationFailure();
            if (!isRegistrationEndpoint && !skipGlobalErrorUi) {
              toastService.add({
                severity: 'warn',
                summary: CORE_COMMON.database,
                detail: errorMessage,
                life: 8000
              });
            }
            return throwError(() => processedError);
          }

          if (!isRegistrationEndpoint && !skipGlobalErrorUi) {
            toastService.add({
              severity: 'error',
              summary: CORE_COMMON.error,
              detail: errorMessage,
              life: 5000
            });
          }

          // Always propagate error so components can handle it
          return throwError(() => processedError);
        })
      )
    )
  );
};
