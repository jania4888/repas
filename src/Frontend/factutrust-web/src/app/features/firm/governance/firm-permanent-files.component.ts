import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { AuthService } from '@core/services/auth.service';
import { FirmGovernanceService, PermanentFile } from '@core/services/firm-governance.service';
import { FirmAssignmentService, FirmClientDossier } from '@core/services/firm-assignment.service';
import { FirmGovernanceActionsService } from '../shared/firm-governance-actions.service';
import { ToastService } from '@core/services/toast.service';
import { ConfirmationService } from '@core/services/confirmation.service';

@Component({
  selector: 'app-firm-permanent-files',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, TableModule, ButtonModule, TagModule,
    InputTextModule, SelectModule, CheckboxModule, PageHeaderComponent, EmptyStateComponent
  ],
  template: `
    <app-page-header title="Dossiers permanents" subtitle="Identité juridique et statut administratif (normes TN)">
      @if (auth.isFirmManager()) {
        <a routerLink="/firm/clients/new" pButton label="Créer un dossier client" icon="pi pi-plus" class="p-button-sm"></a>
      }
    </app-page-header>

    @if (loading()) {
      <p>Chargement…</p>
    } @else if (loadError() && !listLoaded()) {
      <app-empty-state
        icon="pi-exclamation-triangle"
        title="Impossible de charger les dossiers permanents"
        [description]="loadError()!"
        actionLabel="Réessayer"
        (actionClick)="reload()">
      </app-empty-state>
    } @else {
      @if (loadError()) {
        <div class="error-banner" role="alert">
          <i class="pi pi-exclamation-triangle"></i>
          <span>{{ loadError() }}</span>
          <button type="button" pButton label="Réessayer" class="p-button-sm p-button-outlined" (click)="reload()"></button>
        </div>
      }

      <div class="fc-card filters">
        <input pInputText [ngModel]="search()" (ngModelChange)="search.set($event)"
          placeholder="Rechercher société ou NIF…" class="search" />
        <p-select [options]="statusFilters" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)"
          optionLabel="label" optionValue="value" appendTo="body" placeholder="Statut" />
        <label class="archived-toggle">
          <p-checkbox [ngModel]="includeArchived()" (ngModelChange)="includeArchived.set($event)" [binary]="true" inputId="incArch" />
          <span>Inclure archivés</span>
        </label>
      </div>

      <div class="fc-card">
        <h3 class="section-title">Dossiers permanents existants</h3>
        <p-table [value]="sortedFiles()">
          <ng-template pTemplate="header">
            <tr>
              <th>Société</th><th>NIF</th><th>Forme</th><th>Honoraires</th>
              <th>Statut</th><th>Prochaine action</th><th>Étape</th><th>Sync</th><th></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-f>
            <tr>
              <td>
                {{ f.companyName || '—' }}
                @if (f.isFirmManaged) {
                  <p-tag value="Géré par le cabinet" severity="info" styleClass="managed-tag" />
                }
              </td>
              <td>{{ f.nif || '—' }}</td>
              <td>{{ f.legalFormDisplay || '—' }}</td>
              <td>{{ formatHonoraires(f) }}</td>
              <td><p-tag [value]="f.statusDisplay" [severity]="statusSeverity(f.status)" /></td>
              <td>
                @if (nextAction(f); as action) {
                  @if (needsCompletion(f)) {
                    <a [routerLink]="['/firm/governance/permanent-files', f.firmClientAssignmentId]"
                      [queryParams]="completeQueryParams(f)"
                      pButton [label]="action" class="p-button-text p-button-sm p-button-warning"></a>
                  } @else {
                    <span class="next-action">{{ action }}</span>
                  }
                } @else {
                  —
                }
              </td>
              <td>{{ f.wizardStep }}/6 · {{ f.completionPercent ?? 0 }}%</td>
              <td>{{ f.syncedToTenantAt ? (f.syncedToTenantAt | date:'dd/MM/yyyy') : 'Non synchronisé' }}</td>
              <td class="row-actions">
                <a [routerLink]="['/firm/governance/permanent-files', f.firmClientAssignmentId]"
                  [queryParams]="{ mode: openMode(f) }"
                  pButton label="Ouvrir" class="p-button-text p-button-sm"></a>
                @if (f.status === 2) {
                  <button type="button" pButton label="Archiver" icon="pi pi-inbox" class="p-button-text p-button-sm p-button-secondary"
                    (click)="archive(f)"></button>
                }
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="9">
                @if (loadError()) {
                  Impossible de charger les dossiers. Utilisez « Réessayer ».
                } @else if (files().length === 0) {
                  Aucun dossier permanent enregistré pour ce cabinet.
                } @else {
                  Aucun dossier ne correspond aux filtres.
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>

      @if (clientsWithoutDp().length > 0) {
        <div class="fc-card init-card">
          <h3>Clients actifs sans dossier permanent</h3>
          <div class="init-row" *ngFor="let c of clientsWithoutDp()">
            <span>{{ c.companyName }}</span>
            <button type="button" pButton label="Initialiser" icon="pi pi-file-plus" class="p-button-sm p-button-outlined"
              (click)="init(c)"></button>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .fc-card {
      background: var(--color-surface, #fff);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-xl, 16px);
      box-shadow: var(--shadow-soft-sm, 0 1px 2px rgba(15, 23, 42, 0.05));
      padding: var(--spacing-2, 8px);
      margin-bottom: 1rem;
    }
    .error-banner {
      display: flex; align-items: center; gap: .75rem; flex-wrap: wrap;
      padding: .85rem 1rem; margin-bottom: 1rem;
      background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; color: #991b1b; font-size: .875rem;
    }
    .section-title { margin: .5rem .75rem .75rem; font-size: .95rem; font-weight: 600; }
    .filters { display: flex; gap: .75rem; flex-wrap: wrap; padding: .85rem 1rem; align-items: center; }
    .search { flex: 1; min-width: 200px; }
    .archived-toggle { display: flex; align-items: center; gap: .4rem; font-size: .875rem; white-space: nowrap; }
    .init-card { padding: 1rem 1.25rem; }
    .init-card h3 { margin: 0 0 0.75rem; font-size: 0.95rem; }
    .init-row { display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0; border-bottom: 1px solid #f1f5f9; }
    .init-row:last-child { border-bottom: none; }
    .row-actions { white-space: nowrap; display: flex; gap: .25rem; align-items: center; }
    .next-action { font-size: .875rem; color: #64748b; }
    :host ::ng-deep .managed-tag { margin-left: 0.5rem; font-size: 0.7rem; }
  `]
})
export class FirmPermanentFilesComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  readonly auth = inject(AuthService);
  private readonly api = inject(FirmGovernanceService);
  private readonly assignments = inject(FirmAssignmentService);
  private readonly actions = inject(FirmGovernanceActionsService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);

  loading = signal(true);
  listLoaded = signal(false);
  loadError = signal<string | null>(null);
  files = signal<PermanentFile[]>([]);
  clients = signal<FirmClientDossier[]>([]);
  search = signal('');
  statusFilter = signal<number | null>(null);
  includeArchived = signal(false);

  readonly statusFilters = [
    { label: 'Tous', value: null },
    { label: 'Brouillon', value: 0 },
    { label: 'En cours', value: 1 },
    { label: 'Complet', value: 2 },
    { label: 'Archivé', value: 9 }
  ];

  clientsWithoutDp = computed(() =>
    this.clients().filter(c => !c.hasPermanentFile)
  );

  filteredFiles = computed(() => {
    const q = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    const showArchived = this.includeArchived();
    return this.files().filter(f => {
      if (!showArchived && f.status === 9) return false;
      if (status != null && f.status !== status) return false;
      if (!q) return true;
      return (f.companyName ?? '').toLowerCase().includes(q)
        || (f.nif ?? '').toLowerCase().includes(q);
    });
  });

  sortedFiles = computed(() => {
    const list = [...this.filteredFiles()];
    list.sort((a, b) => {
      const aSync = a.status === 2 && !a.syncedToTenantAt ? 0 : 1;
      const bSync = b.status === 2 && !b.syncedToTenantAt ? 0 : 1;
      if (aSync !== bSync) return aSync - bSync;
      if (a.status === 1 && b.status === 1) {
        return (a.completionPercent ?? 0) - (b.completionPercent ?? 0);
      }
      return (a.companyName ?? '').localeCompare(b.companyName ?? '', 'fr');
    });
    return list;
  });

  ngOnInit(): void {
    const statusParam = this.route.snapshot.queryParamMap.get('status');
    if (statusParam != null && statusParam !== '') {
      const parsed = Number(statusParam);
      if (!Number.isNaN(parsed)) this.statusFilter.set(parsed);
    }
    this.reload();
    this.assignments.getActiveClients().subscribe({
      next: r => { if (r.success) this.clients.set(r.data ?? []); }
    });
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.listPermanentFiles().subscribe({
      next: res => {
        this.loading.set(false);
        if (res.success) {
          this.files.set(res.data ?? []);
          this.listLoaded.set(true);
        } else {
          const msg = res.message ?? 'Impossible de charger les dossiers permanents.';
          this.loadError.set(msg);
          this.toast.add({ severity: 'error', summary: 'Dossiers permanents', detail: msg });
        }
      },
      error: err => {
        this.loading.set(false);
        const msg = (err as { error?: { message?: string } })?.error?.message
          ?? 'Impossible de charger les dossiers permanents.';
        this.loadError.set(msg);
        this.toast.add({ severity: 'error', summary: 'Dossiers permanents', detail: msg });
      }
    });
  }

  openMode(f: PermanentFile): 'view' | 'edit' {
    return f.status === 2 ? 'view' : 'edit';
  }

  formatHonoraires(f: PermanentFile): string {
    if (f.annualFeeAmount == null) return '—';
    const amount = `${f.annualFeeAmount} ${f.currency || 'TND'}`;
    return f.billingFrequencyDisplay ? `${amount} / ${f.billingFrequencyDisplay}` : amount;
  }

  nextAction(f: PermanentFile): string | null {
    return f.nextActionLabel ?? null;
  }

  needsCompletion(f: PermanentFile): boolean {
    return f.status !== 2 && f.status !== 9 && !!f.nextActionLabel;
  }

  completeQueryParams(f: PermanentFile): { mode: string; step?: number } {
    const params: { mode: string; step?: number } = { mode: 'edit' };
    if (f.nextRecommendedStep) params.step = f.nextRecommendedStep;
    return params;
  }

  statusSeverity(status: number): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    switch (status) {
      case 2: return 'success';
      case 1: return 'warning';
      case 9: return 'secondary';
      default: return 'info';
    }
  }

  init(c: FirmClientDossier): void {
    void this.actions.initializePermanentFile({ assignmentId: c.assignmentId, companyName: c.companyName });
  }

  archive(f: PermanentFile): void {
    this.confirmation.confirm({
      header: 'Archiver le dossier',
      message: `Archiver « ${f.companyName || 'ce dossier'} » ? Les données sont conservées.`,
      icon: 'pi pi-inbox',
      acceptLabel: 'Archiver',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-secondary',
      accept: () => {
        this.api.archivePermanentFile(f.firmClientAssignmentId).subscribe({
          next: r => {
            if (r.success) {
              this.toast.add({ severity: 'success', summary: 'Archivage', detail: 'Dossier archivé.' });
              this.reload();
            } else {
              this.toast.add({ severity: 'error', summary: 'Archivage', detail: r.message ?? 'Impossible.' });
            }
          },
          error: () => this.toast.add({ severity: 'error', summary: 'Archivage', detail: 'Impossible.' })
        });
      }
    });
  }
}
