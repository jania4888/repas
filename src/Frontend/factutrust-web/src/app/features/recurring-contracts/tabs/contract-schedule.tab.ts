import { Component, EventEmitter, Input, OnChanges, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import {
  ContractScheduleEntry,
  RecurringContractDetail,
  RecurringContractService
} from '@core/services/recurring-contract.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { scheduleBadgeStatus } from '../recurring-contracts.ui-utils';
import { DraftAdjustDialogComponent } from '../components/draft-adjust-dialog.component';

/** Onglet « Échéances » : calendrier prévisionnel (endpoint phase 2, tolérant 404). */
@Component({
  selector: 'app-contract-schedule-tab',
  standalone: true,
  imports: [
    CommonModule, RouterModule, TableModule,
    ButtonComponent, EmptyStateComponent, StatusBadgeComponent, SkeletonTableComponent,
    DraftAdjustDialogComponent
  ],
  template: `
    <div class="section-header">
      <h3>Échéancier prévisionnel</h3>
      @if (canGenerate()) {
        <app-button
          variant="primary"
          size="sm"
          icon="pi-bolt"
          [disabled]="generating()"
          (clicked)="generateNow()">
          {{ generating() ? 'Génération…' : 'Générer maintenant' }}
        </app-button>
      }
    </div>

    @if (loading()) {
      <app-skeleton-table [rows]="6" [columns]="skeletonColumns"></app-skeleton-table>
    } @else if (entries() === null) {
      <app-empty-state
        icon="pi-calendar"
        title="Échéancier disponible prochainement"
        description="L'échéancier prévisionnel sera disponible après la mise à jour du serveur."
        [showAction]="false">
      </app-empty-state>
    } @else if (entries()!.length === 0) {
      <app-empty-state
        icon="pi-calendar-times"
        title="Aucune échéance à venir"
        description="Ce contrat est terminé ou résilié : aucune occurrence future."
        [showAction]="false">
      </app-empty-state>
    } @else {
      <div class="ft-table-card">
        <p-table [value]="entries()!" styleClass="p-datatable-sm" [rowHover]="true">
          <ng-template pTemplate="header">
            <tr>
              <th style="width: 120px">Échéance</th>
              <th>Période</th>
              <th style="width: 140px">Montant estimé HT</th>
              <th style="width: 140px">Statut</th>
              <th style="width: 240px">Action</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-e>
            <tr>
              <td>{{ e.date | date:'dd/MM/yyyy' }}</td>
              <td>{{ e.description }}</td>
              <td class="amount">{{ e.estimatedAmountHT | currency:contract.currency:'symbol':'1.3-3' }}</td>
              <td>
                <app-status-badge [status]="scheduleBadgeStatus(e.status)" [label]="e.statusDisplay">
                </app-status-badge>
              </td>
              <td>
                @if (e.invoiceId) {
                  <app-button variant="ghost" size="sm" icon="pi-receipt" [routerLink]="['/invoices', e.invoiceId]">
                    Voir la facture
                  </app-button>
                } @else if (e.billingRunId && e.invoiceDraftId) {
                  <div class="row-actions">
                    @if (canIssue()) {
                      <app-button
                        variant="primary"
                        size="sm"
                        icon="pi-check"
                        [disabled]="issuingId() === e.billingRunId"
                        (clicked)="confirmIssue(e)">
                        {{ issuingId() === e.billingRunId ? 'Émission…' : 'Émettre' }}
                      </app-button>
                      <app-button
                        variant="ghost"
                        size="sm"
                        icon="pi-file-edit"
                        (clicked)="openAdjust(e)">
                        Ajuster
                      </app-button>
                    }
                  </div>
                } @else {
                  <span class="muted">—</span>
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }

    <app-draft-adjust-dialog
      [(visible)]="adjustVisible"
      [billingRunId]="adjustRunId"
      (saved)="onDraftMutated()"
      (issued)="onDraftMutated()">
    </app-draft-adjust-dialog>
  `,
  styles: [`
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-4);

      h3 { margin: 0; font-size: var(--font-size-lg); color: var(--color-neutral-800); }
    }

    .amount {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-medium);
      white-space: nowrap;
    }

    .muted { color: var(--color-neutral-400); }

    .row-actions { display: flex; gap: var(--spacing-2); flex-wrap: wrap; }
  `]
})
export class ContractScheduleTabComponent implements OnInit, OnChanges {
  @Input({ required: true }) contract!: RecurringContractDetail;
  /** Incrémenté par la page parente après une action (suspendre, renouveler…) pour recharger. */
  @Input() refreshToken = 0;
  /** Notifie la fiche contrat pour recharger détail / Services / Historique / KPI. */
  @Output() draftChanged = new EventEmitter<void>();

  private readonly service = inject(RecurringContractService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly confirmation = inject(ConfirmationService);

  readonly entries = signal<ContractScheduleEntry[] | null>([]);
  readonly loading = signal(true);
  readonly generating = signal(false);
  readonly issuingId = signal<string | null>(null);
  adjustVisible = false;
  adjustRunId: string | null = null;
  private initialized = false;

  readonly canGenerate = computed(() =>
    this.contract.status === 'Active' && this.auth.hasPermission(PERMISSIONS.recurringContracts.triggerBilling));
  readonly canIssue = computed(() => this.auth.hasPermission(PERMISSIONS.invoices.create));

  readonly skeletonColumns: SkeletonColumn[] = [
    { width: '120px' }, { width: '260px' }, { width: '140px' }, { width: '140px' }, { width: '170px' }
  ];

  protected readonly scheduleBadgeStatus = scheduleBadgeStatus;

  ngOnInit(): void {
    this.initialized = true;
    this.load();
  }

  ngOnChanges(): void {
    if (this.initialized) this.load();
  }

  load(): void {
    this.loading.set(true);
    this.service.getSchedule(this.contract.id, 12).subscribe({
      next: entries => {
        // L'API renvoie l'échéancier en décroissant ; l'onglet présente la prochaine
        // échéance en premier (ordre chronologique, comme le mockup et le top-3 Aperçu).
        this.entries.set(
          [...(entries ?? [])].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')));
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.errorHandler.logError('RecurringContracts: schedule', err);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }

  onDraftMutated(): void {
    this.load();
    this.draftChanged.emit();
  }

  generateNow(): void {
    this.generating.set(true);
    this.service.triggerBilling(this.contract.id).subscribe({
      next: count => {
        this.generating.set(false);
        this.toast.add({
          severity: 'success',
          summary: 'Génération terminée',
          detail: `${count} brouillon(s) généré(s).`
        });
        this.load();
      },
      error: err => {
        this.generating.set(false);
        this.errorHandler.logError('RecurringContracts: trigger billing', err);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }

  openAdjust(entry: ContractScheduleEntry): void {
    if (!entry.billingRunId) return;
    this.adjustRunId = entry.billingRunId;
    this.adjustVisible = true;
  }

  confirmIssue(entry: ContractScheduleEntry): void {
    if (!entry.billingRunId) return;
    this.confirmation.confirm({
      header: 'Confirmer l\'émission',
      message: 'Une fois validée, cette facture ne pourra plus être modifiée. Confirmer l\'émission ?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Émettre la facture',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-success',
      size: 'md',
      accept: () => this.issue(entry.billingRunId!)
    });
  }

  private issue(billingRunId: string): void {
    this.issuingId.set(billingRunId);
    this.service.issueBillingRun(billingRunId).subscribe({
      next: issued => {
        this.issuingId.set(null);
        this.toast.add({
          severity: 'success',
          summary: 'Facture émise',
          detail: `Facture ${issued.invoiceNumber} émise.`
        });
        this.load();
        this.draftChanged.emit();
      },
      error: err => {
        this.issuingId.set(null);
        this.errorHandler.logError('RecurringContracts: issue from schedule', err);
        this.toast.add({
          severity: 'error',
          summary: 'Émission impossible',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }
}
