/// <reference types="@angular/localize" />
import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { PaginatorModule } from 'primeng/paginator';
import { ToastModule } from 'primeng/toast';
import { ToastService } from '@core/services/toast.service';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, take } from 'rxjs/operators';
import { applyDeliveryNoteListFiltersFromQuery } from '@core/utils/list-filter-from-query';
import { formatLocalDate } from '@core/utils/date.util';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent, StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { DeliveryNoteService, DeliveryNoteSearchParams, DeliveryNoteListSummary } from '../../services/delivery-note.service';
import { DeliveryNoteListDto, DeliveryNoteStatus } from '../../models/delivery-note.model';
import { PrintPreviewService } from '@core/services/print-preview.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { ClientService, ClientListItem } from '@core/services/client.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { isEmptyDeliveryNoteReportError } from '@core/utils/report-pdf-empty.util';

interface StatusOption {
  label: string;
  value: DeliveryNoteStatus | null;
}

@Component({
  selector: 'app-delivery-note-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    DatePickerModule,
    PaginatorModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent,
    StatusBadgeComponent,
    TableTotalsBarComponent,
    BackendLabelPipe
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>
    
    <app-page-header 
      title="Bons de Livraison" i18n-title="@@delivery-notes.pages.bons.de.livraison.a42b9518" 
      subtitle="Créez, envoyez et transformez vos bons de livraison en factures" i18n-subtitle="@@delivery-notes.pages.creez.envoyez.et.transformez.vos.bons.de.b8671c0b">
      <app-button 
        variant="secondary"
        icon="pi-print"
        iconPos="left"
        [disabled]="printingReport() || !canPrintDeliveryNoteReport()"
        (click)="printDeliveryNoteReport()"
        ariaLabel="Imprimer l'état des bons de livraison (période et client optionnels)" i18n-ariaLabel="@@delivery-notes.pages.imprimer.l.etat.des.bons.de.livraison.pe.5e9a3cfc" i18n="@@delivery-notes.pages.imprimer.l.etat.389e5da9"> Imprimer l'état </app-button>
      @if (canCreateDeliveryNote()) {
        <app-button 
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          routerLink="new" i18n="@@delivery-notes.pages.nouveau.bon.de.livraison.85eb7bab"> Nouveau bon de livraison </app-button>
      }
    </app-page-header>

    <!-- Filters -->
    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title" i18n="@@delivery-notes.pages.filtres.a2a5c940"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button
            class="ft-filters__reset"
            (click)="resetFilters()"
            aria-label="Réinitialiser les filtres" i18n-aria-label="@@delivery-notes.pages.reinitialiser.les.filtres.d8915f02" i18n="@@delivery-notes.pages.reinitialiser.9637f51e">
            <i class="pi pi-times"></i>
            Réinitialiser ({{ activeFiltersCount() }})
          </button>
        }
      </div>
      <div class="ft-filters__row">
        <span class="p-input-icon-left">
          <i class="pi pi-search"></i>
          <input 
            pInputText 
            type="text" 
            placeholder="Rechercher..." i18n-placeholder="@@delivery-notes.pages.rechercher.8bd64daa" 
            [(ngModel)]="searchTerm"
            (input)="onSearch()">
        </span>

        <p-select 
          [options]="statusOptions" 
          [(ngModel)]="selectedStatus"
          placeholder="Tous les statuts" i18n-placeholder="@@delivery-notes.pages.tous.les.statuts.2d5088af"
          [showClear]="true"
          (onChange)="onFilterChange()">
        </p-select>

        <p-datepicker 
          [(ngModel)]="dateRange" 
          selectionMode="range" 
          [readonlyInput]="true"
          placeholder="Période" i18n-placeholder="@@delivery-notes.pages.periode.de2110b7"
          dateFormat="dd/mm/yy"
          [showClear]="true"
          (onSelect)="onFilterChange()">
        </p-datepicker>

        <p-select 
          [options]="clientOptions" 
          [(ngModel)]="selectedClient"
          optionLabel="name"
          placeholder="Tous les clients" i18n-placeholder="@@delivery-notes.pages.tous.les.clients.56f5092c"
          [showClear]="true"
          [filter]="true"
          filterBy="name,code"
          (onChange)="onFilterChange()">
        </p-select>
      </div>
    </div>

    <!-- Error Message -->
    @if (errorMessage() && !loading()) {
      <div class="error-banner">
        <div class="error-content">
          <i class="pi pi-exclamation-triangle"></i>
          <div class="error-text">
            <strong i18n="@@delivery-notes.pages.erreur.de.chargement.d7568404">Erreur de chargement</strong>
            <p>{{ errorMessage() }}</p>
          </div>
          <app-button 
            variant="ghost"
            size="sm"
            icon="pi-refresh"
            (click)="loadDeliveryNotes()"
            [disabled]="loading()" i18n="@@delivery-notes.pages.reessayer.895d416b"> Réessayer </app-button>
        </div>
      </div>
    }

    <!-- Totaux (calculés côté backend sur l'ensemble filtré, pas seulement la page) -->
    <app-table-totals-bar
      [metrics]="summaryMetrics()"
      [loading]="summaryLoading()">
    </app-table-totals-bar>

    <!-- Table -->
    <div class="ft-table-card">
      @if (initialLoad()) {
        <app-skeleton-table
          [rows]="5"
          [columns]="skeletonColumns">
        </app-skeleton-table>
      } @else {
        <p-table 
          [value]="deliveryNotes()" 
          [loading]="loading()"
          [lazy]="true"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalRecords()"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Affichage de {first} à {last} sur {totalRecords} bons de livraison" i18n-currentPageReportTemplate="@@delivery-notes.pages.affichage.de.first.a.last.sur.totalrecords.bons.a59b315a"
          (onLazyLoad)="onPageChange($event)"
          styleClass="p-datatable-sm">
        
        <ng-template pTemplate="header">
          <tr>
            <th pSortableColumn="number"><ng-container i18n="@@delivery-notes.pages.numero.15e73db0">Numéro </ng-container> <p-sortIcon field="number"></p-sortIcon></th>
            <th i18n="@@delivery-notes.pages.client.1bdd79b1">Client</th>
            <th pSortableColumn="issueDate"><ng-container i18n="@@delivery-notes.pages.date.eb9a4bc1">Date </ng-container> <p-sortIcon field="issueDate"></p-sortIcon></th>
            <th class="text-right" i18n="@@delivery-notes.pages.montant.ttc.a742433a">Montant TTC</th>
            <th i18n="@@delivery-notes.pages.statut.659499f3">Statut</th>
            <th style="width: 100px" i18n="@@delivery-notes.pages.actions.c3cd636a">Actions</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-note>
          <tr>
            <td>
              <a [routerLink]="[note.id]" class="delivery-note-number">
                {{ note.number }}
              </a>
            </td>
            <td>{{ note.clientName }}</td>
            <td>{{ note.issueDate | date:'dd/MM/yyyy' }}</td>
            <td class="text-right amount">{{ note.totalTTC | number:'1.3-3' }} TND</td>
            <td>
              <app-status-badge 
                [status]="getStatusBadgeStatus(note.status)"
                [label]="note.statusDisplay | backendLabel">
              </app-status-badge>
            </td>
            <td>
              <div class="actions">
                <app-button 
                  variant="ghost"
                  size="sm"
                  icon="pi-eye"
                  [iconOnly]="true"
                  [iconAlwaysVisible]="true"
                  [routerLink]="note.id"
                  ariaLabel="Voir le bon de livraison" i18n-ariaLabel="@@delivery-notes.pages.voir.le.bon.de.livraison.5047463f">
                </app-button>
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="6" class="text-center p-6">
              <app-empty-state
                illustration="empty-invoices.svg"
                title="Aucun bon de livraison" i18n-title="@@delivery-notes.pages.aucun.bon.de.livraison.e7dcd4f7"
                description="Créez votre premier bon de livraison pour gérer vos expéditions." i18n-description="@@delivery-notes.pages.creez.votre.premier.bon.de.livraison.pou.9c2a06e6"
                [showAction]="canCreateDeliveryNote()"
                actionLabel="Créer un bon" i18n-actionLabel="@@delivery-notes.pages.creer.un.bon.da06defa"
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
    .delivery-note-number {
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
    }

    .actions {
      display: flex;
      gap: var(--spacing-1);
    }

    .amount {
      font-family: var(--font-family-mono, 'JetBrains Mono', 'SF Mono', 'Monaco', 'Consolas', monospace);
      font-weight: var(--font-weight-semibold);
    }

    .text-right {
      text-align: end;
    }

    .error-banner {
      background: var(--color-error-50);
      border: 1px solid var(--color-error-200);
      border-radius: var(--radius-lg);
      padding: var(--spacing-4);
      margin-bottom: var(--spacing-4);
    }

    .error-content {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-3);
    }

    .error-content i {
      color: var(--color-error-600);
      font-size: var(--font-size-lg);
      margin-top: var(--spacing-1);
    }

    .error-text {
      flex: 1;
      
      strong {
        display: block;
        color: var(--color-error-800);
        font-weight: var(--font-weight-semibold);
        margin-bottom: var(--spacing-1);
      }

      p {
        margin: 0;
        color: var(--color-error-700);
        font-size: var(--font-size-sm);
      }
    }
  `]
})
export class DeliveryNoteListComponent implements OnInit, OnDestroy {
  private deliveryNoteService = inject(DeliveryNoteService);
  private printPreviewService = inject(PrintPreviewService);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private clientService = inject(ClientService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);

  canCreateDeliveryNote = computed(() => this.auth.hasPermission(PERMISSIONS.deliveryNotes.create));

  loading = signal(true);
  initialLoad = signal(true);
  deliveryNotes = signal<DeliveryNoteListDto[]>([]);
  totalRecords = signal(0);
  errorMessage = signal<string | null>(null);
  printingReport = signal(false);

  /** Totaux agrégés (backend) sur l'ensemble filtré complet — alimente la zone de totaux. */
  summary = signal<DeliveryNoteListSummary | null>(null);
  summaryLoading = signal(false);

  canPrintDeliveryNoteReport = computed(() => {
    if (this.loading() || this.summaryLoading() || this.initialLoad()) {
      return false;
    }
    return (this.summary()?.count ?? 0) > 0;
  });

  summaryMetrics = computed<TotalMetric[]>(() => {
    const s = this.summary();
    const currency = s?.currency ?? 'TND';
    return [
      { label: $localize`:@@delivery-notes.delivery-note-list.ts.bons.050c19c5:Bons`, value: s?.count, format: 'number', icon: 'pi-file', tone: 'primary' },
      { label: $localize`:@@delivery-notes.delivery-note-list.ts.total.ttc.9e80ff7c:Total TTC`, value: s?.totalTtc, format: 'currency', currency, icon: 'pi-wallet', tone: 'primary' },
      { label: $localize`:@@delivery-notes.delivery-note-list.ts.total.ht.2ca17ae6:Total HT`, value: s?.totalHt, format: 'currency', currency, icon: 'pi-calculator', tone: 'cyan' },
      { label: $localize`:@@delivery-notes.delivery-note-list.ts.livres.e0602de9:Livrés`, value: s?.deliveredCount, format: 'number', icon: 'pi-check-circle', tone: 'emerald' },
      { label: $localize`:@@delivery-notes.delivery-note-list.ts.factures.60d4818b:Facturés`, value: s?.invoicedCount, format: 'number', icon: 'pi-money-bill', tone: 'violet' }
    ];
  });

  searchTerm = '';
  selectedStatus: DeliveryNoteStatus | null = null;
  dateRange: Date[] | null = [];
  selectedClient: ClientListItem | null = null;
  clientOptions: ClientListItem[] = [];
  page = 1;
  pageSize = 20;

  private searchSubject = new Subject<string>();
  private subscriptions = new Subscription();
  private isLoadingInProgress = false;
  private lastErrorTime = 0;
  private readonly ERROR_DEBOUNCE_MS = 2000;
  private readonly SEARCH_DEBOUNCE_MS = 500;

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@delivery-notes.delivery-note-list.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
    { label: $localize`:@@delivery-notes.delivery-note-list.ts.bons.de.livraison.a42b9518:Bons de Livraison` }
  ];

  skeletonColumns: SkeletonColumn[] = [
    { width: '120px' },
    { width: '200px' },
    { width: '100px' },
    { width: '120px' },
    { width: '100px' },
    { width: '100px' }
  ];

  statusOptions: StatusOption[] = [
    { label: $localize`:@@delivery-notes.list.filter.brouillon:Brouillon`, value: DeliveryNoteStatus.Draft },
    { label: $localize`:@@delivery-notes.list.filter.confirme:Confirmé`, value: DeliveryNoteStatus.Confirmed },
    { label: $localize`:@@delivery-notes.list.filter.en-cours:En cours`, value: DeliveryNoteStatus.InTransit },
    { label: $localize`:@@delivery-notes.list.filter.livre:Livré`, value: DeliveryNoteStatus.Delivered },
    { label: $localize`:@@delivery-notes.list.filter.partiel:Partiellement livré`, value: DeliveryNoteStatus.PartiallyDelivered },
    { label: $localize`:@@delivery-notes.list.filter.echoue:Échoué`, value: DeliveryNoteStatus.Failed },
    { label: $localize`:@@delivery-notes.list.filter.annule:Annulé`, value: DeliveryNoteStatus.Cancelled },
    { label: $localize`:@@delivery-notes.list.filter.facture:Facturé`, value: DeliveryNoteStatus.Invoiced }
  ];

  ngOnInit(): void {
    this.subscriptions.add(
      this.route.queryParamMap.pipe(take(1)).subscribe((paramMap) => {
        const applied = applyDeliveryNoteListFiltersFromQuery(paramMap, {
          selectedStatus: this.selectedStatus,
          search: this.searchTerm || null
        });
        this.selectedStatus = applied.selectedStatus;
        if (applied.search) {
          this.searchTerm = applied.search;
        }
      })
    );
    this.subscriptions.add(
      this.searchSubject.pipe(
        debounceTime(this.SEARCH_DEBOUNCE_MS),
        distinctUntilChanged()
      ).subscribe(() => {
        this.page = 1;
        this.loadDeliveryNotes();
      })
    );

    this.loadClients();
    this.loadDeliveryNotes();
  }

  private loadClients(): void {
    this.clientService.getClients({ pageSize: 200 }).subscribe({
      next: (response) => {
        if (response.success && response.data?.items) {
          this.clientOptions = response.data.items;
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  loadDeliveryNotes(): void {
    if (this.isLoadingInProgress) {
      return;
    }

    this.isLoadingInProgress = true;
    this.loading.set(true);
    this.errorMessage.set(null);

    const params: DeliveryNoteSearchParams = {
      search: this.searchTerm || undefined,
      status: this.selectedStatus ?? undefined,
      fromDate: this.dateRange?.[0] ? formatLocalDate(this.dateRange[0]) : undefined,
      toDate: this.dateRange?.[1] ? formatLocalDate(this.dateRange[1]) : undefined,
      clientId: this.selectedClient?.id,
      page: this.page,
      pageSize: this.pageSize
    };

    this.loadSummary(params);

    this.deliveryNoteService.getDeliveryNotes(params).subscribe({
      next: (response) => {
        if (response.success) {
          this.deliveryNotes.set(response.data.items);
          this.totalRecords.set(response.data.totalCount);
        } else {
          const errorMsg = response.errors?.join(', ') || $localize`:@@delivery-notes.delivery-note-list.ts.impossible.de.charger.les.bons.de.livrai.fd61c761:Impossible de charger les bons de livraison`;
          this.errorMessage.set(errorMsg);
          this.showErrorToast(errorMsg);
        }
        this.loading.set(false);
        this.initialLoad.set(false);
        this.isLoadingInProgress = false;
      },
      error: (error) => {
        this.loading.set(false);
        this.initialLoad.set(false);
        this.isLoadingInProgress = false;

        const errorMsg = this.errorHandler.extractErrorMessage(error) || $localize`:@@delivery-notes.delivery-note-list.ts.impossible.de.charger.les.bons.de.livrai.fd61c761:Impossible de charger les bons de livraison`;
        this.errorMessage.set(errorMsg);
        this.showErrorToast(errorMsg);
      }
    });
  }

  /** Totaux conformes aux filtres ; échec silencieux pour ne pas perturber la liste. */
  private loadSummary(params: DeliveryNoteSearchParams): void {
    this.summaryLoading.set(true);
    this.deliveryNoteService.getDeliveryNotesSummary({ ...params, skipGlobalErrorUi: true }).subscribe({
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

  onSearch(): void {
    this.searchSubject.next(this.searchTerm);
  }

  onFilterChange(): void {
    this.page = 1;
    this.loadDeliveryNotes();
  }

  private showErrorToast(message: string): void {
    const now = Date.now();
    if (now - this.lastErrorTime < this.ERROR_DEBOUNCE_MS) {
      return;
    }

    this.lastErrorTime = now;
    this.toastService.add({
      key: 'delivery-note-list-error',
      severity: 'error',
      summary: $localize`:@@delivery-note-list.component.summary.Erreur:Erreur`,
      detail: message,
      life: 5000
    });
  }

  onPageChange(event: any): void {
    this.page = (event.first / event.rows) + 1;
    this.pageSize = event.rows;
    this.loadDeliveryNotes();
  }

  printDeliveryNoteReport(): void {
    if (!this.canPrintDeliveryNoteReport()) {
      this.toastService.add({
        key: 'delivery-note-list-print',
        severity: 'warn',
        summary: $localize`:@@delivery-notes.delivery-note-list.report.toast.summary.information:Information`,
        detail: $localize`:@@delivery-notes.delivery-note-list.report.empty.deliveryNotes:Aucun bon de livraison sur cette période pour l'état.`,
        life: 5000
      });
      return;
    }

    const fromDate = this.dateRange?.[0] ? formatLocalDate(this.dateRange[0]) : undefined;
    const toDate = this.dateRange?.[1] ? formatLocalDate(this.dateRange[1]) : undefined;
    const clientId = this.selectedClient?.id;

    this.printingReport.set(true);
    this.deliveryNoteService.downloadReportPdf(fromDate, toDate, clientId).subscribe({
      next: (blob) => {
        this.printingReport.set(false);
        if (!blob || blob.size === 0) return;
        this.printPreviewService.openPdfForPrintPreview(blob, `Etat_bons_livraison_${fromDate}_${toDate}.pdf`);
      },
      error: (error: Error) => {
        this.printingReport.set(false);
        const emptyPeriod = isEmptyDeliveryNoteReportError(error.message);
        this.toastService.add({
          key: 'delivery-note-list-print',
          severity: emptyPeriod ? 'warn' : 'error',
          summary: emptyPeriod
            ? $localize`:@@delivery-notes.delivery-note-list.report.toast.summary.information:Information`
            : $localize`:@@delivery-note-list.component.summary.Erreur:Erreur`,
          detail: error.message || $localize`:@@delivery-notes.delivery-note-list.ts.impossible.de.generer.le.rapport.pdf.e2243d7a:Impossible de générer le rapport PDF`,
          life: 5000
        });
      }
    });
  }

  hasActiveFilters(): boolean {
    return !!this.searchTerm || this.selectedStatus !== null || (this.dateRange?.length ?? 0) > 0 || this.selectedClient !== null;
  }

  activeFiltersCount(): number {
    let count = 0;
    if (this.searchTerm) count++;
    if (this.selectedStatus !== null) count++;
    if ((this.dateRange?.length ?? 0) > 0) count++;
    if (this.selectedClient !== null) count++;
    return count;
  }

  resetFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = null;
    this.dateRange = [];
    this.selectedClient = null;
    this.page = 1;
    this.loadDeliveryNotes();
  }

  getStatusBadgeStatus(status: DeliveryNoteStatus): StatusBadgeStatus {
    const statusMap: Record<DeliveryNoteStatus, StatusBadgeStatus> = {
      [DeliveryNoteStatus.Draft]: 'draft',
      [DeliveryNoteStatus.Confirmed]: 'validated',
      [DeliveryNoteStatus.Delivered]: 'paid',
      [DeliveryNoteStatus.PartiallyDelivered]: 'pending',
      [DeliveryNoteStatus.Failed]: 'overdue',
      [DeliveryNoteStatus.Cancelled]: 'cancelled',
      [DeliveryNoteStatus.Invoiced]: 'signed',
      [DeliveryNoteStatus.InTransit]: 'sent', // Using 'sent' for InTransit
      [DeliveryNoteStatus.Refused]: 'rejected', // Using 'rejected' for Refused
    };
    return statusMap[status] || 'draft';
  }
}
