/// <reference types="@angular/localize" />
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, OnChanges, OnInit, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { StepsModule } from 'primeng/steps';
import { MenuItem } from 'primeng/api';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { ButtonComponent } from '@shared/components/button/button.component';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import {
  BankDepositService,
  BankDepositListItem,
  BankDepositType
} from '@core/services/bank-deposit.service';
import { BankAccountDto, BankAccountService } from '@core/services/bank-account.service';
import { AddBankAccountDialogComponent } from '../../../bank-accounts/components/add-bank-account-dialog/add-bank-account-dialog.component';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiResponse } from '@core/services/client.service';
import { forkJoin } from 'rxjs';

/** Maps deposit type to PaymentMethod value used in cash desk / API balance buckets. */
const DEPOSIT_TO_METHOD: Record<BankDepositType, number> = {
  [BankDepositType.Cash]: 0,
  [BankDepositType.Draft]: 1,
  [BankDepositType.Check]: 2
};

@Component({
  selector: 'app-bank-deposit-wizard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    StepsModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    Textarea,
    ButtonComponent,
    AddBankAccountDialogComponent
  ],
  templateUrl: './bank-deposit-wizard.component.html',
  styleUrl: './bank-deposit-wizard.component.scss'
})
export class BankDepositWizardComponent implements OnChanges, OnInit {
  @Input() visible = false;
  @Input() year = new Date().getFullYear();
  @Input() month = new Date().getMonth() + 1;

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() depositCreated = new EventEmitter<BankDepositListItem>();

  private readonly bankDepositService = inject(BankDepositService);
  private readonly bankAccountService = inject(BankAccountService);
  private readonly toastService = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  readonly auth = inject(AuthService);

  readonly BankDepositType = BankDepositType;

  /** Droit de saisie des remises en banque — `payments:create` (garde en amont : bouton caisse). */
  readonly canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.payments.create));

  steps: MenuItem[] = [
    { label: $localize`:@@payments.bank-deposit-wizard.ts.type.de.remise.81515d34:Type de remise` },
    { label: $localize`:@@payments.bank-deposit-wizard.ts.infos.basiques.4081af61:Infos basiques` },
    { label: $localize`:@@payments.bank-deposit-wizard.ts.montant.4adcd9fc:Montant` },
    { label: $localize`:@@payments.bank-deposit-wizard.ts.validation.dd74d182:Validation` }
  ];

  currentStep = 0;
  depositType: BankDepositType | null = null;
  depositDate: Date = new Date();
  bankAccountId: string | null = null;
  depositSlipReference = '';
  amount = 0;
  quantity = 1;
  notes = '';
  previewNumber = '';

  bankAccounts: BankAccountDto[] = [];
  addBankDialogVisible = false;

  submitting = signal(false);
  stepError = signal('');

  /** Net available per PaymentMethod (0 cash, 1 bank transfer / traites, 2 check) up to depositDate — from API. */
  readonly serverAvailableByMethod = signal<Record<number, number>>({ 0: 0, 1: 0, 2: 0 });
  readonly serverBalancesLoading = signal(false);

  readonly maxDate = new Date();
  dialogPosition: 'right' | 'center' = 'right';

  ngOnInit(): void {
    this.updateDialogPosition();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateDialogPosition();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']?.currentValue) {
      this.resetWizard();
      this.loadBankAccounts();
      this.loadPreviewNumber();
      this.loadServerBalances();
    }
  }

  private resetWizard(): void {
    this.currentStep = 0;
    this.depositType = null;
    this.depositDate = new Date();
    this.bankAccountId = null;
    this.depositSlipReference = '';
    this.amount = 0;
    this.quantity = 1;
    this.notes = '';
    this.stepError.set('');
    this.submitting.set(false);
    this.serverAvailableByMethod.set({ 0: 0, 1: 0, 2: 0 });
  }

  private formatDepositDateIso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Loads net balances for all deposit types for the current depositDate (same rules as create validation).
   */
  loadServerBalances(onSuccess?: () => void): void {
    const asOf = this.formatDepositDateIso(this.depositDate);
    this.serverBalancesLoading.set(true);
    forkJoin({
      cash: this.bankDepositService.getAvailableBalance(BankDepositType.Cash, asOf),
      check: this.bankDepositService.getAvailableBalance(BankDepositType.Check, asOf),
      draft: this.bankDepositService.getAvailableBalance(BankDepositType.Draft, asOf)
    }).subscribe({
      next: ({ cash, check, draft }) => {
        this.serverBalancesLoading.set(false);
        const map: Record<number, number> = {
          0: cash.success && cash.data ? cash.data.amount : 0,
          2: check.success && check.data ? check.data.amount : 0,
          1: draft.success && draft.data ? draft.data.amount : 0
        };
        this.serverAvailableByMethod.set(map);
        onSuccess?.();
      },
      error: () => {
        this.serverBalancesLoading.set(false);
        this.serverAvailableByMethod.set({ 0: 0, 1: 0, 2: 0 });
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@bank-deposit-wizard.component.summary.Erreur:Erreur`,
          detail: $localize`:@@bank-deposit-wizard.component.detail.impossible.de.charger.les.soldes.disponibles.pou.de02da90:Impossible de charger les soldes disponibles pour cette date.`
        });
      }
    });
  }

  onDepositDateChange(): void {
    this.loadServerBalances();
  }

  private loadBankAccounts(): void {
    this.bankAccountService.list().subscribe({
      next: res => {
        if (res.success && res.data) {
          this.bankAccounts = res.data.filter(a => a.isActive);
          if (this.bankAccounts.length === 1 && !this.bankAccountId) {
            this.bankAccountId = this.bankAccounts[0].id;
          }
        }
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@bank-deposit-wizard.component.summary.Erreur:Erreur`,
          detail: $localize`:@@bank-deposit-wizard.component.detail.impossible.de.charger.les.comptes.bancaires.f5455f1d:Impossible de charger les comptes bancaires.`
        });
      }
    });
  }

  private loadPreviewNumber(): void {
    this.bankDepositService.previewNumber(this.year).subscribe({
      next: res => {
        if (res.success && res.data) this.previewNumber = res.data;
      },
      error: () => {
        this.previewNumber = '';
      }
    });
  }

  selectDepositType(type: BankDepositType): void {
    this.depositType = type;
    this.stepError.set('');
    if (type === BankDepositType.Cash) {
      this.quantity = 1;
    }
  }

  availableForSelectedType(): number {
    if (this.depositType === null) return 0;
    const method = DEPOSIT_TO_METHOD[this.depositType];
    return this.getBalanceMethod(method);
  }

  getBalanceMethod(method: number): number {
    return this.serverAvailableByMethod()[method] ?? 0;
  }

  formatCurrency(n: number): string {
    return n.toLocaleString('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  formatIban(iban: string): string {
    if (!iban) return '';
    const cleaned = iban.replace(/\s/g, '');
    return cleaned.replace(/(.{4})/g, '$1 ').trim();
  }

  selectedBankAccount(): BankAccountDto | null {
    if (!this.bankAccountId) return null;
    return this.bankAccounts.find(a => a.id === this.bankAccountId) ?? null;
  }

  handleVisibleChange(v: boolean): void {
    this.visibleChange.emit(v);
    if (!v) {
      this.resetWizard();
    }
  }

  onHide(): void {
    this.handleVisibleChange(false);
  }

  openAddBank(): void {
    if (this.auth.isFirmDelegatedReadonly()) return;
    this.addBankDialogVisible = true;
  }

  onBankAccountCreated(): void {
    this.addBankDialogVisible = false;
    this.loadBankAccounts();
  }

  canGoNext(): boolean {
    this.stepError.set('');
    if (this.currentStep === 0) {
      if (this.serverBalancesLoading()) {
        this.stepError.set($localize`:@@payments.bank-deposit-wizard.ts.chargement.des.soldes.2d28cd7e:Chargement des soldes…`);
        return false;
      }
      if (this.depositType === null) {
        this.stepError.set($localize`:@@payments.bank-deposit-wizard.ts.selectionnez.un.type.de.depot.98f63bd1:Sélectionnez un type de dépôt.`);
        return false;
      }
      if (this.availableForSelectedType() <= 0) {
        this.stepError.set($localize`:@@payments.bank-deposit-wizard.ts.aucun.solde.disponible.pour.ce.type.a.la.d0c754ea:Aucun solde disponible pour ce type à la date de remise choisie.`);
        return false;
      }
      return true;
    }
    if (this.currentStep === 1) {
      if (!this.bankAccountId) {
        this.stepError.set($localize`:@@payments.bank-deposit-wizard.ts.selectionnez.un.compte.destinataire.97e77ed5:Sélectionnez un compte destinataire.`);
        return false;
      }
      if (!this.depositSlipReference.trim()) {
        this.stepError.set($localize`:@@payments.bank-deposit-wizard.ts.le.numero.de.la.remise.en.banque.est.obl.77142b03:Le numéro de la remise en banque est obligatoire.`);
        return false;
      }
      return true;
    }
    if (this.currentStep === 2) {
      if (this.serverBalancesLoading()) {
        this.stepError.set($localize`:@@payments.bank-deposit-wizard.ts.chargement.des.soldes.2d28cd7e:Chargement des soldes…`);
        return false;
      }
      const avail = this.availableForSelectedType();
      if (this.amount <= 0) {
        this.stepError.set($localize`:@@payments.bank-deposit-wizard.ts.le.montant.doit.etre.positif.aea12344:Le montant doit être positif.`);
        return false;
      }
      if (this.amount > avail) {
        this.stepError.set($localize`:@@payments.bank-deposit-wizard.ts.le.montant.depasse.le.solde.disponible.95f54536:Le montant dépasse le solde disponible.`);
        return false;
      }
      if (this.quantity < 1) {
        this.stepError.set($localize`:@@payments.bank-deposit-wizard.ts.la.quantite.doit.etre.au.moins.1.9ad20414:La quantité doit être au moins 1.`);
        return false;
      }
      return true;
    }
    return true;
  }

  next(): void {
    if (!this.canGoNext()) return;
    if (this.currentStep === 1) {
      this.loadServerBalances(() => {
        this.currentStep = 2;
        if (this.amount <= 0) {
          this.amount = this.availableForSelectedType();
        }
      });
      return;
    }
    if (this.currentStep < 3) {
      this.currentStep++;
      if (this.currentStep === 2 && this.amount <= 0) {
        this.amount = this.availableForSelectedType();
      }
    }
  }

  prev(): void {
    this.stepError.set('');
    if (this.currentStep > 0) this.currentStep--;
  }

  submit(): void {
    if (this.depositType === null || !this.bankAccountId) return;
    if (this.submitting()) return;
    if (!this.canCreate()) {
      this.stepError.set($localize`:@@payments.bank-deposit-wizard.ts.action.refusee.autorisations.insuffisant.c21aade8:Action refusée : autorisations insuffisantes (Trésorerie — saisie).`);
      return;
    }

    this.submitting.set(true);
    this.stepError.set('');

    const y = this.depositDate.getFullYear();
    const m = String(this.depositDate.getMonth() + 1).padStart(2, '0');
    const d = String(this.depositDate.getDate()).padStart(2, '0');

    const payload = {
      depositType: this.depositType,
      depositDate: `${y}-${m}-${d}`,
      bankAccountId: this.bankAccountId,
      amount: this.amount,
      quantity: this.quantity,
      depositSlipReference: this.depositSlipReference.trim(),
      notes: this.notes.trim() ? this.notes.trim() : null
    };

    this.bankDepositService.create(payload).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@bank-deposit-wizard.component.summary.Succès:Succès`,
            detail: $localize`:@@bank-deposit-wizard.component.detail.Remise_en_banque:Remise en banque enregistrée.`
          });
          this.depositCreated.emit(res.data);
          this.onHide();
        } else {
          const r = res as ApiResponse<BankDepositListItem> & { error?: string };
          this.stepError.set(r.message ?? r.error ?? $localize`:@@payments.bank-deposit-wizard.ts.impossible.d.enregistrer.la.remise.fe68a83f:Impossible d’enregistrer la remise.`);
        }
        this.submitting.set(false);
      },
      error: (err: HttpErrorResponse) => {
        // 403 (payments:create) → message métier français ; autres erreurs → extraction francisée.
        this.stepError.set(
          err.status === 403
            ? $localize`:@@ui.tern.action.refusee.autorisations.insuffisantes.c21aad:Action refusée : autorisations insuffisantes (Trésorerie — saisie).`
            : this.errorHandler.extractErrorMessage(err)
        );
        this.submitting.set(false);
      }
    });
  }

  incQty(): void {
    this.quantity = Math.min(999, this.quantity + 1);
  }

  decQty(): void {
    this.quantity = Math.max(1, this.quantity - 1);
  }

  private updateDialogPosition(): void {
    if (typeof window === 'undefined') {
      this.dialogPosition = 'right';
      return;
    }
    this.dialogPosition = window.innerWidth <= 768 ? 'center' : 'right';
  }
}
