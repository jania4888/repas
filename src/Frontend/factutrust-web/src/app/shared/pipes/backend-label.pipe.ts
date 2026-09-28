import { Pipe, PipeTransform } from '@angular/core';
import { BACKEND_DISPLAY_LABELS } from '@core/i18n/backend-display-labels.generated';

/**
 * Libellé d'affichage envoyé par l'API (texte français) → libellé de la langue d'interface.
 * En français, la valeur est renvoyée telle quelle. Une valeur absente est renvoyée telle quelle :
 * `backendDisplayLabel(x) ?? '—'` doit se comporter comme `x ?? '—'`.
 */
export function backendDisplayLabel(value: string): string;
export function backendDisplayLabel(value: string | null | undefined): string | null | undefined;
export function backendDisplayLabel(value: string | null | undefined): string | null | undefined {
  if (!value) {
    return value;
  }
  const lang = typeof document !== 'undefined' ? document.documentElement.getAttribute('lang') ?? 'fr' : 'fr';
  if (lang.startsWith('fr')) {
    return value;
  }
  return BACKEND_DISPLAY_LABELS[value] ?? value;
}

@Pipe({ name: 'backendLabel', standalone: true })
export class BackendLabelPipe implements PipeTransform {
  transform(value: string): string;
  transform(value: string | null | undefined): string | null | undefined;
  transform(value: string | null | undefined): string | null | undefined {
    return backendDisplayLabel(value);
  }
}
