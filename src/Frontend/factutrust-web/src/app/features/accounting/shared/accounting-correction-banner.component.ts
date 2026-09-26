import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-accounting-correction-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (returnUrl) {
      <div class="acct-correction-banner" role="note">
        <i class="pi pi-compass" aria-hidden="true"></i>
        <span i18n="@@accounting.shared.correction.guidee.depuis.le.controle.d.integrite.6cdda52d">Correction guidée depuis le contrôle d'intégrité.</span>
        <button type="button" class="acct-correction-banner__btn" (click)="goBack()" i18n="@@accounting.shared.retour.au.controle.d839261e">Retour au contrôle</button>
      </div>
    }
  `,
  styles: `
    .acct-correction-banner {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      flex-wrap: wrap;
      padding: var(--spacing-3) var(--spacing-4);
      margin-bottom: var(--spacing-4);
      border-radius: var(--radius-md);
      background: var(--color-info-50, #eff6ff);
      border: 1px solid var(--color-info-200, #bfdbfe);
      color: var(--color-info-900, #1e3a8a);
      font-size: var(--font-size-sm);
    }
    .acct-correction-banner__btn {
      margin-left: auto;
      padding: 0.35rem 0.75rem;
      border-radius: var(--radius-md);
      border: 1px solid var(--color-info-300, #93c5fd);
      background: var(--color-background-elevated, #fff);
      color: var(--color-info-800, #1e40af);
      cursor: pointer;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
    }
    .acct-correction-banner__btn:hover {
      background: var(--color-info-100, #dbeafe);
    }
  `
})
export class AccountingCorrectionBannerComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');

  goBack(): void {
    if (this.returnUrl) void this.router.navigateByUrl(this.returnUrl);
  }
}
