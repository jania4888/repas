import { Component, Input, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { CONTRACT_TYPE_OPTIONS, SOCIAL_REGIME_OPTIONS, WEEKLY_REGIME_OPTIONS } from '@features/payroll/payroll-options';
import { CollaboratorPayrollOnboardingPayload } from '@core/services/firm-collaborators.service';

export interface CollaboratorIdentitySnapshot {
  firstName: string;
  lastName: string;
  email: string;
}

function toIsoDate(value: Date | null | undefined): string {
  if (!value) return '';
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Component({
  selector: 'app-firm-collaborator-payroll-onboarding',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule
  ],
  template: `
    <form [formGroup]="form" class="payroll-grid">
      <h3 class="section-title full">Identité paie</h3>
      <label>Prénom
        <input pInputText [value]="identity?.firstName ?? ''" readonly />
      </label>
      <label>Nom
        <input pInputText [value]="identity?.lastName ?? ''" readonly />
      </label>
      <label>Email
        <input pInputText [value]="identity?.email ?? ''" readonly />
      </label>
      <label>Matricule <span class="req">*</span>
        <input pInputText formControlName="employeeNumber" placeholder="Ex. CAB-XXXXXXXX" [attr.maxlength]="employeeNumberMaxLength" />
      </label>
      <label>Date d'embauche <span class="req">*</span>
        <p-datepicker formControlName="hireDate" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" styleClass="w-full" />
      </label>

      <h3 class="section-title full">Contrat</h3>
      <label>Type <span class="req">*</span>
        <p-select formControlName="contractType" [options]="contractTypeOptions" optionLabel="label" optionValue="value" appendTo="body" styleClass="w-full" />
      </label>
      <label>Régime social <span class="req">*</span>
        <p-select formControlName="contractRegime" [options]="regimeOptions" optionLabel="label" optionValue="value" appendTo="body" styleClass="w-full" />
      </label>
      <label>Durée hebdomadaire <span class="req">*</span>
        <p-select formControlName="weeklyRegime" [options]="weeklyRegimeOptions" optionLabel="label" optionValue="value" appendTo="body" styleClass="w-full" />
      </label>
      <label>Date début <span class="req">*</span>
        <p-datepicker formControlName="contractStartDate" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" styleClass="w-full" />
      </label>
      <label>Date fin
        <p-datepicker formControlName="contractEndDate" dateFormat="dd/mm/yy" [showIcon]="true" appendTo="body" styleClass="w-full" />
      </label>
      <label>Salaire de base (TND) <span class="req">*</span>
        <p-inputNumber formControlName="baseSalary" [minFractionDigits]="3" [maxFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
      </label>
      <label>Taux accident travail (%) <span class="req">*</span>
        <p-inputNumber formControlName="workAccidentRate" [min]="0" [max]="100" styleClass="w-full" />
      </label>
      <label class="full">Intitulé poste
        <input pInputText formControlName="jobTitle" placeholder="Collaborateur cabinet" />
      </label>
    </form>
  `,
  styles: [`
    .payroll-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: .9rem 1rem;
      max-width: 820px;
    }
    .payroll-grid label { display: flex; flex-direction: column; gap: .35rem; font-size: .875rem; }
    .full { grid-column: 1 / -1; }
    .section-title { margin: .25rem 0 0; font-size: 1rem; font-weight: 600; }
    .req { color: var(--color-danger-600, #dc2626); }
    @media (max-width: 700px) {
      .payroll-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class FirmCollaboratorPayrollOnboardingComponent implements OnChanges {
  private readonly fb = inject(FormBuilder);

  @Input() identity: CollaboratorIdentitySnapshot | null = null;
  @Input() defaultBaseSalary = 1500;
  @Input() defaultWorkAccidentRate = 0.4;

  /** Length of the payroll `Employees.EmployeeNumber` column. */
  readonly employeeNumberMaxLength = 50;
  readonly contractTypeOptions = CONTRACT_TYPE_OPTIONS;
  readonly regimeOptions = SOCIAL_REGIME_OPTIONS;
  readonly weeklyRegimeOptions = WEEKLY_REGIME_OPTIONS;

  readonly form = this.fb.nonNullable.group({
    employeeNumber: ['', [Validators.required, Validators.maxLength(this.employeeNumberMaxLength)]],
    hireDate: [new Date(), Validators.required],
    contractType: ['Cdi', Validators.required],
    contractRegime: ['Rsna', Validators.required],
    weeklyRegime: ['FortyEightHours', Validators.required],
    contractStartDate: [new Date(), Validators.required],
    contractEndDate: [null as Date | null],
    baseSalary: [0, [Validators.required, Validators.min(0.001)]],
    workAccidentRate: [0.4, [Validators.required, Validators.min(0), Validators.max(100)]],
    jobTitle: ['Collaborateur cabinet']
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['defaultBaseSalary'] || changes['defaultWorkAccidentRate']) {
      this.form.patchValue({
        baseSalary: this.defaultBaseSalary > 0 ? this.defaultBaseSalary : 1500,
        workAccidentRate: this.defaultWorkAccidentRate > 0 ? this.defaultWorkAccidentRate : 0.4
      }, { emitEvent: false });
    }
  }

  markAllAsTouched(): void {
    this.form.markAllAsTouched();
  }

  buildPayload(): CollaboratorPayrollOnboardingPayload | null {
    if (this.form.invalid) return null;
    const raw = this.form.getRawValue();
    if (raw.contractType === 'Cdd' && !raw.contractEndDate) return null;

    return {
      employeeNumber: raw.employeeNumber.trim(),
      hireDate: toIsoDate(raw.hireDate),
      contract: {
        type: raw.contractType,
        regime: raw.contractRegime,
        weeklyRegime: raw.weeklyRegime,
        startDate: toIsoDate(raw.contractStartDate),
        endDate: raw.contractEndDate ? toIsoDate(raw.contractEndDate) : undefined,
        baseSalary: raw.baseSalary,
        workAccidentRate: raw.workAccidentRate,
        jobTitle: raw.jobTitle?.trim() || 'Collaborateur cabinet'
      }
    };
  }
}
