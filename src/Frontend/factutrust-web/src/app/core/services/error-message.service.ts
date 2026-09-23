import { Injectable } from '@angular/core';
import { AbstractControl } from '@angular/forms';

@Injectable({ providedIn: 'root' })
export class ErrorMessageService {
  private errorMessages: Record<string, string> = {
    'required': 'Ce champ est obligatoire',
    'email': 'Veuillez saisir une adresse email valide',
    'minlength': 'Ce champ doit contenir au moins {minLength} caractères',
    'maxlength': 'Ce champ ne doit pas dépasser {maxLength} caractères',
    'pattern': 'Le format saisi est incorrect',
    'min': 'La valeur minimale est {min}',
    'max': 'La valeur maximale est {max}',
    'passwordMismatch': 'Les mots de passe ne correspondent pas'
  };

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
    
    let message = this.errorMessages[firstError] || 'Ce champ contient une erreur';
    
    // Remplacer les placeholders
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
      'email': {
        'email': 'Exemple : votre@email.com'
      },
      'nif': {
        'pattern': 'Format attendu : 1772793W/A/M/000',
        'required': 'Format attendu : 1772793W/A/M/000'
      },
      'phone': {
        'pattern': 'Format attendu : XX XXX XXX (8 chiffres)',
        'required': 'Format attendu : XX XXX XXX (8 chiffres)'
      },
      'password': {
        'minlength': 'Le mot de passe doit contenir au moins 12 caractères avec majuscule, minuscule, chiffre et caractère spécial',
        'pattern': 'Le mot de passe doit contenir au moins 12 caractères avec majuscule, minuscule, chiffre et caractère spécial'
      }
    };
    
    return suggestions[fieldName]?.[errorType] || '';
  }
}
