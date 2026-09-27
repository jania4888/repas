/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AccountingStatusBannerComponent } from '../shared/accounting-status-banner.component';
import { ToastService } from '@core/services/toast.service';
import {
  AccountingService,
  ChartOfAccountDto,
  InventoryEntryKindDto,
  CreateInventoryEntryRequest
} from '../services/accounting.service';
import { todayLocalYmd } from '../shared/accounting-date-utils';
import { ErrorHandlerService } from '@core/services/error-handler.service';

/**
 * Assistant d'écritures d'inventaire : sélection d'un type de régularisation (CCA/PCA, charges
 * à payer, produits à recevoir, provisions, variation de stocks), comptes pré-remplis, montant,
 * et génération de l'écriture + son extourne automatique au nouvel exercice le cas échéant.
 */
@Component({
  selector: 'app-inventory-assistant',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, ButtonComponent, AccountingStatusBannerComponent],
  template: `
    <app-page-header title="Assistant d'écritures d'inventaire" i18n-title="@@accounting.inventory-assistant.assistant.d.ecritures.d.inventaire.fb2e8311" subtitle="Régularisations de fin d'exercice (CCA/PCA, provisions…)" i18n-subtitle="@@accounting.inventory-assistant.regularisations.de.fin.d.exercice.cca.pc.7f604940" />

    <app-accounting-status-banner variant="error" [message]="error() ?? ''" />

    <div class="card inv-kinds-card">
      <h3 class="inv-section-title" i18n="@@accounting.inventory-assistant.type.de.regularisation.6318cebc">Type de régularisation</h3>
      <div class="inv-kinds">
        @for (k of kinds(); track k.kind) {
          <button
            type="button"
            class="inv-kind"
            [class.inv-kind--on]="selectedKind()?.kind === k.kind"
            (click)="selectKind(k)">
            <span class="inv-kind-label">{{ k.label }}</span>
            <span class="inv-kind-accounts">{{ k.defaultDebitAccount }} → {{ k.defaultCreditAccount }}</span>
            @if (k.autoReverse) { <span class="inv-kind-tag" i18n="@@accounting.inventory-assistant.extournee.97c4dbc5">extournée</span> }
          </button>
        }
      </div>
    </div>

    @if (selectedKind(); as k) {
      <div class="card inv-form-card">
        <p class="inv-hint">{{ k.hint }}</p>
        <div class="inv-fields">
          <div class="inv-field">
            <label class="field-label" for="inv-date" i18n="@@accounting.inventory-assistant.date.de.l.ecriture.509ff82c">Date de l'écriture</label>
            <input id="inv-date" type="date" class="inv-input" [(ngModel)]="form.entryDate" />
          </div>
          <div class="inv-field">
            <label class="field-label" for="inv-debit" i18n="@@accounting.inventory-assistant.compte.debit.dadbd7e8">Compte débit</label>
            <input id="inv-debit" class="inv-input" [(ngModel)]="form.debitAccount" list="inv-accounts" placeholder="Compte à débiter" i18n-placeholder="@@accounting.inventory-assistant.compte.a.debiter.9115cf60" />
          </div>
          <div class="inv-field">
            <label class="field-label" for="inv-credit" i18n="@@accounting.inventory-assistant.compte.credit.3aec4855">Compte crédit</label>
            <input id="inv-credit" class="inv-input" [(ngModel)]="form.creditAccount" list="inv-accounts" placeholder="Compte à créditer" i18n-placeholder="@@accounting.inventory-assistant.compte.a.crediter.c614b491" />
          </div>
          <div class="inv-field">
            <label class="field-label" for="inv-amount" i18n="@@accounting.inventory-assistant.montant.4adcd9fc">Montant</label>
            <input id="inv-amount" type="number" min="0" step="0.001" class="inv-input" [(ngModel)]="form.amount" />
          </div>
          <div class="inv-field inv-field-grow">
            <label class="field-label" for="inv-label" i18n="@@accounting.inventory-assistant.libelle.f5485bba">Libellé</label>
            <input id="inv-label" class="inv-input" [(ngModel)]="form.label" [placeholder]="k.label" />
          </div>
        </div>
        <datalist id="inv-accounts">
          @for (a of accounts(); track a.accountNumber) {
            <option [value]="a.accountNumber">{{ a.accountNumber }} — {{ a.label }}</option>
          }
        </datalist>

        <label class="inv-reverse-toggle" for="inv-reverse">
          <input id="inv-reverse" type="checkbox" [(ngModel)]="form.autoReverse" />
          <span i18n="@@accounting.inventory-assistant.extourner.automatiquement.au.1er.de.la.periode.s.c76a75e9">Extourner automatiquement au 1er de la période suivante</span>
        </label>

        @if (previewValid()) {
          <div class="inv-preview" role="note">
            <h4 class="inv-preview-title" i18n="@@accounting.inventory-assistant.apercu.f0f53004">Aperçu</h4>
            <p class="inv-preview-line" i18n="@@accounting.inventory-assistant.ecriture.debit.credit.f2e4efb9">
              <strong>Écriture</strong> ({{ form.entryDate }}) :
              débit {{ form.debitAccount }} / crédit {{ form.creditAccount }} — {{ form.amount | number : '1.3-3' }}
            </p>
            @if (form.autoReverse) {
              <p class="inv-preview-line inv-preview-reversal" i18n="@@accounting.inventory-assistant.extourne.au.nouvel.exercice.debit.credit.3a30111c">
                <strong>Extourne</strong> (au nouvel exercice) :
                débit {{ form.creditAccount }} / crédit {{ form.debitAccount }} — {{ form.amount | number : '1.3-3' }}
              </p>
            }
          </div>
        }

        <div class="inv-actions">
          <app-button variant="secondary" type="button" (click)="reset()" [disabled]="saving()" i18n="@@accounting.inventory-assistant.reinitialiser.e0e2ad54">Réinitialiser</app-button>
          <app-button variant="primary" icon="pi pi-check" type="button" (click)="submit()" [disabled]="saving() || !previewValid()">
            {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : 'Enregistrer l\\'écriture' }}
          </app-button>
        </div>
      </div>
    }
  `,
  styles: `
    .inv-kinds-card, .inv-form-card { padding: var(--spacing-4); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: var(--spacing-4); }
    .inv-section-title { margin: 0 0 var(--spacing-3); font-size: var(--font-size-md); font-weight: var(--font-weight-semibold); }
    .inv-kinds { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: var(--spacing-3); }
    .inv-kind {
      display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
      padding: var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md);
      background: var(--color-background-elevated); cursor: pointer; text-align: left;
    }
    .inv-kind--on { border-color: var(--color-primary-500, #2563eb); background: var(--color-primary-50, #eff6ff); }
    .inv-kind-label { font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .inv-kind-accounts { font-size: var(--font-size-xs); color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; }
    .inv-kind-tag { font-size: var(--font-size-xs); color: var(--color-warning-700, #a16207); background: var(--color-warning-100, #fef3c7); border-radius: var(--radius-pill, 999px); padding: 0 0.4rem; margin-top: 2px; }
    .inv-hint { margin: 0 0 var(--spacing-3); font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .inv-fields { display: flex; flex-wrap: wrap; gap: var(--spacing-3); }
    .inv-field { display: flex; flex-direction: column; gap: var(--spacing-1); flex: 1 1 9rem; min-width: 8rem; }
    .inv-field-grow { flex: 2 1 16rem; }
    .field-label { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .inv-input { padding: var(--spacing-2) var(--spacing-3); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); background: var(--color-background-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); width: 100%; }
    .inv-reverse-toggle { display: inline-flex; align-items: center; gap: var(--spacing-2); margin-top: var(--spacing-3); font-size: var(--font-size-sm); color: var(--color-text-secondary); cursor: pointer; }
    .inv-preview { margin-top: var(--spacing-3); padding: var(--spacing-3); background: var(--color-background-subtle); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-md); }
    .inv-preview-title { margin: 0 0 var(--spacing-2); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
    .inv-preview-line { margin: 0 0 4px; font-size: var(--font-size-sm); font-variant-numeric: tabular-nums; }
    .inv-preview-reversal { color: var(--color-text-secondary); }
    .inv-actions { display: flex; justify-content: flex-end; gap: var(--spacing-3); margin-top: var(--spacing-4); padding-top: var(--spacing-3); border-top: 1px solid var(--color-border-subtle); }
  `
})
export class InventoryAssistantComponent implements OnInit {
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  private readonly errors = inject(ErrorHandlerService);
  private readonly api = inject(AccountingService);
  private readonly toast = inject(ToastService);

  readonly kinds = signal<InventoryEntryKindDto[]>([]);
  readonly accounts = signal<ChartOfAccountDto[]>([]);
  readonly selectedKind = signal<InventoryEntryKindDto | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  form: CreateInventoryEntryRequest = this.emptyForm();

  readonly previewValid = computed(() => {
    const f = this.form;
    return !!f.entryDate && !!f.debitAccount.trim() && !!f.creditAccount.trim()
      && f.debitAccount.trim() !== f.creditAccount.trim() && Number(f.amount) > 0;
  });

  private emptyForm(): CreateInventoryEntryRequest {
    return { kind: 0, entryDate: todayLocalYmd(), debitAccount: '', creditAccount: '', amount: 0, label: '', autoReverse: true };
  }

  ngOnInit(): void {
    this.api.getInventoryKinds().subscribe({
      next: res => { if (res.success && res.data) this.kinds.set(res.data); },
      error: err => this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.inventory-assistant.ts.erreur.de.chargement.des.types.4e51a839:Erreur de chargement des types.`))
    });
    this.api.getChartOfAccounts().subscribe({
      next: res => { if (res.success && res.data) this.accounts.set(res.data.filter(a => a.isActive)); }
    });
  }

  selectKind(k: InventoryEntryKindDto): void {
    this.selectedKind.set(k);
    this.form = {
      ...this.emptyForm(),
      kind: k.kind,
      debitAccount: k.defaultDebitAccount,
      creditAccount: k.defaultCreditAccount,
      label: k.label,
      autoReverse: k.autoReverse
    };
  }

  reset(): void {
    const k = this.selectedKind();
    if (k) this.selectKind(k);
  }

  submit(): void {
    if (!this.previewValid() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.api.createInventoryEntry({ ...this.form, debitAccount: this.form.debitAccount.trim(), creditAccount: this.form.creditAccount.trim() }).subscribe({
      next: res => {
        this.saving.set(false);
        if (res.success) {
          this.toast.add({
            severity: 'success',
            summary: $localize`:@@inventory-assistant.component.summary._criture_enregis:Écriture enregistrée`,
            detail: this.form.autoReverse ? $localize`:@@ui.tern.l.ecriture.d.inventaire.et.son.extourne.on.cd0fca:L'écriture d'inventaire et son extourne ont été créées.` : $localize`:@@ui.tern.l.ecriture.d.inventaire.a.ete.creee.83df0b:L'écriture d'inventaire a été créée.`,
            life: 5000
          });
          this.reset();
        } else {
          this.error.set(res.error ?? $localize`:@@ui.tern.erreur.lors.de.l.enregistrement.e952ae:Erreur lors de l'enregistrement.`);
        }
      },
      error: err => {
        this.saving.set(false);
        this.error.set(this.errors.extractErrorMessage(err, $localize`:@@accounting.inventory-assistant.ts.erreur.reseau.a65da40b:Erreur réseau.`));
      }
    });
  }
}
