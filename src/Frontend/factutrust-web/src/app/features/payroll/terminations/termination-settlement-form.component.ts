/// <reference types="@angular/localize" />
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { Textarea } from 'primeng/textarea';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { EmployeeService, EmployeeListItem } from '@core/services/employee.service';
import { PayrollService, TerminationSettlementPreview } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { PayrollAmountPipe } from '../shared';

const TERMINATION_REASONS = [
  { label: 'Licenciement', value: 'Dismissal' },
  { label: 'Démission', value: 'Resignation' },
  { label: 'Retraite', value: 'Retirement' },
  { label: 'Rupture conventionnelle', value: 'MutualAgreement' },
  { label: 'Faute grave', value: 'GrossMisconduct' },
  { label: 'Fin de CDD', value: 'EndOfCdd' },
  { label: 'Fin de SIVP', value: 'EndOfSivp' },
  { label: 'Décès', value: 'Death' }
];

function toIsoDate(value: Date | null | undefined): string {
  if (!value) return '';
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Component({
  selector: 'app-termination-settlement-form',
  standalone: true,
  imports: [
    CommonModule, FormsModule, SelectModule, DatePickerModule, InputNumberModule, Textarea,
    PageHeaderComponent, ButtonComponent, FormSectionComponent, PayrollAmountPipe
  ],
  template: `
    <app-page-header title="Solde de tout compte" i18n-title="Solde de tout compte" subtitle="Calcul et enregistrement des indemnités de rupture.">
      <app-button variant="outline" (click)="back()" i18n="@@payroll.terminations.retour.e5befb1f">Retour</app-button>
      <app-button variant="outline" icon="pi-calculator" [disabled]="!employeeId" (click)="preview()" i18n="@@payroll.terminations.calculer.29705857">Calculer</app-button>
      <app-button variant="primary" icon="pi-save" [disabled]="!previewData()" (click)="save(false)" i18n="@@payroll.terminations.enregistrer.f7c8bcd8">Enregistrer</app-button>
      <app-button variant="primary" icon="pi-check" [disabled]="!previewData()" (click)="save(true)" i18n="@@payroll.terminations.enregistrer.et.approuver.c70c70df">Enregistrer et approuver</app-button>
    </app-page-header>

    <app-form-section title="Informations" i18n-title="Informations" icon="pi-user" [number]="1">
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.terminations.salarie.27f97915">Salarié</label>
          <p-select [options]="employees()" optionLabel="fullName" optionValue="id" [(ngModel)]="employeeId" [filter]="true" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.terminations.date.de.sortie.a963425d">Date de sortie</label>
          <p-datepicker [(ngModel)]="terminationDate" dateFormat="dd/mm/yy" [showIcon]="true" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.terminations.motif.2a198f47">Motif</label>
          <p-select [options]="reasonOptions" optionLabel="label" optionValue="value" [(ngModel)]="reason" styleClass="w-full" />
        </div>
      </div>
    </app-form-section>

    @if (previewData(); as p) {
      <app-form-section title="Prévisualisation (art. 22bis CDT)" i18n-title="Prévisualisation (art. 22bis CDT)" icon="pi-calculator" [number]="2">
        <dl class="payroll-detail-grid">
          <dt i18n="@@payroll.terminations.anciennete.166e0461">Ancienneté</dt><dd>{{ p.seniorityMonths }} mois ({{ p.indemnityDays }} jours)</dd>
          <dt i18n="@@payroll.terminations.salaire.de.reference.6998cec5">Salaire de référence</dt><dd>{{ p.grossMonthlyReference | payrollAmount }}</dd>
          <dt i18n="@@payroll.terminations.indemnite.legale.54c7c286">Indemnité légale</dt><dd>{{ p.legalIndemnityAmount | payrollAmount }}</dd>
        </dl>
        <div class="payroll-form-row mt-3">
          <div class="payroll-form-group">
            <label i18n="@@payroll.terminations.indemnite.legale.ajustee.878b2302">Indemnité légale (ajustée)</label>
            <p-inputNumber [(ngModel)]="legalIndemnity" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
          </div>
          <div class="payroll-form-group">
            <label i18n="@@payroll.terminations.indemnite.de.preavis.8c4bdc1d">Indemnité de préavis</label>
            <p-inputNumber [(ngModel)]="noticeIndemnity" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
          </div>
          <div class="payroll-form-group">
            <label i18n="@@payroll.terminations.conges.non.consommes.1b9fed81">Congés non consommés</label>
            <p-inputNumber [(ngModel)]="unusedLeave" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
          </div>
          <div class="payroll-form-group">
            <label i18n="@@payroll.terminations.autres.indemnites.d87ca5d2">Autres indemnités</label>
            <p-inputNumber [(ngModel)]="otherIndemnity" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
          </div>
        </div>
        <div class="payroll-form-group mt-2">
          <label i18n="@@payroll.terminations.notes.70440046">Notes</label>
          <textarea pTextarea [(ngModel)]="notes" rows="3" class="w-full"></textarea>
        </div>
      </app-form-section>
    }
  `
})
export class TerminationSettlementFormComponent implements OnInit {
  private readonly payroll = inject(PayrollService);
  private readonly employeesApi = inject(EmployeeService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly reasonOptions = TERMINATION_REASONS;
  readonly employees = signal<EmployeeListItem[]>([]);
  readonly previewData = signal<TerminationSettlementPreview | null>(null);

  employeeId = '';
  terminationDate: Date | null = new Date();
  reason = 'Dismissal';
  legalIndemnity?: number;
  noticeIndemnity = 0;
  unusedLeave = 0;
  otherIndemnity = 0;
  notes = '';

  ngOnInit(): void {
    this.employeesApi.list(undefined, true, 1, 500).subscribe(res => this.employees.set(res.data?.items ?? []));
  }

  preview(): void {
    const date = toIsoDate(this.terminationDate);
    if (!this.employeeId || !date) return;
    this.payroll.previewTerminationSettlement(this.employeeId, date, this.reason).subscribe({
      next: res => {
        this.previewData.set(res.data ?? null);
        if (res.data) this.legalIndemnity = res.data.legalIndemnityAmount;
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@termination-settlement-form.component.summary.Solde de rup:Solde de rupture`, detail: err?.error?.message ?? $localize`:@@ui.tern.calcul.impossible.4c6059:Calcul impossible.` })
    });
  }

  save(approve: boolean): void {
    const date = toIsoDate(this.terminationDate);
    if (!this.employeeId || !date) return;
    const d = new Date(date);
    this.payroll.upsertTerminationSettlement({
      employeeId: this.employeeId,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      terminationDate: date,
      reason: this.reason,
      legalIndemnityAmount: this.legalIndemnity,
      noticeIndemnityAmount: this.noticeIndemnity,
      unusedLeaveAmount: this.unusedLeave,
      otherIndemnityAmount: this.otherIndemnity,
      notes: this.notes || undefined,
      approve
    }).subscribe({
      next: () => { this.toast.add({ severity: 'success', summary: $localize`:@@termination-settlement-form.component.summary.Solde de rup:Solde de rupture`, detail: $localize`:@@termination-settlement-form.component.detail.Solde_enregistr_:Solde enregistré.` }); this.router.navigate(['/payroll/terminations']); },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@termination-settlement-form.component.summary.Solde de rup:Solde de rupture`, detail: err?.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.` })
    });
  }

  back(): void { this.router.navigate(['/payroll/terminations']); }
}
