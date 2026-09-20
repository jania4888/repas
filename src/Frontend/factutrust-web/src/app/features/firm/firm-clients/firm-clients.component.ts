import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { FirmAssignmentService, FirmClientDossier } from '@core/services/firm-assignment.service';
import { FirmContextService } from '@core/services/firm-context.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { FirmFeatureFlagsService } from '@core/services/firm-feature-flags.service';
import { FirmGovernanceActionsService } from '../shared/firm-governance-actions.service';
import { FirmAffectAccountantDialogComponent } from '../affectation/firm-affect-accountant-dialog.component';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

@Component({
  selector: 'app-firm-clients',
  standalone: true,
  imports: [
    CommonModule,
    TableModule,
    TagModule,
    PageHeaderComponent,
    EmptyStateComponent,
    FirmAffectAccountantDialogComponent
  ],
  template: `
    <app-page-header
      title="Dossiers clients"
      subtitle="Sociétés dont vous gérez la comptabilité">
      @if (auth.isFirmManager()) {
        <button type="button" class="fc-btn fc-btn--primary" (click)="createManagedClient()">
          <i class="pi pi-plus"></i> Créer un dossier client
        </button>
      }
    </app-page-header>

    @if (!loading() && clients().length === 0) {
      <app-empty-state
        icon="pi-briefcase"
        [title]="emptyTitle"
        [description]="emptyDescription"
        [actionLabel]="auth.isFirmManager() ? 'Créer un dossier client' : undefined"
        actionRoute="/firm/clients/new">
      </app-empty-state>
    } @else {
      <div class="fc-card">
        <p-table [value]="clients()" [loading]="loading()">
          <ng-template pTemplate="header">
            <tr>
              <th>Société</th>
              <th>Gestionnaire</th>
              <th>Active depuis</th>
              <th>Dossier permanent</th>
              <th class="fc-actions-col"></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>
                {{ row.companyName }}
                @if (row.isFirmManaged) {
                  <p-tag value="Géré par le cabinet" severity="info" styleClass="fc-managed-tag" />
                }
              </td>
              <td>
                @if (row.assignedAccountantName) {
                  {{ row.assignedAccountantName }}
                } @else {
                  <span class="fc-muted">En attente</span>
                }
              </td>
              <td>{{ row.activeSince | date:'dd/MM/yyyy' }}</td>
              <td>
                @if (governanceEnabled()) {
                  @if (row.hasPermanentFile) {
                    <p-tag [value]="row.permanentFileStatusDisplay || 'Ouvert'" [severity]="dpSeverity(row.permanentFileStatus)" />
                  } @else {
                    <p-tag value="Absent" severity="secondary" />
                  }
                } @else {
                  —
                }
              </td>
              <td class="fc-actions">
                <button type="button" class="fc-btn fc-btn--primary" (click)="openDossier(row)">
                  <i class="pi pi-folder-open"></i> Ouvrir la comptabilité
                </button>
                @if (governanceEnabled()) {
                  @if (row.hasPermanentFile) {
                    <button type="button" class="fc-btn fc-btn--secondary" (click)="openPermanentFile(row)">
                      <i class="pi pi-book"></i> Ouvrir dossier permanent
                    </button>
                  } @else {
                    <button type="button" class="fc-btn fc-btn--secondary" (click)="initPermanentFile(row)">
                      <i class="pi pi-file-plus"></i> Initialiser dossier permanent
                    </button>
                  }
                }
                @if (auth.isFirmManager() && governanceEnabled()) {
                  <button type="button" class="fc-btn fc-btn--secondary" (click)="openAffect(row)">
                    <i class="pi pi-user-plus"></i> Affecter
                  </button>
                }
                @if (auth.isFirmManager()) {
                  <button type="button" class="fc-btn fc-btn--danger-outline" (click)="revoke(row)">
                    <i class="pi pi-times"></i> Résilier
                  </button>
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }

    <app-firm-affect-accountant-dialog
      [(visible)]="affectDialogVisible"
      [assignmentIds]="affectAssignmentIds"
      (assigned)="load()">
    </app-firm-affect-accountant-dialog>
  `,
  styles: [`
    :host { display: block; }
    .fc-card {
      background: var(--color-surface, #fff);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-xl, 16px);
      box-shadow: var(--shadow-soft-sm, 0 1px 2px rgba(15, 23, 42, 0.05));
      padding: var(--spacing-2, 8px);
    }
    .fc-muted { color: var(--color-text-muted, #94a3b8); font-style: italic; }
    :host ::ng-deep .fc-managed-tag { margin-left: 0.5rem; font-size: 0.7rem; }
    .fc-actions-col { width: 1%; }
    .fc-actions { display: flex; gap: 0.5rem; justify-content: flex-end; flex-wrap: wrap; }
    .fc-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.45rem 0.85rem;
      border-radius: var(--radius-md, 8px);
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
    }
    .fc-btn--primary { background: var(--color-primary-600, #2563eb); color: #fff; }
    .fc-btn--primary:hover { background: var(--color-primary-700, #1d4ed8); }
    .fc-btn--secondary {
      background: transparent;
      color: var(--color-primary-700, #1d4ed8);
      border-color: var(--color-primary-300, #93c5fd);
    }
    .fc-btn--secondary:hover { background: var(--color-primary-50, #eff6ff); }
    .fc-btn--danger-outline {
      background: transparent;
      color: var(--color-danger-600, #dc2626);
      border-color: var(--color-danger-300, #fca5a5);
    }
    .fc-btn--danger-outline:hover { background: var(--color-danger-50, #fef2f2); }
  `]
})
export class FirmClientsComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly assignments = inject(FirmAssignmentService);
  private readonly firmContext = inject(FirmContextService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly governanceActions = inject(FirmGovernanceActionsService);
  private readonly featureFlags = inject(FirmFeatureFlagsService);

  readonly clients = signal<FirmClientDossier[]>([]);
  readonly loading = signal(true);
  readonly governanceEnabled = () => this.featureFlags.isEnabled('firmGovernance');

  affectDialogVisible = false;
  affectAssignmentIds: string[] = [];

  get emptyTitle(): string {
    return this.auth.isFirmAccountant()
      ? 'Aucun dossier affecté'
      : 'Aucun dossier client';
  }

  get emptyDescription(): string {
    return this.auth.isFirmAccountant()
      ? 'Aucun dossier ne vous est affecté. Contactez le responsable du cabinet.'
      : 'Acceptez une invitation depuis la page Invitations pour commencer à gérer un dossier.';
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.assignments.getActiveClients().subscribe({
      next: r => {
        if (r.success) this.clients.set(r.data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  createManagedClient(): void {
    void this.router.navigate(['/firm/clients/new']);
  }

  openAffect(row: FirmClientDossier): void {
    this.affectAssignmentIds = [row.assignmentId];
    this.affectDialogVisible = true;
  }

  async openDossier(row: FirmClientDossier): Promise<void> {
    try {
      await this.firmContext.switchClient(row.companyTenantId);
      await this.router.navigate(['/accounting/chart']);
    } catch {
      this.toast.add({ severity: 'error', summary: 'Erreur', detail: "Impossible d'ouvrir le dossier." });
    }
  }

  initPermanentFile(row: FirmClientDossier): void {
    void this.governanceActions.initializePermanentFile({
      assignmentId: row.assignmentId,
      companyName: row.companyName
    });
  }

  openPermanentFile(row: FirmClientDossier): void {
    const mode = row.permanentFileStatus === 2 ? 'view' : 'edit';
    this.governanceActions.openPermanentFile(row.assignmentId, mode);
  }

  dpSeverity(status?: number | null): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    switch (status) {
      case 2: return 'success';
      case 1: return 'warning';
      case 9: return 'secondary';
      default: return 'info';
    }
  }

  revoke(row: FirmClientDossier): void {
    this.confirmation.confirm({
      header: 'Résilier le dossier',
      message: `Résilier la liaison avec « ${row.companyName} » ? Vous perdrez l'accès à sa comptabilité.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Résilier',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.assignments.revokeClient(row.assignmentId).subscribe({
          next: r => {
            if (r.success) {
              this.toast.add({ severity: 'success', summary: 'Dossier résilié' });
              this.load();
            } else {
              this.toast.add({ severity: 'error', summary: 'Action impossible', detail: r.message ?? 'Une erreur est survenue.' });
            }
          },
          error: () => this.toast.add({ severity: 'error', summary: 'Action impossible', detail: 'Une erreur est survenue.' })
        });
      }
    });
  }
}
