/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PayrollService,
  EmployeeGarnishment,
  UpsertEmployeeGarnishmentRequest
} from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PayrollSectionComponent, PayrollAmountPipe } from '../shared';

function toIsoDate(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const GARNISHMENT_TYPE_OPTIONS = [
  { label: $localize`:@@payroll.employee-garnishments-tab.ts.saisie.sur.salaire.199fc266:Saisie sur salaire`, value: 'Garnishment' },
  { label: $localize`:@@payroll.employee-garnishments-tab.ts.pension.alimentaire.bcdd775d:Pension alimentaire`, value: 'Alimony' }
];

const GARNISHMENT_KIND_OPTIONS = [
  { label: $localize`:@@payroll.employee-garnishments-tab.ts.montant.fixe.b4a2ce45:Montant fixe`, value: 'FixedAmount' },
  { label: $localize`:@@payroll.employee-garnishments-tab.ts.pourcentage.du.net.15ab28ad:Pourcentage du net`, value: 'PercentOfNet' }
];

@Component({
  selector: 'app-employee-garnishments-tab',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    FormsModule,
    TableModule,
    TagModule,
    DialogModule,
    SelectModule,
    DatePickerModule,
    InputNumberModule,
    InputTextModule,
    ButtonComponent,
    PayrollSectionComponent,
    PayrollAmountPipe
  ],
  template: `
    <app-payroll-section
      title="Saisies sur salaire" i18n-title="@@payroll.employees.saisies.sur.salaire.3e372a38"
      subtitle="Retenues priorisées selon le barème légal et le net disponible." i18n-subtitle="@@payroll.employees.retenues.priorisees.selon.le.bareme.lega.37c70bcf"
      icon="pi-exclamation-triangle">
      @if (!readOnly) {
        <div class="payroll-toolbar mb-3">
          <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()" i18n="@@payroll.employees.nouvelle.saisie.ade08a49">Nouvelle saisie</app-button>
        </div>
      }

      <p-table [value]="items()" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@payroll.employees.type.3deb7456">Type</th>
            <th i18n="@@payroll.employees.reference.f8130bb0">Référence</th>
            <th i18n="@@payroll.employees.beneficiaire.7e8ba7ff">Bénéficiaire</th>
            <th i18n="@@payroll.employees.mode.a7b93d21">Mode</th>
            <th class="text-right" i18n="@@payroll.employees.montant.du.53e5e68c">Montant dû</th>
            <th class="text-right" i18n="@@payroll.employees.deja.retenu.92afdbd5">Déjà retenu</th>
            <th i18n="@@payroll.employees.statut.659499f3">Statut</th>
            @if (!readOnly) { <th></th> }
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-g>
          <tr>
            <td>{{ (g.typeDisplay | backendLabel) || g.type }}</td>
            <td>{{ g.reference }}</td>
            <td>{{ g.beneficiaryName }}</td>
            <td>{{ amountLabel(g) }}</td>
            <td class="text-right">{{ g.totalAmountDue != null ? (g.totalAmountDue | payrollAmount) : '—' }}</td>
            <td class="text-right">{{ (g.totalApplied ?? 0) | payrollAmount }}</td>
            <td>
              <p-tag [value]="(g.statusDisplay | backendLabel) || g.status" [severity]="garnishmentStatusSeverity(g.status)" />
            </td>
            @if (!readOnly) {
              <td class="actions">
                @if (g.status === 'Active') {
                  <button type="button" class="p-button p-button-text p-button-sm" (click)="editGarnishment(g)" i18n="@@payroll.employees.modifier.f260e757">Modifier</button>
                  <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmCancel(g)" i18n="@@payroll.employees.annuler.49ba3292">Annuler</button>
                }
              </td>
            }
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr><td [attr.colspan]="readOnly ? 7 : 8" i18n="@@payroll.employees.aucune.saisie.enregistree.fbac08ea">Aucune saisie enregistrée.</td></tr>
        </ng-template>
      </p-table>
    </app-payroll-section>

    <p-dialog [header]="editingId ? loc_ui_tern_modifier_la_saisie_489cf6 : loc_ui_tern_nouvelle_saisie_ade08a" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '560px' }">
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.type.3deb7456">Type</label>
          <p-select [options]="typeOptions" optionLabel="label" optionValue="value" [(ngModel)]="formType" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.priorite.eede91d2">Priorité</label>
          <p-inputNumber [(ngModel)]="formPriority" [min]="1" styleClass="w-full" />
        </div>
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.reference.f8130bb0">Référence</label>
          <input pInputText [(ngModel)]="formReference" class="w-full" maxlength="100" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.date.du.titre.921f17ec">Date du titre</label>
          <p-datepicker [(ngModel)]="formIssuedAt" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
      </div>
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.beneficiaire.7e8ba7ff">Bénéficiaire</label>
        <input pInputText [(ngModel)]="formBeneficiaryName" class="w-full" maxlength="200" />
      </div>
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.rib.beneficiaire.optionnel.fddc72d3">RIB bénéficiaire (optionnel)</label>
        <input pInputText [(ngModel)]="formBeneficiaryRib" class="w-full" maxlength="20" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.mode.de.calcul.803843c7">Mode de calcul</label>
          <p-select [options]="kindOptions" optionLabel="label" optionValue="value" [(ngModel)]="formKind" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          @if (formKind === 'FixedAmount') {
            <label i18n="@@payroll.employees.montant.fixe.tnd.1ef73ffc">Montant fixe (TND)</label>
            <p-inputNumber [(ngModel)]="formFixedAmount" [min]="0.001" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
          } @else {
            <label i18n="@@payroll.employees.pourcentage.du.net.e873b620">Pourcentage du net (%)</label>
            <p-inputNumber [(ngModel)]="formPercentOfNet" [min]="0.01" [max]="100" [minFractionDigits]="2" [locale]="'fr-TN'" styleClass="w-full" />
          }
        </div>
      </div>
      <div class="payroll-form-group mb-2">
        <label i18n="@@payroll.employees.montant.total.du.optionnel.cbd9acb0">Montant total dû (optionnel)</label>
        <p-inputNumber [(ngModel)]="formTotalAmountDue" [minFractionDigits]="3" [locale]="'fr-TN'" styleClass="w-full" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.date.de.debut.706438ab">Date de début</label>
          <p-datepicker [(ngModel)]="formStartDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.employees.date.de.fin.716a6d8d">Date de fin</label>
          <p-datepicker [(ngModel)]="formEndDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="dialogVisible = false" i18n="@@payroll.employees.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" (click)="save()" i18n="@@payroll.employees.enregistrer.f7c8bcd8">Enregistrer</app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .mb-2 { margin-bottom: var(--spacing-2); }
    .mb-3 { margin-bottom: var(--spacing-4); }
    .w-full { width: 100%; }
    .text-right { text-align: end; }
    .actions { white-space: nowrap; }
  `]
})
export class EmployeeGarnishmentsTabComponent implements OnInit {
  readonly loc_ui_tern_modifier_la_saisie_489cf6 = $localize`:@@ui.tern.modifier.la.saisie.489cf6:Modifier la saisie`;
  readonly loc_ui_tern_nouvelle_saisie_ade08a = $localize`:@@ui.tern.nouvelle.saisie.ade08a:Nouvelle saisie`;
  @Input({ required: true }) employeeId!: string;
  @Input() readOnly = false;

  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  readonly typeOptions = GARNISHMENT_TYPE_OPTIONS;
  readonly kindOptions = GARNISHMENT_KIND_OPTIONS;
  items = signal<EmployeeGarnishment[]>([]);
  dialogVisible = false;
  editingId: string | null = null;
  formType = 'Garnishment';
  formReference = '';
  formIssuedAt: Date | null = new Date();
  formBeneficiaryName = '';
  formBeneficiaryRib = '';
  formPriority = 1;
  formKind = 'FixedAmount';
  formFixedAmount = 0;
  formPercentOfNet = 0;
  formTotalAmountDue: number | null = null;
  formStartDate: Date | null = new Date();
  formEndDate: Date | null = null;

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.payroll.listGarnishments(this.employeeId).subscribe({
      next: res => this.items.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@employee-garnishments-tab.component.summary.Saisies:Saisies`, detail: $localize`:@@employee-garnishments-tab.component.detail.Chargement_impos:Chargement impossible.` })
    });
  }

  amountLabel(g: EmployeeGarnishment): string {
    if (g.kind === 'PercentOfNet') {
      return $localize`:@@payroll.employee-garnishments-tab.ts.p.du.net.9b7e7292:${g.percentOfNet ?? 0}:p: % du net`;
    }
    return g.fixedAmount != null ? $localize`:@@ui.tern.ph.tnd.mois.553db0:${g.fixedAmount}:p0: TND / mois` : (g.kindDisplay ?? g.kind);
  }

  garnishmentStatusSeverity(status: string): 'success' | 'info' | 'secondary' {
    if (status === 'Completed') return 'success';
    if (status === 'Active') return 'info';
    return 'secondary';
  }

  openDialog(): void {
    if (this.readOnly) return;
    this.editingId = null;
    this.resetForm();
    this.dialogVisible = true;
  }

  editGarnishment(g: EmployeeGarnishment): void {
    if (this.readOnly) return;
    this.editingId = g.id;
    this.formType = g.type;
    this.formReference = g.reference;
    this.formIssuedAt = new Date(g.issuedAt);
    this.formBeneficiaryName = g.beneficiaryName;
    this.formBeneficiaryRib = g.beneficiaryRib ?? '';
    this.formPriority = g.priority;
    this.formKind = g.kind;
    this.formFixedAmount = g.fixedAmount ?? 0;
    this.formPercentOfNet = g.percentOfNet ?? 0;
    this.formTotalAmountDue = g.totalAmountDue ?? null;
    this.formStartDate = new Date(g.startDate);
    this.formEndDate = g.endDate ? new Date(g.endDate) : null;
    this.dialogVisible = true;
  }

  private resetForm(): void {
    this.formType = 'Garnishment';
    this.formReference = '';
    this.formIssuedAt = new Date();
    this.formBeneficiaryName = '';
    this.formBeneficiaryRib = '';
    this.formPriority = 1;
    this.formKind = 'FixedAmount';
    this.formFixedAmount = 0;
    this.formPercentOfNet = 0;
    this.formTotalAmountDue = null;
    this.formStartDate = new Date();
    this.formEndDate = null;
  }

  save(): void {
    if (this.readOnly || !this.formReference.trim() || !this.formBeneficiaryName.trim() || !this.formIssuedAt || !this.formStartDate) return;
    if (this.formKind === 'FixedAmount' && this.formFixedAmount <= 0) return;
    if (this.formKind === 'PercentOfNet' && this.formPercentOfNet <= 0) return;

    const body: UpsertEmployeeGarnishmentRequest = {
      type: this.formType,
      reference: this.formReference.trim(),
      issuedAt: toIsoDate(this.formIssuedAt)!,
      beneficiaryName: this.formBeneficiaryName.trim(),
      beneficiaryRib: this.formBeneficiaryRib.trim() || undefined,
      priority: this.formPriority,
      kind: this.formKind,
      fixedAmount: this.formKind === 'FixedAmount' ? this.formFixedAmount : undefined,
      percentOfNet: this.formKind === 'PercentOfNet' ? this.formPercentOfNet : undefined,
      totalAmountDue: this.formTotalAmountDue ?? undefined,
      startDate: toIsoDate(this.formStartDate)!,
      endDate: toIsoDate(this.formEndDate)
    };

    const req = this.editingId
      ? this.payroll.updateGarnishment(this.employeeId, this.editingId, body)
      : this.payroll.createGarnishment(this.employeeId, body);

    req.subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@employee-garnishments-tab.component.summary.Saisies:Saisies`, detail: $localize`:@@employee-garnishments-tab.component.detail.Enregistr_:Enregistré.` });
        this.dialogVisible = false;
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@employee-garnishments-tab.component.summary.Saisies:Saisies`, detail: err.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.` })
    });
  }

  confirmCancel(g: EmployeeGarnishment): void {
    if (this.readOnly) return;
    this.confirmation.confirm({
      message: $localize`:@@payroll.employee-garnishments-tab.ts.annuler.la.saisie.reference.8035d65e:Annuler la saisie « ${g.reference}:reference: » ?`,
      header: $localize`:@@payroll.employee-garnishments-tab.ts.confirmation.3424edc2:Confirmation`,
      acceptLabel: $localize`:@@employee-garnishments-tab.component.acceptLabel.Annuler_la_saisi:Annuler la saisie`,
      rejectLabel: $localize`:@@employee-garnishments-tab.component.rejectLabel.Fermer:Fermer`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.cancel(g.id)
    });
  }

  private cancel(id: string): void {
    this.payroll.deleteGarnishment(this.employeeId, id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@employee-garnishments-tab.component.summary.Saisies:Saisies`, detail: $localize`:@@employee-garnishments-tab.component.detail.Saisie_annul_e_:Saisie annulée.` });
        this.reload();
      },
      error: err => this.toast.add({ severity: 'error', summary: $localize`:@@employee-garnishments-tab.component.summary.Saisies:Saisies`, detail: err.error?.message ?? $localize`:@@ui.tern.annulation.impossible.814b7d:Annulation impossible.` })
    });
  }
}
