import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputSwitchModule } from 'primeng/inputswitch';
import { SelectModule } from 'primeng/select';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PayrollService, AnnualBonusRule, UpsertAnnualBonusRuleRequest } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-annual-bonuses-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TableModule, InputNumberModule, InputTextModule,
    InputSwitchModule, SelectModule, PageHeaderComponent, ButtonComponent
  ],
  template: `
    <app-page-header title="Primes annuelles" i18n-title="Primes annuelles" subtitle="Règles de 13e mois, ancienneté et vacances." />

    <div class="payroll-toolbar mb-3">
      <label i18n="@@payroll.settings.exercice.e171e2b0">Exercice</label>
      <p-inputNumber [(ngModel)]="fiscalYear" (ngModelChange)="load()" [useGrouping]="false" />
      <app-button class="ml-3" variant="primary" (click)="startCreate()" i18n="@@payroll.settings.nouvelle.regle.7087f17c">Nouvelle règle</app-button>
    </div>

    @if (editing()) {
      <div class="payroll-form-row mb-4">
        <div class="payroll-form-group"><label i18n="@@payroll.settings.code.adac6937">Code</label><input pInputText [(ngModel)]="form.code" class="w-full" /></div>
        <div class="payroll-form-group"><label i18n="@@payroll.settings.libelle.f5485bba">Libellé</label><input pInputText [(ngModel)]="form.label" class="w-full" /></div>
        <div class="payroll-form-group"><label i18n="@@payroll.settings.mois.de.versement.d19605e1">Mois de versement</label><p-inputNumber [(ngModel)]="form.paymentMonth" [min]="1" [max]="12" /></div>
        <div class="payroll-form-group"><label i18n="@@payroll.settings.mois.de.base.5e342b5d">Mois de base</label><p-inputNumber [(ngModel)]="form.monthsOfBase" [minFractionDigits]="2" /></div>
        <div class="payroll-form-group"><label i18n="@@payroll.settings.actif.2eb75f84">Actif</label><p-inputSwitch [(ngModel)]="form.isActive" /></div>
        <div class="payroll-form-group flex-end">
          <app-button variant="primary" (click)="saveRule()" i18n="@@payroll.settings.enregistrer.f7c8bcd8">Enregistrer</app-button>
        </div>
      </div>
    }

    <p-table [value]="rules()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr><th i18n="@@payroll.settings.code.adac6937">Code</th><th i18n="@@payroll.settings.libelle.f5485bba">Libellé</th><th i18n="@@payroll.settings.type.3deb7456">Type</th><th i18n="@@payroll.settings.mois.0d304bea">Mois</th><th i18n="@@payroll.settings.formule.1bb7d659">Formule</th><th i18n="@@payroll.settings.actif.2eb75f84">Actif</th><th></th></tr>
      </ng-template>
      <ng-template pTemplate="body" let-row>
        <tr>
          <td>{{ row.code }}</td>
          <td>{{ row.label }}</td>
          <td>{{ row.kindDisplay }}</td>
          <td>{{ row.paymentMonth }}</td>
          <td>{{ row.formulaDisplay }}</td>
          <td>{{ row.isActive ? 'Oui' : 'Non' }}</td>
          <td><button type="button" class="p-button p-button-text" (click)="edit(row)" i18n="@@payroll.settings.modifier.f260e757">Modifier</button></td>
        </tr>
      </ng-template>
    </p-table>
  `
})
export class AnnualBonusesSettingsComponent implements OnInit {
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);

  fiscalYear = new Date().getFullYear();
  readonly rules = signal<AnnualBonusRule[]>([]);
  readonly editing = signal(false);
  editingId: string | null = null;
  form: UpsertAnnualBonusRuleRequest = this.emptyForm();

  ngOnInit(): void { this.load(); }

  load(): void {
    this.payroll.listAnnualBonusRules(this.fiscalYear).subscribe({
      next: res => this.rules.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: 'Primes annuelles', detail: 'Chargement impossible.' })
    });
  }

  startCreate(): void {
    this.editingId = null;
    this.form = this.emptyForm();
    this.editing.set(true);
  }

  edit(row: AnnualBonusRule): void {
    this.editingId = row.id;
    this.form = {
      code: row.code,
      label: row.label,
      kind: row.kind,
      formula: row.formula,
      paymentMonth: row.paymentMonth,
      fixedAmount: row.fixedAmount,
      ratePercent: row.ratePercent,
      monthsOfBase: row.monthsOfBase,
      taxable: row.taxable,
      subjectToCnss: row.subjectToCnss,
      isActive: row.isActive,
      fiscalYear: row.fiscalYear
    };
    this.editing.set(true);
  }

  saveRule(): void {
    const req = { ...this.form, fiscalYear: this.fiscalYear };
    const obs = this.editingId
      ? this.payroll.updateAnnualBonusRule(this.editingId, req)
      : this.payroll.createAnnualBonusRule(req);
    obs.subscribe({
      next: () => { this.toast.add({ severity: 'success', summary: 'Primes annuelles', detail: 'Règle enregistrée.' }); this.editing.set(false); this.load(); },
      error: err => this.toast.add({ severity: 'error', summary: 'Primes annuelles', detail: err?.error?.message ?? 'Erreur.' })
    });
  }

  private emptyForm(): UpsertAnnualBonusRuleRequest {
    return {
      code: '', label: '', kind: 'ThirteenthMonth', formula: 'MonthsOfBase',
      paymentMonth: 12, fixedAmount: 0, ratePercent: 0, monthsOfBase: 1,
      taxable: true, subjectToCnss: true, isActive: true
    };
  }
}
