/// <reference types="@angular/localize" />
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
        routerLink="/clients" i18n="@@clients.client-detail.retour.e5befb1f"> Retour </app-button>
      @if (client()) {
        <app-button 
          variant="primary"
          icon="pi-pencil"
          iconPos="left"
          [routerLink]="['edit']" i18n="@@clients.client-detail.modifier.f260e757"> Modifier </app-button>
        <app-button 
          variant="outline"
          icon="pi-trash"
          iconPos="left"
          (click)="confirmDelete()" i18n="@@clients.client-detail.supprimer.1acfc1c7"> Supprimer </app-button>
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
          label="Total factures" i18n-label="@@clients.client-detail.total.factures.4ef351ea"
          [value]="stats()?.totalInvoices || 0"
          icon="pi-file"
          variant="primary">
        </app-stat-card>
        <app-stat-card
          label="Factures payées" i18n-label="@@clients.client-detail.factures.payees.587e5689"
          [value]="stats()?.paidInvoices || 0"
          icon="pi-check-circle"
          variant="success">
        </app-stat-card>
        <app-stat-card
          label="En attente" i18n-label="@@clients.client-detail.en.attente.5231158f"
          [value]="stats()?.pendingInvoices || 0"
          icon="pi-clock"
          variant="warning">
        </app-stat-card>
        <app-stat-card
          label="Chiffre d'affaires" i18n-label="@@clients.client-detail.chiffre.d.affaires.0a341b9f"
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
              <p-tab [value]="0"><i class="pi pi-info-circle"></i><span i18n="@@clients.client-detail.informations.54937b3a">Informations</span></p-tab>
              <p-tab [value]="1"><i class="pi pi-file"></i><span i18n="@@clients.client-detail.devis.f7622f90">Devis</span></p-tab>
              <p-tab [value]="2"><i class="pi pi-receipt"></i><span i18n="@@clients.client-detail.factures.da35e4f2">Factures</span></p-tab>
              @if (canManagePortal()) {
                <p-tab [value]="3"><i class="pi pi-users"></i><span i18n="@@clients.client-detail.espace.client.997229dc">Espace client</span></p-tab>
              }
            </p-tablist>
            <p-tabpanels>
            <!-- Informations Tab -->
            <p-tabpanel [value]="0">
              <div class="info-grid">
                <div class="info-section">
                  <h3 i18n="@@clients.client-detail.coordonnees.7c309d77">Coordonnées</h3>
                  <div class="info-row">
                    <span class="label" i18n="@@clients.client-detail.email.84add5b2">Email</span>
                    @if (client()!.email) {
                      <a [href]="'mailto:' + client()!.email" class="value link">{{ client()!.email }}</a>
                    } @else {
                      <span class="value" i18n="@@clients.client-detail.text.1b93795b">—</span>
                    }
                  </div>
                  <div class="info-row">
                    <span class="label" i18n="@@clients.client-detail.telephone.d3b023ea">Téléphone</span>
                    <a [href]="'tel:' + client()!.phone" class="value link">{{ client()!.phone }}</a>
                  </div>
                </div>

                <div class="info-section">
                  <h3 i18n="@@clients.client-detail.informations.fiscales.b0156b88">Informations fiscales</h3>
                  <div class="info-row">
                    <span class="label" i18n="@@clients.client-detail.type.3deb7456">Type</span>
                    <app-status-badge 
                      [status]="getClientTypeStatus(client()!.type)"
                      [label]="client()!.typeDisplay">
                    </app-status-badge>
                  </div>
                  <div class="info-row">
                    <span class="label" i18n="@@clients.client-detail.matricule.fiscal.304096c4">Matricule fiscal</span>
                    <span class="value mono">{{ client()!.nif || 'Non renseigné' }}</span>
                  </div>
                </div>

                <div class="info-section">
                  <h3 i18n="@@clients.client-detail.conditions.financieres.ae9a6ff2">Conditions financières</h3>
                  <div class="info-row">
                    <span class="label" i18n="@@clients.client-detail.delai.de.reglement.052e3d66">Délai de règlement</span>
                    <span class="value">
                      @if (client()!.defaultPaymentTermDays != null) {<ng-container i18n="@@clients.client-detail.jours.9970d523">
                        {{ client()!.defaultPaymentTermDays }} jours
                      </ng-container>} @else {
                        —
                      }
                    </span>
                  </div>
                  <div class="info-row">
                    <span class="label" i18n="@@clients.client-detail.plafond.d.encours.d6965e27">Plafond d'encours</span>
                    <span class="value">
                      @if (outstanding()?.creditLimit != null) {
                        {{ formatCurrency(outstanding()!.creditLimit!) }}
                      } @else {<ng-container i18n="@@clients.client-detail.aucun.b2ed82f1">
                        Aucun
                      </ng-container>}
                    </span>
                  </div>
                  <div class="info-row">
                    <span class="label"></span>
                    <a class="value link" [routerLink]="['edit']" i18n="@@clients.client-detail.modifier.le.plafond.b4fd857f">Modifier le plafond</a>
                  </div>
                </div>

                <div class="info-section full-width">
                  <h3 i18n="@@clients.client-detail.adresse.522e1466">Adresse</h3>
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
                    <h3 i18n="@@clients.client-detail.notes.70440046">Notes</h3>
                    <p class="notes">{{ client()!.notes }}</p>
                  </div>
                }
              </div>
            </p-tabpanel>

            <!-- Quotes Tab -->
            <p-tabpanel [value]="1">
              <div class="invoices-section">
                <div class="section-header">
                  <h3 i18n="@@clients.client-detail.historique.des.devis.0d541e89">Historique des devis</h3>
                  <app-button 
                    variant="primary"
                    size="sm"
                    icon="pi-plus"
                    iconPos="left"
                    [routerLink]="['/quotes/new']"
                    [queryParams]="{clientId: client()!.id}" i18n="@@clients.client-detail.nouveau.devis.4c3f0159"> Nouveau devis </app-button>
                </div>

                @if (loadingQuotes()) {
                  <app-skeleton-table [rows]="5" [columns]="skeletonColumns"></app-skeleton-table>
                } @else {
                  <p-table 
          [loading]="loading()" [value]="quotes()" [rows]="10" styleClass="p-datatable-sm">
                    <ng-template pTemplate="header">
                      <tr>
                        <th i18n="@@clients.client-detail.numero.15e73db0">Numéro</th>
                        <th i18n="@@clients.client-detail.date.eb9a4bc1">Date</th>
                        <th i18n="@@clients.client-detail.montant.4adcd9fc">Montant</th>
                        <th i18n="@@clients.client-detail.statut.659499f3">Statut</th>
                        <th style="width: 80px" i18n="@@clients.client-detail.actions.c3cd636a">Actions</th>
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
                            pTooltip="Voir" i18n-pTooltip="@@clients.client-detail.voir.8a754f1f" [routerLink]="['/quotes', quote.id]" ariaLabel="Voir le devis" i18n-ariaLabel="@@clients.client-detail.voir.le.devis.50894eed">
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
                            title="Aucun devis" i18n-title="@@clients.client-detail.aucun.devis.a42220c2"
                            description="Créez un devis pour ce client." i18n-description="@@clients.client-detail.creez.un.devis.pour.ce.client.029c1a1c"
                            actionLabel="Créer un devis" i18n-actionLabel="@@clients.client-detail.creer.un.devis.3a56a7d7"
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
                  <h3 i18n="@@clients.client-detail.historique.des.factures.6bab16bc">Historique des factures</h3>
                  <app-button 
                    variant="primary"
                    size="sm"
                    icon="pi-plus"
                    iconPos="left"
                    [routerLink]="['/invoices/new']"
                    [queryParams]="{clientId: client()!.id}" i18n="@@clients.client-detail.nouvelle.facture.cdf7e09c"> Nouvelle facture </app-button>
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
                      <th i18n="@@clients.client-detail.numero.15e73db0">Numéro</th>
                      <th i18n="@@clients.client-detail.date.eb9a4bc1">Date</th>
                      <th i18n="@@clients.client-detail.montant.4adcd9fc">Montant</th>
                      <th i18n="@@clients.client-detail.statut.659499f3">Statut</th>
                      <th style="width: 80px" i18n="@@clients.client-detail.actions.c3cd636a">Actions</th>
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
                          pTooltip="Voir" i18n-pTooltip="@@clients.client-detail.voir.8a754f1f"
                          [routerLink]="['/invoices', invoice.id]"
                          ariaLabel="Voir la facture" i18n-ariaLabel="@@clients.client-detail.voir.la.facture.23283cea">
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
                          title="Aucune facture" i18n-title="@@clients.client-detail.aucune.facture.72124217"
                          description="Créez une facture pour ce client." i18n-description="@@clients.client-detail.creez.une.facture.pour.ce.client.91a6001c"
                          actionLabel="Créer une facture" i18n-actionLabel="@@clients.client-detail.creer.une.facture.a3863c70"
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
          <p-card header="Statut" i18n-header="@@clients.client-detail.statut.659499f3" styleClass="status-card">
            <div class="status-content">
              <app-status-badge 
                [status]="client()!.isActive ? 'active' : 'inactive'"
                [label]="client()!.isActive ? loc_ui_tern_actif_2eb75f : loc_ui_tern_inactif_d2e033"
                style="margin-bottom: var(--spacing-3);">
              </app-status-badge>
              <app-button 
                variant="outline"
                size="sm"
                [icon]="client()!.isActive ? 'pi-ban' : 'pi-check'"
                iconPos="left"
                (click)="toggleActive()">
                {{ client()!.isActive ? loc_ui_tern_desactiver_le_client_a9b066 : loc_ui_tern_reactiver_le_client_e892c4 }}
              </app-button>
            </div>
          </p-card>

          <p-card header="Historique" i18n-header="@@clients.client-detail.historique.34f3a06a" styleClass="history-card">
            <div class="history-content">
              <div class="history-item">
                <span class="label" i18n="@@clients.client-detail.cree.le.046c02a0">Créé le</span>
                <span class="value">{{ client()!.createdAt | date:'dd/MM/yyyy HH:mm' }}</span>
              </div>
              <div class="history-item">
                <span class="label" i18n="@@clients.client-detail.modifie.le.8b181c38">Modifié le</span>
                <span class="value">{{ client()!.updatedAt | date:'dd/MM/yyyy HH:mm' }}</span>
              </div>
              @if (stats()?.lastInvoiceDate) {
                <div class="history-item">
                  <span class="label" i18n="@@clients.client-detail.derniere.facture.ab799db2">Dernière facture</span>
                  <span class="value">{{ stats()!.lastInvoiceDate | date:'dd/MM/yyyy' }}</span>
                </div>
              }
            </div>
          </p-card>

          <p-card header="Actions rapides" i18n-header="@@clients.client-detail.actions.rapides.abe69a9c" styleClass="actions-card">
            <div class="quick-actions">
              <app-button 
                variant="outline"
                icon="pi-file-edit"
                iconPos="left"
                routerLink="/quotes/new"
                [queryParams]="{clientId: client()!.id}"
                style="width: 100%; margin-bottom: var(--spacing-2);" i18n="@@clients.client-detail.nouveau.devis.4c3f0159"> Nouveau devis </app-button>
              <app-button 
                variant="outline"
                icon="pi-file"
                iconPos="left"
                routerLink="/invoices/new"
                [queryParams]="{clientId: client()!.id}"
                style="width: 100%; margin-bottom: var(--spacing-2);" i18n="@@clients.client-detail.nouvelle.facture.cdf7e09c"> Nouvelle facture </app-button>
              <app-button 
                variant="outline"
                icon="pi-envelope"
                iconPos="left"
                (click)="sendEmail()"
                style="width: 100%;" i18n="@@clients.client-detail.envoyer.un.email.48feacc4"> Envoyer un email </app-button>
            </div>
          </p-card>
        </div>
      </div>
    } @else {
      <div class="not-found">
        <i class="pi pi-exclamation-triangle"></i>
        <h2 i18n="@@clients.client-detail.client.non.trouve.1323765f">Client non trouvé</h2>
        <p i18n="@@clients.client-detail.le.client.demande.n.existe.pas.ou.a.ete.supprime.b283788b">Le client demandé n'existe pas ou a été supprimé.</p>
        <app-button variant="primary" routerLink="/clients" i18n="@@clients.client-detail.retour.a.la.liste.7753f531">Retour à la liste</app-button>
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
  readonly loc_ui_tern_actif_2eb75f = $localize`:@@ui.tern.actif.2eb75f:Actif`;
  readonly loc_ui_tern_inactif_d2e033 = $localize`:@@ui.tern.inactif.d2e033:Inactif`;
  readonly loc_ui_tern_desactiver_le_client_a9b066 = $localize`:@@ui.tern.desactiver.le.client.a9b066:Désactiver le client`;
  readonly loc_ui_tern_reactiver_le_client_e892c4 = $localize`:@@ui.tern.reactiver.le.client.e892c4:Réactiver le client`;
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
      { label: $localize`:@@clients.client-detail.ts.tableau.de.bord.a524057f:Tableau de bord`, route: '/dashboard', icon: 'pi-home' },
      { label: $localize`:@@clients.client-detail.ts.clients.28e22fe3:Clients`, route: '/clients' },
      { label: cli?.name || $localize`:@@clients.client-detail.ts.client.1bdd79b1:Client` }
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
    }).format(amount) + $localize`:@@ui.tern.tnd.9aaf5c: TND`;
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
            summary: $localize`:@@client-detail.component.summary.Succès:Succès`,
            detail: response.data.isActive ? $localize`:@@ui.tern.client.active.4c2918:Client activé` : $localize`:@@ui.tern.client.desactive.f0b4ab:Client désactivé`
          });
        }
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: $localize`:@@client-detail.component.summary.Erreur:Erreur`,
          detail: $localize`:@@client-detail.component.detail.Impossible d:Impossible de modifier le statut`
        });
      }
    });
  }

  confirmDelete(): void {
    const client = this.client();
    if (!client) return;

    this.confirmationService.confirm({
      message: $localize`:@@clients.client-detail.ts.etes.vous.sur.de.vouloir.supprimer.le.cl.df704d5e:Êtes-vous sûr de vouloir supprimer le client "${client.name}:name:" ? Cette action est irréversible.`,
      header: $localize`:@@clients.client-detail.ts.confirmation.de.suppression.6a082d0b:Confirmation de suppression`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: $localize`:@@client-detail.component.acceptLabel.Supprimer:Supprimer`,
      rejectLabel: $localize`:@@client-detail.component.rejectLabel.Annuler:Annuler`,
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
            summary: $localize`:@@client-detail.component.summary.Succès:Succès`,
            detail: $localize`:@@client-detail.component.detail.Client_supprim_:Client supprimé avec succès`
          });
          this.router.navigate(['/clients']);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: $localize`:@@client-detail.component.summary.Erreur:Erreur`,
            detail: response.errors[0] || $localize`:@@clients.client-detail.ts.impossible.de.supprimer.le.client.bd4e32c4:Impossible de supprimer le client`
          });
        }
      },
      error: (error) => {
        const errorMessage = this.errorHandler.extractErrorMessage(error);
        this.errorHandler.logError('Failed to delete client', error);
        this.confirmationService.alert({
          message: errorMessage || $localize`:@@clients.client-detail.ts.impossible.de.supprimer.le.client.bd4e32c4:Impossible de supprimer le client`,
          header: $localize`:@@clients.client-detail.ts.impossible.de.supprimer.0300380e:Impossible de supprimer`,
          icon: 'pi pi-exclamation-triangle'
        });
      }
    });
  }

  sendEmail(): void {
    const client = this.client();
    if (client?.email) {
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
