/// <reference types="@angular/localize" />
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, EventEmitter, HostListener, Input, Output, OnChanges, OnInit, SimpleChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ToastService } from '@core/services/toast.service';
import { formatLocalDate } from '@core/utils/date.util';
import {
  CashDeskService,
  CashOperationType,
  CashRevenueCategory,
  CreateCashOperationPayload,
  CashOperationListItem,
  CASH_EXPENSE_CATEGORY_GROUPS,
  CASH_REVENUE_CATEGORY_GROUPS,
  VAT_RATE_OPTIONS
} from '@core/services/cash-desk.service';

const PAYMENT_METHOD_OPTIONS: { label: string; value: number; icon?: string }[] = [
  { label: $localize`:@@pay.cash:Espèces`, value: 0, icon: 'pi pi-money-bill' },
  { label: $localize`:@@pay.transfer:Virement bancaire`, value: 1, icon: 'pi pi-building' },
  { label: $localize`:@@pay.check:Chèque`, value: 2, icon: 'pi pi-file' },
  { label: $localize`:@@pay.card:Carte bancaire`, value: 3, icon: 'pi pi-credit-card' },
  { label: $localize`:@@pay.mobile:Paiement mobile`, value: 4, icon: 'pi pi-mobile' },
  { label: $localize`:@@pay.other:Autre`, value: 99, icon: 'pi pi-question' }
];

/** Arrondi comptable à 3 décimales (millimes), aligné sur l'arrondi backend (MidpointRounding.AwayFromZero). */
function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** Réplique en TS la formule backend (`CashOperationVatCalculator.SplitTtc`) : HT calculé, TVA en reste. */
function splitTtcVat(ttcAmount: number, ratePercent: number): { ht: number; vat: number } {
  const ht = round3(ttcAmount / (1 + ratePercent / 100));
  const vat = round3(ttcAmount - ht);
  return { ht, vat };
}

@Component({
  selector: 'app-add-cash-operation-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    InputNumberModule,
    DatePickerModule,
    SelectModule,
    InputTextModule,
    Textarea,
    ButtonComponent
  ],
  template: `
    <p-dialog
      header="Enregistrer l'opération" i18n-header="@@payments.cash-desk.enregistrer.l.operation.f94a3886"
      [(visible)]="visible"
      [modal]="true"
      [position]="dialogPosition"
      [style]="{ width: '580px' }"
      styleClass="cash-desk-right-dialog"
      [draggable]="false"
      [closable]="true"
      (onHide)="onHide()"
      [contentStyle]="{ overflow: 'auto', padding: 0 }">

      <div class="dialog-content">
        @if (errorMessage()) {
          <div class="error-message" role="alert">
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            <span>{{ errorMessage() }}</span>
          </div>
        }

        <!-- Operation Type Toggle -->
        <div class="form-group">
          <label><ng-container i18n="@@payments.cash-desk.type.d.operation.265961ab">Type d'opération </ng-container> <span class="required" i18n="@@payments.cash-desk.text.df58248c">*</span></label>
          <div class="type-toggle" role="radiogroup" aria-label="Type d'opération" i18n-aria-label="@@payments.cash-desk.type.d.operation.265961ab">
            <div
              class="type-card"
              [class.selected]="operationType === CashOperationType.Debit"
              (click)="onTypeChange(CashOperationType.Debit)"
              (keydown.enter)="onTypeChange(CashOperationType.Debit)"
              (keydown.space)="onTypeChange(CashOperationType.Debit); $event.preventDefault()"
              tabindex="0"
              role="radio"
              [attr.aria-checked]="operationType === CashOperationType.Debit">
              <span class="type-label" i18n="@@payments.cash-desk.decaissement.de3611ca">Décaissement</span>
            </div>
            <div
              class="type-card type-card-credit"
              [class.selected]="operationType === CashOperationType.Credit"
              (click)="onTypeChange(CashOperationType.Credit)"
              (keydown.enter)="onTypeChange(CashOperationType.Credit)"
              (keydown.space)="onTypeChange(CashOperationType.Credit); $event.preventDefault()"
              tabindex="0"
              role="radio"
              [attr.aria-checked]="operationType === CashOperationType.Credit">
              <span class="type-label" i18n="@@payments.cash-desk.encaissement.b71c7458">Encaissement</span>
            </div>
          </div>
        </div>

        <!-- Category (changes based on operation type) -->
        <div class="form-group">
          <label [for]="operationType === CashOperationType.Debit ? loc_ui_tern_expensecategory_d48904 : loc_ui_tern_revenuecategory_21cd74">
            {{ operationType === CashOperationType.Debit ? loc_ui_tern_categorie_de_depense_652cf2 : loc_ui_tern_categorie_de_revenu_ed807b }}
            <span class="required" i18n="@@payments.cash-desk.text.df58248c">*</span>
          </label>
          @if (operationType === CashOperationType.Debit) {
            <p-select
              inputId="expenseCategory"
              [options]="expenseCategoryGroups"
              [(ngModel)]="selectedExpenseCategory"
              [group]="true"
              optionLabel="label"
              optionGroupLabel="label"
              optionGroupChildren="items"
              optionValue="value"
              placeholder="Sélectionnez une catégorie" i18n-placeholder="@@payments.cash-desk.selectionnez.une.categorie.8fd04bf3"
              [filter]="true"
              filterBy="label"
              [showClear]="false"
              filterPlaceholder="Rechercher…" i18n-filterPlaceholder="@@payments.cash-desk.rechercher.ed75dcce"
              appendTo="body"
              styleClass="w-full category-dropdown">
              <ng-template let-item pTemplate="selectedItem">
                @if (item) {
                  <span [class]="item.icon + loc_ui_tern_category_option_icon_e996ce" aria-hidden="true"></span>
                  <span class="category-option-label">{{ item.label }}</span>
                }
              </ng-template>
              <ng-template let-item pTemplate="item">
                <span [class]="item.icon + loc_ui_tern_category_option_icon_e996ce" aria-hidden="true"></span>
                <span class="category-option-label">{{ item.label }}</span>
              </ng-template>
            </p-select>
          } @else {
            <p-select
              inputId="revenueCategory"
              [options]="revenueCategoryGroups"
              [(ngModel)]="selectedRevenueCategory"
              [group]="true"
              optionLabel="label"
              optionGroupLabel="label"
              optionGroupChildren="items"
              optionValue="value"
              placeholder="Sélectionnez une catégorie" i18n-placeholder="@@payments.cash-desk.selectionnez.une.categorie.8fd04bf3"
              [filter]="false"
              [showClear]="false"
              appendTo="body"
              styleClass="w-full category-dropdown">
              <ng-template let-item pTemplate="selectedItem">
                @if (item) {
                  <span [class]="item.icon + loc_ui_tern_category_option_icon_e996ce" aria-hidden="true"></span>
                  <span class="category-option-label">{{ item.label }}</span>
                }
              </ng-template>
              <ng-template let-item pTemplate="item">
                <span [class]="item.icon + loc_ui_tern_category_option_icon_e996ce" aria-hidden="true"></span>
                <span class="category-option-label">{{ item.label }}</span>
              </ng-template>
            </p-select>
          }
        </div>

        <!-- Payment Method -->
        <div class="form-group">
          <label for="method"><ng-container i18n="@@payments.cash-desk.methode.de.paiement.b111f83e">Méthode de paiement </ng-container> <span class="required" i18n="@@payments.cash-desk.text.df58248c">*</span></label>
          <div class="method-toggle" role="radiogroup" aria-label="Méthode de paiement" i18n-aria-label="@@payments.cash-desk.methode.de.paiement.b111f83e">
            @for (method of paymentMethodOptions; track method.value) {
              <div
                class="method-card"
                [class.selected]="selectedMethod === method.value"
                (click)="selectedMethod = method.value"
                (keydown.enter)="selectedMethod = method.value"
                (keydown.space)="selectedMethod = method.value; $event.preventDefault()"
                tabindex="0"
                role="radio"
                [attr.aria-checked]="selectedMethod === method.value"
                [attr.aria-label]="method.label">
                <i [class]="method.icon" aria-hidden="true"></i>
                <span class="method-label">{{ method.label }}</span>
              </div>
            }
          </div>
        </div>

        <!-- Amount + Date row -->
        <div class="form-row">
          <div class="form-group">
            <label for="amount"><ng-container i18n="@@payments.cash-desk.montant.4adcd9fc">Montant </ng-container> <span class="required" i18n="@@payments.cash-desk.text.df58248c">*</span></label>
            <div class="amount-input-wrap">
              <span class="amount-currency" i18n="@@payments.cash-desk.tnd.51da21a7">TND</span>
              <p-inputNumber
                id="amount"
                [(ngModel)]="amount"
                [min]="0.001"
                [maxFractionDigits]="3"
                [minFractionDigits]="3"
                mode="decimal"
                placeholder="0,000" i18n-placeholder="@@payments.cash-desk.0.000.6f5ad69d"
                styleClass="w-full">
              </p-inputNumber>
            </div>
          </div>

          <div class="form-group">
            <label for="operationDate"><ng-container i18n="@@payments.cash-desk.date.de.reglement.65e1210f">Date de règlement </ng-container> <span class="required" i18n="@@payments.cash-desk.text.df58248c">*</span></label>
            <p-datepicker
              id="operationDate"
              [(ngModel)]="operationDate"
              [showIcon]="true"
              dateFormat="dd/mm/yy"
              [maxDate]="maxDate"
              placeholder="Sélectionnez la date" i18n-placeholder="@@payments.cash-desk.selectionnez.la.date.b9d5a16a"
              appendTo="body"
              styleClass="w-full">
            </p-datepicker>
          </div>
        </div>

        <!-- VAT rate (cash sales receipts only, behind feature flag) -->
        @if (vatSelectorVisible) {
          <div class="form-group">
            <label for="vatRate" i18n="@@payments.cash-desk.taux.de.tva.e704ceaf">Taux de TVA</label>
            <p-select
              inputId="vatRate"
              [options]="vatRateOptions"
              [(ngModel)]="selectedVatRate"
              optionLabel="label"
              optionValue="value"
              placeholder="Sélectionnez un taux" i18n-placeholder="@@payments.cash-desk.selectionnez.un.taux.a9297d9e"
              [showClear]="false"
              appendTo="body"
              styleClass="w-full">
            </p-select>
            @if (vatPreview) {
              <div class="vat-preview" role="note" aria-label="Détail HT / TVA" i18n-aria-label="@@payments.cash-desk.detail.ht.tva.1f495c67">
                <span>HT : {{ vatPreview.ht | number:'1.3-3' }} TND</span>
                <span>TVA : {{ vatPreview.vat | number:'1.3-3' }} TND</span>
              </div>
            }
          </div>
        }

        <!-- Label -->
        <div class="form-group">
          <label for="label"><ng-container i18n="@@payments.cash-desk.libelle.f5485bba">Libellé </ng-container> <span class="required" i18n="@@payments.cash-desk.text.df58248c">*</span></label>
          <input
            id="label"
            pInputText
            [(ngModel)]="label"
            placeholder="Ex: Achat fournitures" i18n-placeholder="@@payments.cash-desk.ex.achat.fournitures.78820e11"
            class="w-full"
            [maxLength]="500"
            aria-label="Libellé de l'opération" i18n-aria-label="@@payments.cash-desk.libelle.de.l.operation.3f2030d4" />
        </div>

        <!-- Reference -->
        <div class="form-group">
          <label for="reference"><ng-container i18n="@@payments.cash-desk.reference.f8130bb0">Référence </ng-container> <span class="optional-tag" i18n="@@payments.cash-desk.optionnel.6f73b232">(optionnel)</span></label>
          <input
            id="reference"
            pInputText
            [(ngModel)]="reference"
            placeholder="Ex: N° chèque, virement n°…" i18n-placeholder="@@payments.cash-desk.ex.n.cheque.virement.n.73a36d88"
            class="w-full"
            [maxLength]="100"
            aria-label="Référence" i18n-aria-label="@@payments.cash-desk.reference.f8130bb0" />
        </div>

        <!-- Notes -->
        <div class="form-group">
          <label for="notes"><ng-container i18n="@@payments.cash-desk.note.2c924e30">Note </ng-container> <span class="optional-tag" i18n="@@payments.cash-desk.optionnel.6f73b232">(optionnel)</span></label>
          <textarea
            id="notes"
            pTextarea
            [(ngModel)]="notes"
            placeholder="Notes internes" i18n-placeholder="@@payments.cash-desk.notes.internes.1a81fb4e"
            [rows]="3"
            class="w-full"
            [maxLength]="500"
            aria-label="Notes" i18n-aria-label="@@payments.cash-desk.notes.70440046">
          </textarea>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <div class="dialog-footer">
          <app-button
            variant="outline"
            [disabled]="submitting()"
            (click)="onHide()"
            ariaLabel="Annuler" i18n-ariaLabel="@@payments.cash-desk.annuler.e063e8ff" i18n="@@payments.cash-desk.annuler.49ba3292"> Annuler </app-button>
          <app-button
            variant="primary"
            [disabled]="submitting()"
            icon="pi pi-check"
            iconPos="right"
            (click)="submit()"
            ariaLabel="Valider l'opération" i18n-ariaLabel="@@payments.cash-desk.valider.l.operation.b4f660f7">
            {{ submitting() ? loc_ui_tern_enregistrement_9bf105 : loc_ui_tern_valider_be4220 }}
          </app-button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .dialog-content {
      padding: var(--spacing-5) var(--spacing-6) var(--spacing-4);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-2);
      margin-bottom: var(--spacing-3);
    }

    .form-group:last-child {
      margin-bottom: 0;
    }

    .form-group label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
    }

    .required { color: var(--color-error-600); }

    .optional-tag {
      font-weight: var(--font-weight-normal);
      color: var(--color-text-tertiary);
      font-size: var(--font-size-xs);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-4);
    }

    .amount-input-wrap {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
    }

    .amount-currency {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-secondary);
      font-family: 'JetBrains Mono', monospace;
      flex-shrink: 0;
    }

    .vat-preview {
      display: flex;
      gap: var(--spacing-4);
      padding: var(--spacing-2) var(--spacing-3);
      background: var(--color-background-subtle);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
      font-family: 'JetBrains Mono', monospace;
      color: var(--color-text-secondary);
    }

    /* Type toggle */
    .type-toggle {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-3);
    }

    .type-card {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-2);
      padding: var(--spacing-3) var(--spacing-4);
      border: 2px solid var(--color-border-subtle);
      border-radius: var(--radius-lg);
      cursor: pointer;
      transition: all var(--transition-fast);
      background: var(--color-background-elevated);
      user-select: none;
    }

    .type-card:hover {
      border-color: var(--color-primary-300);
      background: var(--color-primary-50);
    }

    .type-card:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    .type-card.selected {
      border-color: var(--color-primary-500);
      background: var(--color-primary-50);
      box-shadow: 0 0 0 1px var(--color-primary-500);
    }

    .type-label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .type-card.selected .type-label {
      color: var(--color-primary-700);
    }

    /* Method toggle */
    .method-toggle {
      display: flex;
      flex-wrap: wrap;
      gap: var(--spacing-2);
    }

    .method-card {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      padding: var(--spacing-2) var(--spacing-3);
      border: 1.5px solid var(--color-border-subtle);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all var(--transition-fast);
      background: var(--color-background-elevated);
      font-size: var(--font-size-sm);
      user-select: none;
    }

    .method-card i {
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
    }

    .method-card:hover {
      border-color: var(--color-primary-300);
    }

    .method-card:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 2px;
    }

    .method-card.selected {
      border-color: var(--color-primary-500);
      background: var(--color-primary-50);
    }

    .method-card.selected i {
      color: var(--color-primary-600);
    }

    .method-card.selected .method-label {
      color: var(--color-primary-700);
      font-weight: var(--font-weight-medium);
    }

    .method-label {
      color: var(--color-text-secondary);
    }

    .error-message {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-2);
      margin-bottom: var(--spacing-3);
      padding: var(--spacing-3);
      background: var(--color-error-50);
      border: 1px solid var(--color-error-200);
      border-radius: var(--radius-md);
      color: var(--color-error-700);
      font-size: var(--font-size-sm);
    }

    .error-message i {
      flex-shrink: 0;
      margin-top: 0.1rem;
    }

    :host ::ng-deep .category-dropdown .p-select-label {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-2);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .category-option-icon {
      flex-shrink: 0;
      margin-top: 0.1rem;
      opacity: 0.85;
    }

    .category-option-label {
      min-width: 0;
      line-height: 1.35;
    }

    .w-full { width: 100%; }

    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-3);
    }

    @media (max-width: 640px) {
      .form-row {
        grid-template-columns: 1fr;
      }
      .dialog-content {
        padding: var(--spacing-4);
      }
    }

    :host ::ng-deep {
      .p-dialog {
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-xl);
      }
      .p-dialog-content {
        border-radius: 0;
        padding: 0;
      }
      .p-dialog-header {
        padding: var(--spacing-4) var(--spacing-6);
        border-bottom: 1px solid var(--color-border-subtle);
        background: var(--color-background-elevated);
      }
      .p-dialog-header .p-dialog-title {
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }
      .p-dialog-footer {
        padding: var(--spacing-4) var(--spacing-6);
        border-top: 1px solid var(--color-border-subtle);
        background: var(--color-background-subtle);
      }
      .p-datepicker,
      .p-select,
      .p-inputnumber {
        width: 100%;
      }
    }
  `]
})
export class AddCashOperationDialogComponent implements OnChanges, OnInit {
  readonly loc_ui_tern_expensecategory_d48904 = 'expenseCategory';
  readonly loc_ui_tern_revenuecategory_21cd74 = 'revenueCategory';
  readonly loc_ui_tern_categorie_de_depense_652cf2 = $localize`:@@ui.tern.categorie.de.depense.652cf2:Catégorie de dépense`;
  readonly loc_ui_tern_categorie_de_revenu_ed807b = $localize`:@@ui.tern.categorie.de.revenu.ed807b:Catégorie de revenu`;
  readonly loc_ui_tern_category_option_icon_e996ce = " category-option-icon";
  readonly loc_ui_tern_enregistrement_9bf105 = $localize`:@@ui.tern.enregistrement.9bf105:Enregistrement...`;
  readonly loc_ui_tern_valider_be4220 = $localize`:@@ui.tern.valider.be4220:Valider`;
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() operationCreated = new EventEmitter<CashOperationListItem>();

  private cashDeskService = inject(CashDeskService);
  private toastService = inject(ToastService);

  readonly CashOperationType = CashOperationType;
  readonly paymentMethodOptions = PAYMENT_METHOD_OPTIONS;
  readonly expenseCategoryGroups = CASH_EXPENSE_CATEGORY_GROUPS;
  readonly revenueCategoryGroups = CASH_REVENUE_CATEGORY_GROUPS;
  readonly vatRateOptions = VAT_RATE_OPTIONS;
  readonly maxDate = new Date();

  operationType: CashOperationType = CashOperationType.Credit;
  selectedExpenseCategory: number | null = null;
  selectedMethod: number | null = 0;
  amount = 0;
  operationDate: Date = new Date();
  label = '';
  reference = '';
  notes = '';
  /** Non renseignée par défaut — jamais de pré-sélection à 19 % (cf. plan §Tâche 6). */
  selectedVatRate: number | null = null;

  private _selectedRevenueCategory: number | null = null;
  get selectedRevenueCategory(): number | null {
    return this._selectedRevenueCategory;
  }
  set selectedRevenueCategory(value: number | null) {
    this._selectedRevenueCategory = value;
    this.selectedVatRate = null;
  }

  submitting = signal(false);
  errorMessage = signal('');
  vatEnabled = signal(false);
  dialogPosition: 'right' | 'center' = 'right';

  /** Sélecteur « Taux de TVA » : flag actif + Encaissement + ventes au comptant uniquement. */
  get vatSelectorVisible(): boolean {
    return (
      this.vatEnabled() &&
      this.operationType === CashOperationType.Credit &&
      this.selectedRevenueCategory === CashRevenueCategory.CashSalesReceipt
    );
  }

  /** Récapitulatif HT/TVA en lecture seule, affiché uniquement pour un taux renseigné > 0. */
  get vatPreview(): { ht: number; vat: number } | null {
    if (this.selectedVatRate === null || this.selectedVatRate === undefined || this.selectedVatRate <= 0) {
      return null;
    }
    return splitTtcVat(this.amount || 0, this.selectedVatRate);
  }

  ngOnInit(): void {
    this.updateDialogPosition();
    this.loadFeatureFlags();
  }

  private loadFeatureFlags(): void {
    this.cashDeskService.getFeatureFlags().subscribe({
      next: (res) => {
        this.vatEnabled.set(res.data?.vatEnabled === true);
      },
      error: () => {
        this.vatEnabled.set(false);
      }
    });
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateDialogPosition();
  }

  onHide(): void {
    this.visibleChange.emit(false);
    this.resetForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']?.currentValue) {
      this.resetForm();
    }
  }

  onTypeChange(type: CashOperationType): void {
    this.operationType = type;
    this.selectedVatRate = null;
    this.errorMessage.set('');
  }

  private updateDialogPosition(): void {
    if (typeof window === 'undefined') {
      this.dialogPosition = 'right';
      return;
    }
    this.dialogPosition = window.innerWidth <= 768 ? 'center' : 'right';
  }

  private resetForm(): void {
    this.operationType = CashOperationType.Credit;
    this.selectedExpenseCategory = null;
    this.selectedRevenueCategory = null;
    this.selectedMethod = 0;
    this.amount = 0;
    this.operationDate = new Date();
    this.label = '';
    this.reference = '';
    this.notes = '';
    this.selectedVatRate = null;
    this.errorMessage.set('');
    this.submitting.set(false);
  }

  private validate(): string | null {
    if (this.operationType === CashOperationType.Debit && this.selectedExpenseCategory === null)
      return $localize`:@@payments.add-cash-operation-dialog.ts.selectionnez.une.categorie.de.depense.b2412267:Sélectionnez une catégorie de dépense.`;

    if (this.operationType === CashOperationType.Credit && this.selectedRevenueCategory === null)
      return $localize`:@@payments.add-cash-operation-dialog.ts.categorie.de.revenu.est.obligatoire.13cf0733:Catégorie de revenu est obligatoire.`;

    if (this.selectedMethod === null)
      return $localize`:@@payments.add-cash-operation-dialog.ts.selectionnez.une.methode.de.paiement.9b6e1e03:Sélectionnez une méthode de paiement.`;

    if (this.amount <= 0)
      return $localize`:@@payments.add-cash-operation-dialog.ts.le.montant.doit.etre.strictement.positif.199d1b27:Le montant doit être strictement positif.`;

    if (!this.operationDate)
      return $localize`:@@payments.add-cash-operation-dialog.ts.la.date.de.reglement.est.obligatoire.61c0c3e7:La date de règlement est obligatoire.`;

    if (!this.label.trim())
      return $localize`:@@payments.add-cash-operation-dialog.ts.le.libelle.est.obligatoire.e312d2ca:Le libellé est obligatoire.`;

    if (this.label.trim().length > 500)
      return $localize`:@@payments.add-cash-operation-dialog.ts.le.libelle.ne.peut.pas.depasser.500.cara.c4d87466:Le libellé ne peut pas dépasser 500 caractères.`;

    if (this.reference?.trim() && this.reference.trim().length > 100)
      return $localize`:@@payments.add-cash-operation-dialog.ts.la.reference.ne.peut.pas.depasser.100.ca.36418b46:La référence ne peut pas dépasser 100 caractères.`;

    if (this.notes?.trim() && this.notes.trim().length > 500)
      return $localize`:@@payments.add-cash-operation-dialog.ts.les.notes.ne.peuvent.pas.depasser.500.ca.5cd748fb:Les notes ne peuvent pas dépasser 500 caractères.`;

    return null;
  }

  submit(): void {
    const validation = this.validate();
    if (validation) {
      this.errorMessage.set(validation);
      return;
    }

    if (this.submitting()) return;

    this.submitting.set(true);
    this.errorMessage.set('');

    const payload: CreateCashOperationPayload = {
      operationType: this.operationType,
      operationDate: formatLocalDate(this.operationDate),
      amount: this.amount,
      method: this.selectedMethod!,
      label: this.label.trim(),
      category: this.operationType === CashOperationType.Debit ? this.selectedExpenseCategory : null,
      revenueCategory: this.operationType === CashOperationType.Credit ? this.selectedRevenueCategory : null,
      reference: this.reference?.trim() ? this.reference.trim() : null,
      notes: this.notes?.trim() ? this.notes.trim() : null,
      vatRate: this.vatSelectorVisible ? this.selectedVatRate : null
    };

    this.cashDeskService.createOperation(payload).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          const typeLabel = this.operationType === CashOperationType.Credit ? $localize`:@@ui.tern.encaissement.b71c74:Encaissement` : $localize`:@@ui.tern.decaissement.de3611:Décaissement`;
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@add-cash-operation-dialog.component.summary.Succès:Succès`,
            detail: $localize`:@@payments.add-cash-operation-dialog.ts.typelabel.enregistre.avec.succes.018d1291:${typeLabel}:typeLabel: enregistré avec succès`
          });
          this.operationCreated.emit(res.data);
          this.onHide();
        } else {
          const msg = res.message ?? $localize`:@@payments.add-cash-operation-dialog.ts.impossible.d.enregistrer.l.operation.86fecb67:Impossible d’enregistrer l’opération.`;
          this.errorMessage.set(msg);
        }
        this.submitting.set(false);
      },
      error: (err: HttpErrorResponse) => {
        // 403 (payments:create) → message métier français ; jamais le texte brut `err?.message`
        // (« Http failure response for … 403 Forbidden »). Les autres erreurs → message générique francisé.
        const msg = err.status === 403
          ? $localize`:@@ui.tern.action.refusee.autorisations.insuffisantes.c21aad:Action refusée : autorisations insuffisantes (Trésorerie — saisie).`
          : err?.error?.errors?.[0] ??
            err?.error?.message ??
            err?.error?.error?.description ??
            $localize`:@@payments.add-cash-operation-dialog.ts.erreur.lors.de.l.enregistrement.de.l.ope.2ea3dd53:Erreur lors de l’enregistrement de l’opération.`;
        this.errorMessage.set(msg);
        this.submitting.set(false);
      }
    });
  }
}
