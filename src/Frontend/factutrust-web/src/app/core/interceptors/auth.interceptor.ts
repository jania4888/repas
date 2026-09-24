import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { environment } from '@environments/environment';
import { SKIP_AUTH_HEADER } from '../http-context';

export const authInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn) => {
  const authService = inject(AuthService);

  // Endpoints publics anonymes de la landing : jamais de JWT, jamais de refresh sur 401.
  if (req.context.get(SKIP_AUTH_HEADER)) {
    return next(req);
  }

  // Le Bearer ne part QUE vers notre API (même modèle que le backoffice) :
  // toute future intégration tierce via HttpClient ne recevra jamais le JWT.
  const isOurApi = req.url.startsWith(environment.apiUrl) || req.url.startsWith('/api');
  if (!isOurApi) {
    return next(req);
  }

  // Skip auth header for login/register/password-reset endpoints
  if (
    req.url.includes('/auth/login') ||
    req.url.includes('/auth/register') ||
    req.url.includes('/auth/forgot-password') ||
    req.url.includes('/auth/reset-password')
  ) {
    return next(req);
  }

  const token = authService.getAccessToken();
  
  if (token) {
    req = addAuthHeader(req, token);
  }

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // Never wrap POST /auth/refresh 401 in another refresh — that caused an infinite loop
      // (refresh fails → interceptor retries refresh → same 401 → repeat).
      if (error.status === 401 && !req.url.includes('/auth/refresh')) {
        if (authService.getRefreshToken()) {
          return authService.refreshToken().pipe(
            switchMap(response => {
              if (response.success && response.data) {
                const newReq = addAuthHeader(req, response.data.accessToken);
                return next(newReq);
              }
              // Clear only — no POST /logout; skip navigate if already on /auth/*
              authService.invalidateSession();
              return throwError(() => error);
            }),
            catchError(refreshError => {
              authService.invalidateSession();
              return throwError(() => refreshError);
            })
          );
        }
        const skipAutoLogout =
          req.url.includes('/auth/login') ||
          req.url.includes('/auth/register') ||
          req.url.includes('/auth/forgot-password') ||
          req.url.includes('/auth/reset-password');
        if (authService.isAuthenticated() && !skipAutoLogout) {
          authService.invalidateSession();
        }
      }
      return throwError(() => error);
    })
  );
};

function addAuthHeader(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return req.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`
    }
  });
}
