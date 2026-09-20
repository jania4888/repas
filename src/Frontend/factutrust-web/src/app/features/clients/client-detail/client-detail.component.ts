import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { TabsModule } from 'primeng/tabs';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { SkeletonModule } from 'primeng/skeleton';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { StatCardComponent } from '@shared/components/stat-card/stat-card.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { ClientOutstanding, ClientService, Client, ClientType, ClientStats } from '@core/services/client.service';
import { InvoiceService, InvoiceListItem, InvoiceSearchParams } from '@core/services/invoice.service';
import { QuoteService, QuoteListItem } from '@core/services/quote.service';
import { ClientOutstandingPanelComponent } from '../client-outstanding-panel/client-outstanding-panel.component';
import { ClientPortalContactsPanelComponent } from '../client-portal-contacts-panel.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';

@Component({
  selector: 'app-client-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ButtonModule,
    CardModule,
    TagModule,
    DividerModule,
    TabsModule,
    TableModule,
    TooltipModule,
    ConfirmDialogModule,
    ToastModule,
    SkeletonModule,
    PageHeaderComponent,
    StatCardComponent,
    BreadcrumbComponent,
    SkeletonTableComponent,
    EmptyStateComponent,
    ButtonComponent,
    StatusBadgeComponent,
    ClientOutstandingPanelComponent,
    ClientPortalContactsPanelComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>
    
    <app-page-header 
      [title]="client()?.name || 'Chargement...'" 
      [subtitle]="client()?.code">
      <app-button 
        variant="outline"
        icon="pi-arrow-left"
        iconPos="left"
        routerLink="/clients">
        Retour
      </app-button>
      @if (client()) {
        <app-button 
          variant="primary"
          icon="pi-pencil"
          iconPos="left"
          [routerLink]="['edit']">
          Modifier
        </app-button>
        <app-button 
          variant="outline"
          icon="pi-trash"
          iconPos="left"
          (click)="confirmDelete()">
          Supprimer
        </app-button>
      }
    </app-page-header>

    <!-- Encours : ce que le client doit avant qu'on lui vende a nouveau. -->
    <app-client-outstanding-panel
      [outstanding]="outstanding()"
      [loading]="loadingOutstanding()">
    </app-client-outstanding-panel>

    @if (loading()) {
      <div class="detail-grid">
        <div class="main-content">
          <p-card>
            <p-skeleton height="2rem" styleClass="mb-4"></p-skeleton>
            <p-skeleton height="1rem" styleClass="mb-2" width="60%"></p-skeleton>
            <p-skeleton height="1rem" styleClass="mb-2" width="40%"></p-skeleton>
            <p-skeleton height="1rem" width="50%"></p-skeleton>
          </p-card>
        </div>
        <div class="sidebar">
          <p-skeleton height="8rem" styleClass="mb-4"></p-skeleton>
          <p-skeleton height="8rem"></p-skeleton>
        </div>
      </div>
    } @else if (client()) {
      <!-- Stats -->
      <div class="stats-grid">
        <app-stat-card
          label="Total factures"
          [value]="stats()?.totalInvoices || 0"
          icon="pi-file"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Factures payées"
          [value]="stats()?.paidInvoices || 0"
          icon="pi-check-circle"
          variant="success">
        </app-stat-card>
        <app-stat-card
          label="En attente"
          [value]="stats()?.pendingInvoices || 0"
          icon="pi-clock"
          variant="warning">
        </app-stat-card>
        <app-stat-card
          label="Chiffre d'affaires"
          [value]="formatCurrency(stats()?.totalRevenue || 0)"
          icon="pi-wallet"
          variant="primary">
        </app-stat-card>
      </div>

      <div class="detail-grid">
        <!-- Main Content -->
        <div class="main-content">
          <p-tabs class="ft-tabs" [lazy]="true">
            <p-tablist>
              <p-tab [value]="0"><i class="pi pi-info-circle"></i><span>Informations</span></p-tab>
              <p-tab [value]="1"><i class="pi pi-file"></i><span>Devis</span></p-tab>
              <p-tab [value]="2"><i class="pi pi-receipt"></i><span>Factures</span></p-tab>
              @if (canManagePortal()) {
                <p-tab [value]="3"><i class="pi pi-users"></i><span>Espace client</span></p-tab>
              }
            </p-tablist>
            <p-tabpanels>
            <!-- Informations Tab -->
            <p-tabpanel [value]="0">
              <div class="info-grid">
                <div class="info-section">
                  <h3>Coordonnées</h3>
                  <div class="info-row">
                    <span class="label">Email</span>
                    <a [href]="'mailto:' + client()!.email" class="value link">{{ client()!.email }}</a>
                  </div>
                  <div class="info-row">
                    <span class="label">Téléphone</span>
                    <a [href]="'tel:' + client()!.phone" class="value link">{{ client()!.phone }}</a>
                  </div>
                </div>

                <div class="info-section">
                  <h3>Informations fiscales</h3>
                  <div class="info-row">
                    <span class="label">Type</span>
                    <app-status-badge 
                      [status]="getClientTypeStatus(client()!.type)"
                      [label]="client()!.typeDisplay">
                    </app-status-badge>
                  </div>
                  <div class="info-row">
                    <span class="label">Matricule fiscal</span>
                    <span class="value mono">{{ client()!.nif || 'Non renseigné' }}</span>
                  </div>
                </div>

                <div class="info-section">
                  <h3>Conditions financières</h3>
                  <div class="info-row">
                    <span class="label">Délai de règlement</span>
                    <span class="value">
                      @if (client()!.defaultPaymentTermDays != null) {
                        {{ client()!.defaultPaymentTermDays }} jours
                      } @else {
                        —
                      }
                    </span>
                  </div>
                  <div class="info-row">
                    <span class="label">Plafond d'encours</span>
                    <span class="value">
                      @if (outstanding()?.creditLimit != null) {
                        {{ formatCurrency(outstanding()!.creditLimit!) }}
                      } @else {
                        Aucun
                      }
                    </span>
                  </div>
                  <div class="info-row">
                    <span class="label"></span>
                    <a class="value link" [routerLink]="['edit']">Modifier le plafond</a>
                  </div>
                </div>

                <div class="info-section full-width">
                  <h3>Adresse</h3>
                  <div class="address-block">
                    <p>{{ client()!.address.street }}</p>
                    @if (client()!.address.streetLine2) {
                      <p>{{ client()!.address.streetLine2 }}</p>
                    }
                    <p>
                      @if (client()!.address.postalCode) {
                        {{ client()!.address.postalCode }} 
                      }
                      {{ client()!.address.city }}
                    </p>
                    <p>{{ client()!.address.governorate }}, {{ client()!.address.country }}</p>
                  </div>
                </div>

                @if (client()!.notes) {
                  <div class="info-section full-width">
                    <h3>Notes</h3>
                    <p class="notes">{{ client()!.notes }}</p>
                  </div>
                }
              </div>
            </p-tabpanel>

            <!-- Quotes Tab -->
            <p-tabpanel [value]="1">
              <div class="invoices-section">
                <div class="section-header">
                  <h3>Historique des devis</h3>
                  <app-button 
                    variant="primary"
                    size="sm"
                    icon="pi-plus"
                    iconPos="left"
                    [routerLink]="['/quotes/new']"
                    [queryParams]="{clientId: client()!.id}">
                    Nouveau devis
                  </app-button>
                </div>

                @if (loadingQuotes()) {
                  <app-skeleton-table [rows]="5" [columns]="skeletonColumns"></app-skeleton-table>
                } @else {
                  <p-table 
          [loading]="loading()" [value]="quotes()" [rows]="10" styleClass="p-datatable-sm">
                    <ng-template pTemplate="header">
                      <tr>
                        <th>Numéro</th>
                        <th>Date</th>
                        <th>Montant</th>
                        <th>Statut</th>
                        <th style="width: 80px">Actions</th>
                      </tr>
                    </ng-template>
                    <ng-template pTemplate="body" let-quote>
                      <tr>
                        <td>
                          <a [routerLink]="['/quotes', quote.id]" class="invoice-number">{{ quote.number }}</a>
                        </td>
                        <td>{{ quote.issueDate | date:'dd/MM/yyyy' }}</td>
                        <td class="amount">{{ quote.totalAmount | number:'1.3-3' }} {{ quote.currency }}</td>
                        <td>
                          <span class="status-badge" [class]="quote.statusCssClass">{{ quote.status }}</span>
                        </td>
                        <td>
                          <app-button variant="ghost" size="sm" icon="pi-eye" [iconOnly]="true"
                            pTooltip="Voir" [routerLink]="['/quotes', quote.id]" ariaLabel="Voir le devis">
                          </app-button>
                        </td>
                      </tr>
                    </ng-template>
                    <ng-template pTemplate="emptymessage">
                      <tr>
                        <td colspan="5" class="text-center p-6">
                          <app-empty-state
                            icon="pi-file-edit"
                            iconSize="2rem"
                            title="Aucun devis"
                            description="Créez un devis pour ce client."
                            actionLabel="Créer un devis"
                            (actionClick)="createQuoteForClient()">
                          </app-empty-state>
                        </td>
                      </tr>
                    </ng-template>
                  </p-table>
                }
              </div>
            </p-tabpanel>

            <!-- Invoices Tab -->
            <p-tabpanel [value]="2">
              <div class="invoices-section">
                <div class="section-header">
                  <h3>Historique des factures</h3>
                  <app-button 
                    variant="primary"
                    size="sm"
                    icon="pi-plus"
                    iconPos="left"
                    [routerLink]="['/invoices/new']"
                    [queryParams]="{clientId: client()!.id}">
                    Nouvelle facture
                  </app-button>
                </div>

                @if (loadingInvoices()) {
                  <app-skeleton-table 
                    [rows]="5" 
                    [columns]="skeletonColumns">
                  </app-skeleton-table>
                } @else {
                  <p-table 
          [loading]="loading()" 
                    [value]="invoices()" 
                    [rows]="10"
                    styleClass="p-datatable-sm">
                  
                  <ng-template pTemplate="header">
                    <tr>
                      <th>Numéro</th>
                      <th>Date</th>
                      <th>Montant</th>
                      <th>Statut</th>
                      <th style="width: 80px">Actions</th>
                    </tr>
                  </ng-template>

                  <ng-template pTemplate="body" let-invoice>
                    <tr>
                      <td>
                        <a [routerLink]="['/invoices', invoice.id]" class="invoice-number">
                          {{ invoice.number }}
                        </a>
                      </td>
                      <td>{{ invoice.issueDate | date:'dd/MM/yyyy' }}</td>
                      <td class="amount">{{ invoice.totalAmount | number:'1.3-3' }} {{ invoice.currency }}</td>
                      <td>
                        <span class="status-badge" [class]="invoice.statusCssClass">
                          {{ invoice.status }}
                        </span>
                      </td>
                      <td>
                        <app-button 
                          variant="ghost"
                          size="sm"
                          icon="pi-eye"
                          [iconOnly]="true"
                          pTooltip="Voir"
                          [routerLink]="['/invoices', invoice.id]"
                          ariaLabel="Voir la facture">
                        </app-button>
                      </td>
                    </tr>
                  </ng-template>

                  <ng-template pTemplate="emptymessage">
                    <tr>
                      <td colspan="5" class="text-center p-6">
                        <app-empty-state
                          icon="pi-file"
                          iconSize="2rem"
                          title="Aucune facture"
                          description="Créez une facture pour ce client."
                          actionLabel="Créer une facture"
                          (actionClick)="createInvoiceForClient()">
                        </app-empty-state>
                      </td>
                    </tr>
                  </ng-template>
                  </p-table>
                }
              </div>
            </p-tabpanel>
            @if (canManagePortal() && client()) {
              <p-tabpanel [value]="3">
                <app-client-portal-contacts-panel [clientId]="client()!.id" />
              </p-tabpanel>
            }
            </p-tabpanels>
          </p-tabs>
        </div>

        <!-- Sidebar -->
        <div class="sidebar">
          <p-card header="Statut" styleClass="status-card">
            <div class="status-content">
              <app-status-badge 
                [status]="client()!.isActive ? 'active' : 'inactive'"
                [label]="client()!.isActive ? 'Actif' : 'Inactif'"
                style="margin-bottom: var(--spacing-3);">
              </app-status-badge>
              <app-button 
                variant="outline"
                size="sm"
                [icon]="client()!.isActive ? 'pi-ban' : 'pi-check'"
                iconPos="left"
                (click)="toggleActive()">
                {{ client()!.isActive ? 'Désactiver le client' : 'Réactiver le client' }}
              </app-button>
            </div>
          </p-card>

          <p-card header="Historique" styleClass="history-card">
            <div class="history-content">
              <div class="history-item">
                <span class="label">Créé le</span>
                <span class="value">{{ client()!.createdAt | date:'dd/MM/yyyy HH:mm' }}</span>
              </div>
              <div class="history-item">
                <span class="label">Modifié le</span>
                <span class="value">{{ client()!.updatedAt | date:'dd/MM/yyyy HH:mm' }}</span>
              </div>
              @if (stats()?.lastInvoiceDate) {
                <div class="history-item">
                  <span class="label">Dernière facture</span>
                  <span class="value">{{ stats()!.lastInvoiceDate | date:'dd/MM/yyyy' }}</span>
                </div>
              }
            </div>
          </p-card>

          <p-card header="Actions rapides" styleClass="actions-card">
            <div class="quick-actions">
              <app-button 
                variant="outline"
                icon="pi-file-edit"
                iconPos="left"
                routerLink="/quotes/new"
                [queryParams]="{clientId: client()!.id}"
                style="width: 100%; margin-bottom: var(--spacing-2);">
                Nouveau devis
              </app-button>
              <app-button 
                variant="outline"
                icon="pi-file"
                iconPos="left"
                routerLink="/invoices/new"
                [queryParams]="{clientId: client()!.id}"
                style="width: 100%; margin-bottom: var(--spacing-2);">
                Nouvelle facture
              </app-button>
              <app-button 
                variant="outline"
                icon="pi-envelope"
                iconPos="left"
                (click)="sendEmail()"
                style="width: 100%;">
                Envoyer un email
              </app-button>
            </div>
          </p-card>
        </div>
      </div>
    } @else {
      <div class="not-found">
        <i class="pi pi-exclamation-triangle"></i>
        <h2>Client non trouvé</h2>
        <p>Le client demandé n'existe pas ou a été supprimé.</p>
        <app-button variant="primary" routerLink="/clients">Retour à la liste</app-button>
      </div>
    }

  `,
  styles: [`
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--spacing-4);
      margin-bottom: var(--spacing-6);

      @media (max-width: 1200px) {
        grid-template-columns: repeat(2, 1fr);
      }

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .detail-grid {
      display: grid;
      grid-template-columns: 1fr 320px;
      gap: var(--spacing-6);

      @media (max-width: 1024px) {
        grid-template-columns: 1fr;
      }
    }

    .main-content {
      min-width: 0;
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-4);
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-6);

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .info-section {
      &.full-width {
        grid-column: 1 / -1;
      }

      h3 {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-500);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin: 0 0 var(--spacing-3);
      }
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-2) 0;
      border-bottom: 1px solid var(--color-neutral-100);

      &:last-child {
        border-bottom: none;
      }

      .label {
        color: var(--color-neutral-600);
        font-size: var(--font-size-sm);
      }

      .value {
        font-weight: var(--font-weight-medium);
        color: var(--color-neutral-900);

        &.link {
          color: var(--color-primary-600);
        }

        &.mono {
          font-family: 'JetBrains Mono', monospace;
        }
      }
    }

    .address-block {
      background: var(--color-neutral-50);
      border-radius: var(--radius-lg);
      padding: var(--spacing-4);

      p {
        margin: 0 0 var(--spacing-1);
        color: var(--color-neutral-700);

        &:last-child {
          margin-bottom: 0;
        }
      }
    }

    .notes {
      color: var(--color-neutral-700);
      line-height: 1.6;
      white-space: pre-wrap;
    }

    .invoices-section {
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--spacing-4);

        h3 {
          margin: 0;
          font-size: var(--font-size-lg);
          color: var(--color-neutral-800);
        }
      }
    }

    .invoice-number {
      font-family: 'JetBrains Mono', monospace;
      font-weight: var(--font-weight-semibold);
      color: var(--color-primary-600);
    }

    .amount {
      font-family: 'JetBrains Mono', monospace;
      font-weight: var(--font-weight-medium);
    }


    .status-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-3);
    }

    .history-content {
      .history-item {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-1);
        padding: var(--spacing-2) 0;
        border-bottom: 1px solid var(--color-neutral-100);

        &:last-child {
          border-bottom: none;
        }

        .label {
          font-size: var(--font-size-xs);
          color: var(--color-neutral-500);
          text-transform: uppercase;
        }

        .value {
          font-weight: var(--font-weight-medium);
          color: var(--color-neutral-800);
        }
      }
    }

    .quick-actions {
      display: flex;
      flex-direction: column;
    }

    .not-found {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--spacing-12);
      text-align: center;

      i {
        font-size: 4rem;
        color: var(--color-warning-500);
        margin-bottom: var(--spacing-4);
      }

      h2 {
        color: var(--color-neutral-800);
        margin: 0 0 var(--spacing-2);
      }

      p {
        color: var(--color-neutral-600);
        margin: 0 0 var(--spacing-4);
      }
    }

    :host ::ng-deep {
      .status-card,
      .history-card,
      .actions-card {
        .p-card-header {
          padding: var(--spacing-3) var(--spacing-4);
          border-bottom: 1px solid var(--color-neutral-200);
          font-size: var(--font-size-sm);
          font-weight: var(--font-weight-semibold);
          color: var(--color-neutral-700);
        }

        .p-card-body {
          padding: var(--spacing-4);
        }
      }
    }
  `]
})
export class ClientDetailComponent implements OnInit {
  readonly outstanding = signal<ClientOutstanding | null>(null);
  readonly loadingOutstanding = signal(true);

  private clientService = inject(ClientService);
  private invoiceService = inject(InvoiceService);
  private quoteService = inject(QuoteService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmationService = inject(ConfirmationService);
  private toastService = inject(ToastService);
  private errorHandler = inject(ErrorHandlerService);
  private auth = inject(AuthService);

  readonly canManagePortal = computed(() => this.auth.hasPermission(PERMISSIONS.clients.update));

  loading = signal(true);
  initialLoad = signal(true);
  loadingInvoices = signal(true);
  loadingQuotes = signal(true);
  client = signal<Client | null>(null);
  stats = signal<ClientStats | null>(null);
  invoices = signal<InvoiceListItem[]>([]);
  quotes = signal<QuoteListItem[]>([]);

  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const cli = this.client();
    return [
      { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
      { label: 'Clients', route: '/clients' },
      { label: cli?.name || 'Client' }
    ];
  });

  skeletonColumns: SkeletonColumn[] = [
    { width: '150px' },
    { width: '100px' },
    { width: '120px' },
    { width: '100px' },
    { width: '80px' }
  ];

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadClient(id);
      this.loadStats(id);
      this.loadOutstanding(id);
      this.loadInvoices(id);
      this.loadQuotes(id);
    } else {
      this.router.navigate(['/clients']);
    }
  }

  private loadClient(id: string): void {
    this.loading.set(true);
    
    this.clientService.getClient(id, { skipGlobalErrorUi: true }).subscribe({
      next: (response) => {
        if (response.success) {
          this.client.set(response.data);
        } else {
          this.client.set(null);
        }
        this.loading.set(false);
        this.initialLoad.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.initialLoad.set(false);
        this.client.set(null);
      }
    });
  }

  /**
   * L'encours est un confort d'affichage : son echec ne doit pas empecher de consulter la
   * fiche client. On le laisse simplement vide.
   */
  private loadOutstanding(id: string): void {
    this.loadingOutstanding.set(true);
    this.clientService.getClientOutstanding(id).subscribe({
      next: response => {
        this.outstanding.set(response.success ? response.data : null);
        this.loadingOutstanding.set(false);
      },
      error: () => {
        this.outstanding.set(null);
        this.loadingOutstanding.set(false);
      }
    });
  }

  private loadStats(id: string): void {
    this.clientService.getClientStats(id, { skipGlobalErrorUi: true }).subscribe({
      next: (response) => {
        if (response.success) {
          this.stats.set(response.data);
        }
      },
      error: () => {
        this.stats.set(null);
      }
    });
  }

  private loadInvoices(id: string): void {
    this.loadingInvoices.set(true);

    const params: InvoiceSearchParams = {
      clientId: id,
      pageSize: 10,
      skipGlobalErrorUi: true
    };

    this.invoiceService.getInvoices(params).subscribe({
      next: (response) => {
        if (response.success) {
          this.invoices.set(response.data.items);
        }
        this.loadingInvoices.set(false);
      },
      error: () => {
        this.loadingInvoices.set(false);
      }
    });
  }

  private loadQuotes(id: string): void {
    this.loadingQuotes.set(true);
    this.quoteService.getQuotes({ clientId: id, pageSize: 10, skipGlobalErrorUi: true }).subscribe({
      next: (response) => {
        if (response.success) {
          this.quotes.set(response.data.items);
        }
        this.loadingQuotes.set(false);
      },
      error: () => {
        this.loadingQuotes.set(false);
      }
    });
  }

  getTypeSeverity(type: ClientType): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (type) {
      case ClientType.Individual:
        return 'info';
      case ClientType.Business:
        return 'success';
      case ClientType.Government:
        return 'warn';
      case ClientType.Association:
        return 'secondary';
      default:
        return 'info';
    }
  }

  getClientTypeStatus(type: ClientType): 'draft' | 'validated' | 'pending' {
    // Map client types to available status badge statuses
    // Using generic statuses since StatusBadgeComponent doesn't have specific client type statuses
    switch (type) {
      case ClientType.Business:
        return 'validated';
      case ClientType.Individual:
      case ClientType.Government:
      case ClientType.Association:
      default:
        return 'pending';
    }
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('fr-TN', {
      style: 'decimal',
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }).format(amount) + ' TND';
  }

  toggleActive(): void {
    const client = this.client();
    if (!client) return;

    this.clientService.toggleActive(client.id).subscribe({
      next: (response) => {
        if (response.success) {
          this.client.set(response.data);
          this.toastService.add({
            severity: 'success',
            summary: 'Succès',
            detail: response.data.isActive ? 'Client activé' : 'Client désactivé'
          });
        }
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de modifier le statut'
        });
      }
    });
  }

  confirmDelete(): void {
    const client = this.client();
    if (!client) return;

    this.confirmationService.confirm({
      message: `Êtes-vous sûr de vouloir supprimer le client "${client.name}" ? Cette action est irréversible.`,
      header: 'Confirmation de suppression',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.deleteClient();
      }
    });
  }

  private deleteClient(): void {
    const client = this.client();
    if (!client) return;

    this.clientService.deleteClient(client.id).subscribe({
      next: (response) => {
        if (response.success) {
          this.toastService.add({
            severity: 'success',
            summary: 'Succès',
            detail: 'Client supprimé avec succès'
          });
          this.router.navigate(['/clients']);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: response.errors[0] || 'Impossible de supprimer le client'
          });
        }
      },
      error: (error) => {
        const errorMessage = this.errorHandler.extractErrorMessage(error);
        this.errorHandler.logError('Failed to delete client', error);
        this.confirmationService.alert({
          message: errorMessage || 'Impossible de supprimer le client',
          header: 'Impossible de supprimer',
          icon: 'pi pi-exclamation-triangle'
        });
      }
    });
  }

  sendEmail(): void {
    const client = this.client();
    if (client) {
      window.location.href = `mailto:${client.email}`;
    }
  }

  createInvoiceForClient = (): void => {
    const client = this.client();
    if (client) {
      this.router.navigate(['/invoices/new'], { queryParams: { clientId: client.id } });
    }
  };

  createQuoteForClient = (): void => {
    const client = this.client();
    if (client) {
      this.router.navigate(['/quotes/new'], { queryParams: { clientId: client.id } });
    }
  };
}
