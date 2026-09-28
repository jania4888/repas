/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmployeeService, EmployeeListItem } from '@core/services/employee.service';
import { PayrollService, PayrollOvertimeLine, UpsertOvertimeLineRequest } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { defaultOvertimeRate, overtimeRateOptions, weeklyRegimeDivisor } from '../payroll-options';
import { PayrollSectionComponent, PayrollAmountPipe } from '../shared';

@Component({
  selector: 'app-payroll-overtime-grid',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    FormsModule,
    TableModule,
    TagModule,
    DialogModule,
    SelectModule,
    InputNumberModule,
    ButtonComponent,
    PayrollSectionComponent,
    PayrollAmountPipe
  ],
  template: `
    <app-payroll-section
      title="Éléments variables — Heures supplémentaires" i18n-title="@@payroll.runs.elements.variables.heures.supplementaires.d2df2e32"
      subtitle="Montant = (salaire base ÷ 208 en régime 48 h, ÷ 173,33 en régime 40 h) × heures × taux majoré. Override possible." i18n-subtitle="@@payroll.runs.montant.salaire.base.208.en.regime.48.h.1c8e5c74"
      icon="pi-clock">
      @if (!readOnly) {
        <div class="payroll-toolbar mb-3">
          <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()" i18n="@@payroll.runs.ajouter.une.ligne.ba241fd4">Ajouter une ligne</app-button>
        </div>
      }

      <div class="payroll-table-scroll">
      <p-table [value]="lines()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@payroll.runs.salarie.27f97915">Salarié</th>
            <th class="text-right" i18n="@@payroll.runs.heures.b4448c06">Heures</th>
            <th class="text-right" i18n="@@payroll.runs.taux.18bc95b8">Taux</th>
            <th class="text-right" i18n="@@payroll.runs.calcule.b550f80b">Calculé</th>
            <th class="text-right" i18n="@@payroll.runs.montant.applique.6eaf1229">Montant appliqué</th>
            @if (!readOnly) { <th></th> }
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-line>
          <tr>
            <td>{{ line.employeeName }}</td>
            <td class="text-right">{{ line.hours }}</td>
            <td class="text-right">{{ line.ratePercentDisplay | backendLabel }}</td>
            <td class="text-right">{{ line.computedAmount | payrollAmount }}</td>
            <td class="text-right">
              {{ line.effectiveAmount | payrollAmount }}
              @if (line.isOverridden) {
                <p-tag value="Ajusté manuellement" severity="warn" class="ml-2" />
              }
            </td>
            @if (!readOnly) {
              <td class="actions">
                <button type="button" class="p-button p-button-text p-button-sm" (click)="editLine(line)" i18n="@@payroll.runs.modifier.f260e757">Modifier</button>
                <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(line)" i18n="@@payroll.runs.supprimer.1acfc1c7">Supprimer</button>
              </td>
            }
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td [attr.colspan]="readOnly ? 5 : 6" i18n="@@payroll.runs.aucune.heure.supplementaire.saisie.pour.ce.mois.f6d658f4">Aucune heure supplémentaire saisie pour ce mois.</td></tr>
        </ng-template>
      </p-table>
      </div>
    </app-payroll-section>

    <p-dialog [header]="editingId ? loc_ui_tern_modifier_heures_sup_811294 : loc_ui_tern_nouvelles_heures_sup_a24bc4" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '480px' }">
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.runs.salarie.27f97915">Salarié</label>
        <p-select [options]="employees()" optionLabel="fullName" optionValue="id" [(ngModel)]="formEmployeeId" (ngModelChange)="onEmployeeChange()" appendTo="body" styleClass="w-full" [disabled]="!!editingId" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.runs.heures.b4448c06">Heures</label>
          <p-inputNumber [(ngModel)]="formHours" [min]="0.5" [step]="0.5" [locale]="'fr-TN'" (ngModelChange)="refreshPreview()" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.runs.taux.majore.5cb78527">Taux majoré</label>
          <p-select [options]="rateOptions" optionLabel="label" optionValue="value" [(ngModel)]="formRatePercent" (ngModelChange)="refreshPreview()" appendTo="body" styleClass="w-full" />
        </div>
      </div>
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.runs.montant.override.optionnel.2e151738">Montant override (optionnel)</label>
        <p-inputNumber [(ngModel)]="formOverride" [minFractionDigits]="3" [maxFractionDigits]="3" [locale]="'fr-TN'" (ngModelChange)="refreshPreview()" styleClass="w-full" />
      </div>
      <p class="payroll-info-text" i18n="@@payroll.runs.formule.salaire.base.heures.taux.100.3368a5ee">Formule : (salaire base ÷ {{ divisorLabel }}) × heures × (taux % ÷ 100)</p>
      @if (previewAmount() !== null) {
        <p><ng-container i18n="@@payroll.runs.montant.applique.b4674e8b">Montant appliqué : </ng-container> <strong>{{ previewAmount() | payrollAmount }}</strong></p>
      }
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="dialogVisible = false" i18n="@@payroll.runs.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" (click)="save()" i18n="@@payroll.runs.enregistrer.f7c8bcd8">Enregistrer</app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .mb-2 { margin-bottom: var(--spacing-2); }
    .mb-3 { margin-bottom: var(--spacing-4); }
    .ml-2 { margin-inline-start: var(--spacing-2); }
    .actions { white-space: nowrap; }
    .w-full { width: 100%; }
  `]
})
export class PayrollOvertimeGridComponent implements OnInit {
  readonly loc_ui_tern_modifier_heures_sup_811294 = $localize`:@@ui.tern.modifier.heures.sup.811294:Modifier heures sup.`;
  readonly loc_ui_tern_nouvelles_heures_sup_a24bc4 = $localize`:@@ui.tern.nouvelles.heures.sup.a24bc4:Nouvelles heures sup.`;
  @Input({ required: true }) year!: number;
  @Input({ required: true }) month!: number;
  @Input() readOnly = false;
  @Input() initialLines: PayrollOvertimeLine[] = [];

  private readonly employeesApi = inject(EmployeeService);
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  lines = signal<PayrollOvertimeLine[]>([]);
  employees = signal<EmployeeListItem[]>([]);
  dialogVisible = false;
  editingId: string | null = null;
  formEmployeeId: string | null = null;
  formHours = 1;
  formRatePercent = 175;
  formOverride: number | null = null;
  previewAmount = signal<number | null>(null);
  private extendedRatesEnabled = false;

  /** Régime hebdomadaire du contrat actif du salarié sélectionné. */
  get selectedWeeklyRegime(): string | undefined {
    return this.employees().find(e => e.id === this.formEmployeeId)?.currentWeeklyRegime;
  }

  get divisorLabel(): string {
    return weeklyRegimeDivisor(this.selectedWeeklyRegime);
  }

  get rateOptions(): { value: number; label: string }[] {
    return overtimeRateOptions(this.selectedWeeklyRegime, this.extendedRatesEnabled);
  }

  ngOnInit(): void {
    this.lines.set(this.initialLines ?? []);
    this.loadEmployees();
    this.loadExtendedRatesOption();
  }

  reload(): void {
    this.payroll.listOvertime(this.year, this.month).subscribe({
      next: res => this.lines.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@payroll-overtime-grid.component.summary.Heures sup.:Heures sup.`, detail: $localize`:@@payroll-overtime-grid.component.detail.Chargement_impos:Chargement impossible.` })
    });
  }

  private loadEmployees(): void {
    this.employeesApi.list(undefined, true, 1, 500).subscribe({
      next: res => this.employees.set(res.data?.items ?? []),
      error: () => {}
    });
  }

  private loadExtendedRatesOption(): void {
    this.payroll.getParameters(this.year).subscribe({
      next: res => (this.extendedRatesEnabled = res.data?.enableExtendedOvertimeRates ?? false),
      error: () => {}
    });
  }

  openDialog(): void {
    if (this.readOnly) return;
    this.editingId = null;
    this.formEmployeeId = null;
    this.formHours = 1;
    this.formRatePercent = defaultOvertimeRate(undefined);
    this.formOverride = null;
    this.previewAmount.set(null);
    this.dialogVisible = true;
  }

  onEmployeeChange(): void {
    // Propose le taux légal du régime du salarié ; en édition, le taux historique est conservé.
    if (!this.editingId)
      this.formRatePercent = defaultOvertimeRate(this.selectedWeeklyRegime);
    this.refreshPreview();
  }

  editLine(line: PayrollOvertimeLine): void {
    if (this.readOnly) return;
    this.editingId = line.id;
    this.formEmployeeId = line.employeeId;
    this.formHours = line.hours;
    this.formRatePercent = line.ratePercent;
    this.formOverride = line.overrideAmount ?? null;
    this.previewAmount.set(line.effectiveAmount);
    this.dialogVisible = true;
  }

  refreshPreview(): void {
    const employee = this.employees().find(e => e.id === this.formEmployeeId);
    const baseSalary = employee?.currentBaseSalary ?? 0;
    if (!baseSalary || this.formHours <= 0) {
      this.previewAmount.set(null);
      return;
    }
    this.payroll.previewOvertime({
      baseSalary,
      hours: this.formHours,
      ratePercent: this.formRatePercent,
      overrideAmount: this.formOverride ?? undefined,
      employeeId: this.formEmployeeId ?? undefined
    }).subscribe({
      next: res => this.previewAmount.set(res.data?.effectiveAmount ?? null),
      error: () => this.previewAmount.set(null)
    });
  }

  save(): void {
    if (this.readOnly || !this.formEmployeeId) return;
    const body: UpsertOvertimeLineRequest = {
      employeeId: this.formEmployeeId,
      year: this.year,
      month: this.month,
      hours: this.formHours,
      ratePercent: this.formRatePercent,
      overrideAmount: this.formOverride ?? undefined
    };
    const req = this.editingId
      ? this.payroll.updateOvertime(this.editingId, body)
      : this.payroll.createOvertime(body);

    req.subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@payroll-overtime-grid.component.summary.Heures sup.:Heures sup.`, detail: $localize`:@@payroll-overtime-grid.component.detail.Enregistr_:Enregistré.` });
        this.dialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@payroll-overtime-grid.component.summary.Heures sup.:Heures sup.`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.`
      })
    });
  }

  confirmDelete(line: PayrollOvertimeLine): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: $localize`:@@payroll.payroll-overtime-grid.ts.supprimer.les.heures.sup.de.employeename.be884383:Supprimer les heures sup. de ${line.employeeName}:employeeName: ?`,
      header: $localize`:@@payroll.payroll-overtime-grid.ts.confirmation.3424edc2:Confirmation`,
      acceptLabel: $localize`:@@payroll-overtime-grid.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@payroll-overtime-grid.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.delete(line.id)
    });
  }

  private delete(id: string): void {
    this.payroll.deleteOvertime(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@payroll-overtime-grid.component.summary.Heures sup.:Heures sup.`, detail: $localize`:@@payroll-overtime-grid.component.detail.Ligne_supprim_e_:Ligne supprimée.` });
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@payroll-overtime-grid.component.summary.Heures sup.:Heures sup.`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.suppression.impossible.0dffe4:Suppression impossible.`
      })
    });
  }
}
