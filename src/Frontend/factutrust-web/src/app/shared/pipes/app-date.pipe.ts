import { Pipe, PipeTransform, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ErpLocaleService } from '@core/i18n/erp-locale.service';

/** Dates textuelles localisées (FR/AR) ; les montants restent en fr-TN via LOCALE_ID. */
@Pipe({ name: 'appDate', standalone: true })
export class AppDatePipe implements PipeTransform {
  private readonly locale = inject(ErpLocaleService);

  transform(value: Date | string | number | null | undefined, format = 'mediumDate'): string | null {
    if (value == null || value === '') {
      return null;
    }
    const tag = this.locale.langTag();
    return new DatePipe(tag).transform(value, format);
  }
}
