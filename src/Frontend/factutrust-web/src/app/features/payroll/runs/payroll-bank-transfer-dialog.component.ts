/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { MessageModule } from 'primeng/message';
import { TabsModule } from 'primeng/tabs';
import { finalize } from 'rxjs';
import {
  PayrollService,
  type PayrollBankTransferPreview
} from '@core/services/payroll.service';
import { BankAccountService, type BankAccountDto } from '@core/services/bank-account.service';
import { ToastService } from '@core/services/toast.service';
import { ButtonComponent } from '@shared/components/button/button.component';
import { PayrollAmountPipe, formatPayrollAmount } from '../shared';
import { downloadBlob } from '../../accounting/shared/accounting-download.util';

@Component({
  selector: 'app-payroll-bank-transfer-dialog',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule,
    FormsModule,
    DialogModule,
    SelectModule,
    InputTextModule,
    TableModule,
    MessageModule,
    TabsModule,
    ButtonComponent,
    PayrollAmountPipe
  ],
  template: `
    <p-dialog
      header="Export virement bancaire" i18n-header="@@payroll.runs.export.virement.bancaire.c7c80325"
      [(visible)]="visibleProxy"
      [modal]="true"
      [style]="{ width: '820px' }"
      (onShow)="onOpen()"
      (onHide)="closed.emit()">
      <p class="hint mb-3" i18n="@@payroll.runs.fichier.csv.standard.utf.8.pour.depot.sur.le.por.1e175a62"> Fichier CSV standard (; UTF-8) pour dépôt sur le portail de votre banque.
        Vérifiez le modèle exigé par votre établissement avant import. </p>

      <div class="toolbar mb-3">
        <div class="field">
          <label for="bt-account" i18n="@@payroll.runs.compte.debiteur.b7abcb4f">Compte débiteur</label>
          <p-select
            inputId="bt-account"
            [options]="accountOptions()"
            [(ngModel)]="selectedAccountId"
            (ngModelChange)="reloadPreview()"
            optionLabel="label"
            optionValue="value"
            placeholder="Compte par défaut" i18n-placeholder="@@payroll.runs.compte.par.defaut.938477de"
            [showClear]="true"
            styleClass="w-full" />
        </div>
        <div class="field">
          <label for="bt-label" i18n="@@payroll.runs.libelle.f5485bba">Libellé</label>
          <input pInputText id="bt-label" class="w-full" [(ngModel)]="transferLabel" (change)="reloadPreview()" />
        </div>
      </div>

      @if (loading()) {
        <p i18n="@@payroll.runs.chargement.de.la.previsualisation.6b5a113b">Chargement de la prévisualisation…</p>
      } @else if (preview()) {
        @for (w of preview()!.warnings; track w.code) {
          <p-message severity="warn" [text]="w.message" styleClass="mb-2 w-full" />
        }

        <div class="summary mb-3" i18n="@@payroll.runs.virement.s.total.f3fda0b7">
          <span><strong>{{ preview()!.eligibleCount }}</strong> virement(s)</span>
          <span><ng-container>Total : </ng-container> <strong>{{ preview()!.totalAmount | payrollAmount }}</strong></span>
        </div>

        <p-tabs [lazy]="true">
          <p-tablist>
            <p-tab [value]="0" i18n="@@payroll.runs.inclus.93602bdc">Inclus ({{ preview()!.eligibleCount }})</p-tab>
            <p-tab [value]="1" i18n="@@payroll.runs.exclus.818519f4">Exclus ({{ preview()!.excludedLines.length }})</p-tab>
          </p-tablist>
          <p-tabpanels>
          <p-tabpanel [value]="0">
            <div class="payroll-table-scroll">
              <p-table [value]="preview()!.lines" styleClass="p-datatable-sm">
                <ng-template pTemplate="header">
                  <tr>
                    <th i18n="@@payroll.runs.matricule.8f74c132">Matricule</th>
                    <th i18n="@@payroll.runs.salarie.27f97915">Salarié</th>
                    <th i18n="@@payroll.runs.rib.61f3ea57">RIB</th>
                    <th class="text-right" i18n="@@payroll.runs.net.9bb81c2e">Net</th>
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-l>
                  <tr>
                    <td>{{ l.employeeNumber }}</td>
                    <td>{{ l.fullName }}</td>
                    <td class="mono">{{ maskRib(l.rib) }}</td>
                    <td class="text-right">{{ l.netSalary | payrollAmount }}</td>
                  </tr>
                </ng-template>
                <ng-template pTemplate="emptymessage">
                  <tr><td colspan="4" i18n="@@payroll.runs.aucun.salarie.eligible.rib.valide.et.net.gt.0.3f1d6219">Aucun salarié éligible (RIB valide et net &gt; 0).</td></tr>
                </ng-template>
              </p-table>
            </div>
          </p-tabpanel>
          <p-tabpanel [value]="1">
            <div class="payroll-table-scroll">
              <p-table [value]="preview()!.excludedLines" styleClass="p-datatable-sm">
                <ng-template pTemplate="header">
                  <tr>
                    <th i18n="@@payroll.runs.matricule.8f74c132">Matricule</th>
                    <th i18n="@@payroll.runs.salarie.27f97915">Salarié</th>
                    <th i18n="@@payroll.runs.motif.2a198f47">Motif</th>
                    <th class="text-right" i18n="@@payroll.runs.net.9bb81c2e">Net</th>
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-e>
                  <tr>
                    <td>{{ e.employeeNumber }}</td>
                    <td>{{ e.employeeName }}</td>
                    <td>{{ e.reasonDisplay | backendLabel }}</td>
                    <td class="text-right">{{ e.netSalary | payrollAmount }}</td>
                  </tr>
                </ng-template>
                <ng-template pTemplate="emptymessage">
                  <tr><td colspan="4" i18n="@@payroll.runs.aucun.exclu.eb8cdb35">Aucun exclu.</td></tr>
                </ng-template>
              </p-table>
            </div>
          </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
      }

      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="close()" i18n="@@payroll.runs.annuler.49ba3292">Annuler</app-button>
        <app-button
          variant="primary"
          icon="pi-download"
          iconPos="left"
          [disabled]="!canDownload() || downloading()"
          (click)="download()" i18n="@@payroll.runs.telecharger.csv.7a1a04b2"> Télécharger CSV </app-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .hint { color: var(--color-text-secondary); font-size: 0.9rem; margin: 0; }
    .mb-2 { margin-bottom: var(--spacing-2); display: block; }
    .mb-3 { margin-bottom: var(--spacing-4); }
    .toolbar { display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-4); }
    .field label { display: block; margin-bottom: var(--spacing-1); font-weight: 500; }
    .summary { display: flex; gap: var(--spacing-6); }
    .mono { font-family: var(--font-mono, monospace); letter-spacing: 0.02em; }
    .text-right { text-align: right; }
    .payroll-table-scroll { overflow-x: auto; }
    @media (max-width: 640px) {
      .toolbar { grid-template-columns: 1fr; }
    }
  `]
})
export class PayrollBankTransferDialogComponent implements OnInit {
  private readonly payroll = inject(PayrollService);
  private readonly banks = inject(BankAccountService);
  private readonly toast = inject(ToastService);

  readonly runId = input.required<string>();
  readonly periodLabel = input.required<string>();
  readonly visible = input(false);
  readonly closed = output<void>();

  preview = signal<PayrollBankTransferPreview | null>(null);
  loading = signal(false);
  downloading = signal(false);
  accounts = signal<BankAccountDto[]>([]);
  selectedAccountId: string | null = null;
  transferLabel = '';

  /** Two-way proxy for p-dialog visible binding. */
  get visibleProxy(): boolean {
    return this.visible();
  }
  set visibleProxy(v: boolean) {
    if (!v) this.closed.emit();
  }

  accountOptions = computed(() =>
    this.accounts()
      .filter(a => a.isActive)
      .map(a => ({
        value: a.id,
        label: `${a.bankName}${a.isDefault ? $localize`:@@ui.tern.defaut.f21337: (défaut)` : ''} — …${a.rib.slice(-4)}`
      }))
  );

  canDownload = computed(() => (this.preview()?.eligibleCount ?? 0) > 0);

  ngOnInit(): void {
    this.transferLabel = this.periodLabel();
    this.banks.list().subscribe({
      next: res => {
        const list = res.data ?? [];
        this.accounts.set(list);
        const def = list.find(a => a.isDefault && a.isActive);
        this.selectedAccountId = def?.id ?? null;
      },
      error: () => this.accounts.set([])
    });
  }

  onOpen(): void {
    this.transferLabel = this.periodLabel();
    this.reloadPreview();
  }

  reloadPreview(): void {
    if (!this.runId()) return;
    this.loading.set(true);
    this.payroll
      .getBankTransferPreview(
        this.runId(),
        this.selectedAccountId ?? undefined,
        this.transferLabel || undefined
      )
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: res => this.preview.set(res.data ?? null),
        error: err => {
          this.preview.set(null);
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@payroll-bank-transfer-dialog.component.summary.Virement:Virement`,
            detail: err?.error?.message ?? $localize`:@@ui.tern.impossible.de.previsualiser.le.virement.0d7fd5:Impossible de prévisualiser le virement.`
          });
        }
      });
  }

  maskRib(rib: string): string {
    if (!rib || rib.length < 4) return '****';
    return `****${rib.slice(-4)}`;
  }

  download(): void {
    if (!this.canDownload()) return;
    this.downloading.set(true);
    const run = this.preview()!;
    this.payroll
      .exportBankTransfer(this.runId(), {
        format: 'csv',
        bankAccountId: this.selectedAccountId ?? undefined,
        label: this.transferLabel || undefined
      })
      .pipe(finalize(() => this.downloading.set(false)))
      .subscribe({
        next: blob => {
          const name = `virement_paie_${run.year}_${String(run.month).padStart(2, '0')}.csv`;
          downloadBlob(blob, name);
          this.toast.add({
            severity: 'success',
            summary: $localize`:@@payroll-bank-transfer-dialog.component.summary.Virement:Virement`,
            detail: $localize`:@@payroll.payroll-bank-transfer-dialog.ts.fichier.telecharge.eligiblecount.viremen.44bc711f:Fichier téléchargé (${run.eligibleCount}:eligibleCount: virement(s), ${formatPayrollAmount(run.totalAmount)}:formatPayrollAmount:).`
          });
          this.close();
        },
        error: err =>
          this.toast.add({
            severity: 'error',
            summary: $localize`:@@payroll-bank-transfer-dialog.component.summary.Virement:Virement`,
            detail: err?.error?.message ?? $localize`:@@ui.tern.export.csv.impossible.52ba05:Export CSV impossible.`
          })
      });
  }

  close(): void {
    this.closed.emit();
  }
}
