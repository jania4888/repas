import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ErpLocaleService } from '@core/i18n/erp-locale.service';
import { ErpPreferencesService } from '@core/services/erp-preferences.service';
import type { ErpLocale } from '@core/i18n/erp-locale.types';

@Component({
  selector: 'app-erp-language-switcher',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (localeService.shouldShowLanguageSwitcher()) {
      <div class="erp-lang-switcher" role="group" [attr.aria-label]="languageLabel">
        <button
          type="button"
          class="erp-lang-switcher__btn"
          [class.active]="localeService.effectiveLocale() === 'fr'"
          (click)="switch('fr')">
          {{ frLabel }}
        </button>
        <button
          type="button"
          class="erp-lang-switcher__btn"
          [class.active]="localeService.effectiveLocale() === 'ar'"
          (click)="switch('ar')">
          {{ arLabel }}
        </button>
      </div>
    }
  `,
  styles: `
    .erp-lang-switcher {
      display: inline-flex;
      gap: 0.25rem;
      align-items: center;
    }
    .erp-lang-switcher__btn {
      border: 1px solid rgba(0, 0, 0, 0.12);
      background: #fff;
      border-radius: 4px;
      padding: 0.15rem 0.5rem;
      font-size: 0.8125rem;
      cursor: pointer;
    }
    .erp-lang-switcher__btn.active {
      background: #0d6efd;
      color: #fff;
      border-color: #0d6efd;
    }
  `
})
export class ErpLanguageSwitcherComponent {
  readonly localeService = inject(ErpLocaleService);
  private readonly prefs = inject(ErpPreferencesService);

  readonly languageLabel = $localize`:@@core.language.label:Langue`;
  readonly frLabel = $localize`:@@core.language.fr:Français`;
  readonly arLabel = $localize`:@@core.language.ar:العربية`;

  switch(locale: ErpLocale): void {
    if (locale === this.localeService.effectiveLocale()) {
      return;
    }
    void this.prefs.setLanguage(locale).finally(() => {
      void this.localeService.setLocaleAndReload(locale);
    });
  }
}
