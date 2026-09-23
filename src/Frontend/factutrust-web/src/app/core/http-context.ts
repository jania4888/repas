import { HttpContext, HttpContextToken } from '@angular/common/http';

/**
 * When set to true on a request, the error interceptor will not show global UI for that
 * request's error (neither toast nor modale 403). The caller handles feedback (e.g. inline or dialog).
 */
export const SKIP_ERROR_TOAST = new HttpContextToken<boolean>(() => false);

/** Context for requests where the caller suppresses global error UI (e.g. dashboard aggregate calls). */
export function createHttpContextSkipGlobalErrorUi(): HttpContext {
  return new HttpContext().set(SKIP_ERROR_TOAST, true);
}

/**
 * When set to true, `authInterceptor` never attaches `Authorization: Bearer` (and never attempts a
 * refresh on 401). Reserved for anonymous public endpoints called from the landing
 * (`GET /api/public/registration-status`, `POST /api/public/contact-requests`): a signed-in visitor
 * browsing the landing must not leak their JWT to endpoints that do not need it.
 */
export const SKIP_AUTH_HEADER = new HttpContextToken<boolean>(() => false);

/** Context for anonymous public landing calls: no global error UI, no JWT. */
export function createHttpContextPublicAnonymous(): HttpContext {
  return new HttpContext().set(SKIP_ERROR_TOAST, true).set(SKIP_AUTH_HEADER, true);
}
