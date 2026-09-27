/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { InputNumberModule } from 'primeng/inputnumber';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PayrollService, TerminationSettlement } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { PayrollAmountPipe } from '../shared';

@Component({
  selector: 'app-termination-settlement-list',
  standalone: true,
  imports: [BackendLabelPipe, CommonModule, FormsModule, RouterModule, TableModule, TagModule, InputNumberModule, PageHeaderComponent, ButtonComponent, PayrollAmountPipe],
  template: `
    <app-page-header title="Soldes de tout compte" i18n-title="@@payroll.terminations.soldes.de.tout.compte.afe34b92" subtitle="Indemnités de rupture et fin de contrat." i18n-subtitle="@@payroll.terminations.indemnites.de.rupture.et.fin.de.contrat.3a1f8bba">
      <app-button variant="primary" icon="pi-plus" routerLink="/payroll/terminations/new" i18n="@@payroll.terminations.nouveau.solde.5e1744e0">Nouveau solde</app-button>
    </app-page-header>

    <div class="payroll-toolbar mb-3">
      <label i18n="@@payroll.terminations.annee.1f910d98">Année</label>
      <p-inputNumber [(ngModel)]="year" (ngModelChange)="load()" [useGrouping]="false" />
      <label class="ml-3" i18n="@@payroll.terminations.mois.0d304bea">Mois</label>
      <p-inputNumber [(ngModel)]="month" (ngModelChange)="load()" [min]="1" [max]="12" [useGrouping]="false" />
    </div>

    <p-table [value]="items()" [loading]="loading()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th i18n="@@payroll.terminations.salarie.27f97915">Salarié</th>
          <th i18n="@@payroll.terminations.date.sortie.067eeced">Date sortie</th>
          <th i18n="@@payroll.terminations.motif.2a198f47">Motif</th>
          <th i18n="@@payroll.terminations.statut.659499f3">Statut</th>
          <th class="text-right" i18n="@@payroll.terminations.total.indemnites.7072aa3f">Total indemnités</th>
          <th></th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-row>
        <tr>
          <td>{{ row.employeeName || row.employeeId }}</td>
          <td>{{ row.terminationDate | date:'dd/MM/yyyy' }}</td>
          <td>{{ row.reasonDisplay | backendLabel }}</td>
          <td><p-tag [value]="row.statusDisplay | backendLabel" /></td>
          <td class="text-right">{{ row.totalIndemnityAmount | payrollAmount }}</td>
          <td>
            <a [routerLink]="['/payroll/terminations', row.id]" i18n="@@payroll.terminations.detail.7ce06afc">Détail</a>
          </td>
        </tr>
      </ng-template>
    </p-table>
  `
})
export class TerminationSettlementListComponent implements OnInit {
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);

  year = new Date().getFullYear();
  month = new Date().getMonth() + 1;
  readonly items = signal<TerminationSettlement[]>([]);
  readonly loading = signal(false);

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.payroll.listTerminationSettlements(this.year, this.month).subscribe({
      next: res => { this.items.set(res.data ?? []); this.loading.set(false); },
      error: () => { this.toast.add({ severity: 'error', summary: $localize`:@@termination-settlement-list.component.summary.Soldes de to:Soldes de tout compte`, detail: $localize`:@@termination-settlement-list.component.detail.Impossible d:Impossible de charger les soldes.` }); this.loading.set(false); }
    });
  }
}
