import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { PendingRecurringDraft, RecurringContractService } from '@core/services/recurring-contract.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { DraftAdjustDialogComponent } from '../../components/draft-adjust-dialog.component';

@Component({
  selector: 'app-pending-drafts',
  standalone: true,
  imports: [
    CommonModule, RouterModule, TableModule,
    PageHeaderComponent, BreadcrumbComponent, ButtonComponent, EmptyStateComponent, SkeletonTableComponent,
    DraftAdjustDialogComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Brouillons récurrents à valider"
      subtitle="Factures générées automatiquement en attente d'émission">
      <div class="actions">
        <app-button variant="outline" icon="pi-arrow-left" routerLink="/recurring-contracts">
          Retour aux contrats
        </app-button>
        @if (canTriggerBilling()) {
          <app-button
            variant="primary"
            icon="pi-bolt"
            [disabled]="generating()"
            (clicked)="generateDrafts()">
            {{ generating() ? 'Génération…' : 'Générer les brouillons' }}
          </app-button>
        }
      </div>
    </app-page-header>

    @if (loading()) {
      <app-skeleton-table [rows]="5" [columns]="skeletonColumns"></app-skeleton-table>
    } @else if (loadError()) {
      <app-empty-state
        icon="pi-exclamation-triangle"
        title="Impossible de charger les brouillons"
        description="Une erreur est survenue lors du chargement."
        actionLabel="Réessayer"
        (actionClick)="reload()">
      </app-empty-state>
    } @else if (drafts().length === 0) {
      <app-empty-state
        icon="pi-check-circle"
        title="Aucun brouillon en attente"
        description="Les prochaines factures générées automatiquement apparaîtront ici."
        [showAction]="false">
      </app-empty-state>
    } @else {
      <div class="ft-table-card">
        <p-table [value]="drafts()" styleClass="p-datatable-sm" [rowHover]="true">
          <ng-template pTemplate="header">
            <tr>
              <th>Contrat</th>
              <th>Client</th>
              <th>Période</th>
              <th style="width: 140px">Montant</th>
              <th style="width: 280px">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-d>
            <tr>
              <td>
                <a [routerLink]="['/recurring-contracts', d.recurringContractId]" class="contract-number">
                  {{ d.contractNumber || d.recurringContractId }}
                </a>
              </td>
              <td>{{ d.clientName }}</td>
              <td>{{ d.periodFrom | date:'dd/MM/yyyy' }} — {{ d.periodTo | date:'dd/MM/yyyy' }}</td>
              <td class="amount">{{ d.totalAmount | currency:'TND':'symbol':'1.3-3' }}</td>
              <td>
                <div class="row-actions">
                  @if (canValidateInvoice()) {
                    <app-button
                      variant="primary"
                      size="sm"
                      icon="pi-check"
                      [disabled]="issuingId() === d.billingRunId"
                      (clicked)="confirmIssue(d)">
                      {{ issuingId() === d.billingRunId ? 'Émission…' : 'Valider' }}
                    </app-button>
                    <app-button
                      variant="ghost"
                      size="sm"
                      icon="pi-file-edit"
                      (clicked)="openAdjust(d)">
                      Ajuster
                    </app-button>
                  }
                  <app-button
                    variant="ghost"
                    size="sm"
                    icon="pi-eye"
                    [routerLink]="['/recurring-contracts', d.recurringContractId]">
                    Voir le contrat
                  </app-button>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }

    <app-draft-adjust-dialog
      [(visible)]="adjustVisible"
      [billingRunId]="adjustRunId"
      (saved)="reload()"
      (issued)="reload()">
    </app-draft-adjust-dialog>
  `,
  styles: [`
    .actions { display: flex; gap: var(--spacing-2); flex-wrap: wrap; }
    .row-actions { display: flex; gap: var(--spacing-2); flex-wrap: wrap; }

    .contract-number {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
      font-size: var(--font-size-sm);
      text-decoration: none;
    }

    .contract-number:hover { text-decoration: underline; }

    .amount {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-medium);
      white-space: nowrap;
    }
  `]
})
export class PendingDraftsComponent implements OnInit {
  private readonly service = inject(RecurringContractService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly confirmation = inject(ConfirmationService);

  readonly drafts = signal<PendingRecurringDraft[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly generating = signal(false);
  readonly issuingId = signal<string | null>(null);
  adjustVisible = false;
  adjustRunId: string | null = null;

  readonly canTriggerBilling = computed(() => this.auth.hasPermission(PERMISSIONS.recurringContracts.triggerBilling));
  readonly canValidateInvoice = computed(() => this.auth.hasPermission(PERMISSIONS.invoices.create));

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Accueil', route: '/', icon: 'pi-home' },
    { label: 'Contrats récurrents', route: '/recurring-contracts' },
    { label: 'Brouillons à valider' }
  ];

  readonly skeletonColumns: SkeletonColumn[] = [
    { width: '160px' },
    { width: '200px' },
    { width: '220px' },
    { width: '140px' },
    { width: '280px' }
  ];

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.service.listPendingDrafts().subscribe({
      next: items => {
        this.drafts.set(items);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.loadError.set(true);
        this.errorHandler.logError('RecurringContracts: pending drafts', err);
        this.toast.add({
          severity: 'error',
          summary: 'Erreur',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  openAdjust(draft: PendingRecurringDraft): void {
    this.adjustRunId = draft.billingRunId;
    this.adjustVisible = true;
  }

  confirmIssue(draft: PendingRecurringDraft): void {
    this.confirmation.confirm({
      header: 'Confirmer l\'émission',
      message: 'Une fois validée, cette facture ne pourra plus être modifiée. Confirmer l\'émission ?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Émettre la facture',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-success',
      size: 'md',
      accept: () => this.issue(draft)
    });
  }

  generateDrafts(): void {
    this.generating.set(true);
    this.service.triggerBilling().subscribe({
      next: count => {
        this.generating.set(false);
        this.toast.add({
          severity: 'success',
          summary: 'Génération terminée',
          detail: `${count} brouillon(s) généré(s).`
        });
        this.reload();
      },
      error: err => {
        this.generating.set(false);
        this.errorHandler.logError('RecurringContracts: trigger billing', err);
        this.toast.add({
          severity: 'error',
          summary: 'Erreur',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  private issue(draft: PendingRecurringDraft): void {
    this.issuingId.set(draft.billingRunId);
    this.service.issueBillingRun(draft.billingRunId).subscribe({
      next: issued => {
        this.issuingId.set(null);
        this.toast.add({
          severity: 'success',
          summary: 'Facture émise',
          detail: `Facture ${issued.invoiceNumber} émise.`
        });
        this.reload();
      },
      error: err => {
        this.issuingId.set(null);
        this.errorHandler.logError('RecurringContracts: issue billing run', err);
        this.toast.add({
          severity: 'error',
          summary: 'Émission impossible',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }
}
