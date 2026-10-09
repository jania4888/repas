import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { FirmAssignmentService, FirmClientDossier } from '@core/services/firm-assignment.service';
import { FirmContextService } from '@core/services/firm-context.service';
import { FirmAreaCoherenceService } from '@core/services/firm-area-coherence.service';
import { FIRM_DELEGATED_HOME_ROUTE } from '@core/config/firm-area-access';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';
import { FirmFeatureFlagsService } from '@core/services/firm-feature-flags.service';
import { FirmGovernanceActionsService } from '../shared/firm-governance-actions.service';
import { FirmAffectAccountantDialogComponent } from '../affectation/firm-affect-accountant-dialog.component';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import {
  FirmClientKindFilter,
  filterFirmClientDossiers,
  hasActiveFirmClientFilters,
  isFirmClientAwaitingAssignment,
  uniqueManagers
} from './firm-clients-filters';

const PAGE_SIZES = [15, 25, 50] as const;
const DP_FILTERS = new Set(['all', 'absent', '0', '1', '2', '9']);

@Component({
  selector: 'app-firm-clients',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    TagModule,
    InputTextModule,
    SelectModule,
    TooltipModule,
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
          <i class="pi pi-plus" aria-hidden="true"></i> Créer un dossier client
        </button>
      }
    </app-page-header>

    @if (loading() && clients().length === 0) {
      <div class="fc-card fc-loading" role="status">Chargement des dossiers…</div>
    } @else if (loadError() && clients().length === 0) {
      <app-empty-state
        icon="pi-exclamation-triangle"
        title="Impossible de charger les dossiers"
        [description]="loadError()!"
        actionLabel="Réessayer"
        (actionClick)="load()">
      </app-empty-state>
    } @else if (!loading() && clients().length === 0) {
      <app-empty-state
        icon="pi-briefcase"
        [title]="emptyTitle"
        [description]="emptyDescription"
        [actionLabel]="auth.isFirmManager() ? 'Créer un dossier client' : undefined"
        actionRoute="/firm/clients/new">
      </app-empty-state>
    } @else {
      @if (loadError()) {
        <div class="fc-error" role="alert">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          <span>{{ loadError() }}</span>
          <button type="button" class="fc-btn fc-btn--secondary" [disabled]="loading()" (click)="load()">
            Réessayer
          </button>
        </div>
      }

      <section class="ft-filters" aria-labelledby="fc-filters-title">
        <div class="ft-filters__header">
          <h2 id="fc-filters-title" class="ft-filters__title">
            <i class="pi pi-search" aria-hidden="true"></i>
            Rechercher un dossier
          </h2>
          <span class="fc-count" aria-live="polite">{{ countLabel() }}</span>
        </div>
        <div class="ft-filters__row">
          <div class="ft-filters__field fc-search-field">
            <label class="filter-label" for="fc-search">Recherche</label>
            <input
              id="fc-search"
              pInputText
              type="search"
              [ngModel]="search()"
              (ngModelChange)="onSearchChange($event)"
              placeholder="Société ou gestionnaire…"
              maxlength="80"
              autocomplete="off"
              aria-label="Société ou gestionnaire" />
          </div>
          <div class="ft-filters__field">
            <label class="filter-label" for="fc-manager">Gestionnaire</label>
            <p-select
              inputId="fc-manager"
              [options]="managerOptions()"
              [ngModel]="managerFilter()"
              (ngModelChange)="onManagerChange($event)"
              optionLabel="label"
              optionValue="value"
              appendTo="body" />
          </div>
          @if (governanceEnabled()) {
            <div class="ft-filters__field">
              <label class="filter-label" for="fc-dp">Dossier permanent</label>
              <p-select
                inputId="fc-dp"
                [options]="dpOptions"
                [ngModel]="dpFilter()"
                (ngModelChange)="onDpChange($event)"
                optionLabel="label"
                optionValue="value"
                appendTo="body" />
            </div>
          }
          <div class="ft-filters__field">
            <label class="filter-label" for="fc-kind">Type</label>
            <p-select
              inputId="fc-kind"
              [options]="kindOptions"
              [ngModel]="kindFilter()"
              (ngModelChange)="onKindChange($event)"
              optionLabel="label"
              optionValue="value"
              appendTo="body" />
          </div>
          @if (filtersActive()) {
            <button type="button" class="ft-filters__reset" (click)="resetFilters()">
              <i class="pi pi-filter-slash" aria-hidden="true"></i> Réinitialiser
            </button>
          }
        </div>
      </section>

      <div class="fc-card">
        <p-table
          [value]="filteredClients()"
          [loading]="loading()"
          dataKey="assignmentId"
          styleClass="p-datatable-sm"
          responsiveLayout="scroll"
          [paginator]="true"
          [rows]="tableRows()"
          [rowsPerPageOptions]="pageSizeOptions"
          [first]="tableFirst()"
          (onPage)="onTablePage($event)">
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="companyName" class="fc-col-company">
                Société <p-sortIcon field="companyName" />
              </th>
              <th pSortableColumn="assignedAccountantName" class="fc-col-manager">
                Gestionnaire <p-sortIcon field="assignedAccountantName" />
              </th>
              <th pSortableColumn="activeSince" class="fc-col-date">
                Active depuis <p-sortIcon field="activeSince" />
              </th>
              <th pSortableColumn="permanentFileStatus" class="fc-col-dp">
                Dossier permanent <p-sortIcon field="permanentFileStatus" />
              </th>
              <th class="fc-actions-col">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td class="fc-col-company">
                <span class="fc-company">
                  {{ row.companyName }}
                  @if (row.isFirmManaged) {
                    <p-tag value="Géré par le cabinet" severity="info" styleClass="fc-managed-tag" />
                  }
                </span>
              </td>
              <td class="fc-col-manager">
                @if (isAwaiting(row)) {
                  <span class="fc-muted">En attente</span>
                } @else {
                  {{ row.assignedAccountantName }}
                }
              </td>
              <td class="fc-col-date">{{ row.activeSince | date:'dd/MM/yyyy' }}</td>
              <td class="fc-col-dp">
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
                <button
                  type="button"
                  class="fc-btn fc-btn--primary"
                  (click)="openDossier(row)"
                  aria-label="Ouvrir la comptabilité"
                  pTooltip="Ouvrir la comptabilité"
                  tooltipPosition="top"
                  appendTo="body">
                  <i class="pi pi-folder-open" aria-hidden="true"></i>
                  Comptabilité
                </button>
                @if (governanceEnabled()) {
                  @if (row.hasPermanentFile) {
                    <button
                      type="button"
                      class="fc-btn fc-btn--secondary fc-btn--icon"
                      (click)="openPermanentFile(row)"
                      aria-label="Ouvrir dossier permanent"
                      pTooltip="Ouvrir dossier permanent"
                      tooltipPosition="top"
                      appendTo="body">
                      <i class="pi pi-book" aria-hidden="true"></i>
                      <span class="fc-sr">Ouvrir dossier permanent</span>
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="fc-btn fc-btn--secondary fc-btn--icon"
                      (click)="initPermanentFile(row)"
                      aria-label="Initialiser dossier permanent"
                      pTooltip="Initialiser dossier permanent"
                      tooltipPosition="top"
                      appendTo="body">
                      <i class="pi pi-file-plus" aria-hidden="true"></i>
                      <span class="fc-sr">Initialiser dossier permanent</span>
                    </button>
                  }
                }
                @if (auth.isFirmManager() && governanceEnabled()) {
                  <button
                    type="button"
                    class="fc-btn fc-btn--secondary fc-btn--icon"
                    (click)="openAffect(row)"
                    aria-label="Affecter"
                    pTooltip="Affecter"
                    tooltipPosition="top"
                    appendTo="body">
                    <i class="pi pi-user-plus" aria-hidden="true"></i>
                    <span class="fc-sr">Affecter</span>
                  </button>
                }
                @if (auth.isFirmManager()) {
                  <button
                    type="button"
                    class="fc-btn fc-btn--danger-outline fc-btn--icon"
                    (click)="revoke(row)"
                    aria-label="Résilier"
                    pTooltip="Résilier"
                    tooltipPosition="top"
                    appendTo="body">
                    <i class="pi pi-times" aria-hidden="true"></i>
                    <span class="fc-sr">Résilier</span>
                  </button>
                }
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="5">Aucun dossier ne correspond aux filtres.</td>
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
    .fc-loading { padding: 1.25rem 1rem; color: var(--color-text-secondary, #475569); }
    .fc-error {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      padding: 0.85rem 1rem;
      margin-bottom: 1rem;
      background: var(--color-danger-50, #fef2f2);
      border: 1px solid var(--color-danger-300, #fecaca);
      border-radius: var(--radius-xl, 12px);
      color: var(--color-danger-600, #991b1b);
      font-size: 0.875rem;
    }
    .fc-count {
      font-size: 0.8125rem;
      color: var(--color-text-secondary, #475569);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .fc-search-field { flex: 1 1 16rem; min-width: 14rem; }
    .fc-search-field input { width: 100%; min-width: 0; }
    :host ::ng-deep .ft-filters p-select { min-width: 11.5rem; }
    .fc-muted { color: var(--color-text-muted, #94a3b8); font-style: italic; }
    .fc-company {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    :host ::ng-deep .fc-managed-tag { font-size: 0.7rem; }
    .fc-col-company { min-width: 14rem; }
    .fc-col-manager { min-width: 12rem; }
    .fc-col-date { width: 8rem; white-space: nowrap; }
    .fc-col-dp { min-width: 9rem; }
    .fc-actions-col { width: 1%; white-space: nowrap; }
    .fc-actions {
      display: flex;
      gap: 0.35rem;
      justify-content: flex-end;
      align-items: center;
      flex-wrap: nowrap;
      white-space: nowrap;
    }
    :host ::ng-deep .fc-card .p-datatable-table { min-width: 60rem; }
    :host ::ng-deep .fc-card .p-datatable-tbody > tr > td { vertical-align: middle; }
    .fc-btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem 0.75rem;
      border-radius: var(--radius-md, 8px);
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      white-space: nowrap;
      flex: 0 0 auto;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }
    .fc-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .fc-btn--icon { padding: 0.4rem 0.5rem; }
    .fc-btn--primary { background: var(--color-primary-600, #2563eb); color: #fff; }
    .fc-btn--primary:hover:not(:disabled) { background: var(--color-primary-700, #1d4ed8); }
    .fc-btn--secondary {
      background: transparent;
      color: var(--color-primary-700, #1d4ed8);
      border-color: var(--color-primary-300, #93c5fd);
    }
    .fc-btn--secondary:hover:not(:disabled) { background: var(--color-primary-50, #eff6ff); }
    .fc-btn--danger-outline {
      background: transparent;
      color: var(--color-danger-600, #dc2626);
      border-color: var(--color-danger-300, #fca5a5);
    }
    .fc-btn--danger-outline:hover:not(:disabled) { background: var(--color-danger-50, #fef2f2); }
    .fc-sr {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `]
})
export class FirmClientsComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private readonly assignments = inject(FirmAssignmentService);
  private readonly firmContext = inject(FirmContextService);
  private readonly firmCoherence = inject(FirmAreaCoherenceService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly governanceActions = inject(FirmGovernanceActionsService);
  private readonly featureFlags = inject(FirmFeatureFlagsService);

  readonly clients = signal<FirmClientDossier[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly search = signal('');
  readonly managerFilter = signal<string>('all');
  readonly dpFilter = signal<string>('all');
  readonly kindFilter = signal<FirmClientKindFilter>('all');
  readonly tableFirst = signal(0);
  readonly tableRows = signal<number>(PAGE_SIZES[0]);
  readonly pageSizeOptions = [...PAGE_SIZES];
  readonly isAwaiting = isFirmClientAwaitingAssignment;
  readonly governanceEnabled = () => this.featureFlags.isEnabled('firmGovernance');

  readonly dpOptions = [
    { label: 'Tous', value: 'all' },
    { label: 'Absent', value: 'absent' },
    { label: 'Brouillon', value: '0' },
    { label: 'En cours', value: '1' },
    { label: 'Complet', value: '2' },
    { label: 'Archivé', value: '9' }
  ];

  readonly kindOptions = [
    { label: 'Tous', value: 'all' },
    { label: 'Géré par le cabinet', value: 'firmManaged' },
    { label: 'Client plateforme', value: 'platform' }
  ];

  readonly managerOptions = computed(() => [
    { label: 'Tous les gestionnaires', value: 'all' },
    { label: 'En attente', value: 'awaiting' },
    ...uniqueManagers(this.clients()).map(name => ({ label: name, value: name }))
  ]);

  readonly filteredClients = computed(() => filterFirmClientDossiers(this.clients(), {
    q: this.search(),
    manager: this.managerFilter(),
    dpStatus: this.governanceEnabled() ? this.dpFilter() : 'all',
    kind: this.kindFilter()
  }));

  readonly filtersActive = computed(() => hasActiveFirmClientFilters({
    q: this.search(),
    manager: this.managerFilter(),
    dpStatus: this.governanceEnabled() ? this.dpFilter() : 'all',
    kind: this.kindFilter()
  }));

  readonly countLabel = computed(() => {
    const shown = this.filteredClients().length;
    const total = this.clients().length;
    const shownLabel = shown > 1 ? `${shown} dossiers` : `${shown} dossier`;
    if (!this.filtersActive()) return shownLabel;
    return `${shownLabel} sur ${total}`;
  });

  affectDialogVisible = false;
  affectAssignmentIds: string[] = [];

  private loadSub?: Subscription;
  private hasLoadedSuccessfully = false;

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

  ngOnDestroy(): void {
    this.loadSub?.unsubscribe();
  }

  load(): void {
    this.loadSub?.unsubscribe();
    this.loading.set(true);
    this.loadSub = this.assignments.getActiveClients().subscribe({
      next: r => {
        if (r.success) {
          this.clients.set(r.data ?? []);
          this.loadError.set(null);
          this.hasLoadedSuccessfully = true;
          this.clampTablePage();
        } else {
          this.failLoad(r.message);
        }
        this.loading.set(false);
      },
      error: (err: { error?: { message?: string } }) => {
        this.failLoad(err?.error?.message);
        this.loading.set(false);
      }
    });
  }

  onSearchChange(value: string | null): void {
    this.search.set(value ?? '');
    this.tableFirst.set(0);
  }

  onManagerChange(value: string | null): void {
    if (value === 'awaiting' || value === 'all') {
      this.managerFilter.set(value);
    } else if (typeof value === 'string' && value.trim()) {
      this.managerFilter.set(value.trim());
    } else {
      this.managerFilter.set('all');
    }
    this.tableFirst.set(0);
  }

  onDpChange(value: string | null): void {
    this.dpFilter.set(value && DP_FILTERS.has(value) ? value : 'all');
    this.tableFirst.set(0);
  }

  onKindChange(value: string | null): void {
    this.kindFilter.set(value === 'firmManaged' || value === 'platform' ? value : 'all');
    this.tableFirst.set(0);
  }

  resetFilters(): void {
    this.search.set('');
    this.managerFilter.set('all');
    this.dpFilter.set('all');
    this.kindFilter.set('all');
    this.tableFirst.set(0);
  }

  onTablePage(event: { first?: number; rows?: number }): void {
    if (typeof event.rows === 'number' && (PAGE_SIZES as readonly number[]).includes(event.rows)) {
      this.tableRows.set(event.rows);
    }
    const first = event.first ?? 0;
    this.tableFirst.set(Number.isFinite(first) && first >= 0 ? first : 0);
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
      const navigated = await this.router.navigate([FIRM_DELEGATED_HOME_ROUTE]);
      if (!navigated) {
        this.firmCoherence.enforceNow();
      }
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

  dpSeverity(status?: number | null): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 2: return 'success';
      case 1: return 'warn';
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

  private failLoad(message: string | null | undefined): void {
    const detail = message?.trim() || 'Impossible de charger les dossiers clients.';
    this.loadError.set(detail);
    if (!this.hasLoadedSuccessfully) {
      this.clients.set([]);
    }
    this.toast.add({ severity: 'error', summary: 'Dossiers clients', detail });
  }

  private clampTablePage(): void {
    const total = this.filteredClients().length;
    const rows = this.tableRows();
    if (rows < 1) return;
    const maxFirst = total === 0 ? 0 : Math.floor((total - 1) / rows) * rows;
    if (this.tableFirst() > maxFirst) this.tableFirst.set(maxFirst);
  }
}
