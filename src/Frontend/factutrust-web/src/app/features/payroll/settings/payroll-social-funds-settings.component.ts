import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputSwitchModule } from 'primeng/inputswitch';
import { TagModule } from 'primeng/tag';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PayrollService,
  SocialFundScheme,
  UpsertSocialFundSchemeRequest
} from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { SCE_ACCOUNT_MAX_DIGITS, sceAccountDigitCount } from '@features/accounting/chart-of-accounts/chart-of-accounts.component';
import { ConfirmationService } from '@core/services/confirmation.service';

function toIsoDate(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const BASE_OPTIONS = [
  { label: 'Brut cotisable CNSS', value: 'GrossCnssable' },
  { label: 'Net imposable', value: 'NetTaxable' },
  { label: 'Montant fixe', value: 'FixedAmount' }
];

@Component({
  selector: 'app-payroll-social-funds-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    DialogModule,
    SelectModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    InputSwitchModule,
    TagModule,
    ButtonComponent
  ],
  template: `
    <div class="payroll-toolbar mb-3">
      <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()" i18n="@@payroll.settings.nouvelle.caisse.5357b199">Nouvelle caisse</app-button>
    </div>

    <p-table [value]="schemes()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th i18n="@@payroll.settings.code.adac6937">Code</th>
          <th i18n="@@payroll.settings.libelle.f5485bba">Libellé</th>
          <th i18n="@@payroll.settings.base.077fe9c5">Base</th>
          <th class="text-right" i18n="@@payroll.settings.taux.sal.5d5006c8">Taux sal.</th>
          <th class="text-right" i18n="@@payroll.settings.taux.pat.9c6da90a">Taux pat.</th>
          <th i18n="@@payroll.settings.statut.659499f3">Statut</th>
          <th></th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-s>
        <tr>
          <td>{{ s.code }}</td>
          <td>{{ s.name }}</td>
          <td>{{ s.baseDisplay || baseLabel(s.base) }}</td>
          <td class="text-right">{{ s.employeeRatePercent }} %</td>
          <td class="text-right">{{ s.employerRatePercent }} %</td>
          <td>
            <p-tag [value]="s.isActive ? 'Active' : 'Inactive'" [severity]="s.isActive ? 'success' : 'secondary'" />
          </td>
          <td class="actions">
            <button type="button" class="p-button p-button-text p-button-sm" (click)="editScheme(s)" i18n="@@payroll.settings.modifier.f260e757">Modifier</button>
            <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(s)" i18n="@@payroll.settings.supprimer.1acfc1c7">Supprimer</button>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td colspan="7" i18n="@@payroll.settings.aucune.caisse.complementaire.configuree.2fb942f0">Aucune caisse complémentaire configurée.</td></tr>
      </ng-template>
    </p-table>

    <p-dialog [header]="editingId ? 'Modifier la caisse' : 'Nouvelle caisse complémentaire'" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '640px' }">
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.settings.code.adac6937">Code</label>
          <input pInputText [(ngModel)]="formCode" class="w-full" maxlength="20" [disabled]="!!editingId" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.settings.libelle.f5485bba">Libellé</label>
          <input pInputText [(ngModel)]="formName" class="w-full" maxlength="200" />
        </div>
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.settings.base.de.calcul.8790a31f">Base de calcul</label>
          <p-select [options]="baseOptions" optionLabel="label" optionValue="value" [(ngModel)]="formBase" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group switch-row">
          <label for="schemeActive" i18n="@@payroll.settings.active.a733b809">Active</label>
          <p-inputSwitch inputId="schemeActive" [(ngModel)]="formIsActive" />
        </div>
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.settings.taux.salarie.0fd3b3e0">Taux salarié (%)</label>
          <p-inputNumber [(ngModel)]="formEmployeeRate" [min]="0" [max]="100" [minFractionDigits]="2" [maxFractionDigits]="4" [locale]="'fr-TN'" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.settings.taux.employeur.7c6bae8e">Taux employeur (%)</label>
          <p-inputNumber [(ngModel)]="formEmployerRate" [min]="0" [max]="100" [minFractionDigits]="2" [maxFractionDigits]="4" [locale]="'fr-TN'" styleClass="w-full" />
        </div>
      </div>
      @if (formBase === 'FixedAmount') {
        <div class="payroll-form-row">
          <div class="payroll-form-group">
            <label i18n="@@payroll.settings.montant.fixe.salarie.tnd.7fb06f12">Montant fixe salarié (TND)</label>
            <p-inputNumber [(ngModel)]="formFixedEmployee" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
          </div>
          <div class="payroll-form-group">
            <label i18n="@@payroll.settings.montant.fixe.employeur.tnd.86ddc861">Montant fixe employeur (TND)</label>
            <p-inputNumber [(ngModel)]="formFixedEmployer" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
          </div>
        </div>
      }
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.settings.plafond.mensuel.salarie.optionnel.af8934e7">Plafond mensuel salarié (optionnel)</label>
        <p-inputNumber [(ngModel)]="formMonthlyCap" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.settings.compte.sce.salarie.2ff9c8e9">Compte SCE salarié</label>
          <input pInputText [(ngModel)]="formEmployeeAccount" class="w-full" [maxlength]="accountMaxLength" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.settings.compte.sce.employeur.6b8d7f2d">Compte SCE employeur</label>
          <input pInputText [(ngModel)]="formEmployerAccount" class="w-full" [maxlength]="accountMaxLength" />
        </div>
      </div>
      <p class="payroll-info-text mt-1" i18n="@@payroll.settings.comptes.effectifs.ces.comptes.pilote.desormais.l.dc18db0e">Comptes effectifs : ces comptes pilote désormais l'écriture de paie (crédit part salarié / crédit dette
        employeur). Défauts doctrinaux : salarié « 428.1 », employeur « 4538 » (fonds social à payer — non « 647 »).</p>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.settings.effet.a.partir.du.fece40e7">Effet à partir du</label>
          <p-datepicker [(ngModel)]="formEffectiveFrom" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.settings.effet.jusqu.au.95e4ca77">Effet jusqu'au</label>
          <p-datepicker [(ngModel)]="formEffectiveTo" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="dialogVisible = false" i18n="@@payroll.settings.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" (click)="save()" i18n="@@payroll.settings.enregistrer.f7c8bcd8">Enregistrer</app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .mb-2 { margin-bottom: var(--spacing-2); }
    .mb-3 { margin-bottom: var(--spacing-4); }
    .w-full { width: 100%; }
    .text-right { text-align: right; }
    .actions { white-space: nowrap; }
    .switch-row { flex-direction: row; align-items: center; justify-content: space-between; }
  `]
})
export class PayrollSocialFundsSettingsComponent implements OnInit {
  @Input() fiscalYear = new Date().getFullYear();

  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  readonly baseOptions = BASE_OPTIONS;
  schemes = signal<SocialFundScheme[]>([]);
  dialogVisible = false;
  editingId: string | null = null;
  formCode = '';
  formName = '';
  formIsActive = true;
  formEmployeeRate = 0;
  formEmployerRate = 0;
  formBase = 'GrossCnssable';
  formFixedEmployee = 0;
  formFixedEmployer = 0;
  formMonthlyCap: number | null = null;
  formEmployeeAccount = '428.1';
  formEmployerAccount = '4538';
  formEffectiveFrom: Date | null = null;
  formEffectiveTo: Date | null = null;

  ngOnInit(): void {
    this.reload();
  }

  baseLabel(base: string): string {
    return BASE_OPTIONS.find(o => o.value === base)?.label ?? base;
  }

  reload(): void {
    this.payroll.listSocialFunds().subscribe({
      next: res => this.schemes.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: 'Caisses complémentaires', detail: 'Chargement impossible.' })
    });
  }

  openDialog(): void {
    this.editingId = null;
    this.formCode = '';
    this.formName = '';
    this.formIsActive = true;
    this.formEmployeeRate = 0;
    this.formEmployerRate = 0;
    this.formBase = 'GrossCnssable';
    this.formFixedEmployee = 0;
    this.formFixedEmployer = 0;
    this.formMonthlyCap = null;
    this.formEmployeeAccount = '428.1';
    this.formEmployerAccount = '4538';
    this.formEffectiveFrom = null;
    this.formEffectiveTo = null;
    this.dialogVisible = true;
  }

  editScheme(s: SocialFundScheme): void {
    this.editingId = s.id;
    this.formCode = s.code;
    this.formName = s.name;
    this.formIsActive = s.isActive;
    this.formEmployeeRate = s.employeeRatePercent;
    this.formEmployerRate = s.employerRatePercent;
    this.formBase = s.base;
    this.formFixedEmployee = s.fixedEmployeeAmount;
    this.formFixedEmployer = s.fixedEmployerAmount;
    this.formMonthlyCap = s.monthlyEmployeeCap ?? null;
    this.formEmployeeAccount = s.employeeAccountSce;
    this.formEmployerAccount = s.employerAccountSce;
    this.formEffectiveFrom = s.effectiveFrom ? new Date(s.effectiveFrom) : null;
    this.formEffectiveTo = s.effectiveTo ? new Date(s.effectiveTo) : null;
    this.dialogVisible = true;
  }

  /** Même plafond que le plan comptable : ces deux comptes y sont créés et référencés. */
  readonly accountMaxLength = SCE_ACCOUNT_MAX_DIGITS + 2;

  accountError(): string | null {
    for (const [label, value] of [
      ['salarié', this.formEmployeeAccount],
      ['employeur', this.formEmployerAccount]
    ] as const) {
      const num = value.trim();
      if (num.length === 0) continue;
      const digits = sceAccountDigitCount(num);
      if (digits > SCE_ACCOUNT_MAX_DIGITS) {
        return `Le compte SCE ${label} « ${num} » comporte ${digits} chiffres : le maximum est ${SCE_ACCOUNT_MAX_DIGITS}.`;
      }
    }
    return null;
  }

  save(): void {
    if (!this.formCode.trim() || !this.formName.trim()) return;

    const accountError = this.accountError();
    if (accountError) {
      this.toast.add({ severity: 'error', summary: 'Caisses complémentaires', detail: accountError });
      return;
    }

    const body: UpsertSocialFundSchemeRequest = {
      code: this.formCode.trim(),
      name: this.formName.trim(),
      isActive: this.formIsActive,
      employeeRatePercent: this.formEmployeeRate,
      employerRatePercent: this.formEmployerRate,
      base: this.formBase,
      fixedEmployeeAmount: this.formBase === 'FixedAmount' ? this.formFixedEmployee : undefined,
      fixedEmployerAmount: this.formBase === 'FixedAmount' ? this.formFixedEmployer : undefined,
      monthlyEmployeeCap: this.formMonthlyCap ?? undefined,
      employeeAccountSce: this.formEmployeeAccount.trim() || undefined,
      employerAccountSce: this.formEmployerAccount.trim() || undefined,
      effectiveFrom: toIsoDate(this.formEffectiveFrom),
      effectiveTo: toIsoDate(this.formEffectiveTo)
    };

    const req = this.editingId
      ? this.payroll.updateSocialFund(this.editingId, body)
      : this.payroll.createSocialFund(body);

    req.subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Caisses complémentaires', detail: 'Enregistré.' });
        this.dialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Caisses complémentaires', detail: err.error?.message ?? 'Enregistrement impossible.' })
    });
  }

  confirmDelete(s: SocialFundScheme): void {
    this.confirmation.confirm({
      message: `Supprimer la caisse « ${s.name} » ?`,
      header: 'Confirmation',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(s)
    });
  }

  private delete(scheme: SocialFundScheme): void {
    this.payroll.deleteSocialFund(scheme).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'Caisses complémentaires', detail: 'Supprimé.' });
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: 'Caisses complémentaires', detail: err.error?.message ?? 'Suppression impossible.' })
    });
  }
}
