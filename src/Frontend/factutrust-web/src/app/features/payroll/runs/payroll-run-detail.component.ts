/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { PayrollService, PayrollRunDetail, PayslipDetail } from '@core/services/payroll.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { canRunPayroll, canValidatePayroll, canManagePayrollEmployees, canExportPayroll, canPayPayroll, isCompanyPayrollReadOnly, isPayrollConsultMode, PAYROLL_FIRM_MANAGED_COMPANY_BANNER, PAYROLL_FIRM_CONSULT_BANNER } from '@core/utils/payroll-access';
import { PayrollConsultBannerComponent } from '../shared/payroll-consult-banner.component';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PayrollOvertimeGridComponent } from './payroll-overtime-grid.component';
import { PayrollVariableAllowanceGridComponent } from './payroll-variable-allowance-grid.component';
import { PayrollRegularizationGridComponent } from './payroll-regularization-grid.component';
import { PayrollMealVoucherGridComponent } from './payroll-meal-voucher-grid.component';
import { PayrollBankTransferDialogComponent } from './payroll-bank-transfer-dialog.component';
import { PayrollRecordPaymentDialogComponent } from './payroll-record-payment-dialog.component';
import { PayrollPaymentsPanelComponent } from './payroll-payments-panel.component';
import { PayrollProrataPreviewPanelComponent } from './payroll-prorata-preview-panel.component';
import { PayrollStatGridComponent, PayrollSectionComponent, PayrollAmountPipe, formatPayrollAmount, type PayrollStatItem } from '../shared';
import { FirmGovernanceService } from '@core/services/firm-governance.service';

@Component({
  selector: 'app-payroll-run-detail',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    RouterModule,
    TableModule,
    DialogModule,
    TagModule,
    PageHeaderComponent,
    ButtonComponent,
    PayrollOvertimeGridComponent,
    PayrollVariableAllowanceGridComponent,
    PayrollRegularizationGridComponent,
    PayrollMealVoucherGridComponent,
    PayrollBankTransferDialogComponent,
    PayrollRecordPaymentDialogComponent,
    PayrollPaymentsPanelComponent,
    PayrollProrataPreviewPanelComponent,
    PayrollStatGridComponent,
    PayrollSectionComponent,
    PayrollAmountPipe,
    PayrollConsultBannerComponent
  ],
  template: `
    @if (run()) {
      <app-page-header [title]="run()!.label" [subtitle]="run()!.statusDisplay | backendLabel">
        @if (canRun() && (run()!.status === 'Draft' || run()!.status === 'Calculated')) {
          <app-button variant="primary" icon="pi-calculator" iconPos="left" [disabled]="actionInProgress()" (click)="calculate()" i18n="@@payroll.runs.calculer.29705857">Calculer</app-button>
        }
        @if (canValidate() && run()!.status === 'Calculated') {
          <app-button variant="primary" icon="pi-check" iconPos="left" [disabled]="actionInProgress()" (click)="validate()" i18n="@@payroll.runs.valider.be4220f7">Valider</app-button>
        }
        @if (canValidate() && run()!.status === 'Validated') {
          <app-button variant="outline" icon="pi-replay" iconPos="left" [disabled]="actionInProgress()" (click)="reopen()" i18n="@@payroll.runs.rouvrir.18f717af">Rouvrir</app-button>
          <app-button variant="primary" icon="pi-lock" iconPos="left" [disabled]="actionInProgress()" (click)="close()" i18n="@@payroll.runs.cloturer.e9f075c1">Clôturer</app-button>
        }
        @if (showBankTransferExport()) {
          <app-button variant="outline" icon="pi-building-columns" iconPos="left" [disabled]="actionInProgress()" (click)="openBankTransfer()" i18n="@@payroll.runs.export.virement.0cf7f14c">Export virement</app-button>
        }
        @if (showRecordPayment()) {
          <app-button variant="primary" icon="pi-wallet" iconPos="left" [disabled]="actionInProgress()" (click)="recordPaymentVisible.set(true)" i18n="@@payroll.runs.regler.la.paie.5ab3e218">Régler la paie</app-button>
        }
        @if (showCancelAllPayments()) {
          <app-button variant="outline" icon="pi-times" iconPos="left" [disabled]="actionInProgress()" (click)="cancelAllPayments()" i18n="@@payroll.runs.annuler.tous.les.paiements.7fdf7565">Annuler tous les paiements</app-button>
        }
      </app-page-header>

      <app-payroll-consult-banner
        [visible]="showConsultBanner()"
        [message]="consultBannerMessage()" />

      @if (run()!.status === 'Validated' || run()!.status === 'Closed') {
        <div class="mb-4">
          <div class="treasury-banner" role="region" aria-label="État de trésorerie de la paie" i18n-aria-label="@@payroll.runs.etat.de.tresorerie.de.la.paie.8d202d49">
            <div class="treasury-banner__item">
              <span class="treasury-banner__label" i18n="@@payroll.runs.tresorerie.e0e75da7">Trésorerie</span>
              <strong [class]="loc_ui_tern_treasury_banner_value_74a94b + treasuryStatusClass()">
                {{ (run()!.paymentStatusDisplay | backendLabel) ?? loc_ui_tern_non_paye_00f2ac }}
              </strong>
            </div>
            <div class="treasury-banner__item">
              <span class="treasury-banner__label" i18n="@@payroll.runs.paye.fa02fd68">Payé</span>
              <strong class="treasury-banner__value">{{ (run()!.totalPaid ?? 0) | payrollAmount }}</strong>
            </div>
            <div class="treasury-banner__item">
              <span class="treasury-banner__label" i18n="@@payroll.runs.reste.68135bb8">Reste</span>
              <strong class="treasury-banner__value">{{ (run()!.remainingToPay ?? run()!.totalNet) | payrollAmount }}</strong>
            </div>
          </div>
        </div>
      }

      <app-payroll-stat-grid [items]="totalsStats()" density="run-detail" class="mb-4" />

      @if (run()!.status === 'Draft' || run()!.status === 'Calculated') {
        <app-payroll-prorata-preview-panel [runId]="runId" class="mb-4" />
        <app-payroll-overtime-grid
          [year]="run()!.year"
          [month]="run()!.month"
          [readOnly]="!canManageEmployees()"
          [initialLines]="run()!.overtimeLines ?? []" />
        <app-payroll-variable-allowance-grid
          [year]="run()!.year"
          [month]="run()!.month"
          [readOnly]="!canManageEmployees()"
          [initialLines]="run()!.variableAllowanceLines ?? []" />
        <app-payroll-meal-voucher-grid
          [year]="run()!.year"
          [month]="run()!.month"
          [readOnly]="!canManageEmployees()"
          [initialLines]="run()!.mealVoucherLines ?? []" />
      }

      <!-- Régularisation annuelle : la génération lit le bulletin du mois, elle n'a donc de
           sens qu'une fois le cycle calculé. -->
      @if (run()!.status === 'Calculated') {
        <app-payroll-regularization-grid
          [runId]="run()!.id"
          [year]="run()!.year"
          [month]="run()!.month"
          [readOnly]="!canRun()" />
      }

      <app-payroll-section title="Bulletins de paie" i18n-title="@@payroll.runs.bulletins.de.paie.c587c766" icon="pi-file">
        <div class="payroll-table-scroll">
        <p-table [value]="run()!.payslips" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@payroll.runs.salarie.27f97915">Salarié</th>
              <th class="text-right" i18n="@@payroll.runs.brut.8fc72d21">Brut</th>
              <th class="text-right" i18n="@@payroll.runs.net.9bb81c2e">Net</th>
              <th i18n="@@payroll.runs.statut.paiement.3b17f23f">Statut paiement</th>
              <th></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-p>
            <tr>
              <td>{{ p.employeeName }}</td>
              <td class="text-right">{{ p.grossSalary | payrollAmount }}</td>
              <td class="text-right">{{ p.netSalary | payrollAmount }}</td>
              <td>
                @if (p.paymentStatusDisplay) {
                  <p-tag [value]="p.paymentStatusDisplay | backendLabel" [severity]="paymentTagSeverity(p.paymentStatus)" />
                }
              </td>
              <td class="actions">
                <app-button variant="ghost" size="sm" (click)="showPayslip(p.id)" i18n="@@payroll.runs.detail.7ce06afc">Détail</app-button>
                <app-button variant="ghost" size="sm" (click)="downloadPdf(p.id)" i18n="@@payroll.runs.pdf.d613d88c">PDF</app-button>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr><td colspan="5" i18n="@@payroll.runs.aucun.bulletin.lancez.le.calcul.a6c22606">Aucun bulletin — lancez le calcul.</td></tr>
          </ng-template>
        </p-table>
        </div>
      </app-payroll-section>

      @if (run()!.status === 'Validated' || run()!.status === 'Closed') {
        <app-payroll-payments-panel
          [runId]="runId"
          [canCancel]="canPay()"
          (refreshed)="reload()" />
      }
    }

    <p-dialog header="Détail du bulletin" i18n-header="@@payroll.runs.detail.du.bulletin.43ddb475" [(visible)]="payslipDialogVisible" [modal]="true" [style]="{ width: '640px' }">
      @if (selectedPayslip()) {
        <div class="mb-3">
          <strong>{{ selectedPayslip()!.employeeName }}</strong>
          <span class="ml-2 text-secondary">{{ selectedPayslip()!.employeeNumber }}</span>
          @if (selectedPayslip()!.cin) {
            <span class="ml-2 text-secondary">CIN {{ selectedPayslip()!.cin }}</span>
          }
          @if (selectedPayslip()!.leaveBalanceRemaining != null) {
            <span class="ml-2 text-secondary" i18n="@@payroll.runs.solde.conges.j.a2edfee2">Solde congés : {{ selectedPayslip()!.leaveBalanceRemaining }} j</span>
          }
        </div>
        @if ((selectedPayslip()!.prorataDeductionAmount ?? 0) > 0) {
          <div class="prorata-summary mb-3">
            <strong i18n="@@payroll.runs.prorata.du.mois.b192ed38">Prorata du mois</strong>
            <div class="prorata-grid" i18n="@@payroll.runs.jours.travailles.jours.non.travailles.re.2ce340fd">
              <span>Jours travaillés : {{ selectedPayslip()!.prorataWorkedDays }}</span>
              <span>Jours non travaillés : {{ selectedPayslip()!.prorataNonWorkedDays }}</span>
              <span>Retenue : {{ selectedPayslip()!.prorataDeductionAmount | payrollAmount }}</span>
            </div>
          </div>
        }
        <p-table [value]="selectedPayslip()!.lines" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@payroll.runs.libelle.f5485bba">Libellé</th>
              <th class="text-right" i18n="@@payroll.runs.base.077fe9c5">Base</th>
              <th class="text-right" i18n="@@payroll.runs.taux.18bc95b8">Taux</th>
              <th class="text-right" i18n="@@payroll.runs.montant.4adcd9fc">Montant</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-line>
            <tr>
              <td>{{ line.label }}</td>
              <td class="text-right">{{ line.base != null ? (line.base | payrollAmount:false) : '—' }}</td>
              <td class="text-right">{{ line.rate != null ? (line.rate + ' %') : '—' }}</td>
              <td class="text-right">{{ line.amount | payrollAmount }}</td>
            </tr>
          </ng-template>
        </p-table>
        <div class="mt-3 text-right" i18n="@@payroll.runs.net.a.payer.cd1383cb">
          <strong>Net à payer : {{ selectedPayslip()!.netSalary | payrollAmount }}</strong>
        </div>
      }
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="payslipDialogVisible = false" i18n="@@payroll.runs.fermer.5ab4ec64">Fermer</app-button>
      </ng-template>
    </p-dialog>

    @if (bankTransferVisible()) {
      <app-payroll-bank-transfer-dialog
        [runId]="runId"
        [periodLabel]="run()?.label ?? ''"
        [visible]="bankTransferVisible()"
        (closed)="bankTransferVisible.set(false)" />
    }

    @if (recordPaymentVisible()) {
      <app-payroll-record-payment-dialog
        [runId]="runId"
        [payslips]="run()?.payslips ?? []"
        [visible]="recordPaymentVisible()"
        (closed)="recordPaymentVisible.set(false)"
        (paymentRecorded)="onPaymentRecorded()" />
    }
  `,
  styles: [`
    .treasury-banner {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--spacing-4, 1rem);
      padding: var(--spacing-3) var(--spacing-4);
      background: var(--color-surface-secondary);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
    }
    .treasury-banner__item {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);
      min-width: 0;
    }
    .treasury-banner__label {
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-secondary);
    }
    .treasury-banner__value {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-variant-numeric: tabular-nums;
      color: var(--color-text-primary);
    }
    .treasury-banner__value--unpaid { color: var(--color-text-secondary); }
    .treasury-banner__value--partial { color: var(--color-warning-700, #b45309); }
    .treasury-banner__value--paid { color: var(--color-success-700, #15803d); }
    @media (max-width: 768px) {
      .treasury-banner { grid-template-columns: 1fr; }
    }
    .mb-3 { margin-bottom: var(--spacing-4); }
    .mb-4 { margin-bottom: var(--spacing-6); display: block; }
    .mt-3 { margin-top: var(--spacing-4); }
    .ml-2 { margin-inline-start: var(--spacing-2); }
    .text-secondary { color: var(--color-text-secondary); }
    .actions { display: flex; gap: var(--spacing-2); white-space: nowrap; }
    .prorata-summary {
      padding: var(--spacing-3);
      background: var(--color-surface-secondary);
      border-radius: var(--radius-md);
      font-size: var(--font-size-sm);
    }
    .prorata-grid { display: flex; flex-wrap: wrap; gap: var(--spacing-4); margin-top: var(--spacing-2); }
  `]
})
export class PayrollRunDetailComponent implements OnInit {
  readonly loc_ui_tern_treasury_banner_value_74a94b = "treasury-banner__value ";
  readonly loc_ui_tern_non_paye_00f2ac = $localize`:@@ui.tern.non.paye.00f2ac:Non payé`;
  private readonly route = inject(ActivatedRoute);
  private readonly payroll = inject(PayrollService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly firmGovernance = inject(FirmGovernanceService);
  private readonly confirmation = inject(ConfirmationService);

  run = signal<PayrollRunDetail | null>(null);
  selectedPayslip = signal<PayslipDetail | null>(null);
  payslipDialogVisible = false;
  bankTransferVisible = signal(false);
  recordPaymentVisible = signal(false);
  runId = '';
  routeBase = signal('/payroll');
  firmInternal = signal(false);
  /** Verrou les boutons de workflow pendant un appel (R-30 : évite le double-clic). */
  actionInProgress = signal(false);

  canRun = computed(() => canRunPayroll(this.auth));
  canValidate = computed(() => canValidatePayroll(this.auth));
  canManageEmployees = computed(() => canManagePayrollEmployees(this.auth));
  canExport = computed(() => canExportPayroll(this.auth));
  canPay = computed(() => canPayPayroll(this.auth));
  showConsultBanner = computed(() => !this.firmInternal() && (isPayrollConsultMode(this.auth) || isCompanyPayrollReadOnly(this.auth)));
  consultBannerMessage = computed(() =>
    isCompanyPayrollReadOnly(this.auth) ? PAYROLL_FIRM_MANAGED_COMPANY_BANNER : PAYROLL_FIRM_CONSULT_BANNER);

  showBankTransferExport = computed(() => {
    const r = this.run();
    if (!r || !this.canExport()) return false;
    return r.status === 'Validated' || r.status === 'Closed';
  });

  showRecordPayment = computed(() => {
    const r = this.run();
    if (!r || !this.canPay()) return false;
    if (r.status !== 'Validated' && r.status !== 'Closed') return false;
    return (r.remainingToPay ?? r.totalNet) > 0;
  });

  showCancelAllPayments = computed(() => {
    const r = this.run();
    return !!r && this.canPay() && (r.hasPayments ?? false) && r.status === 'Validated';
  });

  totalsStats = computed((): PayrollStatItem[] => {
    const r = this.run();
    if (!r) return [];
    return [
      { label: $localize`:@@payroll.payroll-run-detail.ts.brut.8fc72d21:Brut`, value: formatPayrollAmount(r.totalGross, false), icon: 'pi-money-bill', variant: 'primary' },
      {
        label: $localize`:@@payroll.payroll-run-detail.ts.net.9bb81c2e:Net`,
        value: formatPayrollAmount(r.totalNet, false),
        valueTitle: formatPayrollAmount(r.totalNet, true),
        icon: 'pi-wallet',
        variant: 'success',
        featured: true
      },
      { label: 'IRPP', value: formatPayrollAmount(r.totalIrpp, false), icon: 'pi-percentage', variant: 'warning' },
      ...(r.totalIrppSmigExemption && r.totalIrppSmigExemption > 0
        ? [{ label: $localize`:@@payroll.payroll-run-detail.ts.exon.irpp.smig.2b5fcb00:Exon. IRPP SMIG`, value: formatPayrollAmount(r.totalIrppSmigExemption, false), icon: 'pi-shield', variant: 'success' as const }]
        : []),
      { label: $localize`:@@payroll.payroll-run-detail.ts.cnss.sal.5d831d27:CNSS sal.`, value: formatPayrollAmount(r.totalCnssEmployee, false), icon: 'pi-user', variant: 'primary' },
      { label: $localize`:@@payroll.payroll-run-detail.ts.cnss.pat.1d666774:CNSS pat.`, value: formatPayrollAmount(r.totalCnssEmployer, false), icon: 'pi-building', variant: 'primary' },
      { label: 'TFP', value: formatPayrollAmount(r.totalTfp, false), icon: 'pi-chart-line', variant: 'warning' },
      { label: 'FOPROLOS', value: formatPayrollAmount(r.totalFoprolos, false), icon: 'pi-briefcase', variant: 'warning' },
      { label: $localize`:@@payroll.payroll-run-detail.ts.css.patronale.4130ab0d:CSS patronale`, value: formatPayrollAmount(r.totalCssEmployer, false), icon: 'pi-shield', variant: 'warning' }
    ];
  });

  ngOnInit(): void {
    const data = this.route.snapshot.data;
    this.routeBase.set(data['payrollRouteBase'] ?? '/payroll');
    this.firmInternal.set(!!data['firmInternalPayroll']);
    this.runId = this.route.snapshot.paramMap.get('id')!;
    this.reload();
  }

  reload(): void {
    this.payroll.getRun(this.runId).subscribe({
      next: res => this.run.set(res.data ?? null),
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@payroll-run-detail.component.summary.Paie:Paie`, detail: $localize`:@@payroll-run-detail.component.detail.Cycle_introuvabl:Cycle introuvable.` })
    });
  }

  openBankTransfer(): void {
    if (!this.showBankTransferExport()) return;
    this.bankTransferVisible.set(true);
  }

  onPaymentRecorded(): void {
    this.recordPaymentVisible.set(false);
    this.reload();
  }

  async cancelAllPayments(): Promise<void> {
    if (this.actionInProgress()) return;
    const reason = await this.confirmation.prompt({
      header: $localize`:@@payroll.payroll-run-detail.ts.annuler.tous.les.paiements.7fdf7565:Annuler tous les paiements`,
      message: $localize`:@@payroll.payroll-run-detail.ts.saisissez.le.motif.d.annulation.de.tous.2933c1d1:Saisissez le motif d'annulation de tous les paiements du cycle :`,
      acceptLabel: $localize`:@@payroll-run-detail.component.acceptLabel.Annuler_les_paie:Annuler les paiements`,
      rejectLabel: $localize`:@@payroll-run-detail.component.rejectLabel.Conserver_les_pa:Conserver les paiements`,
      acceptButtonStyleClass: 'btn-danger',
      required: true
    });
    if (!reason) return;
    this.actionInProgress.set(true);
    this.payroll.cancelAllRunPayments(this.runId, reason).subscribe({
      next: () => {
        this.actionInProgress.set(false);
        this.toast.add({ severity: 'success', summary: $localize`:@@payroll-run-detail.component.summary.Paie:Paie`, detail: $localize`:@@payroll-run-detail.component.detail.Tous_les_paiemen:Tous les paiements ont été annulés.` });
        this.reload();
      },
      error: err => {
        this.actionInProgress.set(false);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@payroll-run-detail.component.summary.Paie:Paie`,
          detail: err?.error?.message ?? $localize`:@@ui.tern.annulation.impossible.814b7d:Annulation impossible.`
        });
      }
    });
  }

  treasuryStatusClass = computed(() => {
    const status = this.run()?.paymentStatus;
    if (status === 'FullyPaid') return 'treasury-banner__value--paid';
    if (status === 'PartiallyPaid') return 'treasury-banner__value--partial';
    return 'treasury-banner__value--unpaid';
  });

  paymentTagSeverity(status?: string): 'success' | 'warn' | 'secondary' {
    if (status === 'Paid') return 'success';
    if (status === 'PartiallyPaid') return 'warn';
    return 'secondary';
  }

  calculate(): void {
    if (!this.canRun() || this.actionInProgress()) return;
    this.actionInProgress.set(true);
    this.payroll.calculateRun(this.runId).subscribe({
      next: res => {
        this.actionInProgress.set(false);
        const warnings = res.data?.warnings ?? [];
        if (warnings.length > 0) {
          this.toast.add({
            severity: 'warn',
            summary: $localize`:@@payroll-run-detail.component.summary.Paie calculé:Paie calculée`,
            detail: warnings.map(w => w.message).join(' | '),
            life: 12000
          });
        } else {
          this.toast.add({ severity: 'success', summary: $localize`:@@payroll-run-detail.component.summary.Paie:Paie`, detail: $localize`:@@payroll-run-detail.component.detail.Cycle calcul:Cycle calculé.` });
        }
        this.reload();
      },
      error: err => {
        this.actionInProgress.set(false);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@payroll-run-detail.component.summary.Paie:Paie`,
          detail: err?.error?.message ?? $localize`:@@ui.tern.calcul.impossible.4c6059:Calcul impossible.`
        });
      }
    });
  }

  validate(): void {
    if (!this.canValidate() || this.actionInProgress()) return;
    this.confirmation.confirm({
      header: $localize`:@@payroll.payroll-run-detail.ts.valider.le.cycle.944a5d0b:Valider le cycle`,
      message: $localize`:@@payroll.payroll-run-detail.ts.confirmer.la.validation.du.cycle.de.paie.8a61d101:Confirmer la validation du cycle de paie ? Les écritures comptables seront générées et les avances/échéances soldées.`,
      acceptLabel: $localize`:@@payroll-run-detail.component.acceptLabel.Valider:Valider`,
      rejectLabel: $localize`:@@payroll-run-detail.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-primary',
      accept: () => this.executeValidate()
    });
  }

  private executeValidate(): void {
    this.actionInProgress.set(true);
    const year = this.run()?.year;
    this.payroll.validateRun(this.runId).subscribe({
      next: () => {
        this.actionInProgress.set(false);
        this.toast.add({ severity: 'success', summary: $localize`:@@payroll-run-detail.component.summary.Paie:Paie`, detail: $localize`:@@payroll-run-detail.component.detail.Cycle validé:Cycle validé.` });
        if (this.firmInternal() && year != null) {
          this.firmGovernance.syncCollaboratorCosts(year, false).subscribe({
            next: res => {
              const imported = res.data?.imported ?? 0;
              if (imported > 0) {
                this.toast.add({
                  severity: 'info',
                  summary: $localize`:@@payroll-run-detail.component.summary.Coûts collab:Coûts collaborateurs`,
                  detail: $localize`:@@payroll.payroll-run-detail.ts.imported.cout.s.mis.a.jour.depuis.la.pai.6e2c6a2e:${imported}:imported: coût(s) mis à jour depuis la paie validée.`
                });
              }
            }
          });
        }
        this.reload();
      },
      error: err => {
        this.actionInProgress.set(false);
        this.toast.add({ severity: 'error', summary: $localize`:@@payroll-run-detail.component.summary.Paie:Paie`, detail: err?.error?.message ?? $localize`:@@ui.tern.validation.impossible.73f194:Validation impossible.` });
      }
    });
  }

  reopen(): void {
    if (!this.canValidate() || this.actionInProgress()) return;
    this.confirmation.confirm({
      header: $localize`:@@payroll.payroll-run-detail.ts.rouvrir.le.cycle.056d0cfc:Rouvrir le cycle`,
      message: $localize`:@@payroll.payroll-run-detail.ts.confirmer.la.reouverture.du.cycle.les.ec.58920ace:Confirmer la réouverture du cycle ? Les écritures seront extournées et les avances/échéances dé-soldées.`,
      acceptLabel: $localize`:@@payroll-run-detail.component.acceptLabel.Rouvrir:Rouvrir`,
      rejectLabel: $localize`:@@payroll-run-detail.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-primary',
      accept: () => this.executeReopen()
    });
  }

  private executeReopen(): void {
    this.actionInProgress.set(true);
    this.payroll.reopenRun(this.runId).subscribe({
      next: () => { this.actionInProgress.set(false); this.toast.add({ severity: 'success', summary: $localize`:@@payroll-run-detail.component.summary.Paie:Paie`, detail: $localize`:@@payroll-run-detail.component.detail.Cycle rouver:Cycle rouvert.` }); this.reload(); },
      error: err => { this.actionInProgress.set(false); this.toast.add({ severity: 'error', summary: $localize`:@@payroll-run-detail.component.summary.Paie:Paie`, detail: err?.error?.message ?? $localize`:@@ui.tern.reouverture.impossible.91ee08:Réouverture impossible.` }); }
    });
  }

  close(): void {
    if (!this.canValidate() || this.actionInProgress()) return;
    this.confirmation.confirm({
      header: $localize`:@@payroll.payroll-run-detail.ts.cloturer.le.cycle.d17ca05c:Clôturer le cycle`,
      message: $localize`:@@payroll.payroll-run-detail.ts.confirmer.la.cloture.definitive.du.cycle.d38602a0:Confirmer la clôture définitive du cycle ? Cette opération est IRRÉVERSIBLE : la période sera verrouillée et ne pourra plus être rouverte.`,
      acceptLabel: $localize`:@@payroll-run-detail.component.acceptLabel.Clôturer:Clôturer`,
      rejectLabel: $localize`:@@payroll-run-detail.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.executeClose()
    });
  }

  private executeClose(): void {
    this.actionInProgress.set(true);
    this.payroll.closeRun(this.runId).subscribe({
      next: () => { this.actionInProgress.set(false); this.toast.add({ severity: 'success', summary: $localize`:@@payroll-run-detail.component.summary.Paie:Paie`, detail: $localize`:@@payroll-run-detail.component.detail.Cycle clôtur:Cycle clôturé.` }); this.reload(); },
      error: err => { this.actionInProgress.set(false); this.toast.add({ severity: 'error', summary: $localize`:@@payroll-run-detail.component.summary.Paie:Paie`, detail: err?.error?.message ?? $localize`:@@ui.tern.cloture.impossible.f65658:Clôture impossible.` }); }
    });
  }

  showPayslip(payslipId: string): void {
    this.payroll.getPayslip(payslipId).subscribe({
      next: res => {
        this.selectedPayslip.set(res.data ?? null);
        this.payslipDialogVisible = true;
      },
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@payroll-run-detail.component.summary.Bulletin:Bulletin`, detail: $localize`:@@payroll-run-detail.component.detail.Impossible d:Impossible de charger le détail.` })
    });
  }

  downloadPdf(payslipId: string): void {
    this.payroll.downloadPayslipPdf(payslipId).subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bulletin-${payslipId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.toast.add({ severity: 'error', summary: $localize`:@@payroll-run-detail.component.summary.PDF:PDF`, detail: $localize`:@@payroll-run-detail.component.detail.Export PDF i:Export PDF impossible.` })
    });
  }
}
