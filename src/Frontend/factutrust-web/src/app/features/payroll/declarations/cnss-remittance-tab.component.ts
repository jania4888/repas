/// <reference types="@angular/localize" />
import { API_ERROR_CODE, apiErrorCode } from '@core/utils/api-error-code';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MessageModule } from 'primeng/message';
import { finalize } from 'rxjs';
import { PayrollService, CnssContributionRemittance } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { canPayPayroll } from '@core/utils/payroll-access';
import { ButtonComponent } from '@shared/components/button/button.component';
import {
  PayrollStatGridComponent,
  PayrollEmptyStateComponent,
  PayrollAmountPipe,
  formatPayrollAmount,
  type PayrollStatItem
} from '../shared';
import { CnssRemittancePaymentDialogComponent } from './cnss-remittance-payment-dialog.component';

const MONTH_LABELS = [
  '',
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

@Component({
  selector: 'app-cnss-remittance-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    TableModule,
    SelectModule,
    TagModule,
    TooltipModule,
    MessageModule,
    ButtonComponent,
    PayrollStatGridComponent,
    PayrollEmptyStateComponent,
    PayrollAmountPipe,
    CnssRemittancePaymentDialogComponent
  ],
  template: `
    <div class="payroll-toolbar mb-3">
      <p-select
        [options]="yearOptions"
        [(ngModel)]="year"
        (ngModelChange)="load()"
        optionLabel="label"
        optionValue="value"
        placeholder="Année" i18n-placeholder="@@payroll.declarations.annee.1f910d98"
        styleClass="w-10rem" />
      <p-select
        [options]="monthOptions"
        [(ngModel)]="month"
        (ngModelChange)="load()"
        optionLabel="label"
        optionValue="value"
        placeholder="Mois" i18n-placeholder="@@payroll.declarations.mois.0d304bea"
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
        icon="pi-file-pdf"
        iconPos="left"
        (click)="exportPdf()"
        [disabled]="!canExport()" i18n="@@payroll.declarations.exporter.pdf.9a2c3956">Exporter PDF</app-button>
      @if (canPay()) {
        <app-button
          variant="success"
          icon="pi-wallet"
          iconPos="left"
          (click)="openPaymentDialog()"
          [disabled]="!canRecordPayment()" i18n="@@payroll.declarations.enregistrer.le.versement.abd144ad">Enregistrer le versement</app-button>
      }
    </div>

    @if (missingEmployerMatricule()) {
      <div class="cnss-matricule-banner mb-3">
        <p-message
          severity="warn"
          text="Le matricule employeur CNSS est manquant. Configurez-le pour exporter le bordereau ou enregistrer un versement." i18n-text="@@payroll.declarations.le.matricule.employeur.cnss.est.manquant.fc66b845"
          styleClass="w-full" />
        <app-button variant="ghost" routerLink="/settings/company" icon="pi-cog" iconPos="left" i18n="@@payroll.declarations.configurer.le.matricule.189aecce"> Configurer le matricule </app-button>
      </div>
    }

    @for (w of otherWarnings(); track w) {
      <p-message severity="warn" [text]="w" styleClass="mb-3 w-full" />
    }

    @if (remittance()?.hasExistingPayment && remittance()?.payment) {
      <p-message
        severity="success"
        [text]="paymentMessage()"
        styleClass="mb-3 w-full" />
    }

    @if (loading()) {
      <app-payroll-empty-state [loading]="true" [skeletonColumns]="6" />
    } @else if (!remittance()) {
      <app-payroll-empty-state
        icon="pi-exclamation-circle"
        title="Impossible de charger le bordereau" i18n-title="@@payroll.declarations.impossible.de.charger.le.bordereau.ea4207e2"
        description="Vérifiez que la fonctionnalité est activée et que vous disposez des droits nécessaires." i18n-description="@@payroll.declarations.verifiez.que.la.fonctionnalite.est.activ.5b85bac5"
        [showAction]="true"
        actionLabel="Réessayer" i18n-actionLabel="@@payroll.declarations.reessayer.b885e20c"
        (actionClick)="load()" />
    } @else if (!remittance()!.isEligible) {
      <app-payroll-empty-state
        icon="pi-calendar"
        title="Cycle de paie non disponible" i18n-title="@@payroll.declarations.cycle.de.paie.non.disponible.e1468b8a"
        [description]="loc_ui_tern_aucun_cycle_valide_ou_cloture_pour_172d01 + monthLabel() + '.'"
        [showAction]="true"
        actionLabel="Voir les cycles de paie" i18n-actionLabel="@@payroll.declarations.voir.les.cycles.de.paie.fd141467"
        actionRoute="/payroll/runs" />
    } @else if (remittance()!.lines.length === 0) {
      <app-payroll-empty-state
        icon="pi-file"
        title="Aucun salarié" i18n-title="@@payroll.declarations.aucun.salarie.a1567c77"
        description="Le cycle ne contient aucun bulletin." i18n-description="@@payroll.declarations.le.cycle.ne.contient.aucun.bulletin.c15507c9"
        [showAction]="true"
        actionLabel="Voir les cycles de paie" i18n-actionLabel="@@payroll.declarations.voir.les.cycles.de.paie.fd141467"
        actionRoute="/payroll/runs" />
    } @else {
      <app-payroll-stat-grid [items]="summaryStats()" class="mb-4" />

      <p-table [value]="remittance()!.lines" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th i18n="@@payroll.declarations.salarie.27f97915">Salarié</th>
            <th i18n="@@payroll.declarations.cnss.a04d171a">CNSS</th>
            <th class="text-right" i18n="@@payroll.declarations.brut.cnss.40e3c3cd">Brut CNSS</th>
            <th class="text-right" i18n="@@payroll.declarations.cnss.sal.5d831d27">CNSS sal.</th>
            <th class="text-right" i18n="@@payroll.declarations.cnss.pat.1d666774">CNSS pat.</th>
            <th class="text-right" i18n="@@payroll.declarations.at.031fd11b">AT</th>
            <th class="text-right" i18n="@@payroll.declarations.total.b25928c6">Total</th>
            <th class="col-warnings"></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-l>
          <tr>
            <td>{{ l.employeeName }}</td>
            <td>
              @if (l.cnssNumber) {
                {{ l.cnssNumber }}
              } @else {
                <p-tag value="Manquant" severity="warn" />
              }
            </td>
            <td class="text-right">{{ l.cnssableGross | payrollAmount }}</td>
            <td class="text-right">{{ l.cnssEmployee | payrollAmount }}</td>
            <td class="text-right">{{ l.cnssEmployer | payrollAmount }}</td>
            <td class="text-right">{{ l.workAccident | payrollAmount }}</td>
            <td class="text-right">{{ l.lineTotal | payrollAmount }}</td>
            <td class="col-warnings">
              @if (l.warnings?.length) {
                <i
                  class="pi pi-exclamation-triangle text-warning"
                  [pTooltip]="l.warnings.join(' · ')"
                  tooltipPosition="left"></i>
              }
            </td>
          </tr>
        </ng-template>
      </p-table>
    }

    <app-cnss-remittance-payment-dialog
      [visible]="paymentDialogVisible()"
      [year]="year"
      [month]="month"
      [totalDue]="remittance()?.totalDue ?? 0"
      (visibleChange)="paymentDialogVisible.set($event)"
      (recorded)="onPaymentRecorded()" />
  `,
  styles: [`
    .mb-3 { margin-bottom: var(--spacing-4); }
    .mb-4 { margin-bottom: var(--spacing-6); display: block; }
    .cnss-matricule-banner {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-2);
    }
    .col-warnings {
      width: 2rem;
      text-align: center;
    }
    .text-warning {
      color: var(--orange-500, #f97316);
    }
  `]
})
export class CnssRemittanceTabComponent implements OnInit {
  readonly loc_ui_tern_aucun_cycle_valide_ou_cloture_pour_172d01 = $localize`:@@ui.tern.aucun.cycle.valide.ou.cloture.pour.172d01:Aucun cycle validé ou clôturé pour `;
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  readonly initialYear = input<number | null>(null);
  readonly initialMonth = input<number | null>(null);

  year = new Date().getFullYear();
  month = new Date().getMonth() + 1;
  yearOptions = Array.from({ length: 5 }, (_, i) => {
    const y = new Date().getFullYear() - 2 + i;
    return { value: y, label: String(y) };
  });
  monthOptions = MONTH_LABELS.slice(1).map((label, i) => ({ value: i + 1, label }));

  remittance = signal<CnssContributionRemittance | null>(null);
  loading = signal(false);
  paymentDialogVisible = signal(false);

  canExport = computed(() => {
    const r = this.remittance();
    return !!r && r.isEligible && r.employeeCount > 0 && !this.missingEmployerMatricule();
  });

  canRecordPayment = computed(() => {
    const r = this.remittance();
    return !!r && r.isEligible && !r.hasExistingPayment && r.totalDue > 0 && !this.missingEmployerMatricule();
  });

  /**
   * Champ structuré, jamais le texte de l'avertissement (traduisible) : le serveur renseigne
   * toujours employerCnssNumber et n'émet l'avertissement « matricule manquant » que s'il est vide.
   */
  missingEmployerMatricule = computed(() => {
    const r = this.remittance();
    return !!r && !r.employerCnssNumber?.trim();
  });

  otherWarnings = computed(() =>
    (this.remittance()?.warnings ?? []).filter(w => !w.includes('Matricule employeur CNSS manquant'))
  );

  canPay = computed(() => canPayPayroll(this.auth));

  summaryStats = computed((): PayrollStatItem[] => {
    const r = this.remittance();
    if (!r) return [];
    return [
      { label: $localize`:@@payroll.cnss-remittance-tab.ts.salaries.ce68387d:Salariés`, value: r.employeeCount, icon: 'pi-users', variant: 'primary' },
      { label: $localize`:@@payroll.cnss-remittance-tab.ts.cnss.salarie.e8528052:CNSS salarié`, value: formatPayrollAmount(r.totalCnssEmployee, false), icon: 'pi-user', variant: 'warning' },
      { label: $localize`:@@payroll.cnss-remittance-tab.ts.cnss.patronale.607c8ea5:CNSS patronale`, value: formatPayrollAmount(r.totalCnssEmployer, false), icon: 'pi-building', variant: 'warning' },
      { label: $localize`:@@payroll.cnss-remittance-tab.ts.accident.travail.d28f22ff:Accident travail`, value: formatPayrollAmount(r.totalWorkAccident, false), icon: 'pi-shield', variant: 'primary' },
      { label: $localize`:@@payroll.cnss-remittance-tab.ts.total.a.verser.70ce9db0:Total à verser`, value: formatPayrollAmount(r.totalDue, false), icon: 'pi-wallet', variant: 'success', featured: true }
    ];
  });

  ngOnInit(): void {
    const y = this.initialYear();
    const m = this.initialMonth();
    if (y != null && y >= 2000 && y <= 2100) this.year = y;
    if (m != null && m >= 1 && m <= 12) this.month = m;
    this.load();
  }

  monthLabel(): string {
    return `${MONTH_LABELS[this.month]} ${this.year}`;
  }

  paymentMessage(): string {
    const p = this.remittance()?.payment;
    if (!p) return '';
    const date = new Date(p.paymentDate).toLocaleDateString('fr-TN');
    return $localize`:@@payroll.cnss-remittance-tab.ts.versement.enregistre.le.date.p.9740f175:Versement enregistré le ${date}:date:${p.reference ? $localize`:@@ui.tern.ref.44045a: — Réf. ` + p.reference : ''}:p:`;
  }

  load(): void {
    this.loading.set(true);
    this.payroll.getCnssRemittance(this.year, this.month).pipe(
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: res => this.remittance.set(res.data ?? null),
      error: err => {
        this.remittance.set(null);
        const message = err?.error?.message ?? err?.error?.error ?? $localize`:@@ui.tern.impossible.de.generer.le.bordereau.d130b4:Impossible de générer le bordereau.`;
        const code = apiErrorCode(err);
        const isMissingMatricule = code
          ? code === API_ERROR_CODE.cnssEmployerNumberMissing
          : typeof message === 'string' && message.toLowerCase().includes('matricule employeur cnss');
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@cnss-remittance-tab.component.summary.Bordereau CN:Bordereau CNSS`,
          detail: isMissingMatricule
            ? $localize`:@@ui.tern.le.matricule.employeur.cnss.est.obligatoir.d9d786:Le matricule employeur CNSS est obligatoire. Configurez-le dans Mon entreprise.`
            : message
        });
      }
    });
  }

  exportCsv(): void {
    if (!this.canExport()) return;
    this.payroll.exportCnssRemittanceCsv(this.year, this.month).subscribe({
      next: blob => downloadBlob(blob, `bordereau_cnss_${this.year}_${String(this.month).padStart(2, '0')}.csv`),
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@cnss-remittance-tab.component.summary.Bordereau CN:Bordereau CNSS`, detail: $localize`:@@cnss-remittance-tab.component.detail.Export CSV i:Export CSV impossible.` })
    });
  }

  exportPdf(): void {
    if (!this.canExport()) return;
    this.payroll.exportCnssRemittancePdf(this.year, this.month).subscribe({
      next: blob => downloadBlob(blob, `bordereau_cnss_${this.year}_${String(this.month).padStart(2, '0')}.pdf`),
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@cnss-remittance-tab.component.summary.Bordereau CN:Bordereau CNSS`, detail: $localize`:@@cnss-remittance-tab.component.detail.Export PDF i:Export PDF impossible.` })
    });
  }

  openPaymentDialog(): void {
    if (!this.canRecordPayment()) return;
    this.paymentDialogVisible.set(true);
  }

  onPaymentRecorded(): void {
    this.paymentDialogVisible.set(false);
    this.load();
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
