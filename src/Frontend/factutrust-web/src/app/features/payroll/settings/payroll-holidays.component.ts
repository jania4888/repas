/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { InputSwitchModule } from 'primeng/inputswitch';
import { TagModule } from 'primeng/tag';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import {
  PayrollService,
  PayrollPublicHoliday,
  UpsertPayrollPublicHolidayRequest
} from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';

const KIND_OPTIONS = [
  { label: $localize`:@@payroll.payroll-holidays.ts.fixe.95d72643:Fixe`, value: 'Fixed' },
  { label: $localize`:@@payroll.payroll-holidays.ts.islamique.d167a27e:Islamique`, value: 'Islamic' }
];

function toIsoDate(value: Date | null | undefined): string {
  if (!value) return '';
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

@Component({
  selector: 'app-payroll-holidays',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    FormsModule,
    TableModule,
    DialogModule,
    SelectModule,
    DatePickerModule,
    InputTextModule,
    InputSwitchModule,
    TagModule,
    ButtonComponent,
    PageHeaderComponent
  ],
  template: `
    <app-page-header
      title="Jours fériés" i18n-title="@@payroll.settings.jours.feries.6ba43434"
      subtitle="Calendrier des fêtes légales tunisiennes pour le décompte des jours ouvrables." i18n-subtitle="@@payroll.settings.calendrier.des.fetes.legales.tunisiennes.7f9dcb75" />

    <div class="payroll-toolbar mb-3">
      <label for="holidayYear" i18n="@@payroll.settings.exercice.e171e2b0">Exercice</label>
      <input id="holidayYear" type="number" class="p-inputtext w-8rem" [(ngModel)]="year" (ngModelChange)="load()" min="2000" max="2100" />
      <app-button variant="outline" icon="pi-refresh" iconPos="left" (click)="load()" i18n="@@payroll.settings.actualiser.9d3b2a7d">Actualiser</app-button>
      <app-button variant="outline" icon="pi-database" iconPos="left" (click)="seedDefaults()" i18n="@@payroll.settings.amorcer.2024.2028.f4a9affc">Amorcer 2024–2028</app-button>
      <app-button variant="primary" icon="pi-plus" iconPos="left" (click)="openDialog()" i18n="@@payroll.settings.nouveau.jour.ferie.a4e4781c">Nouveau jour férié</app-button>
    </div>

    <p-table [value]="holidays()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th i18n="@@payroll.settings.date.eb9a4bc1">Date</th>
          <th i18n="@@payroll.settings.libelle.f5485bba">Libellé</th>
          <th i18n="@@payroll.settings.type.3deb7456">Type</th>
          <th i18n="@@payroll.settings.remunere.6447ac33">Rémunéré</th>
          <th i18n="@@payroll.settings.estime.5dafc637">Estimé</th>
          <th i18n="@@payroll.settings.reference.f8130bb0">Référence</th>
          <th></th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-h>
        <tr>
          <td>{{ h.date | date:'dd/MM/yyyy' }}</td>
          <td>{{ h.label }}</td>
          <td>
            <p-tag [value]="(h.kindDisplay | backendLabel) || h.kind" [severity]="h.kind === 'Islamic' ? 'warn' : 'info'" />
          </td>
          <td>
            <p-tag [value]="h.isPaid ? loc_ui_tern_oui_eaa02f : loc_ui_tern_non_a72199" [severity]="h.isPaid ? 'success' : 'secondary'" />
          </td>
          <td>
            @if (h.isEstimated) {
              <p-tag value="Estimé" severity="warn" />
            }
          </td>
          <td class="text-muted">{{ h.decreeReference || '—' }}</td>
          <td class="actions">
            <button type="button" class="p-button p-button-text p-button-sm" (click)="editHoliday(h)" i18n="@@payroll.settings.modifier.f260e757">Modifier</button>
            <button type="button" class="p-button p-button-text p-button-danger p-button-sm" (click)="confirmDelete(h)" i18n="@@payroll.settings.supprimer.1acfc1c7">Supprimer</button>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td colspan="7" i18n="@@payroll.settings.aucun.jour.ferie.pour.cet.exercice.utilisez.amor.4bc9fd90">Aucun jour férié pour cet exercice. Utilisez « Amorcer 2024–2028 » pour charger le calendrier tunisien.</td></tr>
      </ng-template>
    </p-table>

    <p-dialog [header]="editingId ? loc_ui_tern_modifier_le_jour_ferie_f18a5f : loc_ui_tern_nouveau_jour_ferie_a4e478" [(visible)]="dialogVisible" [modal]="true" [style]="{ width: '560px' }">
      <div class="payroll-form-row">
        <div class="payroll-form-group">
          <label i18n="@@payroll.settings.date.eb9a4bc1">Date</label>
          <p-datepicker [(ngModel)]="formDate" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
        </div>
        <div class="payroll-form-group">
          <label i18n="@@payroll.settings.type.3deb7456">Type</label>
          <p-select [options]="kindOptions" optionLabel="label" optionValue="value" [(ngModel)]="formKind" appendTo="body" styleClass="w-full" />
        </div>
      </div>
      <div class="payroll-form-group">
        <label i18n="@@payroll.settings.libelle.f5485bba">Libellé</label>
        <input pInputText [(ngModel)]="formLabel" class="w-full" maxlength="200" />
      </div>
      <div class="payroll-form-row">
        <div class="payroll-form-group switch-row">
          <label for="holidayPaid" i18n="@@payroll.settings.remunere.6447ac33">Rémunéré</label>
          <p-inputSwitch inputId="holidayPaid" [(ngModel)]="formIsPaid" />
        </div>
        <div class="payroll-form-group switch-row">
          <label for="holidayEstimated" i18n="@@payroll.settings.date.estimee.f9532d05">Date estimée</label>
          <p-inputSwitch inputId="holidayEstimated" [(ngModel)]="formIsEstimated" />
        </div>
      </div>
      <div class="payroll-form-group">
        <label i18n="@@payroll.settings.reference.decret.note.a36be637">Référence décret / note</label>
        <input pInputText [(ngModel)]="formDecreeReference" class="w-full" maxlength="500" />
      </div>
      <div class="form-actions mt-3">
        <app-button type="button" variant="outline" (click)="dialogVisible = false" i18n="@@payroll.settings.annuler.49ba3292">Annuler</app-button>
        <app-button type="button" variant="primary" icon="pi-check" iconPos="left" (click)="save()" i18n="@@payroll.settings.enregistrer.f7c8bcd8">Enregistrer</app-button>
      </div>
    </p-dialog>
  `
})
export class PayrollHolidaysComponent implements OnInit {
  readonly loc_ui_tern_oui_eaa02f = $localize`:@@ui.tern.oui.eaa02f:Oui`;
  readonly loc_ui_tern_non_a72199 = $localize`:@@ui.tern.non.a72199:Non`;
  readonly loc_ui_tern_modifier_le_jour_ferie_f18a5f = $localize`:@@ui.tern.modifier.le.jour.ferie.f18a5f:Modifier le jour férié`;
  readonly loc_ui_tern_nouveau_jour_ferie_a4e478 = $localize`:@@ui.tern.nouveau.jour.ferie.a4e478:Nouveau jour férié`;
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  readonly holidays = signal<PayrollPublicHoliday[]>([]);
  readonly kindOptions = KIND_OPTIONS;

  year = new Date().getFullYear();
  dialogVisible = false;
  editingId: string | null = null;
  formDate: Date | null = null;
  formLabel = '';
  formKind: 'Fixed' | 'Islamic' = 'Fixed';
  formIsPaid = true;
  formIsEstimated = false;
  formDecreeReference = '';

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.payroll.listPublicHolidays(this.year).subscribe({
      next: res => this.holidays.set(res.data ?? []),
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@payroll-holidays.component.summary.Jours fériés:Jours fériés`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.chargement.impossible.ce4b23:Chargement impossible.`
      })
    });
  }

  seedDefaults(): void {
    this.confirmation.confirm({
      message: $localize`:@@payroll.payroll-holidays.ts.charger.les.jours.feries.tunisiens.fixes.9bb79370:Charger les jours fériés tunisiens (fixes + islamiques estimés) pour 2024 à 2028 ? Les dates déjà présentes seront conservées.`,
      header: $localize`:@@payroll.payroll-holidays.ts.amorcage.calendrier.d2294100:Amorçage calendrier`,
      accept: () => {
        this.payroll.seedPublicHolidays([2024, 2025, 2026, 2027, 2028], false).subscribe({
          next: res => {
            this.toast.add({
              severity: 'success',
              summary: $localize`:@@payroll-holidays.component.summary.Amorçage:Amorçage`,
              detail: res.message ?? $localize`:@@ui.tern.ph.jour.s.ajoute.s.6d2db9:${res.data?.insertedCount ?? 0}:p0: jour(s) ajouté(s).`
            });
            this.load();
          },
          error: err => this.toast.add({
            severity: 'error',
            summary: $localize`:@@payroll-holidays.component.summary.Amorçage:Amorçage`,
            detail: err?.error?.message ?? $localize`:@@ui.tern.amorcage.impossible.d0bc7f:Amorçage impossible.`
          })
        });
      }
    });
  }

  openDialog(): void {
    this.editingId = null;
    this.formDate = new Date(this.year, 0, 1);
    this.formLabel = '';
    this.formKind = 'Fixed';
    this.formIsPaid = true;
    this.formIsEstimated = false;
    this.formDecreeReference = '';
    this.dialogVisible = true;
  }

  editHoliday(h: PayrollPublicHoliday): void {
    this.editingId = h.id;
    this.formDate = parseDate(h.date.split('T')[0]);
    this.formLabel = h.label;
    this.formKind = h.kind;
    this.formIsPaid = h.isPaid;
    this.formIsEstimated = h.isEstimated;
    this.formDecreeReference = h.decreeReference ?? '';
    this.dialogVisible = true;
  }

  save(): void {
    if (!this.formDate || !this.formLabel.trim()) {
      this.toast.add({ severity: 'warn', summary: $localize`:@@payroll-holidays.component.summary.Jour férié:Jour férié`, detail: $localize`:@@payroll-holidays.component.detail.Date_et_libell_:Date et libellé sont obligatoires.` });
      return;
    }

    const body: UpsertPayrollPublicHolidayRequest = {
      year: this.formDate.getFullYear(),
      date: toIsoDate(this.formDate),
      label: this.formLabel.trim(),
      kind: this.formKind,
      isPaid: this.formIsPaid,
      isEstimated: this.formIsEstimated,
      decreeReference: this.formDecreeReference.trim() || undefined
    };

    const req = this.editingId
      ? this.payroll.updatePublicHoliday(this.editingId, body)
      : this.payroll.createPublicHoliday(body);

    req.subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: $localize`:@@payroll-holidays.component.summary.Jour férié:Jour férié`, detail: $localize`:@@payroll-holidays.component.detail.Enregistr_:Enregistré.` });
        this.dialogVisible = false;
        this.year = body.year;
        this.load();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: $localize`:@@payroll-holidays.component.summary.Jour férié:Jour férié`,
        detail: err?.error?.message ?? $localize`:@@ui.tern.enregistrement.impossible.206044:Enregistrement impossible.`
      })
    });
  }

  confirmDelete(h: PayrollPublicHoliday): void {
    const dateLabel = h.date ? h.date.split('T')[0] : '';
    this.confirmation.confirm({
      message: $localize`:@@payroll.payroll-holidays.ts.supprimer.label.datelabel.97afe02b:Supprimer « ${h.label}:label: » (${dateLabel}:dateLabel:) ?`,
      header: $localize`:@@payroll.payroll-holidays.ts.suppression.c3b592c0:Suppression`,
      accept: () => {
        this.payroll.deletePublicHoliday(h.id).subscribe({
          next: () => {
            this.toast.add({ severity: 'success', summary: $localize`:@@payroll-holidays.component.summary.Jour férié:Jour férié`, detail: $localize`:@@payroll-holidays.component.detail.Supprimé.:Supprimé.` });
            this.load();
          },
          error: err => this.toast.add({
            severity: 'error',
            summary: $localize`:@@payroll-holidays.component.summary.Jour férié:Jour férié`,
            detail: err?.error?.message ?? $localize`:@@ui.tern.suppression.impossible.0dffe4:Suppression impossible.`
          })
        });
      }
    });
  }
}
