import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { FirmGovernanceService, FirmExpenseNote } from '@core/services/firm-governance.service';
import { FirmAssignmentService, FirmClientDossier } from '@core/services/firm-assignment.service';
import { FirmGovernanceActionsService } from '../shared/firm-governance-actions.service';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-firm-expense-notes',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    SelectModule,
    InputNumberModule,
    InputTextModule,
    TagModule,
    PageHeaderComponent,
    EmptyStateComponent
  ],
  template: `
    <app-page-header title="Notes de frais dirigeants" subtitle="Suivi et approbation (normes TN)">
      <button type="button" pButton label="Nouvelle note" icon="pi pi-plus" class="p-button-sm" (click)="openCreate()"></button>
    </app-page-header>

    @if (!loading() && notes().length === 0) {
      <app-empty-state
        icon="pi-receipt"
        title="Aucune note de frais"
        description="Créez une note de frais dirigeant pour un dossier client.">
      </app-empty-state>
    } @else {
      <div class="fc-card">
        <p-table [value]="notes()" [loading]="loading()">
          <ng-template pTemplate="header">
            <tr>
              <th>Période</th>
              <th>Société</th>
              <th>Statut</th>
              <th>Total à rembourser</th>
              <th>Charges mixtes</th>
              <th>Exploitation</th>
              <th>IK</th>
              <th class="fc-actions-col">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-n>
            <tr>
              <td>{{ n.periodMonth }}/{{ n.periodYear }}</td>
              <td>{{ n.companyName }}</td>
              <td><p-tag [value]="n.statusDisplay" [severity]="statusSeverity(n.status)" /></td>
              <td>{{ n.totalToReimburse | number:'1.3-3' }} TND</td>
              <td>{{ n.mixedCharges | number:'1.3-3' }}</td>
              <td>{{ n.operatingExpenses | number:'1.3-3' }}</td>
              <td>{{ n.mileageAllowance | number:'1.3-3' }}</td>
              <td class="fc-actions">
                @if (n.status === 0 || n.status === 3) {
                  <button type="button" pButton icon="pi pi-pencil" class="p-button-text p-button-sm" (click)="openEdit(n)"></button>
                  <button type="button" pButton icon="pi pi-send" class="p-button-text p-button-sm" (click)="submit(n.id)"></button>
                }
                @if (n.status === 1) {
                  <button type="button" pButton icon="pi pi-check" class="p-button-text p-button-sm p-button-success" (click)="approve(n.id)"></button>
                  <button type="button" pButton icon="pi pi-times" class="p-button-text p-button-sm p-button-danger" (click)="reject(n.id)"></button>
                }
                @if (n.status === 2) {
                  <button type="button" pButton icon="pi pi-wallet" class="p-button-text p-button-sm" label="Remboursée" (click)="reimburse(n.id)"></button>
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }

    <p-dialog
      [header]="editingNote() ? 'Modifier la note' : 'Nouvelle note de frais'"
      [(visible)]="dialogVisible"
      [modal]="true"
      [style]="{ width: '520px' }"
      appendTo="body">
      <form [formGroup]="form" class="dialog-form">
        <label>Société
          <p-select
            formControlName="firmClientAssignmentId"
            [options]="clients()"
            optionLabel="companyName"
            optionValue="assignmentId"
            placeholder="Sélectionner un dossier"
            [filter]="true"
            filterBy="companyName"
            appendTo="body" />
        </label>
        <div class="period-row">
          <label>Mois
            <p-select formControlName="periodMonth" [options]="months" optionLabel="label" optionValue="value" appendTo="body" />
          </label>
          <label>Année
            <input pInputText type="number" formControlName="periodYear" min="2020" max="2100" />
          </label>
        </div>
        <label>Total à rembourser (TND)
          <p-inputNumber formControlName="totalToReimburse" mode="decimal" [minFractionDigits]="3" [maxFractionDigits]="3" />
        </label>
        <label>Charges mixtes
          <p-inputNumber formControlName="mixedCharges" mode="decimal" [minFractionDigits]="3" [maxFractionDigits]="3" />
        </label>
        <label>Exploitation
          <p-inputNumber formControlName="operatingExpenses" mode="decimal" [minFractionDigits]="3" [maxFractionDigits]="3" />
        </label>
        <label>Indemnités kilométriques
          <p-inputNumber formControlName="mileageAllowance" mode="decimal" [minFractionDigits]="3" [maxFractionDigits]="3" />
        </label>
        <label>CA ventes
          <p-inputNumber formControlName="salesAmount" mode="decimal" [minFractionDigits]="3" [maxFractionDigits]="3" />
        </label>
        <label>Notes
          <input pInputText formControlName="notes" />
        </label>
      </form>
      <ng-template pTemplate="footer">
        <button type="button" pButton label="Annuler" class="p-button-text" (click)="dialogVisible = false"></button>
        <button type="button" pButton label="Enregistrer" [loading]="saving()" (click)="save()"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    :host { display: block; }
    .fc-card {
      background: var(--color-surface, #fff);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-xl, 16px);
      box-shadow: var(--shadow-soft-sm, 0 1px 2px rgba(15, 23, 42, 0.05));
      padding: var(--spacing-2, 8px);
    }
    .fc-actions-col { width: 1%; white-space: nowrap; }
    .fc-actions { display: flex; gap: 0.25rem; justify-content: flex-end; flex-wrap: wrap; }
    .dialog-form { display: grid; gap: 0.75rem; }
    .dialog-form label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.875rem; }
    .period-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  `]
})
export class FirmExpenseNotesComponent implements OnInit {
  private readonly api = inject(FirmGovernanceService);
  private readonly assignments = inject(FirmAssignmentService);
  private readonly actions = inject(FirmGovernanceActionsService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  notes = signal<FirmExpenseNote[]>([]);
  clients = signal<FirmClientDossier[]>([]);
  loading = signal(true);
  saving = signal(false);
  editingNote = signal<FirmExpenseNote | null>(null);
  dialogVisible = false;

  readonly months = Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1).padStart(2, '0'), value: i + 1 }));

  form = this.fb.group({
    firmClientAssignmentId: ['', Validators.required],
    periodYear: [new Date().getFullYear(), Validators.required],
    periodMonth: [new Date().getMonth() + 1, Validators.required],
    totalToReimburse: [0, Validators.required],
    mixedCharges: [0],
    operatingExpenses: [0],
    mileageAllowance: [0],
    salesAmount: [0],
    notes: ['']
  });

  ngOnInit(): void {
    this.loadClients();
    this.load();
  }

  statusSeverity(status: number): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | undefined {
    switch (status) {
      case 1: return 'warn';
      case 2: return 'success';
      case 3: return 'danger';
      case 4: return 'info';
      default: return 'secondary';
    }
  }

  openCreate(): void {
    this.editingNote.set(null);
    this.form.controls.firmClientAssignmentId.enable();
    this.form.controls.periodYear.enable();
    this.form.controls.periodMonth.enable();
    this.form.reset({
      firmClientAssignmentId: '',
      periodYear: new Date().getFullYear(),
      periodMonth: new Date().getMonth() + 1,
      totalToReimburse: 0,
      mixedCharges: 0,
      operatingExpenses: 0,
      mileageAllowance: 0,
      salesAmount: 0,
      notes: ''
    });
    this.dialogVisible = true;
  }

  openEdit(note: FirmExpenseNote): void {
    this.editingNote.set(note);
    this.form.patchValue({
      firmClientAssignmentId: note.firmClientAssignmentId,
      periodYear: note.periodYear,
      periodMonth: note.periodMonth,
      totalToReimburse: note.totalToReimburse,
      mixedCharges: note.mixedCharges,
      operatingExpenses: note.operatingExpenses,
      mileageAllowance: note.mileageAllowance,
      salesAmount: note.salesAmount,
      notes: note.notes ?? ''
    });
    this.form.controls.firmClientAssignmentId.disable();
    this.form.controls.periodYear.disable();
    this.form.controls.periodMonth.disable();
    this.dialogVisible = true;
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const raw = this.form.getRawValue();
    this.api.upsertExpenseNote({
      firmClientAssignmentId: raw.firmClientAssignmentId!,
      periodYear: raw.periodYear!,
      periodMonth: raw.periodMonth!,
      totalToReimburse: raw.totalToReimburse ?? 0,
      mixedCharges: raw.mixedCharges ?? 0,
      operatingExpenses: raw.operatingExpenses ?? 0,
      mileageAllowance: raw.mileageAllowance ?? 0,
      salesAmount: raw.salesAmount ?? 0,
      notes: raw.notes || undefined
    }).subscribe({
      next: r => {
        this.saving.set(false);
        if (r.success) {
          this.dialogVisible = false;
          this.form.controls.firmClientAssignmentId.enable();
          this.form.controls.periodYear.enable();
          this.form.controls.periodMonth.enable();
          this.toast.add({ severity: 'success', summary: 'Note de frais', detail: 'Enregistrée.' });
          this.load();
        } else {
          this.toast.add({ severity: 'error', summary: 'Erreur', detail: r.message ?? 'Enregistrement impossible.' });
        }
      },
      error: () => {
        this.saving.set(false);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Enregistrement impossible.' });
      }
    });
  }

  async submit(id: string): Promise<void> {
    if (await this.actions.submitExpenseNote(id)) this.load();
  }

  async approve(id: string): Promise<void> {
    if (await this.actions.processExpenseNote(id, true)) this.load();
  }

  async reject(id: string): Promise<void> {
    if (await this.actions.processExpenseNote(id, false)) this.load();
  }

  async reimburse(id: string): Promise<void> {
    if (await this.actions.reimburseExpenseNote(id)) this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api.listExpenseNotes().subscribe({
      next: res => {
        this.notes.set(res.data ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Chargement impossible.' });
      }
    });
  }

  private loadClients(): void {
    this.assignments.getActiveClients().subscribe({
      next: r => { if (r.success) this.clients.set(r.data ?? []); }
    });
  }
}
