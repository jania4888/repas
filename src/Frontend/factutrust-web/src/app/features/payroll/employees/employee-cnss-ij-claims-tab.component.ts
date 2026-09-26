import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DatePickerModule } from 'primeng/datepicker';
import { DialogModule } from 'primeng/dialog';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PayrollService, CnssIjClaim } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';

function toIsoDate(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Component({
  selector: 'app-employee-cnss-ij-claims-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, TagModule, DatePickerModule, DialogModule, ButtonComponent],
  template: `
    <p class="payroll-info-text mb-3" i18n="@@payroll.employees.creances.ij.cnss.generees.lors.de.la.paie.subrog.6d51992e">Créances IJ CNSS générées lors de la paie (subrogation maladie ou indemnisation maternité).</p>

    <p-table [value]="items()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th i18n="@@payroll.employees.periode.de2110b7">Période</th>
          <th class="text-right" i18n="@@payroll.employees.montant.4adcd9fc">Montant</th>
          <th i18n="@@payroll.employees.statut.659499f3">Statut</th>
          @if (!readOnly) { <th></th> }
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-c>
        <tr>
          <td>{{ c.month | number:'2.0-0' }}/{{ c.year }}</td>
          <td class="text-right">{{ c.amount | number:'1.3-3' }} TND</td>
          <td>
            <p-tag
              [value]="c.statusDisplay"
              [severity]="c.status === 'Paid' ? 'success' : c.status === 'Rejected' ? 'danger' : 'warn'" />
          </td>
          @if (!readOnly) {
            <td>
              @if (c.status === 'Pending') {
                <button type="button" class="p-button p-button-text p-button-sm" (click)="openMarkPaid(c)" i18n="@@payroll.employees.marquer.reglee.08e95b04">Marquer réglée</button>
              }
            </td>
          }
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td [attr.colspan]="readOnly ? 3 : 4" i18n="@@payroll.employees.aucune.creance.ij.cnss.2f845cb6">Aucune créance IJ CNSS.</td></tr>
      </ng-template>
    </p-table>

    <p-dialog header="Règlement IJ CNSS" [(visible)]="markPaidVisible" [modal]="true" [style]="{ width: '360px' }">
      <div class="payroll-form-group">
        <label i18n="@@payroll.employees.date.de.reglement.65e1210f">Date de règlement</label>
        <p-datepicker [(ngModel)]="paidAt" dateFormat="dd/mm/yy" appendTo="body" styleClass="w-full" />
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="markPaidVisible = false" i18n="@@payroll.employees.annuler.49ba3292">Annuler</app-button>
        <app-button variant="primary" (click)="confirmMarkPaid()" i18n="@@payroll.employees.confirmer.80a664c8">Confirmer</app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .mb-3 { margin-bottom: var(--spacing-4); }
    .w-full { width: 100%; }
  `]
})
export class EmployeeCnssIjClaimsTabComponent implements OnInit {
  @Input({ required: true }) employeeId!: string;
  @Input() readOnly = false;

  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);

  items = signal<CnssIjClaim[]>([]);
  markPaidVisible = false;
  paidAt: Date | null = new Date();
  private selectedClaim: CnssIjClaim | null = null;

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.payroll.listCnssIjClaims(this.employeeId).subscribe({
      next: res => this.items.set(res.data ?? []),
      error: () => this.toast.add({ severity: 'error', summary: 'IJ CNSS', detail: 'Chargement impossible.' })
    });
  }

  openMarkPaid(claim: CnssIjClaim): void {
    this.selectedClaim = claim;
    this.paidAt = new Date();
    this.markPaidVisible = true;
  }

  confirmMarkPaid(): void {
    if (!this.selectedClaim || !this.paidAt) return;
    const paidAt = toIsoDate(this.paidAt);
    if (!paidAt) return;

    this.payroll.markCnssIjClaimPaid(this.selectedClaim.id, paidAt).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'IJ CNSS', detail: 'Créance marquée comme réglée.' });
        this.markPaidVisible = false;
        this.reload();
      },
      error: err => this.toast.add({
        severity: 'error',
        summary: 'IJ CNSS',
        detail: err?.error?.message ?? 'Mise à jour impossible.'
      })
    });
  }
}
