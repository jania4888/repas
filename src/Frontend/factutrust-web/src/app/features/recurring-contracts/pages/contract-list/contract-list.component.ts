/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { TableModule } from 'primeng/table';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import {
  ContractStats,
  RecurringContractListItem,
  RecurringContractService,
  RecurringContractStatus
} from '@core/services/recurring-contract.service';
import { ClientListItem, ClientService } from '@core/services/client.service';
import { AuthService } from '@core/services/auth.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { contractBadgeStatus, formatContractAmount } from '../../recurring-contracts.ui-utils';

interface StatusFilterOption {
  label: string;
  value: RecurringContractStatus | null;
}

@Component({
  selector: 'app-contract-list',
  standalone: true,
  imports: [BackendLabelPipe, 
    CommonModule, RouterModule, FormsModule, TableModule,
    PageHeaderComponent, ButtonComponent, EmptyStateComponent,
    SkeletonTableComponent, StatCardComponent, StatusBadgeComponent
  ],
  template: `
    <app-page-header
      title="Contrats récurrents" i18n-title="@@recurring-contracts.pages.contrats.recurrents.e773e54a"
      subtitle="Abonnements et facturation périodique B2B" i18n-subtitle="@@recurring-contracts.pages.abonnements.et.facturation.periodique.b2.c67e5e30">
      <div class="actions">
        <app-button variant="outline" icon="pi-file-edit" routerLink="pending-drafts" i18n="@@recurring-contracts.pages.brouillons.a.valider.3fabaa45"> Brouillons à valider </app-button>
        @if (canCreate()) {
          <app-button variant="primary" icon="pi-plus" routerLink="new" i18n="@@recurring-contracts.pages.nouveau.contrat.13fabd25">Nouveau contrat</app-button>
        }
      </div>
    </app-page-header>

    @if (stats(); as s) {
      <div class="kpi-grid">
        <app-stat-card
          label="Contrats actifs" i18n-label="@@recurring-contracts.pages.contrats.actifs.9c1f0223"
          [value]="s.activeCount"
          icon="pi-check-circle"
          tone="teal">
        </app-stat-card>
        <app-stat-card
          label="MRR estimé" i18n-label="@@recurring-contracts.pages.mrr.estime.76040103"
          [value]="formatContractAmount(s.estimatedMonthlyRecurringTotal, s.currency)"
          icon="pi-wallet"
          tone="primary">
        </app-stat-card>
        <app-stat-card
          label="Échéances ≤ 7 j" i18n-label="@@recurring-contracts.pages.echeances.7.j.b1be5150"
          [value]="s.dueSoonCount"
          icon="pi-calendar"
          tone="orange">
        </app-stat-card>
        <app-stat-card
          label="Brouillons en attente" i18n-label="@@recurring-contracts.pages.brouillons.en.attente.7d7a40ea"
          [value]="s.pendingDraftsCount"
          icon="pi-file-edit"
          tone="violet"
          routerLink="/recurring-contracts/pending-drafts"
          navigationAriaLabel="Voir les brouillons à valider" i18n-navigationAriaLabel="@@recurring-contracts.contract-list.voir.les.brouillons.a.valider.7e168a49">
        </app-stat-card>
      </div>
    }

    <div class="ft-filters">
      <div class="ft-filters__row">
        <input
          class="ft-input filters__search"
          [(ngModel)]="search"
          (ngModelChange)="onSearchInput()"
          placeholder="Rechercher (numéro, référence, client)…" i18n-placeholder="@@recurring-contracts.pages.rechercher.numero.reference.client.7cb836b5" />
        <select class="ft-input" [(ngModel)]="statusFilter" (ngModelChange)="onFilterChange()">
          @for (opt of statusOptions; track opt.label) {
            <option [ngValue]="opt.value">{{ opt.label }}</option>
          }
        </select>
        <select class="ft-input" [(ngModel)]="clientFilter" (ngModelChange)="onFilterChange()">
          <option [ngValue]="null" i18n="@@recurring-contracts.pages.tous.les.clients.56f5092c">Tous les clients</option>
          @for (c of clients(); track c.id) {
            <option [ngValue]="c.id">{{ c.name }}</option>
          }
        </select>
      </div>
    </div>

    @if (loading() && items().length === 0) {
      <app-skeleton-table [rows]="8" [columns]="skeletonColumns"></app-skeleton-table>
    } @else if (!loading() && items().length === 0) {
      <app-empty-state
        icon="pi-inbox"
        title="Aucun contrat" i18n-title="@@recurring-contracts.pages.aucun.contrat.355efb57"
        description="Créez votre premier contrat récurrent ou ajustez vos filtres." i18n-description="@@recurring-contracts.pages.creez.votre.premier.contrat.recurrent.ou.f5838c69"
        actionLabel="Nouveau contrat" i18n-actionLabel="@@recurring-contracts.pages.nouveau.contrat.5cbb43f2"
        actionRoute="/recurring-contracts/new"
        [showAction]="canCreate()">
      </app-empty-state>
    } @else {
      <div class="ft-table-card">
        <p-table
          [value]="items()"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalRecords()"
          [lazy]="true"
          (onLazyLoad)="onPageChange($event)"
          [loading]="loading()"
          [first]="(page() - 1) * pageSize"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} contrats" i18n-currentPageReportTemplate="@@recurring-contracts.pages.affichage.de.first.a.last.sur.totalrecords.contr.c58ca015"
          [rowHover]="true"
          styleClass="p-datatable-sm">
          <ng-template pTemplate="header">
            <tr>
              <th style="width: 150px" i18n="@@recurring-contracts.pages.numero.15e73db0">Numéro</th>
              <th i18n="@@recurring-contracts.pages.client.1bdd79b1">Client</th>
              <th style="width: 130px" i18n="@@recurring-contracts.pages.statut.659499f3">Statut</th>
              <th style="width: 120px" i18n="@@recurring-contracts.pages.periodicite.0eb1b4d4">Périodicité</th>
              <th style="width: 150px" i18n="@@recurring-contracts.pages.prochaine.facturation.8078b7d4">Prochaine facturation</th>
              <th style="width: 140px" i18n="@@recurring-contracts.pages.montant.mois.54101d4b">Montant / mois</th>
              <th style="width: 90px" i18n="@@recurring-contracts.pages.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-item>
            <tr>
              <td>
                <a [routerLink]="[item.id]" class="contract-number">{{ item.number || '—' }}</a>
              </td>
              <td>{{ item.clientName }}</td>
              <td>
                <app-status-badge
                  [status]="contractBadgeStatus(item.status)"
                  [label]="item.statusDisplay | backendLabel">
                </app-status-badge>
              </td>
              <td>{{ item.billingFrequencyDisplay | backendLabel }}</td>
              <td>{{ item.nextBillingDate ? (item.nextBillingDate | date:'dd/MM/yyyy') : '—' }}</td>
              <td class="amount">{{ item.estimatedMonthlyAmount | currency:item.currency:'symbol':'1.3-3' }}</td>
              <td>
                <app-button
                  variant="ghost"
                  size="sm"
                  icon="pi-eye"
                  [routerLink]="[item.id]"
                  ariaLabel="Voir le contrat" i18n-ariaLabel="@@recurring-contracts.pages.voir.le.contrat.434d4b1f" i18n="@@recurring-contracts.pages.voir.8a754f1f"> Voir </app-button>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }
  `,
  styles: [`
    .actions { display: flex; gap: var(--spacing-2); flex-wrap: wrap; }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-5);
    }

    .ft-input {
      padding: var(--spacing-2) var(--spacing-3);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg);
      font-size: var(--font-size-sm);
      font-family: inherit;
      background: var(--color-background-elevated);
      color: var(--color-text-primary);
    }

    .ft-input:focus-visible {
      outline: 2px solid var(--color-primary-500);
      outline-offset: 1px;
    }

    .filters__search { flex: 1; min-width: 220px; }

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
export class ContractListComponent implements OnInit, OnDestroy {
  private readonly service = inject(RecurringContractService);
  private readonly clientService = inject(ClientService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);

  readonly items = signal<RecurringContractListItem[]>([]);
  readonly loading = signal(true);
  readonly totalRecords = signal(0);
  readonly page = signal(1);
  readonly pageSize = 20;
  readonly clients = signal<ClientListItem[]>([]);
  readonly stats = signal<ContractStats | null>(null);

  search = '';
  statusFilter: RecurringContractStatus | null = null;
  clientFilter: string | null = null;

  readonly canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.recurringContracts.create));

  readonly statusOptions: StatusFilterOption[] = [
    { label: $localize`:@@recurring-contracts.list.filter.tous:Tous les statuts`, value: null },
    { label: $localize`:@@recurring-contracts.list.filter.brouillon:Brouillon`, value: 'Draft' },
    { label: $localize`:@@recurring-contracts.list.filter.actif:Actif`, value: 'Active' },
    { label: $localize`:@@recurring-contracts.list.filter.suspendu:Suspendu`, value: 'Suspended' },
    { label: $localize`:@@recurring-contracts.list.filter.resilie:Résilié`, value: 'Cancelled' },
    { label: $localize`:@@recurring-contracts.list.filter.expire:Expiré`, value: 'Expired' }
  ];

  readonly skeletonColumns: SkeletonColumn[] = [
    { width: '150px' },
    { width: '200px' },
    { width: '130px' },
    { width: '120px' },
    { width: '150px' },
    { width: '140px' },
    { width: '90px' }
  ];

  protected readonly contractBadgeStatus = contractBadgeStatus;
  protected readonly formatContractAmount = formatContractAmount;

  private readonly destroy$ = new Subject<void>();
  private readonly search$ = new Subject<void>();

  ngOnInit(): void {
    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => { this.page.set(1); this.load(); });
    this.loadClients();
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.search$.complete();
  }

  onSearchInput(): void { this.search$.next(); }

  onFilterChange(): void {
    this.page.set(1);
    this.load();
  }

  onPageChange(event: { first?: number | null; rows?: number | null }): void {
    const rows = event.rows ?? this.pageSize;
    this.page.set(Math.floor((event.first ?? 0) / rows) + 1);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadStats();
    this.service.list({
      search: this.search || undefined,
      status: this.statusFilter ?? undefined,
      clientId: this.clientFilter ?? undefined,
      page: this.page(),
      pageSize: this.pageSize
    }).subscribe({
      next: res => {
        this.items.set(res.items);
        this.totalRecords.set(res.totalCount);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.errorHandler.logError('RecurringContracts: list', err);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@contract-list.component.summary.Erreur:Erreur`,
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  /** Bande KPI : masquée silencieusement quand GET /stats n'existe pas encore (404 → null). */
  private loadStats(): void {
    this.service.getStats().subscribe({
      next: s => this.stats.set(s),
      error: err => {
        this.stats.set(null);
        this.errorHandler.logError('RecurringContracts: stats', err);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@contract-list.component.summary.Erreur:Erreur`,
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  private loadClients(): void {
    this.clientService.getClients({ page: 1, pageSize: 200 }).subscribe({
      next: res => { if (res.success) this.clients.set(res.data.items); },
      error: () => this.clients.set([])
    });
  }
}
