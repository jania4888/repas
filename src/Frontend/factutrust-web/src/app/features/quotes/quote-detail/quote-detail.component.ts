import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { TimelineModule } from 'primeng/timeline';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { Textarea } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService } from '@core/services/confirmation.service';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { StatusBadgeComponent, StatusBadgeStatus } from '@shared/components/status-badge/status-badge.component';
import {
  QuoteService,
  QuoteDetail,
} from '@core/services/quote.service';
import { RecurringContractService } from '@core/services/recurring-contract.service';

interface TimelineEvent {
  status: string;
  date: string | null;
  icon: string;
  color: string;
}

@Component({
  selector: 'app-quote-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ButtonModule,
    CardModule,
    TagModule,
    DividerModule,
    TableModule,
    TooltipModule,
    SkeletonModule,
    TimelineModule,
    ConfirmDialogModule,
    DialogModule,
    Textarea,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    ButtonComponent,
    StatusBadgeComponent,
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems()"></app-breadcrumb>

    <app-page-header
      [title]="quote()?.number ?? 'Chargement...'"
      [subtitle]="'Devis du ' + (quote()?.issueDate | date:'dd/MM/yyyy')">
      <app-button
        variant="outline"
        icon="pi-arrow-left"
        iconPos="left"
        routerLink="/quotes">
        Retour aux devis
      </app-button>
      @if (quote()) {
        <app-button
          variant="outline"
          icon="pi-download"
          iconPos="left"
          (click)="downloadPdf()">
          Télécharger PDF
        </app-button>
        @if (canConvert()) {
          <app-button
            variant="primary"
            icon="pi-file-export"
            iconPos="left"
            (click)="confirmConvertToInvoice()">
            Créer la facture finale
          </app-button>
        }
        @if (canConvertToOrder()) {
          <app-button
            variant="primary"
            icon="pi-shopping-cart"
            iconPos="left"
            (click)="confirmConvertToSalesOrder()">
            Transformer en commande
          </app-button>
        }
        @if (canConvertToRecurringContract()) {
          <app-button
            variant="outline"
            icon="pi-refresh"
            iconPos="left"
            (click)="confirmConvertToRecurringContract()">
            Créer un contrat récurrent
          </app-button>
        }
      }
    </app-page-header>

    @if (loading()) {
      <div class="detail-grid">
        <div class="main-content">
          <p-card>
            <p-skeleton height="2rem" styleClass="mb-4"></p-skeleton>
            <p-skeleton height="1rem" styleClass="mb-2" width="60%"></p-skeleton>
            <p-skeleton height="10rem"></p-skeleton>
          </p-card>
        </div>
        <div class="sidebar">
          <p-skeleton height="12rem" styleClass="mb-4"></p-skeleton>
        </div>
      </div>
    } @else if (quote()) {
      <div class="detail-grid">
        <div class="main-content">
          <p-card styleClass="quote-card">
            <div class="quote-header">
              <div class="quote-meta">
                <h2>{{ quote()!.number }}</h2>
                <app-status-badge
                  [status]="getStatusBadgeStatus(quote()!.status)"
                  [label]="quote()!.statusDisplay">
                </app-status-badge>
              </div>
              <div class="quote-dates">
                <div class="date-item">
                  <span class="label">Date d'émission</span>
                  <span class="value">{{ quote()!.issueDate | date:'dd/MM/yyyy' }}</span>
                </div>
                <div class="date-item">
                  <span class="label">Valide jusqu'au</span>
                  <span class="value" [class.expired]="isExpired()">
                    {{ quote()!.expiryDate | date:'dd/MM/yyyy' }}
                  </span>
                </div>
              </div>
            </div>

            <p-divider></p-divider>

            <div class="parties-grid">
              <div class="party-card">
                <h4>Client</h4>
                <p class="party-name">{{ quote()!.client.name }}</p>
                <p class="party-address">{{ quote()!.client.address }}</p>
                @if (quote()!.client.nif) {
                  <p class="party-nif">NIF: {{ quote()!.client.nif }}</p>
                }
                <p class="party-email">{{ quote()!.client.email }}</p>
              </div>
            </div>

            <p-divider></p-divider>

            <div class="lines-section">
              <h4>Lignes</h4>
              <table class="lines-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Désignation</th>
                    <th class="text-right">Quantité</th>
                    <th class="text-right">Prix unitaire</th>
                    <th class="text-center">TVA</th>
                    <th class="text-right">Total HT</th>
                  </tr>
                </thead>
                <tbody>
                  @for (line of quote()!.lines; track line.id) {
                    <tr>
                      <td>{{ line.lineNumber }}</td>
                      <td>
                        <span class="line-name">{{ line.productName }}</span>
                        @if (line.productDescription) {
                          <br /><small class="line-desc">{{ line.productDescription }}</small>
                        }
                      </td>
                      <td class="text-right">{{ line.quantity | number:'1.0-3' }} {{ line.unit ?? '' }}</td>
                      <td class="text-right mono">{{ line.unitPrice | number:'1.3-3' }}</td>
                      <td class="text-center">{{ line.vatRatePercent }}%</td>
                      <td class="text-right mono">{{ line.subTotal | number:'1.3-3' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <div class="totals-box">
              <div class="total-row">
                <span>Total HT</span>
                <span class="mono">{{ quote()!.subTotal | number:'1.3-3' }} {{ quote()!.currency }}</span>
              </div>
              @if (quote()!.fodecAmount) {
                <div class="total-row">
                  <span>FODEC</span>
                  <span class="mono">{{ quote()!.fodecAmount | number:'1.3-3' }} {{ quote()!.currency }}</span>
                </div>
              }
              <div class="total-row">
                <span>Total TVA</span>
                <span class="mono">{{ quote()!.totalVat | number:'1.3-3' }} {{ quote()!.currency }}</span>
              </div>
              @if (quote()!.fiscalStampAmount) {
                <div class="total-row">
                  <span>Timbre fiscal</span>
                  <span class="mono">{{ quote()!.fiscalStampAmount | number:'1.3-3' }} {{ quote()!.currency }}</span>
                </div>
              }
              <div class="total-row grand">
                <span>Total TTC</span>
                <span class="mono">{{ quote()!.totalAmount | number:'1.3-3' }} {{ quote()!.currency }}</span>
              </div>
            </div>

            @if (quote()!.notes || quote()!.termsAndConditions) {
              <p-divider></p-divider>
              <div class="notes-section">
                @if (quote()!.termsAndConditions) {
                  <div class="note">
                    <strong>Conditions générales:</strong> {{ quote()!.termsAndConditions }}
                  </div>
                }
                @if (quote()!.notes) {
                  <div class="note">
                    <strong>Notes:</strong> {{ quote()!.notes }}
                  </div>
                }
              </div>
            }
          </p-card>
        </div>

        <div class="sidebar">
          <p-card header="Statut" styleClass="status-card">
            <app-status-badge
              [status]="getStatusBadgeStatus(quote()!.status)"
              [label]="quote()!.statusDisplay"
              style="margin-bottom: var(--spacing-4);">
            </app-status-badge>
            @if (canSend()) {
              <app-button
                variant="primary"
                size="sm"
                icon="pi-send"
                iconPos="left"
                (click)="sendQuote()"
                style="width: 100%; margin-bottom: var(--spacing-3);">
                Envoyer au client
              </app-button>
            }
            @if (canAccept()) {
              <div class="status-actions">
                <app-button
                  variant="primary"
                  size="sm"
                  icon="pi-check"
                  iconPos="left"
                  (click)="acceptQuote()">
                  Accepter
                </app-button>
                <app-button
                  variant="outline"
                  size="sm"
                  icon="pi-times"
                  iconPos="left"
                  (click)="rejectQuote()">
                  Refuser
                </app-button>
              </div>
            }
          </p-card>

          <p-card header="Historique" styleClass="timeline-card">
            <p-timeline [value]="timeline" styleClass="custom-timeline">
              <ng-template pTemplate="content" let-event>
                <div class="timeline-event">
                  <span class="event-label">{{ event.status }}</span>
                  @if (event.date) {
                    <span class="event-date">{{ event.date | date:'dd/MM/yyyy HH:mm' }}</span>
                  }
                </div>
              </ng-template>
              <ng-template pTemplate="marker" let-event>
                <span class="timeline-marker" [style.background]="event.color">
                  <i [class]="event.icon"></i>
                </span>
              </ng-template>
            </p-timeline>
          </p-card>

          <p-card header="Actions" styleClass="actions-card">
            <div class="quick-actions">
              <app-button
                variant="outline"
                icon="pi-download"
                iconPos="left"
                (click)="downloadPdf()"
                style="width: 100%; margin-bottom: var(--spacing-2);">
                Télécharger PDF
              </app-button>
              <app-button
                variant="outline"
                icon="pi-copy"
                iconPos="left"
                (click)="duplicateQuote()"
                style="width: 100%; margin-bottom: var(--spacing-2);">
                Dupliquer
              </app-button>
              @if (convertedInvoiceId()) {
                <app-button
                  variant="outline"
                  icon="pi-file"
                  iconPos="left"
                  [routerLink]="['/invoices', convertedInvoiceId()!]"
                  style="width: 100%; margin-bottom: var(--spacing-2);">
                  Voir la facture
                </app-button>
              }
              @if (convertedSalesOrderId()) {
                <app-button
                  variant="outline"
                  icon="pi-shopping-cart"
                  iconPos="left"
                  [routerLink]="['/sales-orders', convertedSalesOrderId()!]"
                  style="width: 100%;">
                  Voir la commande
                </app-button>
              }
              @if (canCancel()) {
                <app-button
                  variant="outline"
                  icon="pi-times"
                  iconPos="left"
                  (click)="cancelQuote()"
                  style="width: 100%; margin-top: var(--spacing-2);">
                  Annuler le devis
                </app-button>
              }
            </div>
          </p-card>
        </div>
      </div>
    } @else {
      <div class="not-found">
        <i class="pi pi-exclamation-triangle"></i>
        <h2>Devis non trouvé</h2>
        <p>Le devis demandé n'existe pas ou a été supprimé.</p>
        <app-button variant="primary" routerLink="/quotes">Retour aux devis</app-button>
      </div>
    }

    <p-dialog
      header="Refuser ce devis"
      [(visible)]="rejectDialogVisible"
      [modal]="true"
      [style]="{ width: '420px' }"
      [draggable]="false"
      [resizable]="false"
      (onHide)="rejectReason = ''">
      <p class="dialog-message">Vous êtes sur le point de refuser ce devis. Un motif est optionnel mais recommandé pour l'historique.</p>
      <div class="dialog-field">
        <label for="reject-reason">Motif de refus (optionnel)</label>
        <textarea
          pTextarea
          id="reject-reason"
          [(ngModel)]="rejectReason"
          [rows]="3"
          placeholder="Ex. : budget insuffisant, délais inadaptés…"
          class="w-full">
        </textarea>
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="rejectDialogVisible = false">Annuler</app-button>
        <app-button variant="primary" icon="pi-times" iconPos="left" (click)="doReject()">Refuser le devis</app-button>
      </ng-template>
    </p-dialog>

    <p-dialog
      header="Annuler le devis"
      [(visible)]="cancelDialogVisible"
      [modal]="true"
      [style]="{ width: '420px' }"
      [draggable]="false"
      [resizable]="false"
      (onHide)="cancelReason = ''">
      <p class="dialog-message">L'annulation est définitive. Le motif est obligatoire pour la traçabilité.</p>
      <div class="dialog-field">
        <label for="cancel-reason">Motif d'annulation <span class="required">*</span></label>
        <textarea
          pTextarea
          id="cancel-reason"
          [(ngModel)]="cancelReason"
          [rows]="3"
          placeholder="Ex. : projet abandonné, commande annulée…"
          class="w-full">
        </textarea>
        @if (cancelError()) {
          <small class="field-error">{{ cancelError() }}</small>
        }
      </div>
      <ng-template pTemplate="footer">
        <app-button variant="outline" (click)="cancelDialogVisible = false">Retour</app-button>
        <app-button variant="primary" icon="pi-times" iconPos="left" (click)="doCancel()">Annuler le devis</app-button>
      </ng-template>
    </p-dialog>

  `,
  styles: [
    `
      .detail-grid {
        display: grid;
        grid-template-columns: 1fr 320px;
        gap: var(--spacing-6);
      }
      @media (max-width: 1024px) {
        .detail-grid {
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
      .quote-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: var(--spacing-4);
      }
      .quote-meta h2 {
        margin: 0 0 var(--spacing-2);
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-bold);
        color: var(--color-neutral-900);
      }
      .quote-dates {
        display: flex;
        gap: var(--spacing-6);
      }
      .date-item {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-1);
      }
      .date-item .label {
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        color: var(--color-neutral-500);
      }
      .date-item .value {
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-800);
      }
      .date-item .value.expired {
        color: var(--color-error-600);
      }
      .parties-grid {
        margin: var(--spacing-4) 0;
      }
      .party-card {
        padding: var(--spacing-4);
        background: var(--color-neutral-50);
        border-radius: var(--radius-lg);
      }
      .party-card h4 {
        margin: 0 0 var(--spacing-2);
        font-size: var(--font-size-xs);
        text-transform: uppercase;
        color: var(--color-neutral-500);
      }
      .party-name {
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-900);
        margin: 0 0 var(--spacing-2);
      }
      .party-address,
      .party-email,
      .party-nif {
        font-size: var(--font-size-sm);
        color: var(--color-neutral-600);
        margin: 0 0 var(--spacing-1);
      }
      .lines-section h4 {
        margin: 0 0 var(--spacing-3);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
        color: var(--color-neutral-800);
      }
      .lines-table {
        width: 100%;
        border-collapse: collapse;
      }
      .lines-table th,
      .lines-table td {
        padding: var(--spacing-3) var(--spacing-2);
        font-size: var(--font-size-sm);
        text-align: left;
        border-bottom: 1px solid var(--color-neutral-100);
      }
      .lines-table th {
        text-transform: uppercase;
        color: var(--color-neutral-500);
      }
      .lines-table .text-right {
        text-align: right;
      }
      .lines-table .text-center {
        text-align: center;
      }
      .lines-table .mono {
        font-family: 'JetBrains Mono', monospace;
      }
      .line-desc {
        color: var(--color-neutral-500);
      }
      .totals-box {
        min-width: 280px;
        max-width: 320px;
        margin-top: var(--spacing-4);
        margin-left: auto;
        padding: var(--spacing-4);
        background: var(--color-primary-50);
        border-radius: var(--radius-lg);
      }
      .total-row {
        display: flex;
        justify-content: space-between;
        padding: var(--spacing-2) 0;
        font-size: var(--font-size-sm);
      }
      .total-row.grand {
        margin-top: var(--spacing-2);
        padding-top: var(--spacing-3);
        border-top: 2px solid var(--color-primary-200);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-bold);
        color: var(--color-primary-700);
      }
      .total-row .mono {
        font-family: 'JetBrains Mono', monospace;
        font-weight: var(--font-weight-semibold);
      }
      .notes-section .note {
        font-size: var(--font-size-sm);
        color: var(--color-neutral-600);
        margin-bottom: var(--spacing-2);
      }
      .status-actions {
        display: flex;
        gap: var(--spacing-2);
        margin-top: var(--spacing-3);
        flex-wrap: wrap;
      }
      .timeline-event {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-1);
      }
      .event-label {
        font-weight: var(--font-weight-medium);
        color: var(--color-neutral-800);
      }
      .event-date {
        font-size: var(--font-size-xs);
        color: var(--color-neutral-500);
      }
      .timeline-marker {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        color: white;
      }
      .timeline-marker i {
        font-size: 12px;
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
      }
      .not-found i {
        font-size: 4rem;
        color: var(--color-warning-500);
        margin-bottom: var(--spacing-4);
      }
      .not-found h2 {
        color: var(--color-neutral-800);
        margin: 0 0 var(--spacing-2);
      }
      .not-found p {
        color: var(--color-neutral-600);
        margin: 0 0 var(--spacing-4);
      }
      .mt-3 {
        margin-top: var(--spacing-3);
      }
      .w-full {
        width: 100%;
      }
      .mb-2 {
        margin-bottom: var(--spacing-2);
      }
      .mt-2 {
        margin-top: var(--spacing-2);
      }
      :host ::ng-deep .quote-card .p-card-body {
        padding: var(--spacing-6);
      }
      :host ::ng-deep .status-card .p-card-body,
      :host ::ng-deep .timeline-card .p-card-body,
      :host ::ng-deep .actions-card .p-card-body {
        padding: var(--spacing-4);
      }
      :host ::ng-deep .status-card .p-card-header,
      :host ::ng-deep .timeline-card .p-card-header,
      :host ::ng-deep .actions-card .p-card-header {
        padding: var(--spacing-3) var(--spacing-4);
        border-bottom: 1px solid var(--color-neutral-200);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
      }
      :host ::ng-deep .custom-timeline .p-timeline-event-opposite {
        display: none;
      }
      .dialog-message {
        margin: 0 0 var(--spacing-4);
        font-size: var(--font-size-sm);
        color: var(--color-text-secondary);
      }
      .dialog-field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2);
      }
      .dialog-field label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }
      .dialog-field .required {
        color: var(--color-error-600);
      }
      .field-error {
        font-size: var(--font-size-xs);
        color: var(--color-error-600);
      }
    `,
  ],
})
export class QuoteDetailComponent implements OnInit {
  private quoteService = inject(QuoteService);
  private recurringContractService = inject(RecurringContractService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmationService = inject(ConfirmationService);
  private toastService = inject(ToastService);

  loading = signal(true);
  quote = signal<QuoteDetail | null>(null);
  timeline: TimelineEvent[] = [];

  rejectDialogVisible = false;
  rejectReason = '';
  cancelDialogVisible = false;
  cancelReason = '';
  cancelError = signal<string | null>(null);

  breadcrumbItems = computed<BreadcrumbItem[]>(() => {
    const q = this.quote();
    return [
      { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
      { label: 'Devis', route: '/quotes' },
      { label: q?.number ?? 'Devis' },
    ];
  });

  convertedInvoiceId = computed<string | null>(() => {
    return this.quote()?.convertedInvoiceId ?? null;
  });

  convertedSalesOrderId = computed<string | null>(() => {
    return this.quote()?.convertedSalesOrderId ?? null;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.loadQuote(id);
    else this.router.navigate(['/quotes']);
  }

  private loadQuote(id: string): void {
    this.loading.set(true);
    this.quoteService.getQuote(id).subscribe({
      next: (res) => {
        if (res.success) {
          this.quote.set(res.data);
          this.buildTimeline(res.data);
        } else this.quote.set(null);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.quote.set(null);
      },
    });
  }

  private buildTimeline(q: QuoteDetail): void {
    this.timeline = [
      { status: 'Créé', date: q.createdAt, icon: 'pi pi-file', color: 'var(--color-neutral-400)' },
      {
        status: 'Envoyé',
        date: q.sentAt,
        icon: 'pi pi-send',
        color: q.sentAt ? 'var(--color-info-500)' : 'var(--color-neutral-300)',
      },
      {
        status: q.status === 'Rejected' ? 'Refusé' : 'Accepté',
        date: q.acceptedAt ?? q.rejectedAt,
        icon: q.status === 'Rejected' ? 'pi pi-times' : 'pi pi-check',
        color:
          q.acceptedAt || q.rejectedAt
            ? q.status === 'Rejected'
              ? 'var(--color-error-500)'
              : 'var(--color-success-500)'
            : 'var(--color-neutral-300)',
      },
      {
        status: q.convertedSalesOrderId ? 'Commande créée' : 'Facture créée',
        date: q.convertedAt ?? null,
        icon: q.convertedSalesOrderId ? 'pi pi-shopping-cart' : 'pi pi-file-export',
        color: q.convertedInvoiceId || q.convertedSalesOrderId ? 'var(--color-primary-500)' : 'var(--color-neutral-300)',
      },
    ];
  }

  getStatusSeverity(
    status: string,
  ): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (status) {
      case 'Draft':
        return 'secondary';
      case 'Sent':
        return 'info';
      case 'Accepted':
        return 'success';
      case 'Rejected':
        return 'danger';
      case 'Expired':
        return 'warn';
      case 'Converted':
        return 'success';
      case 'Cancelled':
        return 'warn';
      default:
        return 'secondary';
    }
  }

  getStatusBadgeStatus(status: string): StatusBadgeStatus {
    switch (status) {
      case 'Draft': return 'draft';
      case 'Sent': return 'sent';
      case 'Accepted': return 'accepted';
      case 'Rejected': return 'rejected';
      case 'Expired': return 'expired';
      case 'Converted': return 'converted';
      case 'Cancelled': return 'cancelled';
      default: return 'draft';
    }
  }

  isExpired(): boolean {
    const q = this.quote();
    return !!q && new Date(q.expiryDate) < new Date();
  }

  canSend(): boolean {
    return this.quote()?.status === 'Draft';
  }

  canAccept(): boolean {
    return this.quote()?.status === 'Sent';
  }

  canCancel(): boolean {
    const s = this.quote()?.status;
    return s === 'Draft' || s === 'Sent';
  }

  canConvert(): boolean {
    return this.quote()?.status === 'Accepted' && !this.quote()?.convertedInvoiceId && !this.quote()?.convertedSalesOrderId;
  }

  canConvertToOrder(): boolean {
    return this.quote()?.status === 'Accepted' && !this.quote()?.convertedInvoiceId && !this.quote()?.convertedSalesOrderId;
  }

  canConvertToRecurringContract(): boolean {
    const q = this.quote();
    return !!q
      && q.status === 'Accepted'
      && !q.convertedInvoiceId
      && !q.convertedSalesOrderId
      && this.auth.hasPermission(PERMISSIONS.recurringContracts.create);
  }

  confirmConvertToRecurringContract(): void {
    this.confirmationService.confirm({
      header: 'Créer un contrat récurrent',
      message:
        'Un contrat récurrent sera créé à partir de ce devis (lignes et client repris). Vous pourrez ajuster la périodicité avant activation.',
      icon: 'pi pi-refresh',
      acceptLabel: 'Créer le contrat',
      rejectLabel: 'Annuler',
      accept: () => this.convertToRecurringContract(),
    });
  }

  convertToRecurringContract(): void {
    const q = this.quote();
    if (!q) return;
    const today = new Date().toISOString().slice(0, 10);
    this.recurringContractService.convertFromQuote(q.id, {
      clientId: q.clientId,
      billingFrequency: 'Monthly',
      billingDayOfMonth: new Date().getDate(),
      startDate: today,
      autoRenew: true,
      noticePeriodDays: 30,
      sourceQuoteId: q.id,
      lines: []
    }).subscribe({
      next: (contractId) => {
        this.toastService.add({
          severity: 'success',
          summary: 'Contrat créé',
          detail: 'Le contrat récurrent a été créé depuis le devis.',
        });
        void this.router.navigate(['/recurring-contracts', contractId]);
      },
      error: (err) => {
        this.toastService.add({
          severity: 'error',
          summary: 'Échec',
          detail: err?.error?.message ?? 'Impossible de créer le contrat.',
        });
      },
    });
  }

  confirmConvertToInvoice(): void {
    this.confirmationService.confirm({
      header: 'Créer la facture finale',
      message:
        'Une facture définitive sera créée à partir de ce devis. Elle aura un nouveau numéro et ne pourra plus être modifiée après signature. Souhaitez-vous continuer ?',
      icon: 'pi pi-file-export',
      acceptLabel: 'Créer la facture',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-success',
      accept: () => this.convertToInvoice(),
    });
  }

  confirmConvertToSalesOrder(): void {
    this.confirmationService.confirm({
      header: 'Transformer en commande',
      message:
        'Une commande client sera créée à partir de ce devis. Le devis sera ensuite verrouillé et ne pourra plus être converti. Souhaitez-vous continuer ?',
      icon: 'pi pi-shopping-cart',
      acceptLabel: 'Créer la commande',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-success',
      accept: () => this.convertToSalesOrder(),
    });
  }

  convertToInvoice(): void {
    const q = this.quote();
    if (!q) return;
    this.quoteService.convertToInvoice(q.id).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.toastService.add({
            severity: 'success',
            summary: 'Facture créée',
            detail: 'La facture a été générée. Redirection...',
            life: 3000,
          });
          this.router.navigate(['/invoices', res.data]);
        } else if (!res.success) {
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: res.message || 'Impossible de créer la facture à partir du devis.',
          });
        }
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de créer la facture à partir du devis.',
        });
      },
    });
  }

  convertToSalesOrder(): void {
    const q = this.quote();
    if (!q) return;
    this.quoteService.convertToSalesOrder(q.id).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.toastService.add({
            severity: 'success',
            summary: 'Commande créée',
            detail: 'La commande a été générée. Redirection...',
            life: 3000,
          });
          this.router.navigate(['/sales-orders', res.data]);
        } else if (!res.success) {
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: res.message || 'Impossible de créer la commande à partir du devis.',
          });
        }
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de créer la commande à partir du devis.',
        });
      },
    });
  }

  sendQuote(): void {
    const q = this.quote();
    if (!q) return;
    this.quoteService.sendQuote(q.id).subscribe({
      next: (res) => {
        if (res.success) {
          this.toastService.add({
            severity: 'success',
            summary: 'Devis envoyé',
            detail: 'Le devis a été marqué comme envoyé.',
          });
          this.loadQuote(q.id);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: res.message || 'Impossible d\'envoyer le devis.',
          });
        }
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible d\'envoyer le devis.',
        });
      },
    });
  }

  acceptQuote(): void {
    const q = this.quote();
    if (!q) return;
    this.quoteService.acceptQuote(q.id).subscribe({
      next: (res) => {
        if (res.success) {
          this.toastService.add({
            severity: 'success',
            summary: 'Devis accepté',
            detail: 'Vous pouvez maintenant créer la facture finale.',
          });
          this.loadQuote(q.id);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: res.message || 'Impossible d\'accepter le devis.',
          });
        }
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible d\'accepter le devis.',
        });
      },
    });
  }

  rejectQuote(): void {
    this.rejectReason = '';
    this.rejectDialogVisible = true;
  }

  doReject(): void {
    const q = this.quote();
    if (!q) return;
    const reason = this.rejectReason?.trim() || undefined;
    this.quoteService.rejectQuote(q.id, reason).subscribe({
      next: (res) => {
        if (res.success) {
          this.rejectDialogVisible = false;
          this.rejectReason = '';
          this.toastService.add({
            severity: 'info',
            summary: 'Devis refusé',
          });
          this.loadQuote(q.id);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: res.message || 'Impossible de refuser le devis.',
          });
        }
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de refuser le devis.',
        });
      },
    });
  }

  cancelQuote(): void {
    this.cancelReason = '';
    this.cancelError.set(null);
    this.cancelDialogVisible = true;
  }

  doCancel(): void {
    const q = this.quote();
    if (!q) return;
    const reason = this.cancelReason?.trim();
    if (!reason) {
      this.cancelError.set('Le motif d\'annulation est obligatoire.');
      return;
    }
    this.cancelError.set(null);
    this.quoteService.cancelQuote(q.id, reason).subscribe({
      next: (res) => {
        if (res.success) {
          this.cancelDialogVisible = false;
          this.cancelReason = '';
          this.toastService.add({ severity: 'info', summary: 'Devis annulé' });
          this.loadQuote(q.id);
        } else {
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: res.message || 'Impossible d\'annuler le devis.',
          });
        }
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible d\'annuler le devis.',
        });
      },
    });
  }

  duplicateQuote(): void {
    const q = this.quote();
    if (!q) return;
    this.quoteService.duplicateQuote(q.id).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.toastService.add({
            severity: 'success',
            summary: 'Devis dupliqué',
            detail: 'Redirection vers le nouveau devis.',
          });
          this.router.navigate(['/quotes', res.data]);
        } else if (!res.success) {
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: res.message || 'Impossible de dupliquer le devis.',
          });
        }
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de dupliquer le devis.',
        });
      },
    });
  }

  downloadPdf(): void {
    const q = this.quote();
    if (!q) return;
    this.quoteService.downloadPdf(q.id).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Devis_${q.number}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: () => {
        this.toastService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Impossible de télécharger le PDF.',
        });
      },
    });
  }
}
