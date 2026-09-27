/// <reference types="@angular/localize" />
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { ToastService } from '@core/services/toast.service';
import { AccountingService } from '../services/accounting.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-account-replacement',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, ButtonComponent, AccountingStatusBannerComponent],
  template: `
    <app-page-header title="Remplacement de compte" i18n-title="@@accounting.account-replacement.remplacement.de.compte.2fb8886e" subtitle="Remplacer un compte par un autre sur les écritures des périodes ouvertes" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    <div class="card ar-card">
      <div class="ar-warn" role="note">
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        <span><ng-container i18n="@@accounting.account-replacement.operation.de.maintenance.seules.les.ecritures.de.2fc19dc1">Opération de maintenance. Seules les écritures des </ng-container> <strong i18n="@@accounting.account-replacement.periodes.ouvertes.83adb1a3">périodes ouvertes</strong> sont modifiées ; l'action est journalisée.</span>
      </div>

      <div class="ar-grid">
        <div class="ar-field">
          <label class="ar-lbl" for="ar-old" i18n="@@accounting.account-replacement.ancien.compte.b188eb3d">Ancien compte</label>
          <input id="ar-old" class="ar-inp" [(ngModel)]="oldAccount" (ngModelChange)="onOldChange()" placeholder="Ex. 41100001" i18n-placeholder="@@accounting.account-replacement.ex.41100001.d4119d77" [disabled]="replacing()" />
        </div>
        <div class="ar-arrow"><i class="pi pi-arrow-right" aria-hidden="true"></i></div>
        <div class="ar-field">
          <label class="ar-lbl" for="ar-new" i18n="@@accounting.account-replacement.nouveau.compte.9c08a4c7">Nouveau compte</label>
          <input id="ar-new" class="ar-inp" [(ngModel)]="newAccount" placeholder="Ex. 41100002" i18n-placeholder="@@accounting.account-replacement.ex.41100002.96d21ae5" [disabled]="replacing()" />
        </div>
      </div>

      <div class="ar-actions">
        <app-button variant="secondary" icon="pi pi-eye" type="button" (click)="preview()" [disabled]="!oldAccount.trim() || replacing()" i18n="@@accounting.account-replacement.apercu.f0f53004">Aperçu</app-button>
        <app-button variant="primary" icon="pi pi-check" type="button" (click)="replace()"
          [disabled]="!canReplace() || replacing()">
          {{ replacing() ? loc_ui_tern_remplacement_d3e8d9 : loc_ui_tern_remplacer_db2c67 }}
        </app-button>
      </div>

      @if (previewCount() !== null) {
        <p class="ar-preview">
          <strong>{{ previewCount() }}</strong> ligne(s) d'écriture porteraient l'ancien compte
          <code>{{ previewedAccount() }}</code> dans les périodes ouvertes.
        </p>
      }
    </div>
  `,
  styles: `
    .ar-card { padding: var(--spacing-5); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); max-width: 44rem; }
    .ar-warn { display: flex; align-items: center; gap: var(--spacing-2); margin-bottom: var(--spacing-4); padding: var(--spacing-3) var(--spacing-4); border-radius: var(--radius-md); background: var(--color-warning-50, #fffbeb); border: 1px solid var(--color-warning-200, #fde68a); color: var(--color-warning-700, #b45309); font-size: var(--font-size-sm); }
    .ar-grid { display: flex; align-items: flex-end; gap: var(--spacing-3); flex-wrap: wrap; }
    .ar-field { display: flex; flex-direction: column; gap: var(--spacing-1); flex: 1 1 12rem; }
    .ar-lbl { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .ar-inp { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; font-family: ui-monospace, monospace; }
    .ar-arrow { padding-bottom: var(--spacing-3); color: var(--color-text-tertiary); }
    .ar-actions { display: flex; gap: var(--spacing-3); margin-top: var(--spacing-4); }
    .ar-preview { margin: var(--spacing-4) 0 0; font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .ar-preview code { font-family: ui-monospace, monospace; background: var(--color-background-subtle); padding: 0 0.25rem; border-radius: 4px; }
  `
})
export class AccountReplacementComponent {
  readonly loc_ui_tern_remplacement_d3e8d9 = $localize`:@@ui.tern.remplacement.d3e8d9:Remplacement…`;
  readonly loc_ui_tern_remplacer_db2c67 = $localize`:@@ui.tern.remplacer.db2c67:Remplacer`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly toast = inject(ToastService);

  oldAccount = '';
  newAccount = '';
  readonly replacing = signal(false);
  readonly error = signal<string | null>(null);
  readonly previewCount = signal<number | null>(null);
  readonly previewedAccount = signal('');

  onOldChange(): void {
    this.previewCount.set(null);
  }

  canReplace(): boolean {
    const o = this.oldAccount.trim();
    const n = this.newAccount.trim();
    return o.length >= 2 && n.length >= 2 && o !== n;
  }

  preview(): void {
    const acc = this.oldAccount.trim();
    if (!acc) return;
    this.error.set(null);
    this.api.previewAccountReplacement(acc).subscribe({
      next: res => {
        if (res.success && res.data !== undefined && res.data !== null) {
          this.previewedAccount.set(acc);
          this.previewCount.set(res.data);
        } else this.error.set(res.error ?? $localize`:@@ui.tern.erreur.ab546c:Erreur`);
      },
      error: err => this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau'))
    });
  }

  replace(): void {
    if (!this.canReplace() || this.replacing()) return;
    const o = this.oldAccount.trim();
    const n = this.newAccount.trim();
    this.replacing.set(true);
    this.error.set(null);
    this.api.replaceAccount(o, n).subscribe({
      next: res => {
        this.replacing.set(false);
        if (res.success) {
          this.toast.add({ severity: 'success', summary: $localize`:@@account-replacement.component.summary.Compte rempl:Compte remplacé`, detail: `${res.data} ligne(s) — ${o} → ${n}`, life: 5000 });
          this.previewCount.set(null);
          this.oldAccount = '';
          this.newAccount = '';
        } else this.error.set(res.error ?? $localize`:@@ui.tern.le.remplacement.a.echoue.cdb82e:Le remplacement a échoué.`);
      },
      error: err => { this.replacing.set(false); this.error.set(this.errors.extractErrorMessage(err, 'Erreur réseau')); }
    });
  }
}
