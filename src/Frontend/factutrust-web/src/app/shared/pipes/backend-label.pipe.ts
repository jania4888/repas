import { Pipe, PipeTransform } from '@angular/core';
import { BACKEND_DISPLAY_LABELS } from '@core/i18n/backend-display-labels.generated';

@Pipe({ name: 'backendLabel', standalone: true })
export class BackendLabelPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) {
      return '';
    }
    const lang = typeof document !== 'undefined' ? document.documentElement.getAttribute('lang') ?? 'fr' : 'fr';
    if (lang.startsWith('fr')) {
      return value;
    }
    return BACKEND_DISPLAY_LABELS[value] ?? value;
  }
}
