/// <reference types="@angular/localize" />
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputSwitchModule } from 'primeng/inputswitch';
import { CheckboxModule } from 'primeng/checkbox';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmployeeService, CreateContractRequest, EmploymentContract } from '@core/services/employee.service';
import { ToastService } from '@core/services/toast.service';
import { CONTRACT_TYPE_OPTIONS, SOCIAL_REGIME_OPTIONS, WEEKLY_REGIME_OPTIONS } from '../payroll-options';

export interface AllowanceRow {
  label: string;
  amount: number;
  taxable: boolean;
  subjectToCnss: boolean;
}

function toIsoDate(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIsoDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Component({
  selector: 'app-contract-form-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    SelectModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    InputSwitchModule,
    CheckboxModule,
    ButtonComponent
  ],
  template: `
    <p-dialog
      [header]="editContract ? loc_ui_tern_modifier_le_contrat_2ed431 : loc_ui_tern_nouveau_contrat_13fabd"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '720px', maxWidth: '95vw' }"
      [draggable]="false"
      (onHide)="onHide()">
      <div class="form-grid">
        <div class="form-group">
          <label i18n="@@payroll.employees.type.3deb7456">Type</label>
          <p-select [options]="contractTypeOptions" [(ngModel)]="type" optionLabel="label" optionValue="value" appendTo="body" styleClass="w-full" />
        </div>
        <div class="form-group">
          <label i18n="@@payroll.employees.regime.social.9844bfda">Régime social</label>
          <p-select [options]="regimeOptions" [(ngModel)]="regime" optionLabel="label" optionValue="value" appendTo="body" styleClass="w-full" />
        </div>
        <div class="form-group">
          <label i18n="@@payroll.employees.duree.hebdomadaire.c55ea457">Durée hebdomadaire</label>
          <p-select [options]="weeklyRegimeOptions" [(ngModel)]="weeklyRegime" optionLabel="label" optionValue="value" appendTo="body" styleClass="w-full" />
        </div>
        <div class="form-group">
          <label i18n="@@payroll.employees.date.debut.2413e246">Date début</label>
          <p-datepicker [(ngModel)]="startDate" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" styleClass="w-full" />
        </div>
        <div class="form-group">
          <label i18n="@@payroll.employees.date.fin.2d44e855">Date fin</label>
          <p-datepicker [(ngModel)]="endDate" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" styleClass="w-full" />
        </div>
        <div class="form-group">
          <label i18n="@@payroll.employees.salaire.de.base.tnd.05b73374">Salaire de base (TND)</label>
          <p-inputNumber [(ngModel)]="baseSalary" [minFractionDigits]="3" [maxFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
        </div>
        <div class="form-group">
          <label i18n="@@payroll.employees.taux.accident.travail.b0bfd18c">Taux accident travail (%)</label>
          <p-inputNumber [(ngModel)]="workAccidentRate" [min]="0" [max]="100" styleClass="w-full" />
        </div>
        <div class="form-group full-width">
          <label i18n="@@payroll.employees.intitule.poste.faef1efb">Intitulé poste</label>
          <input pInputText [(ngModel)]="jobTitle" class="w-full" />
        </div>
        @if (editContract) {
          <div class="form-group">
            <label i18n="@@payroll.employees.contrat.actif.db7e3b10">Contrat actif</label>
            <p-inputSwitch [(ngModel)]="isActive" />
          </div>
        }
      </div>

      @if (type === 'Sivp') {
        <h4 class="mt-3" i18n="@@payroll.employees.civp.sivp.afda7627">CIVP / SIVP</h4>
        <div class="form-grid">
          <div class="form-group">
            <label i18n="@@payroll.employees.debut.civp.6897b40e">Début CIVP</label>
            <p-datepicker [(ngModel)]="civpStartDate" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" styleClass="w-full" />
          </div>
          <div class="form-group">
            <label i18n="@@payroll.employees.fin.civp.max.12.mois.04818857">Fin CIVP (max 12 mois)</label>
            <p-datepicker [(ngModel)]="civpEndDate" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" styleClass="w-full" />
          </div>
          <div class="form-group">
            <label i18n="@@payroll.employees.subvention.etat.995c84ca">Subvention État</label>
            <p-inputNumber [(ngModel)]="civpStateGrant" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
          </div>
          <div class="form-group">
            <label i18n="@@payroll.employees.indemnite.employeur.2ac117d4">Indemnité employeur</label>
            <p-inputNumber [(ngModel)]="civpEmployerAllowance" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
          </div>
          <div class="form-group full-width">
            <label i18n="@@payroll.employees.reference.aneti.6bcc67fb">Référence ANETI</label>
            <input pInputText [(ngModel)]="anetiReference" class="w-full" />
          </div>
        </div>
        @if (editContract) {
          <app-button variant="outline" class="mt-2" (click)="downloadCivpAttestation()" i18n="@@payroll.employees.telecharger.attestation.civp.cc799e1e">Télécharger attestation CIVP</app-button>
        }
      }

      <h4 class="mt-3" i18n="@@payroll.employees.primes.ef76befd">Primes</h4>
      <table class="allowance-table">
        <thead>
          <tr><th i18n="@@payroll.employees.libelle.f5485bba">Libellé</th><th i18n="@@payroll.employees.montant.4adcd9fc">Montant</th><th i18n="@@payroll.employees.imposable.49743e0c">Imposable</th><th i18n="@@payroll.employees.cnss.a04d171a">CNSS</th><th></th></tr>
        </thead>
        <tbody>
          @for (row of allowanceRows; track i; let i = $index) {
            <tr>
              <td><input pInputText [(ngModel)]="row.label" [name]="'label' + i" class="w-full" /></td>
              <td><p-inputNumber [(ngModel)]="row.amount" [minFractionDigits]="3" [locale]="'fr-TN'" [name]="'amt' + i" /></td>
              <td><p-checkbox [(ngModel)]="row.taxable" [binary]="true" [name]="'tax' + i" /></td>
              <td><p-checkbox [(ngModel)]="row.subjectToCnss" [binary]="true" [name]="'cnss' + i" /></td>
              <td><button type="button" class="p-button p-button-text p-button-danger" (click)="removeAllowance(i)" i18n="@@payroll.employees.text.67fba2f3">×</button></td>
            </tr>
          }
        </tbody>
      </table>
      <button type="button" class="p-button p-button-text mt-2" (click)="addAllowance()" i18n="@@payroll.employees.ajouter.une.prime.dab52440">+ Ajouter une prime</button>

      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="close()" i18n="@@payroll.employees.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" [disabled]="saving()" (click)="save()" i18n="@@payroll.employees.enregistrer.f7c8bcd8">Enregistrer</app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .form-group { display: flex; flex-direction: column; gap: 0.35rem; }
    .full-width { grid-column: 1 / -1; }
    .allowance-table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
    .allowance-table th, .allowance-table td { padding: 0.5rem; border-bottom: 1px solid #e2e8f0; text-align: left; }
    .w-full { width: 100%; }
    .mt-2 { margin-top: 0.5rem; }
    .mt-3 { margin-top: 1rem; }
  `]
})
export class ContractFormDialogComponent implements OnChanges {
  readonly loc_ui_tern_modifier_le_contrat_2ed431 = $localize`:@@ui.tern.modifier.le.contrat.2ed431:Modifier le contrat`;
  readonly loc_ui_tern_nouveau_contrat_13fabd = $localize`:@@ui.tern.nouveau.contrat.13fabd:Nouveau contrat`;
  private readonly employees = inject(EmployeeService);
  private readonly toast = inject(ToastService);

  readonly contractTypeOptions = CONTRACT_TYPE_OPTIONS;
  readonly regimeOptions = SOCIAL_REGIME_OPTIONS;
  readonly weeklyRegimeOptions = WEEKLY_REGIME_OPTIONS;

  @Input() visible = false;
  @Input() employeeId = '';
  @Input() editContract: EmploymentContract | null = null;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() saved = new EventEmitter<void>();

  saving = signal(false);
  type = 'Cdi';
  regime = 'Rsna';
  weeklyRegime = 'FortyEightHours';
  startDate: Date | null = new Date();
  endDate: Date | null = null;
  baseSalary = 0;
  workAccidentRate = 0.4;
  jobTitle = '';
  isActive = true;
  civpStartDate: Date | null = null;
  civpEndDate: Date | null = null;
  civpStateGrant = 0;
  civpEmployerAllowance = 0;
  anetiReference = '';
  allowanceRows: AllowanceRow[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.visible) return;
    if (this.editContract) {
      const c = this.editContract;
      this.type = c.type;
      this.regime = c.regime;
      this.weeklyRegime = c.weeklyRegime ?? 'FortyEightHours';
      this.startDate = parseIsoDate(c.startDate);
      this.endDate = parseIsoDate(c.endDate);
      this.baseSalary = c.baseSalary;
      this.workAccidentRate = c.workAccidentRate;
      this.jobTitle = c.jobTitle ?? '';
      this.isActive = c.isActive;
      this.civpStartDate = parseIsoDate(c.civpStartDate);
      this.civpEndDate = parseIsoDate(c.civpEndDate);
      this.civpStateGrant = c.civpStateGrant ?? 0;
      this.civpEmployerAllowance = c.civpEmployerAllowance ?? 0;
      this.anetiReference = c.anetiReference ?? '';
      this.allowanceRows = c.allowances.map(a => ({
        label: a.label,
        amount: a.amount,
        taxable: a.taxable,
        subjectToCnss: a.subjectToCnss
      }));
    } else if (changes['visible']?.currentValue === true && !this.editContract) {
      this.resetFormFields();
    }
  }

  addAllowance(): void {
    this.allowanceRows.push({ label: '', amount: 0, taxable: true, subjectToCnss: true });
  }

  removeAllowance(i: number): void {
    this.allowanceRows.splice(i, 1);
  }

  save(): void {
    if (!this.employeeId || !this.startDate) return;
    this.saving.set(true);
    const allowances = this.allowanceRows
      .filter(r => r.label.trim())
      .map(r => ({ label: r.label.trim(), amount: r.amount, taxable: r.taxable, subjectToCnss: r.subjectToCnss }));

    const body: CreateContractRequest = {
      type: this.type,
      regime: this.regime,
      weeklyRegime: this.weeklyRegime,
      startDate: toIsoDate(this.startDate)!,
      endDate: toIsoDate(this.endDate),
      baseSalary: this.baseSalary,
      workAccidentRate: this.workAccidentRate,
      jobTitle: this.jobTitle || undefined,
      allowances,
      civpStartDate: this.type === 'Sivp' ? toIsoDate(this.civpStartDate) : undefined,
      civpEndDate: this.type === 'Sivp' ? toIsoDate(this.civpEndDate) : undefined,
      civpStateGrant: this.type === 'Sivp' ? this.civpStateGrant : 0,
      civpEmployerAllowance: this.type === 'Sivp' ? this.civpEmployerAllowance : 0,
      anetiReference: this.type === 'Sivp' ? (this.anetiReference || undefined) : undefined
    };

    const req = this.editContract
      ? this.employees.updateContract(this.editContract.id, { ...body, isActive: this.isActive })
      : this.employees.addContract(this.employeeId, body);

    req.subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@contract-form-dialog.component.summary.Contrat:Contrat`, detail: $localize`:@@contract-form-dialog.component.detail.Contrat_enregist:Contrat enregistré.` });
        this.saved.emit();
        this.close();
        this.saving.set(false);
      },
      error: err => {
        this.toast.add({ severity: 'error', summary: $localize`:@@contract-form-dialog.component.summary.Contrat:Contrat`, detail: err.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.` });
        this.saving.set(false);
      }
    });
  }

  close(): void {
    this.visible = false;
    this.visibleChange.emit(false);
    this.resetFormFields();
  }

  onHide(): void {
    this.visibleChange.emit(false);
  }

  private resetFormFields(): void {
    this.type = 'Cdi';
    this.regime = 'Rsna';
    this.weeklyRegime = 'FortyEightHours';
    this.startDate = new Date();
    this.endDate = null;
    this.baseSalary = 0;
    this.workAccidentRate = 0.4;
    this.jobTitle = '';
    this.isActive = true;
    this.civpStartDate = null;
    this.civpEndDate = null;
    this.civpStateGrant = 0;
    this.civpEmployerAllowance = 0;
    this.anetiReference = '';
    this.allowanceRows = [];
  }

  downloadCivpAttestation(): void {
    if (!this.editContract) return;
    this.employees.exportCivpAttestationPdf(this.editContract.id).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attestation-civp-${this.editContract!.id}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@contract-form-dialog.component.summary.CIVP:CIVP`, detail: $localize`:@@contract-form-dialog.component.detail.T_l_chargement_i:Téléchargement impossible.` })
    });
  }
}
