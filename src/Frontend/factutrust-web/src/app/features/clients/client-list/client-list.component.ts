/// <reference types="@angular/localize" />
import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { ClientService, ClientListItem, ClientSearchParams, ClientType, ClientListSummary } from '@core/services/client.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { applyClientListFiltersFromQuery } from '@core/utils/list-filter-from-query';
import { take } from 'rxjs/operators';

interface TypeOption {
  label: string;
  value: ClientType | null;
}

interface StatusOption {
  label: string;
  value: boolean | null;
}

@Component({
  selector: 'app-client-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TagModule,
    TooltipModule,
    ConfirmDialogModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent,
    TableTotalsBarComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>
    
    <app-page-header 
      title="Clients" i18n-title="@@clients.client-list.clients.28e22fe3" 
      subtitle="Gérez vos clients et facturez plus vite." i18n-subtitle="@@clients.client-list.gerez.vos.clients.et.facturez.plus.vite.fb45edba">
      @if (canCreateClient()) {
        <app-button 
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          routerLink="new" i18n="@@clients.client-list.ajouter.un.client.pour.facturer.plus.vite.74cf9d67"> Ajouter un client pour facturer plus vite </app-button>
      }
    </app-page-header>

    <!-- Filters -->
    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title" i18n="@@clients.client-list.filtres.a2a5c940"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button
            class="ft-filters__reset"
            (click)="resetFilters()"
            aria-label="Réinitialiser les filtres" i18n-aria-label="@@clients.client-list.reinitialiser.les.filtres.d8915f02" i18n="@@clients.client-list.reinitialiser.9637f51e">
            <i class="pi pi-times"></i>
            Réinitialiser ({{ activeFiltersCount() }})
          </button>
        }
      </div>
      <div class="ft-filters__row">
        <span class="p-input-icon-left flex-1">
          <i class="pi pi-search"></i>
          <input 
            pInputText 
            type="text" 
            placeholder="Rechercher par nom, email ou NIF…" i18n-placeholder="@@clients.client-list.rechercher.par.nom.email.ou.nif.e25e488c" 
            [(ngModel)]="searchTerm"
            (input)="onSearchInput($event)"
            class="w-full">
        </span>

        <p-select 
          [options]="typeOptions" 
          [(ngModel)]="selectedType"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les types" i18n-placeholder="@@clients.client-list.tous.les.types.5a6be24d"
          [showClear]="true"
          (onChange)="onFilterChange()">
        </p-select>

        <p-select 
          [options]="statusOptions" 
          [(ngModel)]="selectedStatus"
          optionLabel="label"
          optionValue="value"
          placeholder="Tous les statuts" i18n-placeholder="@@clients.client-list.tous.les.statuts.2d5088af"
          [showClear]="true"
          (onChange)="onFilterChange()">
        </p-select>
      </div>
    </div>

    <!-- Totaux (calculés côté backend sur l'ensemble filtré, pas seulement la page) -->
    <app-table-totals-bar [metrics]="summaryMetrics()" [loading]="summaryLoading()"></app-table-totals-bar>

    <!-- Table -->
    <div class="ft-table-card">
      @if (loading() && clients().length === 0) {
        <app-skeleton-table 
          [rows]="5" 
          [columns]="skeletonColumns">
        </app-skeleton-table>
      } @else {
        <p-table 
          [value]="clients()" 
          [lazy]="true"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalRecords()"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} clients" i18n-currentPageReportTemplate="@@clients.client-list.affichage.de.first.a.last.sur.totalrecords.clien.a4c2b3ad"
          (onLazyLoad)="onPageChange($event)"
          [loading]="loading()"
          [first]="(page - 1) * pageSize"
          [rowHover]="true"
          styleClass="p-datatable-sm">
        
        <ng-template pTemplate="header">
          <tr>
            <th pSortableColumn="code" style="width: 100px"><ng-container i18n="@@clients.client-list.code.adac6937">Code </ng-container> <p-sortIcon field="code"></p-sortIcon></th>
            <th pSortableColumn="name"><ng-container i18n="@@clients.client-list.nom.7ff20370">Nom </ng-container> <p-sortIcon field="name"></p-sortIcon></th>
            <th i18n="@@clients.client-list.contact.b37456c4">Contact</th>
            <th i18n="@@clients.client-list.nif.77124a3a">NIF</th>
            <th i18n="@@clients.client-list.type.3deb7456">Type</th>
            <th i18n="@@clients.client-list.localisation.84e3d483">Localisation</th>
            <th pSortableColumn="totalInvoices" style="width: 100px"><ng-container i18n="@@clients.client-list.factures.da35e4f2">Factures </ng-container> <p-sortIcon field="totalInvoices"></p-sortIcon></th>
            <th style="width: 80px" i18n="@@clients.client-list.statut.659499f3">Statut</th>
            <th style="width: 120px" i18n="@@clients.client-list.actions.c3cd636a">Actions</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-client>
          <tr>
            <td>
              <a [routerLink]="[client.id]" class="client-code">
                {{ client.code }}
              </a>
            </td>
            <td>
              <div class="client-name">
                <span class="name">{{ client.name }}</span>
              </div>
            </td>
            <td>
              <div class="contact-info">
                @if (client.email) {
                  <a [href]="'mailto:' + client.email" class="email">{{ client.email }}</a>
                } @else {
                  <span class="email" i18n="@@clients.client-list.text.1b93795b">—</span>
                }
                <span class="phone">{{ client.phone || '-' }}</span>
              </div>
            </td>
            <td>
              <span class="nif">{{ client.nif || '-' }}</span>
            </td>
            <td>
              <p-tag 
                [value]="client.typeDisplay" 
                [severity]="getTypeSeverity(client.type)">
              </p-tag>
            </td>
            <td>
              <span class="location">{{ client.city }}, {{ client.governorate }}</span>
            </td>
            <td class="text-center">
              <span class="invoice-count">{{ client.totalInvoices }}</span>
            </td>
            <td>
              <p-tag 
                [value]="client.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033" 
                [severity]="client.isActive ? 'success' : 'secondary'">
              </p-tag>
            </td>
            <td>
              <div class="actions">
                <app-button 
                  variant="ghost"
                  size="sm"
                  icon="pi-eye"
                  [iconOnly]="true"
                  [routerLink]="client.id"
                  ariaLabel="Voir le client" i18n-ariaLabel="@@clients.client-list.voir.le.client.fd1e4588">
                </app-button>
                @if (canEditClient()) {
                  <app-button 
                    variant="ghost"
                    size="sm"
                    icon="pi-pencil"
                    [iconOnly]="true"
                    [routerLink]="[client.id, 'edit']"
                    ariaLabel="Modifier le client" i18n-ariaLabel="@@clients.client-list.modifier.le.client.4eab4088">
                  </app-button>
                }
                @if (canDeleteClient()) {
                  <app-button 
                    variant="ghost"
                    size="sm"
                    icon="pi-trash"
                    [iconOnly]="true"
                    (click)="confirmDelete(client)"
                    ariaLabel="Supprimer le client" i18n-ariaLabel="@@clients.client-list.supprimer.le.client.ecd5c5e1">
                  </app-button>
                }
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="9" class="text-center p-6">
              <app-empty-state
                illustration="empty-clients.svg"
                title="Aucun client" i18n-title="@@clients.client-list.aucun.client.667e69de"
                description="Ajoutez votre premier client pour créer des devis et des factures en quelques clics." i18n-description="@@clients.client-list.ajoutez.votre.premier.client.pour.creer.7fe662ba"
                [showAction]="canCreateClient()"
                actionLabel="Ajouter un client pour facturer plus vite" i18n-actionLabel="@@clients.client-list.ajouter.un.client.pour.facturer.plus.vit.63aedb21"
                actionRoute="new">
              </app-empty-state>
            </td>
          </tr>
        </ng-template>
        </p-table>
      }
    </div>

  `,
  styles: [`
    .client-code {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
      font-size: var(--font-size-sm);
    }

    .client-name {
      .name {
        font-weight: var(--font-weight-medium);
        color: var(--color-neutral-900);
      }
    }

    .contact-info {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1);

      .email {
        color: var(--color-primary-600);
        font-size: var(--font-size-sm);
      }

      .phone {
        color: var(--color-neutral-600);
        font-size: var(--font-size-sm);
      }
    }

    .nif {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-size: var(--font-size-sm);
      color: var(--color-neutral-700);
    }

    .location {
      font-size: var(--font-size-sm);
      color: var(--color-neutral-600);
    }

    .invoice-count {
      font-weight: var(--font-weight-semibold);
      color: var(--color-neutral-800);
    }

    .actions {
      display: flex;
      gap: var(--spacing-1);
    }
  `]
})
export class ClientListComponent implements OnInit, OnDestroy {
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  private clientService = inject(ClientService);
  private confirmationService = inject(ConfirmationService);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  canCreateClient = computed(() => this.auth.hasPermission(PERMISSIONS.clients.create));
  canEditClient = computed(() => this.auth.hasPermission(PERMISSIONS.clients.update));
  canDeleteClient = computed(() => this.auth.hasPermission(PERMISSIONS.clients.delete));
  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();
  private lastErrorTime = 0;
  private readonly ERROR_DEBOUNCE_MS = 2000; // 2 secondes entre les erreurs
  private initialLoadDone = false;
  private isFirstLoad = true;

  loading = signal(true);
  initialLoad = signal(true);
  clients = signal<ClientListItem[]>([]);
  totalRecords = signal(0);

  /** Totaux agrégés (backend) sur l'ensemble filtré complet — alimente la zone de totaux. */
  summary = signal<ClientListSummary | null>(null);
  summaryLoading = signal(false);

  summaryMetrics = computed<TotalMetric[]>(() => {
    const s = this.summary();
    return [
      { label: $localize`:@@clients.client-list.ts.clients.28e22fe3:Clients`, value: s?.count, format: 'number', icon: 'pi-users', tone: 'primary' },
      { label: $localize`:@@clients.client-list.ts.actifs.4fc3a980:Actifs`, value: s?.activeCount, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
      { label: $localize`:@@clients.client-list.ts.inactifs.41c2d03e:Inactifs`, value: s?.inactiveCount, format: 'number', icon: 'pi-ban', tone: 'neutral' }
    ];
  });

  searchTerm = '';
  selectedType: ClientType | null = null;
  selectedStatus: boolean | null = null;
  page = 1;
  pageSize = 20;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@clients.client-list.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@clients.client-list.ts.clients.28e22fe3:Clients` }
  ];

  skeletonColumns: SkeletonColumn[] = [
    { width: '100px' },
    { width: '200px' },
    { width: '180px' },
    { width: '120px' },
    { width: '100px' },
    { width: '150px' },
    { width: '100px' },
    { width: '80px' },
    { width: '120px' }
  ];

  typeOptions: TypeOption[] = [
    { label: $localize`:@@clients.client-list.ts.particulier.281680dd:Particulier`, value: ClientType.Individual },
    { label: $localize`:@@clients.client-list.ts.entreprise.d03e74b6:Entreprise`, value: ClientType.Business }
  ];

  statusOptions: StatusOption[] = [
    { label: $localize`:@@clients.client-list.ts.actifs.4fc3a980:Actifs`, value: true },
    { label: $localize`:@@clients.client-list.ts.inactifs.41c2d03e:Inactifs`, value: false }
  ];

  ngOnInit(): void {
    this.route.queryParamMap.pipe(take(1)).subscribe((paramMap) => {
      const applied = applyClientListFiltersFromQuery(paramMap, {
        search: this.searchTerm || null
      });
      if (applied.search) {
        this.searchTerm = applied.search;
      }
    });

    console.log('[ClientList] Component initialized');
    
    // Configuration du debounce pour la recherche
    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.onSearch();
      });

    // Charger les clients au démarrage
    // La table lazy déclenchera aussi onLazyLoad, mais on charge d'abord pour éviter le délai
    console.log('[ClientList] Loading clients on init...');
    this.loadClients();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.searchSubject.complete();
  }

  /** Totaux conformes aux filtres ; échec silencieux pour ne pas perturber la liste. */
  private loadSummary(params: ClientSearchParams): void {
    this.summaryLoading.set(true);
    this.clientService.getClientsSummary({ ...params, skipGlobalErrorUi: true }).subscribe({
      next: (response) => {
        this.summary.set(response.success && response.data ? response.data : null);
        this.summaryLoading.set(false);
      },
      error: () => {
        this.summary.set(null);
        this.summaryLoading.set(false);
      }
    });
  }

  loadClients(): void {
    // Éviter les appels multiples simultanés seulement si on est déjà en train de charger
    // Ne pas bloquer si on n'a pas encore de données
    if (this.loading() && this.clients().length > 0) {
      return;
    }

    this.loading.set(true);

    const params: ClientSearchParams = {
      search: this.searchTerm || undefined,
      type: this.selectedType ?? undefined,
      isActive: this.selectedStatus ?? undefined,
      page: this.page,
      pageSize: this.pageSize
    };

    this.loadSummary(params);

    this.clientService.getClients(params).subscribe({
      next: (response) => {
        console.log('[ClientList] API Response:', response);
        if (response.success && response.data) {
          console.log('[ClientList] Setting clients:', response.data.items.length, 'items');
          this.clients.set(response.data.items);
          this.totalRecords.set(response.data.totalCount);
          // Réinitialiser le flag d'erreur en cas de succès
          this.lastErrorTime = 0;
          this.initialLoadDone = true;
        } else {
          // Gérer les erreurs de réponse API
          console.error('[ClientList] API returned success=false:', response.errors);
          this.handleError(response.errors?.[0] || 'Impossible de charger les clients');
        }
        this.loading.set(false);
        this.initialLoad.set(false);
      },
      error: (error) => {
        console.error('[ClientList] API Error:', error);
        this.loading.set(false);
        this.initialLoad.set(false);
        
        // Gérer spécifiquement les erreurs 429 (rate limiting)
        if (error?.status === 429) {
          this.handleError('Trop de requêtes. Veuillez patienter quelques instants avant de réessayer.');
          // Ne pas bloquer l'affichage, juste afficher un message
          return;
        }
        
        // Extraire le message d'erreur si disponible
        const errorMessage = error?.error?.errors?.[0] || error?.error?.message || error?.message || $localize`:@@clients.client-list.ts.impossible.de.charger.les.clients.9a6137e9:Impossible de charger les clients`;
        this.handleError(errorMessage);
      }
    });
  }

  private handleError(message: string): void {
    const now = Date.now();
    // Éviter les notifications dupliquées dans un court laps de temps
    if (now - this.lastErrorTime < this.ERROR_DEBOUNCE_MS) {
      return;
    }
    
    this.lastErrorTime = now;
    this.toastService.add({
      key: 'client-list-error', // Clé unique pour éviter les doublons
      severity: 'error',
      summary: $localize`:@@client-list.component.summary.Erreur:Erreur`,
      detail: message,
      life: 5000, // Durée d'affichage de 5 secondes
      closable: true
    });
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchSubject.next(value);
  }

  onSearch(): void {
    this.page = 1;
    this.loadClients();
  }

  onPageChange(event: any): void {
    console.log('[ClientList] onPageChange triggered:', event);
    
    // Calculer la page et la taille à partir de l'événement
    const first = event.first ?? 0;
    const rows = event.rows ?? this.pageSize;
    const newPage = rows ? Math.floor(first / rows) + 1 : 1;
    const newPageSize = rows || this.pageSize;

    console.log('[ClientList] Page change - first:', first, 'rows:', rows, 'newPage:', newPage, 'isFirstLoad:', this.isFirstLoad, 'initialLoadDone:', this.initialLoadDone);

    // Mettre à jour la page et la taille
    this.page = newPage;
    this.pageSize = newPageSize;
    
    // Si c'est le premier chargement lazy (first === 0) et qu'on a déjà chargé dans ngOnInit, ignorer
    // pour éviter le double chargement
    if (this.isFirstLoad && first === 0 && this.initialLoadDone) {
      console.log('[ClientList] Skipping lazy load - already loaded in ngOnInit');
      this.isFirstLoad = false;
      return;
    }
    
    // Charger les données
    console.log('[ClientList] Loading clients from onPageChange');
    this.loadClients();
    this.isFirstLoad = false;
  }

  getTypeSeverity(type: ClientType): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (type) {
      case ClientType.Individual:
        return 'info';
      case ClientType.Business:
        return 'success';
      default:
        return 'info';
    }
  }

  confirmDelete(client: ClientListItem): void {
    this.confirmationService.confirm({
      message: $localize`:@@clients.client-list.ts.etes.vous.sur.de.vouloir.supprimer.le.cl.68d22a96:Êtes-vous sûr de vouloir supprimer le client "${client.name}:name:" ?`,
      header: $localize`:@@clients.client-list.ts.confirmation.de.suppression.6a082d0b:Confirmation de suppression`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@client-list.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@client-list.component.rejectLabel.Annuler:Annuler`,
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.deleteClient(client.id);
      }
    });
  }

  private deleteClient(id: string): void {
    this.clientService.deleteClient(id).subscribe({
      next: (response) => {
        if (response.success) {
          this.toastService.add({
            severity: 'success',
            summary: $localize`:@@client-list.component.summary.Succès:Succès`,
            detail: $localize`:@@client-list.component.detail.Client_supprim_:Client supprimé avec succès`
          });
          this.loadClients();
        } else {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@client-list.component.summary.Erreur:Erreur`,
            detail: response.errors[0] || $localize`:@@clients.client-list.ts.impossible.de.supprimer.le.client.bd4e32c4:Impossible de supprimer le client`
          });
        }
      },
      error: (error) => {
        const errorMessage = this.errorHandler.extractErrorMessage(error);
        this.errorHandler.logError('Failed to delete client', error);
        this.confirmationService.alert({
          message: errorMessage || $localize`:@@clients.client-list.ts.impossible.de.supprimer.le.client.bd4e32c4:Impossible de supprimer le client`,
          header: $localize`:@@clients.client-list.ts.impossible.de.supprimer.0300380e:Impossible de supprimer`,
          icon: 'pi pi-exclamation-triangle'
        });
      }
    });
  }

  hasActiveFilters(): boolean {
    return !!this.searchTerm || this.selectedType !== null || this.selectedStatus !== null;
  }

  activeFiltersCount(): number {
    let count = 0;
    if (this.searchTerm) count++;
    if (this.selectedType !== null) count++;
    if (this.selectedStatus !== null) count++;
    return count;
  }

  onFilterChange(): void {
    this.page = 1;
    this.loadClients();
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.selectedType = null;
    this.selectedStatus = null;
    this.page = 1;
    this.loadClients();
  }
}
