/// <reference types="@angular/localize" />
import { BackendLabelPipe } from '@shared/pipes/backend-label.pipe';
import { Component, Input, OnChanges, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonComponent } from '@shared/components/button/button.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { StatusBadgeComponent } from '@shared/components/status-badge/status-badge.component';
import { SkeletonTableComponent, SkeletonColumn } from '@shared/components/skeleton/skeleton-table.component';
import { ProjectApiService, ProjectLinkedInvoice } from '../project-api.service';
import { InvoiceService } from '@core/services/invoice.service';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { invoiceBadgeStatus } from '../../recurring-contracts/recurring-contracts.ui-utils';

/** Section « Factures du projet » dans l'onglet Facturation. */
@Component({
  selector: 'app-project-invoices-section',
  standalone: true,
  imports: [
    BackendLabelPipe,
    CommonModule,
    RouterModule,
    TableModule,
    ButtonComponent,
    EmptyStateComponent,
    StatusBadgeComponent,
    SkeletonTableComponent
  ],
  template: `
    <div class="section-header">
      <h3 i18n="@@projects.components.factures.du.projet.69bf2d0d">Factures du projet</h3>
    </div>

    @if (loading()) {
      <app-skeleton-table [rows]="5" [columns]="skeletonColumns"></app-skeleton-table>
    } @else if (invoices() === null) {
      <app-empty-state
        icon="pi-receipt"
        title="Factures indisponibles" i18n-title="@@projects.components.factures.indisponibles.d67140b4"
        description="Impossible de charger la liste des factures pour ce projet."
        [showAction]="false">
      </app-empty-state>
    } @else if (invoices()!.length === 0) {
      <app-empty-state
        icon="pi-receipt"
        title="Aucune facture" i18n-title="@@projects.components.aucune.facture.72124217"
        description="Aucune facture n'a encore été générée pour ce projet."
        [showAction]="false">
      </app-empty-state>
    } @else {
      <div class="ft-table-card">
        <p-table [value]="invoices()!" styleClass="p-datatable-sm" [rowHover]="true">
          <ng-template pTemplate="header">
            <tr>
              <th i18n="@@projects.components.numero.15e73db0">Numéro</th>
              <th style="width: 110px" i18n="@@projects.components.date.eb9a4bc1">Date</th>
              <th i18n="@@projects.components.client.1bdd79b1">Client</th>
              <th style="width: 120px" i18n="@@projects.components.montant.ht.3df1d6fe">Montant HT</th>
              <th style="width: 110px" i18n="@@projects.components.tva.fb62cb5d">TVA</th>
              <th style="width: 120px" i18n="@@projects.components.montant.ttc.a742433a">Montant TTC</th>
              <th style="width: 140px" i18n="@@projects.components.statut.659499f3">Statut</th>
              <th style="width: 130px" i18n="@@projects.components.date.de.creation.d5e8d1af">Date de création</th>
              <th style="width: 100px" i18n="@@projects.components.actions.c3cd636a">Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-inv>
            <tr [class.row-avoir]="inv.isCreditNote">
              <td>
                @if (canReadInvoices()) {
                  <a [routerLink]="['/invoices', inv.invoiceId]" class="invoice-number">{{ inv.number }}</a>
                } @else {
                  <span class="invoice-number-static">{{ inv.number }}</span>
                }
                @if (inv.isCreditNote) {
                  <span class="credit-note-tag" i18n="@@projects.components.avoir.8ee24717">Avoir</span>
                }
              </td>
              <td>{{ inv.issueDate | date:'dd/MM/yyyy' }}</td>
              <td>{{ inv.clientName }}</td>
              <td class="amount">{{ inv.amountHT | currency:currency:'symbol':'1.3-3' }}</td>
              <td class="amount">{{ inv.amountVat | currency:currency:'symbol':'1.3-3' }}</td>
              <td class="amount">{{ inv.amountTTC | currency:currency:'symbol':'1.3-3' }}</td>
              <td>
                <app-status-badge [status]="invoiceBadgeStatus(inv.status)" [label]="inv.statusDisplay | backendLabel">
                </app-status-badge>
              </td>
              <td>{{ inv.createdAt | date:'dd/MM/yyyy HH:mm' }}</td>
              <td>
                @if (canReadInvoices()) {
                  <div class="actions">
                    <app-button
                      variant="ghost"
                      size="sm"
                      icon="pi-eye"
                      [iconOnly]="true"
                      [routerLink]="['/invoices', inv.invoiceId]"
                      ariaLabel="Voir la facture">
                    </app-button>
                    <app-button
                      variant="ghost"
                      size="sm"
                      icon="pi-download"
                      [iconOnly]="true"
                      [disabled]="downloadingId() === inv.invoiceId"
                      (click)="downloadPdf(inv)"
                      ariaLabel="Télécharger le PDF">
                    </app-button>
                  </div>
                }
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      margin-top: var(--spacing-6, 1.5rem);
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-4);

      h3 { margin: 0; font-size: var(--font-size-lg); color: var(--color-neutral-800); }
    }

    .invoice-number,
    .invoice-number-static {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-sm);
    }

    .invoice-number {
      color: var(--color-primary-600);
      text-decoration: none;
    }

    .invoice-number:hover { text-decoration: underline; }

    .invoice-number-static { color: var(--color-neutral-800); }

    .credit-note-tag {
      margin-left: var(--spacing-2);
      padding: 0 var(--spacing-2);
      border-radius: var(--radius-full);
      background: var(--color-warning-50, #fffbeb);
      color: var(--color-warning-700, #b45309);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
    }

    .amount {
      font-family: var(--font-family-mono, 'JetBrains Mono', monospace);
      font-weight: var(--font-weight-medium);
      white-space: nowrap;
    }

    .actions {
      display: flex;
      gap: var(--spacing-1);
    }

    .row-avoir td { background: var(--color-warning-50, #fffbeb); }
  `]
})
export class ProjectInvoicesSectionComponent implements OnInit, OnChanges {
  @Input({ required: true }) projectId!: string;
  @Input() currency = 'TND';
  @Input() refreshToken = 0;

  private readonly api = inject(ProjectApiService);
  private readonly invoiceService = inject(InvoiceService);
  private readonly toast = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);
  private readonly auth = inject(AuthService);

  readonly invoices = signal<ProjectLinkedInvoice[] | null>([]);
  readonly loading = signal(true);
  readonly downloadingId = signal<string | null>(null);
  private initialized = false;

  readonly canReadInvoices = computed(() => this.auth.hasPermission(PERMISSIONS.invoices.read));

  readonly skeletonColumns: SkeletonColumn[] = [
    { width: '120px' }, { width: '110px' }, { width: '140px' },
    { width: '120px' }, { width: '110px' }, { width: '120px' },
    { width: '140px' }, { width: '130px' }, { width: '100px' }
  ];

  protected readonly invoiceBadgeStatus = invoiceBadgeStatus;

  ngOnInit(): void {
    this.initialized = true;
    this.load();
  }

  ngOnChanges(): void {
    if (this.initialized) this.load();
  }

  load(): void {
    if (!this.projectId) return;
    this.loading.set(true);
    this.api.linkedInvoices(this.projectId).subscribe({
      next: response => {
        this.invoices.set(response.success && response.data ? response.data : []);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.invoices.set(null);
        this.errorHandler.logError('Projects: linked invoices', err);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@project-invoices-section.component.summary.Erreur:Erreur`,
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  downloadPdf(inv: ProjectLinkedInvoice): void {
    this.downloadingId.set(inv.invoiceId);
    this.invoiceService.downloadPdf(inv.invoiceId).subscribe({
      next: blob => {
        this.downloadingId.set(null);
        if (!blob || blob.size === 0) return;
        try {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${inv.isCreditNote ? $localize`:@@ui.tern.avoir.8ee247:Avoir` : $localize`:@@ui.tern.facture.3953b9:Facture`}_${inv.number}.pdf`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        } catch (error) {
          console.error('Erreur lors du téléchargement du PDF:', error);
        }
      },
      error: (error: Error) => {
        this.downloadingId.set(null);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@project-invoices-section.component.summary.T_l_chargement_i:Téléchargement impossible`,
          detail: this.errorHandler.extractErrorMessage(error)
        });
      }
    });
  }
}
