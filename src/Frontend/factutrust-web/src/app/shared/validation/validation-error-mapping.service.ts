import { Injectable } from '@angular/core';
import {
  ValidationErrorResponse,
  WizardFieldErrors,
  WizardStepKey,
  FieldError,
  createEmptyWizardErrors,
  getStepForField,
  getStepIndex,
  isValidationErrorResponse,
  countBySeverity
} from './validation-error.model';

/**
 * Service for mapping backend validation errors to frontend form fields.
 * Handles the translation between API error responses and wizard step errors.
 */
@Injectable({
  providedIn: 'root'
})
export class ValidationErrorMappingService {

  /**
   * Maps a backend validation error response to wizard field errors.
   */
  mapToWizardFields(response: ValidationErrorResponse): WizardFieldErrors {
    const mapped = createEmptyWizardErrors();

    for (const [fieldPath, errors] of Object.entries(response.fieldErrors)) {
      const { stepKey, field } = this.parseFieldPath(fieldPath);

      if (stepKey && field) {
        if (!mapped[stepKey][field]) {
          mapped[stepKey][field] = [];
        }
        mapped[stepKey][field].push(...errors);
      }
    }

    return mapped;
  }

  /**
   * Parses a backend field path into step key and field name.
   */
  private parseFieldPath(path: string): { stepKey: WizardStepKey | null; field: string | null } {
    const stepKey = getStepForField(path);
    
    if (!stepKey) {
      return { stepKey: null, field: null };
    }

    // Extract the field name (last part of the path or the whole path if simple)
    const field = this.extractFieldName(path, stepKey);
    
    return { stepKey, field };
  }

  /**
   * Extracts the field name from a path, removing the step prefix if present.
   */
  private extractFieldName(path: string, stepKey: WizardStepKey): string {
    // Common prefixes to remove
    const prefixes = [
      'metadata.',
      'seller.',
      'client.',
      'newClient.',
      'client.address.',
      'newClient.address.',
      'lines.',
      'payment.',
      'paymentLegal.',
      'paymentLegal.bankInfo.',
      'paymentLegal.legalMentions.',
      'bankInfo.',
      'legalMentions.'
    ];

    let field = path;
    for (const prefix of prefixes) {
      if (path.startsWith(prefix)) {
        field = path.substring(prefix.length);
        break;
      }
    }

    return field;
  }

  /**
   * Returns the step index that contains the first error.
   */
  getFirstErrorStep(errors: WizardFieldErrors): number {
    const stepOrder: WizardStepKey[] = ['metadata', 'seller', 'client', 'lines', 'legal', 'preview'];

    for (let i = 0; i < stepOrder.length; i++) {
      const stepKey = stepOrder[i];
      const stepErrors = errors[stepKey];
      
      if (Object.keys(stepErrors).length > 0) {
        // Check if there are actual errors (not just warnings)
        const hasErrors = Object.values(stepErrors)
          .flat()
          .some(e => e.severity === 'ERROR');
        
        if (hasErrors) {
          return i;
        }
      }
    }

    return -1;
  }

  /**
   * Gets all error messages for a specific step.
   */
  getStepErrors(errors: WizardFieldErrors, stepKey: WizardStepKey): string[] {
    const stepErrors = errors[stepKey];
    const messages: string[] = [];

    for (const fieldErrors of Object.values(stepErrors)) {
      for (const error of fieldErrors) {
        if (error.severity === 'ERROR') {
          messages.push(error.message);
        }
      }
    }

    return messages;
  }

  /**
   * Gets all warning messages for a specific step.
   */
  getStepWarnings(errors: WizardFieldErrors, stepKey: WizardStepKey): string[] {
    const stepErrors = errors[stepKey];
    const messages: string[] = [];

    for (const fieldErrors of Object.values(stepErrors)) {
      for (const error of fieldErrors) {
        if (error.severity === 'WARNING') {
          messages.push(error.message);
        }
      }
    }

    return messages;
  }

  /**
   * Checks if a specific field has errors.
   */
  hasFieldError(errors: WizardFieldErrors, stepKey: WizardStepKey, field: string): boolean {
    const stepErrors = errors[stepKey];
    const fieldErrors = stepErrors[field];
    
    if (!fieldErrors || fieldErrors.length === 0) {
      return false;
    }

    return fieldErrors.some(e => e.severity === 'ERROR');
  }

  /**
   * Gets the first error message for a field.
   */
  getFieldErrorMessage(errors: WizardFieldErrors, stepKey: WizardStepKey, field: string): string | null {
    const stepErrors = errors[stepKey];
    const fieldErrors = stepErrors[field];

    if (!fieldErrors || fieldErrors.length === 0) {
      return null;
    }

    // Return first error, preferring blocking errors over warnings
    const blockingError = fieldErrors.find(e => e.severity === 'ERROR');
    if (blockingError) {
      return blockingError.message;
    }

    return fieldErrors[0].message;
  }

  /**
   * Merges local validation errors with server errors.
   * Server errors take precedence.
   */
  mergeErrors(
    localErrors: WizardFieldErrors,
    serverErrors: WizardFieldErrors
  ): WizardFieldErrors {
    const merged = createEmptyWizardErrors();

    // Copy local errors
    for (const stepKey of Object.keys(localErrors) as WizardStepKey[]) {
      for (const [field, errors] of Object.entries(localErrors[stepKey])) {
        merged[stepKey][field] = [...errors];
      }
    }

    // Override/add server errors
    for (const stepKey of Object.keys(serverErrors) as WizardStepKey[]) {
      for (const [field, errors] of Object.entries(serverErrors[stepKey])) {
        // Server errors replace local errors for the same field
        merged[stepKey][field] = [...errors];
      }
    }

    return merged;
  }

  /**
   * Clears errors for a specific step.
   */
  clearStepErrors(errors: WizardFieldErrors, stepKey: WizardStepKey): WizardFieldErrors {
    return {
      ...errors,
      [stepKey]: {}
    };
  }

  /**
   * Clears errors for a specific field.
   */
  clearFieldError(
    errors: WizardFieldErrors,
    stepKey: WizardStepKey,
    field: string
  ): WizardFieldErrors {
    const stepErrors = { ...errors[stepKey] };
    delete stepErrors[field];

    return {
      ...errors,
      [stepKey]: stepErrors
    };
  }

  /**
   * Converts an HTTP error response to a ValidationErrorResponse.
   */
  parseHttpError(error: unknown): ValidationErrorResponse | null {
    if (!error || typeof error !== 'object') {
      return null;
    }

    // Check if it's already a ValidationErrorResponse
    if (isValidationErrorResponse(error)) {
      return error;
    }

    // Try to extract from HttpErrorResponse
    const httpError = error as { error?: unknown; status?: number; message?: string };
    
    if (httpError.error && isValidationErrorResponse(httpError.error)) {
      return httpError.error;
    }

    // Create a generic error response
    return {
      success: false,
      code: 'HTTP_ERROR',
      message: httpError.message || $localize`:@@shared.validation-error-mapping.ts.une.erreur.est.survenue.0419f56e:Une erreur est survenue`,
      fieldErrors: {},
      globalErrors: [httpError.message || 'Une erreur est survenue'],
      canProceed: false,
      errorCount: 1,
      warningCount: 0
    };
  }

  /**
   * Creates a summary of all errors for display.
   */
  createErrorSummary(errors: WizardFieldErrors): ErrorSummary {
    const { errors: errorCount, warnings: warningCount } = this.countAllErrors(errors);
    
    const errorsByStep: Record<WizardStepKey, number> = {
      metadata: 0,
      seller: 0,
      client: 0,
      lines: 0,
      legal: 0,
      preview: 0
    };

    for (const stepKey of Object.keys(errors) as WizardStepKey[]) {
      const counts = countBySeverity(errors[stepKey]);
      errorsByStep[stepKey] = counts.errors;
    }

    const firstErrorStep = this.getFirstErrorStep(errors);

    return {
      totalErrors: errorCount,
      totalWarnings: warningCount,
      errorsByStep,
      firstErrorStep,
      hasBlockingErrors: errorCount > 0
    };
  }

  /**
   * Counts all errors across all steps.
   */
  private countAllErrors(errors: WizardFieldErrors): { errors: number; warnings: number } {
    let totalErrors = 0;
    let totalWarnings = 0;

    for (const stepKey of Object.keys(errors) as WizardStepKey[]) {
      const counts = countBySeverity(errors[stepKey]);
      totalErrors += counts.errors;
      totalWarnings += counts.warnings;
    }

    return { errors: totalErrors, warnings: totalWarnings };
  }
}

/**
 * Error summary for display purposes.
 */
export interface ErrorSummary {
  totalErrors: number;
  totalWarnings: number;
  errorsByStep: Record<WizardStepKey, number>;
  firstErrorStep: number;
  hasBlockingErrors: boolean;
}
