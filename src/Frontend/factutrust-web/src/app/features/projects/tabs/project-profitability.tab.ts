/// <reference types="@angular/localize" />
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { ProjectDetail } from '../project-api.service';
import { ProjectProfitability, TimesheetApiService } from '../../timesheets/timesheet-api.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ToastService } from '@core/services/toast.service';

@Component({
  selector: 'app-project-profitability-tab',
  standalone: true,
  imports: [CommonModule, TableModule],
  template: `
    @if (data(); as p) {
      <h3 i18n="@@projects.tabs.rentabilite.expected.to.invoice.invoiced.5918894f">Rentabilité (Expected / To invoice / Invoiced)</h3>
      <p i18n="@@projects.tabs.marge.facturee.ht.8258205d">Marge facturée : <strong>{{ p.marginInvoiced | number:'1.3-3' }} HT</strong></p>

      <h4 i18n="@@projects.tabs.revenus.a08a099a">Revenus</h4>
      <p-table [value]="p.revenues">
        <ng-template pTemplate="header">
          <tr><th i18n="@@projects.tabs.categorie.6b38300a">Catégorie</th><th i18n="@@projects.tabs.expected.6ac87f34">Expected</th><th i18n="@@projects.tabs.to.invoice.1b919714">To invoice</th><th i18n="@@projects.tabs.invoiced.4da40d1d">Invoiced</th></tr>
        </ng-template>
        <ng-template pTemplate="body" let-r>
          <tr>
            <td>{{ r.category }}</td>
            <td>{{ r.expected | number:'1.3-3' }}</td>
            <td>{{ r.toInvoiceOrBill | number:'1.3-3' }}</td>
            <td>{{ r.invoicedOrBilled | number:'1.3-3' }}</td>
          </tr>
        </ng-template>
      </p-table>

      <h4 i18n="@@projects.tabs.couts.517e3006">Coûts</h4>
      <p-table [value]="p.costs">
        <ng-template pTemplate="header">
          <tr><th i18n="@@projects.tabs.categorie.6b38300a">Catégorie</th><th i18n="@@projects.tabs.expected.6ac87f34">Expected</th><th i18n="@@projects.tabs.to.bill.a9d72ed0">To bill</th><th i18n="@@projects.tabs.billed.763fe55e">Billed</th></tr>
        </ng-template>
        <ng-template pTemplate="body" let-c>
          <tr>
            <td>{{ c.category }}</td>
            <td>{{ c.expected | number:'1.3-3' }}</td>
            <td>{{ c.toInvoiceOrBill | number:'1.3-3' }}</td>
            <td>{{ c.invoicedOrBilled | number:'1.3-3' }}</td>
          </tr>
        </ng-template>
      </p-table>
    } @else {
      <p i18n="@@projects.tabs.chargement.rentabilite.3ee275d0">Chargement rentabilité…</p>
    }
  `,
  styles: [`h3, h4 { margin: 1rem 0 .5rem; }`]
})
export class ProjectProfitabilityTabComponent implements OnInit {
  @Input({ required: true }) project!: ProjectDetail;
  private readonly api = inject(TimesheetApiService);
  private readonly errors = inject(ErrorHandlerService);
  private readonly toast = inject(ToastService);
  data = signal<ProjectProfitability | null>(null);

  ngOnInit(): void {
    this.api.getProfitability(this.project.id).subscribe({
      next: r => { if (r.success && r.data) this.data.set(r.data); },
      error: e => this.toast.add({
        severity: 'error',
        summary: $localize`:@@project-profitability.tab.summary.Rentabilit_:Rentabilité`,
        detail: this.errors.extractErrorMessage(e)
      })
    });
  }
}
