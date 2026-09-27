/// <reference types="@angular/localize" />
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MessageModule } from 'primeng/message';
import { finalize } from 'rxjs';
import { PayrollService, PayrollWithholdingCertificateBatch } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PayrollStatGridComponent,
  PayrollEmptyStateComponent,
  PayrollAmountPipe,
  formatPayrollAmount,
  type PayrollStatItem
} from '../shared';

const MONTH_LABELS = [
  '',
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

@Component({
  selector: 'app-withholding-certificates-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    SelectModule,
    TagModule,
    TooltipModule,
    MessageModule,
    ButtonComponent,
    PayrollStatGridComponent,
    PayrollEmptyStateComponent,
    PayrollAmountPipe
  ],
  template: `
    <div class="payroll-toolbar mb-3">
      <p-select
        [options]="yearOptions"
        [(ngModel)]="year"
        (ngModelChange)="load()"
        optionLabel="label"
        optionValue="value"
        placeholder="Exercice" i18n-placeholder="@@payroll.declarations.exercice.e171e2b0"
        styleClass="w-10rem" />
      <app-button variant="primary" icon="pi-refresh" iconPos="left" (click)="load()" i18n="@@payroll.declarations.generer.bd221c07">Générer</app-button>
      <app-button
        variant="outline"
        icon="pi-download"
        iconPos="left"
        (click)="exportCsv()"
        [disabled]="!canExport()" i18n="@@payroll.declarations.exporter.csv.d4fc31cb">Exporter CSV</app-button>
      <app-button
        variant="outline"
        icon="pi-file-export"
        iconPos="left"
        (click)="exportZip()"
        [disabled]="!canExport()" i18n="@@payroll.declarations.exporter.zip.pdf.6bd22aa3">Exporter ZIP (PDF)</app-button>
    </div>

    @if (batch() && !batch()!.isComplete) {
      <p-message
        severity="warn"
        [text]="incompletenessMessage()"
        styleClass="mb-3 w-full" />
    }

    @if (loading()) {
      <app-payroll-empty-state [loading]="true" [skeletonColumns]="7" />
    } @else if (!batch()) {
      <app-payroll-empty-state
        icon="pi-exclamation-circle"
        title="Impossible de charger les certificats" i18n-title="@@payroll.declarations.impossible.de.charger.les.certificats.9e902ae6"
        description="Une erreur est survenue lors de la génération. Vérifiez le NIF de la société et vos droits." i18n-description="@@payroll.declarations.une.erreur.est.survenue.lors.de.la.gener.5f296646"
        [showAction]="true"
        actionLabel="Réessayer" i18n-actionLabel="@@payroll.declarations.reessayer.b885e20c"
        (actionClick)="load()" />
    } @else if (batch()!.lines.length === 0) {
      <app-payroll-empty-state
        icon="pi-file"
        title="Aucun certificat à générer" i18n-title="@@payroll.declarations.aucun.certificat.a.generer.2997d642"
        [description]="emptyDescription()"
        [showAction]="true"
        actionLabel="Voir les cycles de paie" i18n-actionLabel="@@payroll.declarations.voir.les.cycles.de.paie.fd141467"
        actionRoute="/payroll/runs" />
    } @else {
      <app-payroll-stat-grid [items]="summaryStats()" class="mb-4" />

      <p-table [value]="batch()!.lines" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@payroll.declarations.salarie.27f97915">Salarié</th>
            <th i18n="@@payroll.declarations.cin.748d5d16">CIN</th>
            <th class="text-right" i18n="@@payroll.declarations.mois.0d304bea">Mois</th>
            <th class="text-right" i18n="@@payroll.declarations.net.imposable.2439110f">Net imposable</th>
            <th class="text-right" i18n="@@payroll.declarations.irpp.retenu.7cc73d3d">IRPP retenu</th>
            <th class="text-right" i18n="@@payroll.declarations.css.retenue.034ee1f0">CSS retenue</th>
            <th class="text-right" i18n="@@payroll.declarations.total.retenues.b2cd335c">Total retenues</th>
            <th class="text-center" i18n="@@payroll.declarations.pdf.d613d88c">PDF</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-l>
          <tr>
            <td>
              {{ l.employeeName }}
              @if (l.warnings?.length) {
                <i class="pi pi-exclamation-triangle text-warning ml-2"
                   [pTooltip]="l.warnings.join(' — ')"
                   tooltipPosition="top"></i>
              }
            </td>
            <td>
              @if (l.cin) {
                {{ l.cin }}
              } @else {
                <p-tag value="Manquant" severity="warn" />
              }
            </td>
            <td class="text-right">{{ l.monthsCount }}</td>
            <td class="text-right">{{ l.annualNetTaxable | payrollAmount }}</td>
            <td class="text-right">{{ l.totalIrppWithheld | payrollAmount }}</td>
            <td class="text-right">{{ l.totalCssWithheld | payrollAmount }}</td>
            <td class="text-right">{{ l.totalWithholding | payrollAmount }}</td>
            <td class="text-center">
              <app-button
                variant="ghost"
                icon="pi-file-pdf"
                size="sm"
                (click)="downloadPdf(l.employeeId)"
                [attr.aria-label]="loc_ui_tern_telecharger_le_certificat_de_36ca16 + l.employeeName" />
            </td>
          </tr>
        </ng-template>
      </p-table>
    }
  `,
  styles: [`
    .mb-3 { margin-bottom: var(--spacing-4); }
    .mb-4 { margin-bottom: var(--spacing-6); display: block; }
    .ml-2 { margin-left: var(--spacing-2); }
    .text-warning { color: var(--color-warning-600); }
  `]
})
export class WithholdingCertificatesTabComponent implements OnInit {
  readonly loc_ui_tern_telecharger_le_certificat_de_36ca16 = $localize`:@@ui.tern.telecharger.le.certificat.de.36ca16:Télécharger le certificat de `;
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);

  readonly initialYear = input<number | null>(null);

  year = new Date().getFullYear() - 1;
  yearOptions = Array.from({ length: 5 }, (_, i) => {
    const y = new Date().getFullYear() - 3 + i;
    return { value: y, label: String(y) };
  });
  batch = signal<PayrollWithholdingCertificateBatch | null>(null);
  loading = signal(false);

  canExport = computed(() => {
    const b = this.batch();
    return !!b && b.employeeCount > 0;
  });

  incompletenessMessage = computed(() => {
    const b = this.batch();
    if (!b || b.isComplete) return '';
    const months = formatMonthList(b.missingMonths);
    return `Exercice incomplet : cycles Validé/Clôturé manquants pour ${months}. Seuls les mois validés sont inclus.`;
  });

  emptyDescription = computed(() => {
    const b = this.batch();
    const base = 'Seuls les cycles de paie validés ou clôturés sont inclus.';
    if (!b || b.isComplete || b.missingMonths.length === 0) {
      return `${base} Aucun bulletin éligible pour cet exercice.`;
    }
    return `${base} Mois manquants : ${formatMonthList(b.missingMonths)}.`;
  });

  summaryStats = computed((): PayrollStatItem[] => {
    const b = this.batch();
    if (!b) return [];
    return [
      { label: 'Salariés', value: b.employeeCount, icon: 'pi-users', variant: 'primary' },
      { label: 'Net imposable', value: formatPayrollAmount(b.totalAnnualNetTaxable, false), icon: 'pi-chart-bar', variant: 'primary' },
      { label: 'IRPP retenu', value: formatPayrollAmount(b.totalIrppWithheld, false), icon: 'pi-percentage', variant: 'warning' },
      { label: 'CSS retenue', value: formatPayrollAmount(b.totalCssWithheld, false), icon: 'pi-percentage', variant: 'warning' },
      { label: 'Total retenues', value: formatPayrollAmount(b.totalWithholding, false), icon: 'pi-wallet', variant: 'success', featured: true }
    ];
  });

  ngOnInit(): void {
    const y = this.initialYear();
    if (y != null && y >= 2000 && y <= 2100) this.year = y;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.payroll.getWithholdingCertificates(this.year).pipe(
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: res => this.batch.set(res.data ?? null),
      error: () => {
        this.batch.set(null);
        this.toast.add({ severity: 'error', summary: $localize`:@@withholding-certificates-tab.component.summary.Certificats :Certificats RS`, detail: $localize`:@@withholding-certificates-tab.component.detail.Impossible_de_g_:Impossible de générer les certificats.` });
      }
    });
  }

  exportCsv(): void {
    if (!this.canExport()) return;
    this.payroll.exportWithholdingCertificatesCsv(this.year).subscribe({
      next: blob => downloadBlob(blob, `certificats_rs_${this.year}.csv`),
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@withholding-certificates-tab.component.summary.Certificats :Certificats RS`, detail: $localize`:@@withholding-certificates-tab.component.detail.Export CSV i:Export CSV impossible.` })
    });
  }

  exportZip(): void {
    if (!this.canExport()) return;
    this.payroll.exportWithholdingCertificatesZip(this.year).subscribe({
      next: blob => downloadBlob(blob, `certificats_rs_${this.year}.zip`),
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@withholding-certificates-tab.component.summary.Certificats :Certificats RS`, detail: $localize`:@@withholding-certificates-tab.component.detail.Export ZIP i:Export ZIP impossible.` })
    });
  }

  downloadPdf(employeeId: string): void {
    this.payroll.downloadWithholdingCertificatePdf(this.year, employeeId).subscribe({
      next: blob => downloadBlob(blob, `certificat_rs_${this.year}_${employeeId}.pdf`),
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@withholding-certificates-tab.component.summary.Certificats :Certificats RS`, detail: $localize`:@@withholding-certificates-tab.component.detail.T_l_chargement_P:Téléchargement PDF impossible.` })
    });
  }
}

function formatMonthList(months: number[]): string {
  return months.map(m => MONTH_LABELS[m] ?? `M${m}`).join(', ');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
