import { Injectable } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { CORE_VALIDATION } from '@core/i18n/core-localize';

@Injectable({ providedIn: 'root' })
export class ErrorMessageService {
  private errorMessages(): Record<string, string> {
    const v = CORE_VALIDATION;
    return {
      required: v.required,
      email: v.email,
      minlength: v.minlength,
      maxlength: v.maxlength,
      pattern: v.pattern,
      min: v.min,
      max: v.max,
      passwordMismatch: v.passwordMismatch
    };
  }

  getErrorMessage(control: AbstractControl | null): string {
    if (!control || !control.errors) return '';

    const firstError = Object.keys(control.errors)[0];
    const error = control.errors[firstError];

    if (firstError === 'server') {
      if (typeof error === 'string' && error.trim()) {
        return error;
      }
      if (error && typeof error === 'object' && typeof error.message === 'string' && error.message.trim()) {
        return error.message;
      }
    }

    let message = this.errorMessages()[firstError] || CORE_VALIDATION.generic;

    if (firstError === 'minlength' && error.requiredLength) {
      message = message.replace('{minLength}', error.requiredLength.toString());
    }

    if (firstError === 'maxlength' && error.requiredLength) {
      message = message.replace('{maxLength}', error.requiredLength.toString());
    }

    if (firstError === 'min' && error.min !== undefined) {
      message = message.replace('{min}', error.min.toString());
    }

    if (firstError === 'max' && error.max !== undefined) {
      message = message.replace('{max}', error.max.toString());
    }

    return message;
  }

  getFieldSuggestion(fieldName: string, errorType: string): string {
    const suggestions: Record<string, Record<string, string>> = {
      email: {
        email: $localize`:@@core.validation.suggestion.email:Exemple : contact@entreprise.tn`
      }
    };
    return suggestions[fieldName]?.[errorType] ?? '';
  }
}
