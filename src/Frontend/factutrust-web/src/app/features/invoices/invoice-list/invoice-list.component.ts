/// <reference types="@angular/localize" />
import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, ParamMap, Params, Router } from '@angular/router';
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
import { applyInvoiceListFiltersFromQuery } from '@core/utils/list-filter-from-query';
import { formatLocalDate } from '@core/utils/date.util';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AnalyzeWithAiButtonComponent } from '@features/ai-assistant/components/analyze-with-ai-button/analyze-with-ai-button.component';
import { wrapLegacyAnalyzePayload } from '@features/ai-assistant/utils/ai-screen-payload.factory';
import { InvoiceImportDialogComponent } from '@features/invoices/components/invoice-import-dialog/invoice-import-dialog.component';
import { StatusBadgeComponent, StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';
import { TableTotalsBarComponent, TotalMetric } from '@shared/components/table-totals-bar/table-totals-bar.component';
import { InvoiceService, InvoiceListItem, InvoiceSearchParams, InvoiceListSummary, InvoiceTypeCode } from '@core/services/invoice.service';
import { PrintPreviewService } from '@core/services/print-preview.service';
import { ClientService, ClientListItem } from '@core/services/client.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import {
  RefundInvoiceIdDialogComponent,
  REFUND_INVOICE_DIALOG_OPTIONS
} from '@shared/components/refund-invoice-id-dialog/refund-invoice-id-dialog.component';
import { LinkedInvoiceRef } from '@core/services/invoice-reference-resolver.service';
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';

type InvoiceListMode = 'invoices' | 'unpaid' | 'creditNotes';

interface StatusOption {
  label: string;
  value: number | null;
}

@Component({
  selector: 'app-invoice-list',
  standalone: true,
  imports: [
    BackendLabelPipe,
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
    AnalyzeWithAiButtonComponent,
    InvoiceImportDialogComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>
    
    <app-page-header 
      [title]="pageTitle()" 
      [subtitle]="pageSubtitle()">
      <app-button 
        variant="secondary"
        icon="pi-print"
        iconPos="left"
        [disabled]="printingReport()"
        (click)="printInvoiceReport()"
        [ariaLabel]="printAriaLabel()" i18n="@@invoices.invoice-list.imprimer.l.etat.389e5da9"> Imprimer l'état </app-button>
      <app-analyze-with-ai-button
        [screenId]="analyzeScreenId()"
        [payloadBuilder]="buildInvoiceAnalyzePayload"
        [disabled]="loading() || initialLoad()" />
      @if (canImportInvoice()) {
        <app-button
          variant="secondary"
          icon="pi-file-import"
          iconPos="left"
          (click)="openImportDialog()"
          ariaLabel="Importer une facture depuis un fichier (PDF, image, Word ou Excel)" i18n-ariaLabel="@@invoices.invoice-list.importer.une.facture.depuis.un.fichier.p.01937b6a" i18n="@@invoices.invoice-list.importer.une.facture.66ed8807"> Importer une facture </app-button>
      }
      @if (canCreateInvoice() && creditNotesOnlyMode()) {
        <app-button 
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          (click)="openNewCreditNote()" i18n="@@invoices.invoice-list.nouvel.avoir.f3e4055a"> Nouvel avoir </app-button>
      } @else if (canCreateInvoice()) {
        <app-button 
          variant="primary"
          icon="pi-plus"
          iconPos="left"
          routerLink="/invoices/new" i18n="@@invoices.invoice-list.nouvelle.facture.cdf7e09c"> Nouvelle facture </app-button>
      }
    </app-page-header>

    <!-- Filters -->
    <div class="ft-filters">
      <div class="ft-filters__header">
        <h3 class="ft-filters__title" i18n="@@invoices.invoice-list.filtres.a2a5c940"><i class="pi pi-filter"></i> Filtres</h3>
        @if (hasActiveFilters()) {
          <button
            class="ft-filters__reset"
            (click)="resetFilters()"
            aria-label="Réinitialiser les filtres" i18n-aria-label="@@invoices.invoice-list.reinitialiser.les.filtres.d8915f02" i18n="@@invoices.invoice-list.reinitialiser.9637f51e">
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
            placeholder="Rechercher..." i18n-placeholder="@@invoices.invoice-list.rechercher.8bd64daa" 
            [(ngModel)]="searchTerm"
            (input)="onSearch()">
        </span>

        <p-select 
          [options]="statusOptions" 
          [(ngModel)]="selectedStatus"
          placeholder="Tous les statuts" i18n-placeholder="@@invoices.invoice-list.tous.les.statuts.2d5088af"
          [showClear]="true"
          (onChange)="onFilterChange()">
        </p-select>

        <p-datepicker 
          [(ngModel)]="dateRange" 
          selectionMode="range" 
          [readonlyInput]="true"
          placeholder="Période" i18n-placeholder="@@invoices.invoice-list.periode.de2110b7"
          dateFormat="dd/mm/yy"
          [showClear]="true"
          (onSelect)="onFilterChange()">
        </p-datepicker>

        <p-select 
          [options]="clientOptions" 
          [(ngModel)]="selectedClient"
          optionLabel="name"
          placeholder="Tous les clients" i18n-placeholder="@@invoices.invoice-list.tous.les.clients.56f5092c"
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
            <strong i18n="@@invoices.invoice-list.erreur.de.chargement.d7568404">Erreur de chargement</strong>
            <p>{{ errorMessage() }}</p>
            @if (isRateLimited()) {
              <small i18n="@@invoices.invoice-list.nouvelle.tentative.dans.quelques.instants.9cfcab5b">Nouvelle tentative dans quelques instants...</small>
            }
          </div>
          <app-button 
            variant="ghost"
            size="sm"
            icon="pi-refresh"
            (click)="loadInvoices()"
            [disabled]="loading()" i18n="@@invoices.invoice-list.reessayer.895d416b"> Réessayer </app-button>
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
          [loading]="loading()" 
          [value]="invoices()" 
          [lazy]="true"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalRecords()"
          [showCurrentPageReport]="true"
          [currentPageReportTemplate]="paginatorTemplate()"
          (onLazyLoad)="onPageChange($event)"
          styleClass="p-datatable-sm">
        
        <ng-template pTemplate="header">
          <tr>
            <th pSortableColumn="number"><ng-container i18n="@@invoices.invoice-list.numero.15e73db0">Numéro </ng-container> <p-sortIcon field="number"></p-sortIcon></th>
            <th i18n="@@invoices.invoice-list.client.1bdd79b1">Client</th>
            <th pSortableColumn="issueDate"><ng-container i18n="@@invoices.invoice-list.date.eb9a4bc1">Date </ng-container> <p-sortIcon field="issueDate"></p-sortIcon></th>
            <th i18n="@@invoices.invoice-list.echeance.f9a77ff6">Échéance</th>
            <th pSortableColumn="totalAmount"><ng-container i18n="@@invoices.invoice-list.montant.4adcd9fc">Montant </ng-container> <p-sortIcon field="totalAmount"></p-sortIcon></th>
            <th i18n="@@invoices.invoice-list.montant.paye.40c0b255">Montant payé</th>
            <th>{{ remainingColumnLabel() }}</th>
            <th i18n="@@invoices.invoice-list.statut.659499f3">Statut</th>
            <th style="width: 120px" i18n="@@invoices.invoice-list.actions.c3cd636a">Actions</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-invoice>
          <tr [class.overdue]="invoice.isOverdue" [class.row-avoir]="invoice.isCreditNote">
            <td>
              <a [routerLink]="invoiceDetailLink(invoice)" class="invoice-number">
                {{ invoice.number }}
              </a>
              @if (invoice.isCreditNote && !creditNotesOnlyMode()) {
                <span class="doc-type-chip" title="Facture d'avoir" i18n-title="@@invoices.invoice-list.facture.d.avoir.541e4451" i18n="@@invoices.invoice-list.avoir.8ee24717">Avoir</span>
              }
            </td>
            <td>{{ invoice.clientName }}</td>
            <td>{{ invoice.issueDate | date:'dd/MM/yyyy' }}</td>
            <td>
              @if (invoice.dueDate) {
                <span [class.text-error]="invoice.isOverdue">
                  {{ invoice.dueDate | date:'dd/MM/yyyy' }}
                </span>
              } @else {
                <span class="text-muted">-</span>
              }
            </td>
            <td class="amount">{{ invoice.totalAmount | number:'1.3-3' }} {{ invoice.currency }}</td>
            <td class="amount">{{ invoice.totalPaid | number:'1.3-3' }} {{ invoice.currency }}</td>
            <td class="amount">{{ invoice.remainingAmount | number:'1.3-3' }} {{ invoice.currency }}</td>
            <td>
              <app-status-badge 
                [status]="getStatusBadgeStatus(invoice.status)"
                [label]="invoice.status | backendLabel">
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
                  [routerLink]="invoiceDetailLink(invoice)"
                  [ariaLabel]="viewAriaLabel()">
                </app-button>
                <app-button 
                  variant="ghost"
                  size="sm"
                  icon="pi-download"
                  [iconOnly]="true"
                  [iconAlwaysVisible]="true"
                  (click)="downloadPdf(invoice)"
                  ariaLabel="Télécharger le PDF" i18n-ariaLabel="@@invoices.invoice-list.telecharger.le.pdf.27f91e86">
                </app-button>
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="9" class="text-center p-6">
              @if (unpaidOnlyMode()) {
                <app-empty-state
                  illustration="empty-invoices.svg"
                  title="Aucune facture impayée" i18n-title="@@invoices.invoice-list.aucune.facture.impayee.6da9b1d9"
                  description="Aucune facture client en attente de règlement." i18n-description="@@invoices.invoice-list.aucune.facture.client.en.attente.de.regl.e4ddd34c"
                  actionLabel="Voir toutes les factures" i18n-actionLabel="@@invoices.invoice-list.voir.toutes.les.factures.17662051"
                  actionRoute="/invoices">
                </app-empty-state>
              } @else if (creditNotesOnlyMode()) {
                <app-empty-state
                  illustration="empty-invoices.svg"
                  title="Aucun avoir" i18n-title="@@invoices.invoice-list.aucun.avoir.41d83a3a"
                  description="Créez votre premier avoir à partir d'une facture existante." i18n-description="@@invoices.invoice-list.creez.votre.premier.avoir.a.partir.d.une.580fe2da"
                  [showAction]="canCreateInvoice()"
                  actionLabel="Créer un avoir" i18n-actionLabel="@@invoices.invoice-list.creer.un.avoir.0c8c075d"
                  (actionClick)="openNewCreditNote()">
                </app-empty-state>
              } @else {
                <app-empty-state
                  illustration="empty-invoices.svg"
                  title="Aucune facture" i18n-title="@@invoices.invoice-list.aucune.facture.72124217"
                  description="Créez votre première facture pour commencer à facturer vos clients." i18n-description="@@invoices.invoice-list.creez.votre.premiere.facture.pour.commen.b84348c3"
                  [showAction]="canCreateInvoice()"
                  actionLabel="Créer une facture" i18n-actionLabel="@@invoices.invoice-list.creer.une.facture.a3863c70"
                  actionRoute="/invoices/new">
                </app-empty-state>
              }
            </td>
          </tr>
        </ng-template>
        </p-table>
      }
    </div>

    <app-invoice-import-dialog
      [visible]="importDialogVisible()"
      (visibleChange)="importDialogVisible.set($event)">
    </app-invoice-import-dialog>

  `,
  styles: [`
    .invoice-number {
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
    }

    .doc-type-chip {
      display: inline-block;
      margin-inline-start: var(--spacing-2);
      padding: 0 var(--spacing-2);
      border-radius: var(--radius-sm);
      background: var(--color-error-50, #fee2e2);
      color: var(--color-error-700, #b91c1c);
      border: 1px solid var(--color-error-200, #fecaca);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .amount {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-medium);
    }

    .actions {
      display: flex;
      gap: var(--spacing-1);
    }

    tr.overdue {
      background: var(--color-error-50);
    }

    tr.row-avoir .amount {
      color: var(--color-error-700, #b91c1c);
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

      small {
        display: block;
        margin-top: var(--spacing-1);
        color: var(--color-error-600);
        font-size: var(--font-size-xs);
        font-style: italic;
      }
    }
  `]
})
export class InvoiceListComponent implements OnInit, OnDestroy {
  private invoiceService = inject(InvoiceService);
  private printPreviewService = inject(PrintPreviewService);
  private toastService = inject(ToastService);
  private clientService = inject(ClientService);
  private errorHandler = inject(ErrorHandlerService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  private ngbModal = inject(NgbModal);

  listMode = signal<InvoiceListMode>('invoices');
  unpaidOnlyMode = computed(() => this.listMode() === 'unpaid');
  creditNotesOnlyMode = computed(() => this.listMode() === 'creditNotes');

  pageTitle = computed(() => {
    switch (this.listMode()) {
      case 'unpaid': return $localize`:@@invoices.invoice-list.ts.factures.impayees.dc3cffa5:Factures impayées`;
      case 'creditNotes': return $localize`:@@invoices.invoice-list.ts.avoirs.de.vente.63b21d70:Avoirs de vente`;
      default: return $localize`:@@invoices.invoice-list.ts.factures.da35e4f2:Factures`;
    }
  });

  pageSubtitle = computed(() => {
    switch (this.listMode()) {
      case 'unpaid': return $localize`:@@invoices.invoice-list.ts.factures.clients.non.reglees.ou.partiell.e3555d85:Factures clients non réglées ou partiellement réglées.`;
      case 'creditNotes': return $localize`:@@invoices.invoice-list.ts.gerez.vos.avoirs.de.vente.4ef43a4a:Gérez vos avoirs de vente`;
      default: return $localize`:@@invoices.invoice-list.ts.gerez.vos.factures.8f0170ed:Gérez vos factures`;
    }
  });

  analyzeScreenId = computed(() => this.creditNotesOnlyMode() ? 'credit-note-list' : 'invoice-list');
  remainingColumnLabel = computed(() => this.creditNotesOnlyMode() ? $localize`:@@ui.tern.reste.a.rembourser.551580:Reste à rembourser` : $localize`:@@ui.tern.reste.a.payer.968444:Reste à payer`);
  paginatorTemplate = computed(() =>
    this.creditNotesOnlyMode()
      ? $localize`:@@ui.tern.affichage.de.first.a.last.sur.totalrecords.b122ac:Affichage de {first} à {last} sur {totalRecords} avoirs`
      : $localize`:@@ui.tern.affichage.de.first.a.last.sur.totalrecords.5b810a:Affichage de {first} à {last} sur {totalRecords} factures`
  );
  printAriaLabel = computed(() =>
    this.creditNotesOnlyMode()
      ? $localize`:@@ui.tern.imprimer.l.etat.des.avoirs.periode.et.clie.1f08fb:Imprimer l'état des avoirs (période et client optionnels)`
      : $localize`:@@ui.tern.imprimer.l.etat.des.factures.periode.et.cl.728ed9:Imprimer l'état des factures (période et client optionnels)`
  );
  viewAriaLabel = computed(() => this.creditNotesOnlyMode() ? $localize`:@@ui.tern.voir.l.avoir.1dce8e:Voir l'avoir` : $localize`:@@ui.tern.voir.la.facture.e4bdde:Voir la facture`);

  canCreateInvoice = computed(
    () => !this.auth.isFirmDelegatedReadonly() && this.auth.hasPermission(PERMISSIONS.invoices.create)
  );
  /** Le bouton d'import requiert la permission de création ET l'accès à l'IA (policy backend AiChat). */
  canImportInvoice = computed(
    () => !this.creditNotesOnlyMode() && this.canCreateInvoice() && this.auth.hasAllPermissions(['ai:chat'])
  );
  importDialogVisible = signal(false);

  openImportDialog(): void {
    this.importDialogVisible.set(true);
  }

  loading = signal(true);
  initialLoad = signal(true);
  invoices = signal<InvoiceListItem[]>([]);
  totalRecords = signal(0);
  errorMessage = signal<string | null>(null);
  isRateLimited = signal(false);
  printingReport = signal(false);

  /** Totaux agrégés (backend) sur l'ensemble filtré complet — alimente la zone de totaux. */
  summary = signal<InvoiceListSummary | null>(null);
  summaryLoading = signal(false);

  /** Cartes de la zone de totaux, dérivées du résumé backend. */
  summaryMetrics = computed<TotalMetric[]>(() => {
    const s = this.summary();
    const currency = s?.currency ?? 'TND';
    const creditNotes = this.creditNotesOnlyMode();
    return [
      { label: creditNotes ? $localize`:@@ui.tern.avoirs.38b0e7:Avoirs` : $localize`:@@ui.tern.factures.da35e4:Factures`, value: s?.count, format: 'number', icon: 'pi-file', tone: 'primary' },
      { label: $localize`:@@invoices.invoice-list.ts.total.ttc.9e80ff7c:Total TTC`, value: s?.totalTtc, format: 'currency', currency, icon: 'pi-wallet', tone: 'primary' },
      { label: $localize`:@@invoices.invoice-list.ts.total.ht.2ca17ae6:Total HT`, value: s?.totalHt, format: 'currency', currency, icon: 'pi-calculator', tone: 'cyan' },
      { label: creditNotes ? $localize`:@@ui.tern.total.rembourse.81bf5c:Total remboursé` : $localize`:@@ui.tern.total.paye.57d30b:Total payé`, value: s?.totalPaid, format: 'currency', currency, icon: 'pi-check-circle', tone: 'emerald' },
      { label: creditNotes ? $localize`:@@ui.tern.reste.a.rembourser.551580:Reste à rembourser` : $localize`:@@ui.tern.reste.a.payer.968444:Reste à payer`, value: s?.totalRemaining, format: 'currency', currency, icon: 'pi-clock', tone: 'amber' },
      { label: $localize`:@@invoices.invoice-list.ts.en.retard.40c1dde3:En retard`, value: s?.overdueCount, format: 'number', icon: 'pi-exclamation-triangle', tone: 'rose' }
    ];
  });

  searchTerm = '';
  selectedStatus: number | null = null;
  dateRange: Date[] | null = [];
  selectedClient: ClientListItem | null = null;
  clientOptions: ClientListItem[] = [];
  private pendingClientIdFromQuery: string | null = null;
  page = 1;
  pageSize = 20;

  // Debounce pour la recherche
  private searchSubject = new Subject<string>();
  private subscriptions = new Subscription();
  private isLoadingInProgress = false;
  private lastErrorTime = 0;
  private readonly ERROR_DEBOUNCE_MS = 2000; // 2 secondes entre les messages d'erreur
  private readonly SEARCH_DEBOUNCE_MS = 500; // 500ms de debounce pour la recherche
  /** Évite le double chargement (ngOnInit + premier onLazyLoad PrimeNG). */
  private initialLoadDone = false;
  private isFirstLoad = true;

  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const base: BreadcrumbItem[] = [
      { label: $localize`:@@invoices.invoice-list.ts.accueil.a8ff8fd2:Accueil`, route: '/', icon: 'pi-home' }
    ];
    if (this.creditNotesOnlyMode()) {
      base.push({ label: $localize`:@@invoices.invoice-list.ts.avoirs.de.vente.63b21d70:Avoirs de vente` });
    } else {
      base.push({ label: $localize`:@@invoices.invoice-list.ts.factures.da35e4f2:Factures`, route: '/invoices' });
      if (this.unpaidOnlyMode()) {
        base.push({ label: $localize`:@@invoices.invoice-list.ts.factures.impayees.dc3cffa5:Factures impayées` });
      }
    }
    return base;
  });

  skeletonColumns: SkeletonColumn[] = [
    { width: '120px' },
    { width: '200px' },
    { width: '100px' },
    { width: '120px' },
    { width: '120px' },
    { width: '100px' },
    { width: '100px' },
    { width: '100px' },
    { width: '100px' }
  ];

  statusOptions: StatusOption[] = [
    { label: $localize`:@@invoices.list.filter.brouillon:Brouillon`, value: 0 },
    { label: $localize`:@@invoices.list.filter.validee:Validée`, value: 1 },
    { label: $localize`:@@invoices.list.filter.signee:Signée`, value: 2 },
    { label: $localize`:@@invoices.list.filter.payee:Payée`, value: 4 },
    { label: $localize`:@@invoices.list.filter.partielle:Partiellement payée`, value: 5 },
    { label: $localize`:@@invoices.list.filter.retard:En retard`, value: 6 },
    { label: $localize`:@@invoices.list.filter.annulee:Annulée`, value: 7 }
  ];

  ngOnInit(): void {
    this.applyListModeFromRouteData(this.route.snapshot.data);
    this.subscriptions.add(
      this.route.data.subscribe((data) => {
        this.applyListModeFromRouteData(data);
      })
    );
    this.subscriptions.add(
      this.route.queryParamMap.pipe(take(1)).subscribe((paramMap) => {
        this.applyFiltersFromQuery(paramMap);
      })
    );
    // Configuration du debounce pour la recherche
    this.subscriptions.add(
      this.searchSubject.pipe(
        debounceTime(this.SEARCH_DEBOUNCE_MS),
        distinctUntilChanged()
      ).subscribe(() => {
        this.page = 1;
        this.syncFiltersToUrl();
        this.loadInvoices();
      })
    );

    this.loadClients();
    this.loadInvoices();
  }

  private applyListModeFromRouteData(data: { [key: string]: unknown }): void {
    if (data['creditNotesOnly'] === true) {
      this.listMode.set('creditNotes');
    } else if (data['unpaidOnly'] === true) {
      this.listMode.set('unpaid');
    } else {
      this.listMode.set('invoices');
    }
  }

  invoiceDetailLink(invoice: InvoiceListItem): string[] {
    if (this.creditNotesOnlyMode()) {
      return ['/invoices', 'credit-notes', invoice.id];
    }
    if (this.unpaidOnlyMode()) {
      return ['/invoices', 'unpaid', invoice.id];
    }
    return ['/invoices', invoice.id];
  }

  openNewCreditNote(): void {
    const ref = this.ngbModal.open(RefundInvoiceIdDialogComponent, REFUND_INVOICE_DIALOG_OPTIONS);
    ref.result.then(
      (linkedInvoice: LinkedInvoiceRef) => {
        if (linkedInvoice?.id) {
          this.router.navigate(['/invoices', linkedInvoice.id, 'credit-note']);
        }
      },
      () => undefined
    ).catch(() => undefined);
  }

  private documentType(): InvoiceTypeCode {
    return this.creditNotesOnlyMode() ? 'CREDIT_NOTE' : 'INVOICE';
  }

  private applyFiltersFromQuery(paramMap: ParamMap): void {
    const applied = applyInvoiceListFiltersFromQuery(paramMap, {
      selectedStatus: this.selectedStatus,
      dateRange: this.dateRange,
      selectedClientId: this.selectedClient?.id ?? null,
      search: this.searchTerm || null
    });
    this.selectedStatus = applied.selectedStatus;
    if (applied.dateRange) {
      this.dateRange = applied.dateRange;
    }
    if (applied.selectedClientId) {
      this.pendingClientIdFromQuery = applied.selectedClientId;
      if (this.clientOptions.length > 0) {
        this.resolveClientFromQuery();
      }
    }
    if (applied.search) {
      this.searchTerm = applied.search;
    }
  }

  private resolveClientFromQuery(): void {
    if (!this.pendingClientIdFromQuery) {
      return;
    }
    this.selectedClient =
      this.clientOptions.find((c) => c.id === this.pendingClientIdFromQuery) ?? null;
    this.pendingClientIdFromQuery = null;
  }

  private loadClients(): void {
    this.clientService.getClients({ pageSize: 200 }).subscribe({
      next: (response) => {
        if (response.success && response.data?.items) {
          this.clientOptions = response.data.items;
          if (this.pendingClientIdFromQuery) {
            this.resolveClientFromQuery();
            this.loadInvoices();
          }
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  loadInvoices(): void {
    // Empêcher les requêtes multiples simultanées
    if (this.isLoadingInProgress) {
      return;
    }

    this.isLoadingInProgress = true;
    this.loading.set(true);
    this.errorMessage.set(null);
    this.isRateLimited.set(false);

    const params: InvoiceSearchParams = {
      search: this.searchTerm || undefined,
      status: this.selectedStatus ?? undefined,
      fromDate: this.dateRange?.[0] ? formatLocalDate(this.dateRange[0]) : undefined,
      toDate: this.dateRange?.[1] ? formatLocalDate(this.dateRange[1]) : undefined,
      clientId: this.selectedClient?.id,
      page: this.page,
      pageSize: this.pageSize,
      type: this.documentType(),
      ...(this.unpaidOnlyMode() ? { unpaidOnly: true } : {})
    };

    // Totaux conformes aux filtres (mêmes params, ensemble filtré complet côté backend).
    this.loadSummary(params);

    this.invoiceService.getInvoices(params).subscribe({
      next: (response) => {
        if (response.success) {
          this.invoices.set(response.data.items);
          this.totalRecords.set(response.data.totalCount);
          this.isRateLimited.set(false);
        } else {
          const errorMsg = response.errors?.join(', ') || $localize`:@@invoices.invoice-list.ts.impossible.de.charger.les.factures.583c2251:Impossible de charger les factures`;
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

        // Gestion spécifique des erreurs 429 (rate limiting) — pas de retry automatique côté service
        if (error?.status === 429) {
          this.isRateLimited.set(true);
          const errorMsg = this.errorHandler.extractErrorMessage(error);
          this.errorMessage.set(errorMsg);
          // Ne pas afficher de toast ici car l'intercepteur le gère déjà
          // Le composant affiche juste le message inline
          return;
        }

        // Autres erreurs
        const errorMsg = this.errorHandler.extractErrorMessage(error) || $localize`:@@invoices.invoice-list.ts.impossible.de.charger.les.factures.583c2251:Impossible de charger les factures`;
        this.errorMessage.set(errorMsg);
        this.showErrorToast(errorMsg);
      },
      complete: () => {
        this.initialLoadDone = true;
      }
    });
  }

  /**
   * Charge les totaux agrégés (mêmes filtres que la liste). Échec silencieux : la zone de
   * totaux ne doit jamais perturber l'affichage de la liste (skipGlobalErrorUi).
   */
  private loadSummary(params: InvoiceSearchParams): void {
    this.summaryLoading.set(true);
    this.invoiceService.getInvoicesSummary({ ...params, skipGlobalErrorUi: true }).subscribe({
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
    // Utiliser le Subject pour le debounce
    this.searchSubject.next(this.searchTerm);
  }

  onFilterChange(): void {
    // Pour les changements de filtres (dropdown, date), recharger immédiatement
    // mais toujours avec protection contre les requêtes multiples
    this.page = 1;
    this.syncFiltersToUrl();
    this.loadInvoices();
  }

  /**
   * Reflète les filtres courants dans l'URL (query params) : URL partageable et conservée au
   * rafraîchissement (lecture symétrique dans applyFiltersFromQuery). `replaceUrl` évite de
   * polluer l'historique ; une valeur nulle retire le paramètre (merge).
   */
  private syncFiltersToUrl(): void {
    const queryParams: Params = {
      search: this.searchTerm || null,
      status: this.selectedStatus ?? null,
      fromDate: this.dateRange?.[0] ? formatLocalDate(this.dateRange[0]) : null,
      toDate: this.dateRange?.[1] ? formatLocalDate(this.dateRange[1]) : null,
      clientId: this.selectedClient?.id ?? null
    };
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  private showErrorToast(message: string): void {
    const now = Date.now();
    // Éviter les notifications dupliquées dans un court laps de temps
    if (now - this.lastErrorTime < this.ERROR_DEBOUNCE_MS) {
      return;
    }
    
    this.lastErrorTime = now;
    this.toastService.add({
      key: 'invoice-list-error',
      severity: 'error',
      summary: $localize`:@@invoice-list.component.summary.Erreur:Erreur`,
      detail: message,
      life: 5000
    });
  }

  onPageChange(event: any): void {
    const first = event.first ?? 0;
    const rows = event.rows ?? this.pageSize;
    this.page = rows ? Math.floor(first / rows) + 1 : 1;
    this.pageSize = rows || this.pageSize;

    if (this.isFirstLoad && first === 0 && this.initialLoadDone) {
      this.isFirstLoad = false;
      return;
    }

    this.loadInvoices();
    this.isFirstLoad = false;
  }

  downloadPdf(invoice: InvoiceListItem): void {
    this.invoiceService.downloadPdf(invoice.id).subscribe({
      next: (blob) => {
        if (!blob || blob.size === 0) {
          return;
        }

        try {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${invoice.isCreditNote ? $localize`:@@ui.tern.avoir.8ee247:Avoir` : $localize`:@@ui.tern.facture.3953b9:Facture`}_${invoice.number}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        } catch (error) {
          console.error('Erreur lors du téléchargement du PDF:', error);
        }
      },
      error: (error: Error) => {
        console.error('Erreur lors du téléchargement du PDF:', error);
      }
    });
  }

  printInvoiceReport(): void {
    const fromDate = this.dateRange?.[0] ? formatLocalDate(this.dateRange[0]) : undefined;
    const toDate = this.dateRange?.[1] ? formatLocalDate(this.dateRange[1]) : undefined;
    const clientId = this.selectedClient?.id;

    this.printingReport.set(true);
    this.invoiceService.downloadReportPdf(fromDate, toDate, clientId, this.documentType()).subscribe({
      next: (blob) => {
        this.printingReport.set(false);
        if (!blob || blob.size === 0) return;
        const prefix = this.creditNotesOnlyMode() ? 'Etat_avoirs_ventes' : 'Etat_factures_ventes';
        this.printPreviewService.openPdfForPrintPreview(blob, `${prefix}_${fromDate}_${toDate}.pdf`);
      },
      error: (error: Error) => {
        this.printingReport.set(false);
        this.toastService.add({
          key: 'invoice-list-print',
          severity: 'error',
          summary: $localize`:@@invoice-list.component.summary.Erreur:Erreur`,
          detail: error.message || $localize`:@@invoices.invoice-list.ts.impossible.de.generer.le.rapport.pdf.e2243d7a:Impossible de générer le rapport PDF`,
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
    this.syncFiltersToUrl();
    this.loadInvoices();
  }

  readonly buildInvoiceAnalyzePayload = (): unknown =>
    wrapLegacyAnalyzePayload(
      this.analyzeScreenId(),
      {
        screen: this.analyzeScreenId(),
        unpaidOnly: this.unpaidOnlyMode(),
        creditNotesOnly: this.creditNotesOnlyMode(),
        filters: {
          search: this.searchTerm || null,
          status: this.selectedStatus,
          fromDate: this.dateRange?.[0] ? formatLocalDate(this.dateRange[0]) : null,
          toDate: this.dateRange?.[1] ? formatLocalDate(this.dateRange[1]) : null,
          clientId: this.selectedClient?.id ?? null,
          clientName: this.selectedClient?.name ?? null
        },
        pagination: {
          page: this.page,
          pageSize: this.pageSize,
          totalRecords: this.totalRecords()
        },
        totals: this.summary(),
        rows: this.invoices().map(i => ({
          number: i.number,
          clientName: i.clientName,
          issueDate: i.issueDate,
          dueDate: i.dueDate,
          totalAmount: i.totalAmount,
          totalPaid: i.totalPaid,
          remainingAmount: i.remainingAmount,
          status: i.status,
          currency: i.currency,
          isOverdue: i.isOverdue
        }))
      } as Record<string, unknown>
    );

  getStatusBadgeStatus(status: string): StatusBadgeStatus {
    const statusMap: Record<string, StatusBadgeStatus> = {
      'Payée': 'paid',
      'Partiellement payée': 'partial',
      'En attente': 'pending',
      'En retard': 'overdue',
      'Brouillon': 'draft',
      'Annulée': 'cancelled',
      'Validée': 'validated',
      'Signée': 'signed'
    };
    return statusMap[status] || 'draft';
  }
}
