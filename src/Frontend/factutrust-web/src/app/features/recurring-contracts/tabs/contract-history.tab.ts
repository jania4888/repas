import { Component, EventEmitter, Input, OnChanges, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import {
  ContractAmendment,
  RecurringContractBillingRun,
  RecurringContractDetail,
  RecurringContractService
} from '@core/services/recurring-contract.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { runBadgeStatus } from '../recurring-contracts.ui-utils';
import { DraftAdjustDialogComponent } from '../components/draft-adjust-dialog.component';

/**
 * Onglet « Historique » : chronologie des facturations (endpoint existant) et des
 * avenants (endpoint phase 2 — trace aussi suspensions, reprises et renouvellements).
 */
@Component({
  selector: 'app-contract-history-tab',
  standalone: true,
  imports: [
    CommonModule, RouterModule, TableModule, TooltipModule,
    ButtonComponent, StatusBadgeComponent, SkeletonTableComponent,
    DraftAdjustDialogComponent
  ],
  template: `
    <section class="ft-card-block">
      <h3 class="block-title"><i class="pi pi-receipt"></i> Facturations</h3>
      @if (loadingRuns()) {
        <app-skeleton-table [rows]="4" [columns]="runsSkeletonColumns"></app-skeleton-table>
      } @else if (runs().length === 0) {
        <p class="placeholder-note">Aucune facturation pour l'instant.</p>
      } @else {
        <p-table [value]="runs()" styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th>Période</th>
              <th style="width: 150px">Statut</th>
              <th style="width: 110px">Fixe</th>
              <th style="width: 130px">Consommation</th>
              <th style="width: 110px">Prorata</th>
              <th style="width: 120px">Total</th>
              <th style="width: 130px">Créé le</th>
              <th style="width: 140px">Lien</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr>
              <td>{{ r.periodFrom | date:'dd/MM/yyyy' }} — {{ r.periodTo | date:'dd/MM/yyyy' }}</td>
              <td>
                <app-status-badge [status]="runBadgeStatus(r.status)" [label]="r.statusDisplay"></app-status-badge>
                @if (r.status === 'Failed' && r.errorMessage) {
                  <div class="run-error" [pTooltip]="r.errorMessage" tooltipPosition="top">
                    <i class="pi pi-exclamation-triangle"></i> {{ r.errorMessage }}
                  </div>
                }
              </td>
              <td class="amount">{{ r.fixedAmount | currency:contract.currency:'symbol':'1.3-3' }}</td>
              <td class="amount">{{ r.usageAmount | currency:contract.currency:'symbol':'1.3-3' }}</td>
              <td class="amount">{{ r.prorationAmount | currency:contract.currency:'symbol':'1.3-3' }}</td>
              <td class="amount"><strong>{{ r.totalAmount | currency:contract.currency:'symbol':'1.3-3' }}</strong></td>
              <td>{{ r.createdAt | date:'dd/MM/yyyy HH:mm' }}</td>
              <td>
                @if (r.invoiceId) {
                  <app-button
                    variant="ghost" size="sm" icon="pi-receipt" [iconOnly]="true"
                    [routerLink]="['/invoices', r.invoiceId]" ariaLabel="Voir la facture">
                  </app-button>
                } @else if (r.status === 'DraftCreated' && r.invoiceDraftId) {
                  <div class="row-actions">
                    @if (canIssue()) {
                      <app-button
                        variant="primary" size="sm" icon="pi-check" [iconOnly]="true"
                        [disabled]="issuingId() === r.id"
                        (clicked)="confirmIssue(r)"
                        ariaLabel="Émettre la facture">
                      </app-button>
                      <app-button
                        variant="ghost" size="sm" icon="pi-file-edit" [iconOnly]="true"
                        (clicked)="openAdjust(r)"
                        ariaLabel="Ajuster le brouillon">
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
      }
    </section>

    <section class="ft-card-block">
      <div class="block-head">
        <h3 class="block-title"><i class="pi pi-history"></i> Avenants et cycle de vie</h3>
        @if (canAmend()) {
          <app-button variant="primary" size="sm" icon="pi-file-plus" (clicked)="createAmend.emit()">
            Nouvel avenant
          </app-button>
        }
      </div>
      @if (loadingAmendments()) {
        <div class="stack">
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
        </div>
      } @else if (amendments() === null) {
        <p class="placeholder-note">L'historique des avenants sera disponible après la mise à jour du serveur.</p>
      } @else if (amendments()!.length === 0) {
        <p class="placeholder-note">Aucun avenant enregistré.</p>
      } @else {
        <ul class="timeline">
          @for (a of amendments()!; track a.id) {
            <li class="timeline__item">
              <div class="timeline__date">{{ a.effectiveDate | date:'dd/MM/yyyy' }}</div>
              <div class="timeline__body">
                <span class="timeline__type">{{ a.typeDisplay }}</span>
                @if (a.notes) {
                  <p class="timeline__notes">{{ a.notes }}</p>
                }
                <span class="timeline__meta">
                  Enregistré le {{ a.createdAt | date:'dd/MM/yyyy HH:mm' }}
                  @if (a.createdByUserName) { par {{ a.createdByUserName }} }
                  · {{ a.prorationPolicyDisplay }}
                </span>
              </div>
            </li>
          }
        </ul>
      }
    </section>

    <app-draft-adjust-dialog
      [(visible)]="adjustVisible"
      [billingRunId]="adjustRunId"
      (saved)="onDraftMutated()"
      (issued)="onDraftMutated()">
    </app-draft-adjust-dialog>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: var(--spacing-4); }

    .ft-card-block {
      background: var(--color-background-elevated);
      border: 1px solid var(--color-border-subtle);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-soft-sm, var(--shadow-sm));
      padding: var(--spacing-4);
    }

    .block-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-2);
      margin: 0 0 var(--spacing-3);
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-700);
      text-transform: uppercase;
      letter-spacing: 0.05em;

      .pi { color: var(--color-primary-600); }
    }

    .block-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-3);

      .block-title { margin-bottom: 0; }
    }

    .amount {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      white-space: nowrap;
    }

    .muted { color: var(--color-neutral-400); }

    .row-actions { display: flex; gap: var(--spacing-1); flex-wrap: wrap; align-items: center; }

    .run-error {
      margin-top: var(--spacing-1);
      font-size: var(--font-size-xs);
      color: var(--color-error-600, #dc2626);
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      .pi { font-size: var(--font-size-xs); }
    }

    .placeholder-note {
      margin: 0;
      color: var(--color-text-tertiary);
      font-size: var(--font-size-sm);
    }

    .stack { display: flex; flex-direction: column; gap: var(--spacing-2); }

    .skeleton-line {
      height: 1.5rem;
      border-radius: var(--radius-sm);
      background: var(--color-neutral-200);
    }

    .timeline {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .timeline__item {
      display: flex;
      gap: var(--spacing-4);
      padding: var(--spacing-3) 0;
      border-bottom: 1px solid var(--color-neutral-100);

      &:last-child { border-bottom: none; }
    }

    .timeline__date {
      min-width: 90px;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
    }

    .timeline__body { flex: 1; min-width: 0; }

    .timeline__type {
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
    }

    .timeline__notes {
      margin: var(--spacing-1) 0;
      font-size: var(--font-size-sm);
      color: var(--color-neutral-700);
    }

    .timeline__meta {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
    }
  `]
})
export class ContractHistoryTabComponent implements OnInit, OnChanges {
  @Input({ required: true }) contract!: RecurringContractDetail;
  @Input() refreshToken = 0;
  @Output() createAmend = new EventEmitter<void>();
  /** Notifie la fiche contrat pour recharger détail / Services / Échéances / KPI. */
  @Output() draftChanged = new EventEmitter<void>();

  private readonly service = inject(RecurringContractService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly confirmation = inject(ConfirmationService);

  readonly runs = signal<RecurringContractBillingRun[]>([]);
  readonly amendments = signal<ContractAmendment[] | null>([]);
  readonly loadingRuns = signal(true);
  readonly loadingAmendments = signal(true);
  readonly issuingId = signal<string | null>(null);
  adjustVisible = false;
  adjustRunId: string | null = null;
  private initialized = false;

  /** Avenant de lignes : réservé aux contrats actifs (backend AmendLines) + permission manage. */
  readonly canAmend = computed(() =>
    this.contract.status === 'Active' && this.auth.hasPermission(PERMISSIONS.recurringContracts.manage));
  readonly canIssue = computed(() => this.auth.hasPermission(PERMISSIONS.invoices.create));

  readonly runsSkeletonColumns: SkeletonColumn[] = [
    { width: '200px' }, { width: '150px' }, { width: '110px' }, { width: '130px' }, { width: '110px' }, { width: '120px' }, { width: '130px' }, { width: '90px' }
  ];

  protected readonly runBadgeStatus = runBadgeStatus;

  ngOnInit(): void {
    this.initialized = true;
    this.load();
  }

  ngOnChanges(): void {
    if (this.initialized) this.load();
  }

  load(): void {
    this.loadRuns();
    this.loadAmendments();
  }

  loadRuns(): void {
    this.loadingRuns.set(true);
    this.service.listBillingRuns(this.contract.id).subscribe({
      next: runs => {
        this.runs.set(runs);
        this.loadingRuns.set(false);
      },
      error: err => {
        this.loadingRuns.set(false);
        this.errorHandler.logError('RecurringContracts: billing runs', err);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }

  onDraftMutated(): void {
    this.load();
    this.draftChanged.emit();
  }

  private loadAmendments(): void {
    this.loadingAmendments.set(true);
    this.service.getAmendments(this.contract.id).subscribe({
      next: amendments => {
        this.amendments.set(amendments);
        this.loadingAmendments.set(false);
      },
      error: err => {
        this.loadingAmendments.set(false);
        this.errorHandler.logError('RecurringContracts: amendments', err);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: this.errorHandler.extractErrorMessage(err) });
      }
    });
  }

  openAdjust(run: RecurringContractBillingRun): void {
    this.adjustRunId = run.id;
    this.adjustVisible = true;
  }

  confirmIssue(run: RecurringContractBillingRun): void {
    this.confirmation.confirm({
      header: 'Confirmer l\'émission',
      message: 'Une fois validée, cette facture ne pourra plus être modifiée. Confirmer l\'émission ?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Émettre la facture',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-success',
      size: 'md',
      accept: () => this.issue(run.id)
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
        this.loadRuns();
        this.draftChanged.emit();
      },
      error: err => {
        this.issuingId.set(null);
        this.errorHandler.logError('RecurringContracts: issue from history', err);
        this.toast.add({
          severity: 'error',
          summary: 'Émission impossible',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }
}
