/// <reference types="@angular/localize" />
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputMaskModule } from 'primeng/inputmask';
import { CheckboxModule } from 'primeng/checkbox';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  BankAccountDto,
  BankAccountService,
  CreateBankAccountPayload,
  TunisianBankReference,
  UpdateBankAccountPayload
} from '@core/services/bank-account.service';
import { AccountingService, ChartOfAccountDto } from '@features/accounting/services/accounting.service';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-add-bank-account-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DialogModule,
    SelectModule,
    InputTextModule,
    InputMaskModule,
    CheckboxModule,
    ButtonComponent
  ],
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: 'min(580px, 96vw)' }"
      [draggable]="false"
      [closable]="true"
      (onHide)="onHide()"
      [contentStyle]="{ overflow: 'auto', maxHeight: 'min(72vh, 660px)', padding: 0 }">

      <ng-template pTemplate="header">
        <div class="dialog-header-custom">
          <div class="dialog-header-icon" aria-hidden="true">
            <i class="pi pi-building"></i>
          </div>
          <div class="dialog-header-text">
            <h2 class="dialog-title">{{ editingAccount ? loc_ui_tern_modifier_le_compte_bancaire_84e73b : loc_ui_tern_ajouter_un_compte_bancaire_197db1 }}</h2>
            <p class="dialog-subtitle">{{ editingAccount ? loc_ui_tern_mettez_a_jour_les_informations_de_votre_co_68e692 : loc_ui_tern_renseignez_les_coordonnees_de_votre_compte_562c3e }}</p>
          </div>
        </div>
      </ng-template>

      <div class="dialog-body">
        @if (errorMessage()) {
          <div class="alert-error" role="alert">
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            <span>{{ errorMessage() }}</span>
          </div>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" class="bank-account-form" novalidate>
          <div class="form-fields">

            <div class="form-section">
              <div class="form-section-header">
                <div class="form-section-icon" aria-hidden="true"><i class="pi pi-building"></i></div>
                <h4 class="form-section-title" i18n="@@payments.bank-accounts.etablissement.bancaire.9073e0e6">Établissement bancaire</h4>
              </div>
              <div class="form-section-body">
                <div class="form-group">
                  <label for="bankCode"><ng-container i18n="@@payments.bank-accounts.banque.2a7302cd">Banque </ng-container> <span class="req" aria-hidden="true" i18n="@@payments.bank-accounts.text.df58248c">*</span></label>
                  <p-select
                    inputId="bankCode"
                    formControlName="bankCode"
                    [options]="bankOptions"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Sélectionnez une banque" i18n-placeholder="@@payments.bank-accounts.selectionnez.une.banque.078f3330"
                    [filter]="true"
                    filterBy="label"
                    [showClear]="false"
                    styleClass="w-full"
                    [class.ng-invalid]="form.controls.bankCode.touched && form.controls.bankCode.invalid"
                    (onChange)="onBankSelected($event.value)">
                  </p-select>
                  @if (form.controls.bankCode.touched && form.controls.bankCode.hasError('required')) {
                    <small class="error-text" i18n="@@payments.bank-accounts.banque.est.obligatoire.9a262f81">Banque est obligatoire</small>
                  }
                </div>

                <div class="form-group">
                  <label for="bankName"><ng-container i18n="@@payments.bank-accounts.nom.de.la.banque.9848ce74">Nom de la banque </ng-container> <span class="req" aria-hidden="true" i18n="@@payments.bank-accounts.text.df58248c">*</span></label>
                  <input
                    pInputText
                    id="bankName"
                    formControlName="bankName"
                    class="w-full"
                    [readOnly]="!isAutreBank()"
                    [attr.aria-readonly]="!isAutreBank()"
                    placeholder="Nom de la banque" i18n-placeholder="@@payments.bank-accounts.nom.de.la.banque.9848ce74" />
                  @if (form.controls.bankCode.value && !isAutreBank()) {
                    <small class="hint" i18n="@@payments.bank-accounts.renseigne.automatiquement.modifiable.si.3ab4fd64"><i class="pi pi-info-circle hint-icon" aria-hidden="true"></i> Renseigné automatiquement — modifiable si « Autre ».</small>
                  }
                  @if (form.controls.bankName.touched && form.controls.bankName.hasError('required')) {
                    <small class="error-text" i18n="@@payments.bank-accounts.le.nom.de.la.banque.est.obligatoire.77516c5c">Le nom de la banque est obligatoire</small>
                  }
                </div>
              </div>
            </div>

            <div class="form-section">
              <div class="form-section-header">
                <div class="form-section-icon section-icon-banking" aria-hidden="true"><i class="pi pi-credit-card"></i></div>
                <h4 class="form-section-title" i18n="@@payments.bank-accounts.coordonnees.bancaires.9d367d41">Coordonnées bancaires</h4>
              </div>
              <div class="form-section-body">
                <div class="form-group">
                  <label for="iban"><ng-container i18n="@@payments.bank-accounts.iban.e81566a5">IBAN </ng-container> <span class="req" aria-hidden="true" i18n="@@payments.bank-accounts.text.df58248c">*</span></label>
                  <input
                    pInputText
                    id="iban"
                    formControlName="iban"
                    class="w-full mono-input"
                    placeholder="TN59 1000 0035 1835 8847 8831" i18n-placeholder="@@payments.bank-accounts.tn59.1000.0035.1835.8847.8831.b9af2b3b"
                    autocomplete="off"
                    (blur)="syncRibFromIban()" />
                  <small class="hint" i18n="@@payments.bank-accounts.exemple.nbsp.tn59.1000.0035.1835.8847.8831.6fe94886">Exemple&nbsp;: TN59 1000 0035 1835 8847 8831</small>
                </div>

                <div class="form-group">
                  <label for="rib"><ng-container i18n="@@payments.bank-accounts.rib.61f3ea57">RIB </ng-container> <span class="req" aria-hidden="true" i18n="@@payments.bank-accounts.text.df58248c">*</span></label>
                  <p-inputMask
                    inputId="rib"
                    formControlName="rib"
                    mask="99 999 9999999999999 99"
                    placeholder="XX XXX XXXXXXXXXXXXX XX" i18n-placeholder="@@payments.bank-accounts.xx.xxx.xxxxxxxxxxxxx.xx.88bae40a"
                    styleClass="w-full mono-input-mask">
                  </p-inputMask>
                  <small class="hint" i18n="@@payments.bank-accounts.20.chiffres.complete.depuis.l.iban.b167c224">20 chiffres — complété depuis l'IBAN</small>
                </div>

                <div class="form-group">
                  <label for="swiftBic" i18n="@@payments.bank-accounts.swift.bic.d66efbd3">SWIFT / BIC</label>
                  <input
                    pInputText
                    id="swiftBic"
                    formControlName="swiftBic"
                    class="w-full mono-input"
                    placeholder="Ex: BIATTNTT" i18n-placeholder="@@payments.bank-accounts.ex.biattntt.4404ffb2"
                    maxlength="11" />
                </div>
              </div>
            </div>

            <div class="form-section">
              <div class="form-section-header">
                <div class="form-section-icon section-icon-accounting" aria-hidden="true"><i class="pi pi-book"></i></div>
                <h4 class="form-section-title" i18n="@@payments.bank-accounts.comptabilite.532x.78487f19">Comptabilité (532x)</h4>
              </div>
              <div class="form-section-body">
                <div class="default-account-option">
                  <p-checkbox formControlName="autoCreateChartAccount" inputId="autoCreateChartAccount" [binary]="true"></p-checkbox>
                  <label for="autoCreateChartAccount" class="checkbox-label">
                    <span class="checkbox-label-text" i18n="@@payments.bank-accounts.creer.automatiquement.un.sous.compte.banque.532x.889b1960">Créer automatiquement un sous-compte banque 532x</span>
                    <span class="checkbox-label-hint" i18n="@@payments.bank-accounts.un.compte.auxiliaire.sera.cree.sous.5321.tnd.lor.dcc4282b">Un compte auxiliaire sera créé sous 5321 (TND) lors de l'enregistrement.</span>
                  </label>
                </div>
                @if (!form.controls.autoCreateChartAccount.value) {
                  <div class="form-group">
                    <label for="chartOfAccountNumber" i18n="@@payments.bank-accounts.compte.comptable.existant.e93f4023">Compte comptable existant</label>
                    <p-select
                      inputId="chartOfAccountNumber"
                      formControlName="chartOfAccountNumber"
                      [options]="chartAccountOptions"
                      optionLabel="label"
                      optionValue="value"
                      placeholder="5321…" i18n-placeholder="@@payments.bank-accounts.5321.8d5bc024"
                      [filter]="true"
                      filterBy="label"
                      [showClear]="true"
                      styleClass="w-full">
                    </p-select>
                  </div>
                }
              </div>
            </div>

            <div class="form-section">
              <div class="form-section-header">
                <div class="form-section-icon section-icon-info" aria-hidden="true"><i class="pi pi-info-circle"></i></div>
                <h4 class="form-section-title" i18n="@@payments.bank-accounts.informations.complementaires.805470ce">Informations complémentaires</h4>
                <span class="section-badge" i18n="@@payments.bank-accounts.optionnel.879d6b16">Optionnel</span>
              </div>
              <div class="form-section-body">
                <div class="form-row">
                  <div class="form-group">
                    <label for="designation" i18n="@@payments.bank-accounts.libelle.du.compte.7200e54f">Libellé du compte</label>
                    <input pInputText id="designation" formControlName="designation" class="w-full" placeholder="Ex: Compte principal" i18n-placeholder="@@payments.bank-accounts.ex.compte.principal.56f72496" />
                  </div>
                  <div class="form-group">
                    <label for="agencyName" i18n="@@payments.bank-accounts.agence.37c58081">Agence</label>
                    <input pInputText id="agencyName" formControlName="agencyName" class="w-full" placeholder="Ex: Agence centre-ville" i18n-placeholder="@@payments.bank-accounts.ex.agence.centre.ville.77664fc3" />
                  </div>
                </div>

                @if (!editingAccount) {
                  <div class="default-account-option">
                    <p-checkbox formControlName="setAsDefault" inputId="setAsDefault" [binary]="true"></p-checkbox>
                    <label for="setAsDefault" class="checkbox-label">
                      <span class="checkbox-label-text" i18n="@@payments.bank-accounts.definir.comme.compte.par.defaut.6a8425f5">Définir comme compte par défaut</span>
                      <span class="checkbox-label-hint" i18n="@@payments.bank-accounts.ce.compte.sera.utilise.automatiquement.sur.vos.d.ee927bb1">Ce compte sera utilisé automatiquement sur vos documents.</span>
                    </label>
                  </div>
                }
              </div>
            </div>

          </div>

          <button type="submit" class="sr-only" tabindex="-1" aria-hidden="true" i18n="@@payments.bank-accounts.valider.be4220f7">Valider</button>
        </form>
      </div>

      <ng-template pTemplate="footer">
        <div class="dialog-footer">
          <app-button type="button" variant="ghost" (click)="close()" ariaLabel="Annuler" i18n-ariaLabel="@@payments.bank-accounts.annuler.e063e8ff" i18n="@@payments.bank-accounts.annuler.49ba3292">Annuler</app-button>
          <app-button
            type="button"
            variant="primary"
            icon="pi pi-check"
            [disabled]="saving() || form.invalid"
            ariaLabel="Valider" i18n-ariaLabel="@@payments.bank-accounts.valider.8ef67b67"
            (click)="submit()">
            {{ saving() ? loc_ui_tern_enregistrement_e7d5f2 : loc_ui_tern_valider_be4220 }}
          </app-button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    /* ── Entry animation ── */
    @keyframes dialogBodyFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ── Custom header ── */
    .dialog-header-custom {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      min-width: 0;
    }

    .dialog-header-icon {
      flex-shrink: 0;
      width: 42px;
      height: 42px;
      border-radius: var(--radius-lg);
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-primary-100);
      color: var(--color-primary-600);
      font-size: 1.2rem;
    }

    .dialog-header-text {
      min-width: 0;
    }

    .dialog-title {
      margin: 0;
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      line-height: 1.3;
    }

    .dialog-subtitle {
      margin: var(--spacing-1) 0 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      line-height: 1.4;
    }

    /* ── Dialog body ── */
    .dialog-body {
      padding: var(--spacing-5) var(--spacing-6) var(--spacing-4);
      animation: dialogBodyFadeIn 0.25s ease-out;
      overflow-x: hidden;
      box-sizing: border-box;
    }

    .bank-account-form {
      padding: 0;
    }

    .form-fields {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-5);
    }

    /* ── Form sections (card-style) ── */
    .form-section {
      background: var(--color-background-subtle);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      overflow: hidden;
    }

    .form-section-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      border-bottom: 1px solid var(--color-border-subtle);
      background: var(--color-background-elevated);
    }

    .form-section-icon {
      flex-shrink: 0;
      width: 30px;
      height: 30px;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-primary-100);
      color: var(--color-primary-600);
      font-size: 0.85rem;
    }

    .section-icon-banking {
      background: var(--color-success-100, #dcfce7);
      color: var(--color-success-600, #16a34a);
    }

    .section-icon-info {
      background: var(--color-neutral-200);
      color: var(--color-text-secondary);
    }

    .section-icon-accounting {
      background: var(--color-warning-100, #fef3c7);
      color: var(--color-warning-700, #b45309);
    }

    .form-section-title {
      margin: 0;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      letter-spacing: 0.01em;
      flex: 1;
    }

    .section-badge {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
      padding: 0.125rem 0.5rem;
      border-radius: var(--radius-md);
      background: var(--color-background-subtle);
      color: var(--color-text-tertiary);
      border: 1px solid var(--color-border-subtle);
    }

    .form-section-body {
      padding: var(--spacing-4);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    /* ── Form groups ── */
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-4);
    }

    @media (max-width: 480px) {
      .form-row { grid-template-columns: 1fr; }
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
    }

    .form-group > label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .req { color: var(--color-danger-500); }

    .hint {
      display: flex;
      align-items: center;
      gap: var(--spacing-1);
      color: var(--color-text-tertiary);
      font-size: var(--font-size-xs);
      line-height: var(--line-height-normal);
    }

    .hint-icon {
      font-size: 0.7rem;
      flex-shrink: 0;
    }

    .error-text {
      color: var(--color-danger-500);
      font-size: var(--font-size-xs);
    }

    /* ── Mono fields for banking data ── */
    .mono-input {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.04em;
      transition: box-shadow var(--transition-fast), border-color var(--transition-fast);
    }

    /* ── Alert ── */
    .alert-error {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-2);
      padding: var(--spacing-3);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-error-200);
      background: var(--color-error-50);
      color: var(--color-error-700);
      margin-bottom: var(--spacing-4);
      font-size: var(--font-size-sm);
      line-height: 1.45;
    }

    .alert-error .pi {
      margin-top: 2px;
      flex-shrink: 0;
    }

    /* ── Default account checkbox ── */
    .default-account-option {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
      padding: var(--spacing-3) var(--spacing-4);
      background: var(--color-primary-50);
      border: 1px solid var(--color-primary-200);
      border-radius: var(--radius-lg);
      cursor: pointer;
    }

    .checkbox-label {
      margin: 0;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .checkbox-label-text {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--color-text-primary);
      line-height: 1.4;
    }

    .checkbox-label-hint {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      line-height: 1.4;
    }

    /* ── Footer ── */
    .dialog-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: var(--spacing-3);
      width: 100%;
    }

    /* ── Responsive ── */
    @media (max-width: 480px) {
      .dialog-body {
        padding: var(--spacing-4) var(--spacing-4) var(--spacing-3);
      }

      .dialog-header-icon { display: none; }

      .form-section-body {
        padding: var(--spacing-3);
      }
    }

    /* ── PrimeNG overrides ── */
    :host ::ng-deep {
      .p-dialog {
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-xl);
        overflow: hidden;
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
        display: none;
      }

      .p-dialog-footer {
        padding: var(--spacing-4) var(--spacing-6);
        border-top: 1px solid var(--color-border-subtle);
        background: var(--color-background-subtle);
      }

      .p-select,
      .p-inputmask {
        width: 100%;
      }

      .mono-input-mask .p-inputtext {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        letter-spacing: 0.04em;
      }
    }
  `]
})
export class AddBankAccountDialogComponent implements OnChanges {
  readonly loc_ui_tern_modifier_le_compte_bancaire_84e73b = $localize`:@@ui.tern.modifier.le.compte.bancaire.84e73b:Modifier le compte bancaire`;
  readonly loc_ui_tern_ajouter_un_compte_bancaire_197db1 = $localize`:@@ui.tern.ajouter.un.compte.bancaire.197db1:Ajouter un compte bancaire`;
  readonly loc_ui_tern_mettez_a_jour_les_informations_de_votre_co_68e692 = $localize`:@@ui.tern.mettez.a.jour.les.informations.de.votre.co.68e692:Mettez à jour les informations de votre compte.`;
  readonly loc_ui_tern_renseignez_les_coordonnees_de_votre_compte_562c3e = $localize`:@@ui.tern.renseignez.les.coordonnees.de.votre.compte.562c3e:Renseignez les coordonnées de votre compte tunisien.`;
  readonly loc_ui_tern_enregistrement_e7d5f2 = $localize`:@@ui.tern.enregistrement.e7d5f2:Enregistrement…`;
  readonly loc_ui_tern_valider_be4220 = $localize`:@@ui.tern.valider.be4220:Valider`;
  private readonly fb = inject(FormBuilder);
  private readonly bankAccountService = inject(BankAccountService);
  private readonly accountingService = inject(AccountingService);
  private readonly toast = inject(ToastService);

  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() saved = new EventEmitter<void>();
  @Input() editingAccount: BankAccountDto | null = null;

  bankOptions: { label: string; value: string }[] = [];
  chartAccountOptions: { label: string; value: string }[] = [];
  private banks: TunisianBankReference[] = [];

  saving = signal(false);
  errorMessage = signal<string | null>(null);

  form = this.fb.nonNullable.group({
    bankCode: ['', Validators.required],
    bankName: ['', [Validators.required, Validators.maxLength(100)]],
    designation: [''],
    agencyName: [''],
    swiftBic: [''],
    iban: ['', Validators.required],
    rib: ['', Validators.required],
    setAsDefault: [false],
    autoCreateChartAccount: [true],
    chartOfAccountNumber: ['']
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.visible) return;
    if (changes['visible']?.currentValue === true || changes['editingAccount']) {
      this.errorMessage.set(null);
      this.loadBanksAndForm();
    }
  }

  private loadBanksAndForm(): void {
    this.accountingService.getChartOfAccounts().subscribe(chartRes => {
      const accounts = chartRes.success && chartRes.data ? chartRes.data : [];
      this.chartAccountOptions = accounts
        .filter((a: ChartOfAccountDto) => a.accountNumber.startsWith('532'))
        .map((a: ChartOfAccountDto) => ({ label: `${a.accountNumber} — ${a.label}`, value: a.accountNumber }));
    });

    this.bankAccountService.getTunisianBanks().subscribe(banks => {
      this.banks = banks;
      this.bankOptions = banks.map(b => ({
        label: `${b.name} (${b.code})`,
        value: b.code
      }));
      if (this.editingAccount) {
        this.patchEditForm(this.editingAccount);
      } else {
        this.form.reset({
          bankCode: '',
          bankName: '',
          designation: '',
          agencyName: '',
          swiftBic: '',
          iban: '',
          rib: '',
          setAsDefault: false,
          autoCreateChartAccount: true,
          chartOfAccountNumber: ''
        });
      }
    });
  }

  private patchEditForm(a: BankAccountDto): void {
    const ribFormatted = this.formatRibDisplay(a.rib);
    this.form.patchValue({
      bankCode: a.bankCode,
      bankName: a.bankName,
      designation: a.designation ?? '',
      agencyName: a.agencyName ?? '',
      swiftBic: a.swiftBic ?? '',
      iban: this.formatIbanDisplay(a.iban),
      rib: ribFormatted,
      setAsDefault: false,
      autoCreateChartAccount: !a.chartOfAccountNumber,
      chartOfAccountNumber: a.chartOfAccountNumber ?? ''
    });
    this.onBankSelected(a.bankCode);
  }

  private formatRibDisplay(ribDigits: string): string {
    const d = ribDigits.replace(/\D/g, '');
    if (d.length !== 20) return ribDigits;
    return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 18)} ${d.slice(18, 20)}`;
  }

  isAutreBank(): boolean {
    return this.form.controls.bankCode.value === 'AUTRE';
  }

  onBankSelected(code: string | null): void {
    if (!code) return;
    const bank = this.banks.find(b => b.code === code);
    if (!bank) return;
    if (code === 'AUTRE') {
      this.form.patchValue({ bankName: '', swiftBic: '' });
    } else {
      this.form.patchValue({
        bankName: bank.name,
        swiftBic: bank.defaultSwiftBic ?? ''
      });
    }
  }

  syncRibFromIban(): void {
    const iban = this.normalizeIban(this.form.controls.iban.value);
    if (iban.length >= 24 && iban.startsWith('TN')) {
      const rib = iban.slice(4, 24);
      const formatted = `${rib.slice(0, 2)} ${rib.slice(2, 5)} ${rib.slice(5, 18)} ${rib.slice(18, 20)}`;
      this.form.patchValue({ rib: formatted });
    }
  }

  private normalizeIban(v: string): string {
    return v.replace(/\s/g, '').toUpperCase();
  }

  private formatIbanDisplay(iban: string): string {
    const c = this.normalizeIban(iban);
    if (c.length !== 24) return iban;
    return c.replace(/(.{4})/g, '$1 ').trim();
  }

  private stripRib(v: string): string {
    return v.replace(/\D/g, '');
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const ribDigits = this.stripRib(v.rib);
    const ibanNorm = this.normalizeIban(v.iban);
    if (ribDigits.length !== 20) {
      this.errorMessage.set('Le RIB doit contenir 20 chiffres.');
      return;
    }
    if (!/^TN\d{22}$/.test(ibanNorm)) {
      this.errorMessage.set("L'IBAN tunisien est invalide (TN + 22 chiffres).");
      return;
    }
    if (ibanNorm.slice(4) !== ribDigits) {
      this.errorMessage.set("Le RIB ne correspond pas à l'IBAN.");
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);

    if (this.editingAccount) {
      const payload: UpdateBankAccountPayload = {
        bankCode: v.bankCode,
        bankName: v.bankName.trim(),
        rib: ribDigits,
        iban: ibanNorm,
        designation: v.designation?.trim() || null,
        agencyName: v.agencyName?.trim() || null,
        swiftBic: v.swiftBic?.trim() || null,
        chartOfAccountNumber: v.autoCreateChartAccount ? null : (v.chartOfAccountNumber?.trim() || null),
        autoCreateChartAccount: v.autoCreateChartAccount
      };
      this.bankAccountService.update(this.editingAccount.id, payload).subscribe({
        next: res => {
          this.saving.set(false);
          if (res.success) {
            this.toast.add({
              severity: 'success',
              summary: $localize`:@@add-bank-account-dialog.component.summary.Succès:Succès`,
              detail: res.message ?? $localize`:@@ui.tern.compte.mis.a.jour.34817f:Compte mis à jour.`
            });
            this.close();
            this.saved.emit();
          } else {
            this.errorMessage.set(res.errors?.[0] ?? $localize`:@@ui.tern.echec.de.la.mise.a.jour.29ae4d:Échec de la mise à jour.`);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.errorMessage.set(this.extractError(err));
        }
      });
    } else {
      const payload: CreateBankAccountPayload = {
        bankCode: v.bankCode,
        bankName: v.bankName.trim(),
        rib: ribDigits,
        iban: ibanNorm,
        designation: v.designation?.trim() || null,
        agencyName: v.agencyName?.trim() || null,
        swiftBic: v.swiftBic?.trim() || null,
        setAsDefault: v.setAsDefault,
        chartOfAccountNumber: v.autoCreateChartAccount ? null : (v.chartOfAccountNumber?.trim() || null),
        autoCreateChartAccount: v.autoCreateChartAccount
      };
      this.bankAccountService.create(payload).subscribe({
        next: res => {
          this.saving.set(false);
          if (res.success) {
            this.toast.add({
              severity: 'success',
              summary: $localize`:@@add-bank-account-dialog.component.summary.Succès:Succès`,
              detail: res.message ?? $localize`:@@ui.tern.compte.cree.b6349d:Compte créé.`
            });
            this.close();
            this.saved.emit();
          } else {
            this.errorMessage.set(res.errors?.[0] ?? $localize`:@@ui.tern.echec.de.la.creation.23cd9c:Échec de la création.`);
          }
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.errorMessage.set(this.extractError(err));
        }
      });
    }
  }

  private extractError(err: HttpErrorResponse): string {
    // 403 → message métier français (saisie à la création, mise à jour à l'édition) ;
    // jamais le texte brut `err.message` (« Http failure response for … »).
    if (err.status === 403) {
      return this.editingAccount
        ? $localize`:@@ui.tern.action.refusee.autorisations.insuffisantes.86b982:Action refusée : autorisations insuffisantes (Trésorerie — mise à jour).`
        : $localize`:@@ui.tern.action.refusee.autorisations.insuffisantes.c21aad:Action refusée : autorisations insuffisantes (Trésorerie — saisie).`;
    }
    const body = err.error;
    if (typeof body === 'string') return body;
    if (body && typeof body === 'object') {
      const o = body as { message?: string; errors?: string[] };
      if (o.errors?.length) return o.errors[0];
      if (o.message) return o.message;
    }
    return 'Erreur lors de l\u2019enregistrement du compte.';
  }

  close(): void {
    this.visibleChange.emit(false);
  }

  onHide(): void {
    this.visibleChange.emit(false);
  }
}
