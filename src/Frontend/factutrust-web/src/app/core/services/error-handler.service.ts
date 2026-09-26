import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

/** Backend ValidationErrorResponse / similar (`VALIDATION_FAILED`, fieldErrors, globalErrors). */
const VALIDATION_FAILED_CODE = 'VALIDATION_FAILED';
const TENANT_MIGRATION_FAILED_CODE = 'TENANT_MIGRATION_FAILED';
export const TENANT_CONTEXT_INVALID_CODE = 'TENANT_CONTEXT_INVALID';
export const DELEGATED_CONTEXT_INVALID_CODE = 'DELEGATED_CONTEXT_INVALID';

export interface ApiErrorResponse {
  success?: boolean;
  errors?: string[];
  message?: string;
  error?: string;
  /** Stable backend code (e.g. TENANT_MIGRATION_FAILED). */
  code?: string;
  fieldErrors?: Record<string, any[]>;
}

/**
 * Centralized error handling service.
 * Provides consistent error extraction and formatting across the application.
 */
@Injectable({
  providedIn: 'root'
})
export class ErrorHandlerService {
  /**
   * True when the response is a structured validation payload (FluentValidation / ValidationErrorResponse).
   * Use with HTTP 400 from the interceptor.
   */
  isStructuredValidationError(error: HttpErrorResponse | any): boolean {
    if (error?.status !== 400) {
      return false;
    }
    const payload = this.getValidationPayload(error);
    if (!payload) {
      return false;
    }
    const code = payload['code'];
    if (code === VALIDATION_FAILED_CODE) {
      return true;
    }
    const fieldErrors = payload['fieldErrors'];
    if (fieldErrors && typeof fieldErrors === 'object' && !Array.isArray(fieldErrors) && Object.keys(fieldErrors).length > 0) {
      return true;
    }
    const globalErrors = payload['globalErrors'] ?? payload['GlobalErrors'];
    return Array.isArray(globalErrors) && globalErrors.length > 0;
  }

  /**
   * Multi-line message for validation error dialogs (field + global messages, deduplicated).
   */
  formatValidationDialogBody(error: HttpErrorResponse | any): string {
    return this.extractStructuredValidationMessages(error).join('\n');
  }

  /**
   * True when the backend blocked the request because tenant migrations failed or are pending.
   */
  isTenantMigrationFailure(error: HttpErrorResponse | any): boolean {
    return this.getApiErrorCode(error) === TENANT_MIGRATION_FAILED_CODE;
  }

  isTenantContextInvalid(error: HttpErrorResponse | any): boolean {
    return this.getApiErrorCode(error) === TENANT_CONTEXT_INVALID_CODE;
  }

  /** User-facing message for tenant migration / database upgrade failures. */
  getTenantMigrationFailureMessage(): string {
    return 'Mise à jour de la base de données en cours ou bloquée. Réessayez dans quelques instants ou contactez l\'administrateur si le problème persiste.';
  }

  private getApiErrorCode(error: HttpErrorResponse | any): string | undefined {
    const payload = typeof error?.error === 'object' && error?.error !== null
      ? error.error as ApiErrorResponse
      : null;
    return payload?.code;
  }

  /**
   * Extracts error message from HTTP error response.
   * Handles multiple error response formats from the backend.
   *
   * @param networkFallback Message rendu à la place du message générique de connexion lorsque la
   * requête n'a pas abouti du tout (`status === 0`). Il porte le contexte de l'action — « … lors du
   * chargement du relevé. » — que le message générique ne peut pas connaître. Passer ce paramètre
   * permet à un écran d'afficher la raison du refus côté serveur tout en conservant son message
   * réseau d'origine. **Sans ce paramètre, le comportement est strictement celui d'avant.**
   */
  extractErrorMessage(error: HttpErrorResponse | any, networkFallback?: string): string {
    // Le repli n'est consenti que sur une absence totale de réponse : un 4xx porte un message
    // métier qu'il ne faut jamais masquer derrière un libellé d'erreur réseau.
    if (networkFallback !== undefined && (error as HttpErrorResponse)?.status === 0) {
      return networkFallback;
    }
    if (this.isTenantMigrationFailure(error)) {
      return this.getTenantMigrationFailureMessage();
    }
    // Network error (backend not reachable) - multiple checks
    if (
      error.status === 0 ||
      error instanceof ErrorEvent ||
      (!error.status && !error.error) ||
      (error.status === undefined && error.error === undefined)
    ) {
      return 'Impossible de se connecter au serveur. Vérifiez que le backend est démarré sur https://localhost:7001 et que votre connexion est active.';
    }

    // Handle case where error is not a proper HttpErrorResponse
    if (!error || (typeof error === 'object' && !error.status && !error.error && !error.message)) {
      return 'Erreur de connexion. Le serveur ne répond pas. Vérifiez que le backend est démarré.';
    }

    // Handle non-JSON responses (e.g., rate limiting text responses)
    let errorData: ApiErrorResponse | string | null = error.error;

    // If error.error is a string that looks like it might be JSON, try to parse it
    if (typeof errorData === 'string' && errorData.trim().startsWith('{')) {
      try {
        errorData = JSON.parse(errorData) as ApiErrorResponse;
      } catch {
        // If parsing fails, keep it as string
      }
    }

    // If error.error is a string (non-JSON response), handle it directly
    if (typeof errorData === 'string') {
      // Check if it's a rate limiting message
      if (error.status === 429 || errorData.toLowerCase().includes('trop de requêtes')) {
        return 'Trop de requêtes. Veuillez patienter avant de réessayer.';
      }
      return errorData;
    }

    // No error data but we have a status
    if (!errorData && error.status) {
      return this.getDefaultMessage(error.status);
    }

    // No error data and no status - network issue
    if (!errorData && !error.status) {
      return 'Erreur de connexion réseau. Vérifiez votre connexion et que le backend est démarré.';
    }

    // String error
    if (typeof errorData === 'string') {
      return errorData;
    }

    // ValidationErrorResponse format (from ExceptionHandlingMiddleware) - check FIRST
    // This ensures field-level validation errors are shown instead of generic messages
    if (errorData && typeof errorData === 'object' && (errorData as any).fieldErrors) {
      const fieldErrors = (errorData as any).fieldErrors;
      if (Object.keys(fieldErrors).length > 0) {
        const allErrors: string[] = [];
        Object.values(fieldErrors).forEach((errors: any) => {
          if (Array.isArray(errors)) {
            errors.forEach((fe: any) => {
              if (fe.message) allErrors.push(fe.message);
            });
          }
        });
        if (allErrors.length > 0) {
          return allErrors.join(', ');
        }
      }
    }

    // ValidationErrorResponse global errors
    if (errorData && typeof errorData === 'object') {
      const globalErrors = (errorData as any).globalErrors ?? (errorData as any).GlobalErrors;
      if (Array.isArray(globalErrors) && globalErrors.length > 0) {
        return globalErrors.join(', ');
      }
    }

    // Domain Error format (code/description)
    if (errorData && typeof errorData === 'object') {
      const description = (errorData as any).description ?? (errorData as any).Description;
      if (description) {
        return description;
      }
    }

    // ApiResponse format (our standard format) - check AFTER field errors
    if (this.isApiResponse(errorData)) {
      // Multiple errors
      if (errorData.errors && Array.isArray(errorData.errors) && errorData.errors.length > 0) {
        return errorData.errors.join(', ');
      }
      // Single message
      if (errorData.message) {
        return errorData.message;
      }
      // Backend ApiResponse.Fail() sends the message in "error" (camelCase)
      if (errorData.error) {
        return errorData.error;
      }
    }

    // Fallback to message, error, or default
    const finalMessage = (errorData && (errorData.message ?? (errorData as any).error)) || this.getDefaultMessage(error.status);

    // S'assurer qu'on ne retourne jamais "undefined" comme chaîne
    if (!finalMessage || finalMessage === 'undefined' || finalMessage.trim() === '') {
      return this.getDefaultMessage(error.status || 0);
    }

    return finalMessage;
  }

  /**
   * Extracts all error messages from HTTP error response.
   */
  extractAllErrors(error: HttpErrorResponse | any): string[] {
    const errorData: ApiErrorResponse | string | null = error.error;

    if (!errorData || typeof errorData === 'string') {
      return [this.extractErrorMessage(error)];
    }

    const errors: string[] = [];

    // ApiResponse format
    if (this.isApiResponse(errorData)) {
      if (errorData.errors && Array.isArray(errorData.errors)) {
        errors.push(...errorData.errors);
      } else if (errorData.message) {
        errors.push(errorData.message);
      } else if (errorData.error) {
        errors.push(errorData.error);
      }
    }

    // ValidationErrorResponse global errors
    if (errorData && typeof errorData === 'object') {
      const globalErrors = (errorData as any).globalErrors ?? (errorData as any).GlobalErrors;
      if (Array.isArray(globalErrors) && globalErrors.length > 0) {
        errors.push(...globalErrors);
      }
    }

    // Domain Error format (code/description)
    if (errorData && typeof errorData === 'object') {
      const description = (errorData as any).description ?? (errorData as any).Description;
      if (description) {
        errors.push(description);
      }
    }

    // ValidationErrorResponse format
    if (errorData.fieldErrors && Object.keys(errorData.fieldErrors).length > 0) {
      Object.values(errorData.fieldErrors).forEach(fieldErrors => {
        if (Array.isArray(fieldErrors)) {
          fieldErrors.forEach((fe: any) => {
            if (fe.message) errors.push(fe.message);
          });
        }
      });
    }

    return errors.length > 0 ? errors : [this.getDefaultMessage(error.status)];
  }

  /**
   * Logs error details for debugging.
   * @param options.consoleLevel — `warn` lorsque l’erreur est déjà signalée à l’utilisateur (ex. modale 403).
   */
  logError(
    context: string,
    error: HttpErrorResponse | any,
    options?: { consoleLevel?: 'error' | 'warn' }
  ): void {
    const errorMessage = this.extractErrorMessage(error);

    // Enhanced error details with better handling of undefined values
    const payload = typeof error?.error === 'object' && error?.error !== null ? error.error as ApiErrorResponse : null;
    const errorDetails: any = {
      context,
      status: error?.status ?? 'N/A',
      statusText: error?.statusText ?? 'N/A',
      url: error?.url ?? error?.config?.url ?? 'N/A',
      message: errorMessage,
      timestamp: new Date().toISOString(),
      ...(payload?.code ? { code: payload.code } : {})
    };

    // Only include error.error if it exists and is meaningful
    if (error?.error !== undefined && error?.error !== null) {
      errorDetails.error = error.error;
    }

    // Add network-specific information
    if (error?.status === 0 || !error?.status) {
      errorDetails.networkError = true;
      errorDetails.suggestion = 'Vérifiez que le backend est démarré et accessible sur https://localhost:7001';
    }

    const level = options?.consoleLevel ?? 'error';
    const line = `[ErrorHandler] ${context}:`;
    if (level === 'warn') {
      console.warn(line, errorDetails);
    } else {
      console.error(line, errorDetails);
    }

    // In production, you might want to send this to a logging service
    // this.loggingService.logError(errorDetails);
  }

  /**
   * Unwraps optional nested `error` when it carries validation data (defensive for wrapped API shapes).
   */
  private getValidationPayload(error: HttpErrorResponse | any): Record<string, unknown> | null {
    let data: unknown = error?.error;
    if (typeof data === 'string' && data.trim().startsWith('{')) {
      try {
        data = JSON.parse(data) as ApiErrorResponse;
      } catch {
        return null;
      }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }
    const root = data as Record<string, unknown>;
    const nested = root['error'];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const n = nested as Record<string, unknown>;
      const hasValidation =
        n['fieldErrors'] !== undefined ||
        n['code'] === VALIDATION_FAILED_CODE ||
        (Array.isArray(n['globalErrors']) && (n['globalErrors'] as unknown[]).length > 0) ||
        (Array.isArray(n['GlobalErrors']) && (n['GlobalErrors'] as unknown[]).length > 0);
      if (hasValidation) {
        return n;
      }
    }
    return root;
  }

  private extractStructuredValidationMessages(error: HttpErrorResponse | any): string[] {
    const payload = this.getValidationPayload(error);
    if (!payload) {
      return [this.extractErrorMessage(error)];
    }
    const out: string[] = [];
    const fieldErrors = payload['fieldErrors'] as Record<string, { message?: string }[]> | undefined;
    if (fieldErrors && typeof fieldErrors === 'object' && !Array.isArray(fieldErrors)) {
      for (const arr of Object.values(fieldErrors)) {
        if (Array.isArray(arr)) {
          for (const fe of arr) {
            if (fe?.message) {
              out.push(fe.message);
            }
          }
        }
      }
    }
    const globalErrors = (payload['globalErrors'] ?? payload['GlobalErrors']) as string[] | undefined;
    if (Array.isArray(globalErrors)) {
      out.push(...globalErrors.filter((g): g is string => typeof g === 'string' && g.trim().length > 0));
    }
    const seen = new Set<string>();
    const deduped = out.filter(m => {
      if (seen.has(m)) {
        return false;
      }
      seen.add(m);
      return true;
    });
    if (deduped.length > 0) {
      return deduped;
    }
    const msg = payload['message'];
    if (typeof msg === 'string' && msg.trim()) {
      return [msg.trim()];
    }
    return [this.extractErrorMessage(error)];
  }

  /**
   * Checks if error data matches ApiResponse format.
   */
  private isApiResponse(data: any): data is ApiErrorResponse {
    return data && (typeof data.success === 'boolean' || Array.isArray(data.errors) || data.message || data.error);
  }

  /**
   * Returns default error message based on HTTP status code.
   */
  private getDefaultMessage(status: number): string {
    const messages: Record<number, string> = {
      0: 'Impossible de se connecter au serveur. Vérifiez votre connexion.',
      400: 'Requête invalide. Veuillez vérifier les données saisies.',
      401: 'Authentification requise. Veuillez vous connecter.',
      403: 'Accès non autorisé.',
      404: 'Ressource non trouvée.',
      422: 'Données invalides. Veuillez corriger les erreurs indiquées.',
      429: 'Trop de requêtes. Veuillez patienter avant de réessayer.',
      409: 'Conflit de données : une autre modification a eu lieu. Actualisez la page et réessayez.',
      500: 'Erreur serveur. Veuillez réessayer plus tard.',
      502: 'Service temporairement indisponible.',
      503: 'Service en maintenance. Veuillez réessayer plus tard.'
    };

    return messages[status] || `Erreur ${status}. Veuillez réessayer.`;
  }
}
