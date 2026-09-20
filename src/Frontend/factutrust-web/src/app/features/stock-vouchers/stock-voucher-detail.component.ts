import { Component, OnInit, computed, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { Textarea } from 'primeng/textarea';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService, MessageService } from 'primeng/api';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { formatLocalDate } from '@core/utils/date.util';
import {
  isStockVoucherDraft,
  isStockVoucherEntry,
  isStockVoucherValidated,
  movementReasonName,
  StockVoucherDetailDto,
  StockVoucherKindName,
  StockVoucherService
} from '@core/services/stock-voucher.service';

@Component({
  selector: 'app-stock-voucher-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    CurrencyPipe,
    DatePipe,
    ButtonModule,
    DialogModule,
    Textarea,
    ConfirmDialogModule,
    ProgressSpinnerModule,
    ToastModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    ButtonComponent
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast></p-toast>
    <p-confirmDialog></p-confirmDialog>
    @if (initialLoading()) {
      <div class="loading-state" role="status">
        <p-progressSpinner strokeWidth="4"></p-progressSpinner>
      </div>
    } @else {
      @if (voucher(); as v) {
      <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>
      <app-page-header [title]="v.kindDisplay + ' ' + v.number" [subtitle]="v.reasonDisplay">
        <div class="header-actions">
          <span class="status-badge" [ngClass]="v.statusCss">{{ v.statusDisplay }}</span>
          <button pButton type="button" label="PDF" icon="pi pi-file-pdf" class="p-button-outlined"
                  (click)="downloadPdf()" [loading]="pdfLoading()"></button>
          @if (canUpdate() && isDraft(v.status)) {
            <app-button variant="outline" icon="pi-pencil" iconPos="left" [routerLink]="editRoute">
              Modifier
            </app-button>
            <button pButton type="button" label="Valider" icon="pi pi-check"
                    (click)="validate()" [loading]="processing()"></button>
          }
          @if (canCreate() && !isDraft(v.status)) {
            <button pButton type="button" label="Dupliquer" icon="pi pi-copy" class="p-button-outlined"
                    (click)="duplicate()" [loading]="duplicating()"></button>
          }
          @if (canUpdate() && (isDraft(v.status) || isValidated(v.status))) {
            <button pButton type="button" label="Annuler" icon="pi pi-times"
                    class="p-button-danger p-button-outlined" (click)="showCancelDialog = true"></button>
          }
          @if (canDelete() && isDraft(v.status)) {
            <button pButton type="button" label="Supprimer" icon="pi pi-trash"
                    class="p-button-danger" (click)="confirmDelete()"></button>
          }
          <app-button variant="outline" icon="pi-arrow-left" iconPos="left" [routerLink]="listRoute">
            Retour
          </app-button>
        </div>
      </app-page-header>

      <div class="info-grid">
        <div class="card">
          <h3>Dépôt</h3>
          <p class="warehouse-name">{{ v.warehouseName || '—' }}</p>
        </div>
        <div class="card">
          <h3>Informations</h3>
          <p><strong>Date :</strong> {{ v.voucherDate | date:'dd/MM/yyyy' }}</p>
          @if (v.externalReference) {
            <p><strong>Référence :</strong> {{ v.externalReference }}</p>
          }
          @if (v.notes) {
            <p><strong>Notes :</strong> {{ v.notes }}</p>
          }
        </div>
        <div class="card">
          <h3>Totaux</h3>
          <p><strong>Quantité :</strong> {{ v.totalQuantity | number:'1.0-3' }}</p>
          <p><strong>Valorisation :</strong> {{ v.totalValue | currency:'TND':'symbol':'1.3-3' }}</p>
          @if (v.validatedAt) {
            <p><strong>Validé le :</strong> {{ v.validatedAt | date:'dd/MM/yyyy HH:mm' }}</p>
          }
          @if (v.cancellationReason) {
            <p><strong>Annulation :</strong> {{ v.cancellationReason }}</p>
          }
        </div>
      </div>

      <div class="card">
        <h3>Lignes</h3>
        <table class="lines-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Code</th>
              <th>Produit</th>
              <th>Unité</th>
              <th>Qté</th>
              <th>Coût</th>
              <th>Valorisation</th>
            </tr>
          </thead>
          <tbody>
            @for (line of v.lines; track line.id) {
              <tr>
                <td>{{ line.lineNumber }}</td>
                <td>{{ line.productCode }}</td>
                <td>{{ line.productName }}</td>
                <td>{{ line.unit || '—' }}</td>
                <td>{{ line.quantity | number:'1.0-3' }}</td>
                <td>{{ line.unitCost | currency:'TND':'symbol':'1.3-3' }}</td>
                <td>{{ line.lineValue | currency:'TND':'symbol':'1.3-3' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <p-dialog header="Annuler le bon" [(visible)]="showCancelDialog" [modal]="true" [style]="{width:'450px'}">
        <div class="field">
          <label class="field-label">Motif d'annulation</label>
          <textarea pTextarea [(ngModel)]="cancelReason" rows="3" style="width:100%"></textarea>
        </div>
        <ng-template pTemplate="footer">
          <button pButton type="button" label="Fermer" class="p-button-text" (click)="showCancelDialog = false"></button>
          <button pButton type="button" label="Confirmer l'annulation" class="p-button-danger"
                  (click)="cancelVoucher()" [disabled]="!cancelReason.trim()" [loading]="processing()"></button>
        </ng-template>
      </p-dialog>
      }
    }
  `,
  styles: [`
    .loading-state { display: flex; justify-content: center; align-items: center; min-height: 240px; }
    .header-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
    @media (max-width: 768px) { .info-grid { grid-template-columns: 1fr; } }
    .card { background: white; border-radius: 0.75rem; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .card h3 { font-size: 0.875rem; font-weight: 600; color: #64748b; text-transform: uppercase; margin: 0 0 0.75rem 0; }
    .warehouse-name { font-size: 1.125rem; font-weight: 600; margin: 0; }
    .lines-table { width: 100%; border-collapse: collapse; }
    .lines-table th, .lines-table td { padding: 0.625rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
    .status-badge { padding: 0.25rem 0.75rem; border-radius: 1rem; font-size: 0.75rem; font-weight: 500; }
    .status-draft { background: #f1f5f9; color: #475569; }
    .status-validated { background: #dcfce7; color: #166534; }
    .status-cancelled { background: #fee2e2; color: #991b1b; }
    .field-label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.375rem; }
  `]
})
export class StockVoucherDetailComponent implements OnInit {
  private voucherService = inject(StockVoucherService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private errorHandler = inject(ErrorHandlerService);
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);

  voucher = signal<StockVoucherDetailDto | null>(null);
  initialLoading = signal(true);
  processing = signal(false);
  pdfLoading = signal(false);
  duplicating = signal(false);
  showCancelDialog = false;
  cancelReason = '';

  breadcrumbItems: BreadcrumbItem[] = [];

  canUpdate = computed(() => this.auth.hasPermission(PERMISSIONS.stockVouchers.update));
  canCreate = computed(() => this.auth.hasPermission(PERMISSIONS.stockVouchers.create));
  canDelete = computed(() => this.auth.hasPermission(PERMISSIONS.stockVouchers.delete));

  readonly isDraft = isStockVoucherDraft;
  readonly isValidated = isStockVoucherValidated;

  get listRoute(): string {
    return this.isEntry ? '/stock/entries' : '/stock/issues';
  }

  get editRoute(): string {
    const v = this.voucher();
    return v ? `${this.listRoute}/${v.id}/edit` : this.listRoute;
  }

  get isEntry(): boolean {
    return isStockVoucherEntry(this.voucher()?.kind ?? this.route.snapshot.data['kind']);
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
    else {
      this.initialLoading.set(false);
      void this.router.navigate(['/stock']);
    }
  }

  load(id: string): void {
    const showSpinner = this.voucher() === null;
    if (showSpinner) this.initialLoading.set(true);
    this.voucherService.getStockVoucher(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        const data = res.data ?? null;
        this.voucher.set(data);
        if (data) {
          const listLabel = isStockVoucherEntry(data.kind) ? "Bons d'entrée" : 'Bons de sortie';
          this.breadcrumbItems = [
            { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
            { label: 'Stock', route: '/stock' },
            { label: listLabel, route: this.listRoute },
            { label: data.number }
          ];
        }
        this.initialLoading.set(false);
      },
      error: (err) => {
        this.initialLoading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: this.errorHandler.extractErrorMessage(err)
        });
        void this.router.navigate([this.listRoute]);
      }
    });
  }

  validate(): void {
    const v = this.voucher();
    if (!v) return;
    this.confirmationService.confirm({
      header: 'Valider le bon',
      message: 'Le stock sera mis à jour. Continuer ?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Valider',
      rejectLabel: 'Retour',
      accept: () => {
        this.processing.set(true);
        this.voucherService.validate(v.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: () => {
            this.processing.set(false);
            this.messageService.add({ severity: 'success', summary: 'Validé', detail: 'Le stock a été mis à jour.' });
            this.load(v.id);
          },
          error: (err) => {
            this.processing.set(false);
            this.messageService.add({
              severity: 'error',
              summary: 'Validation refusée',
              detail: this.errorHandler.extractErrorMessage(err)
            });
          }
        });
      }
    });
  }

  cancelVoucher(): void {
    const v = this.voucher();
    if (!v || !this.cancelReason.trim()) return;
    this.processing.set(true);
    this.voucherService.cancel(v.id, this.cancelReason.trim()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.processing.set(false);
        this.showCancelDialog = false;
        this.messageService.add({ severity: 'info', summary: 'Annulé', detail: 'Bon de stock annulé.' });
        this.load(v.id);
      },
      error: (err) => {
        this.processing.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Annulation refusée',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  confirmDelete(): void {
    const v = this.voucher();
    if (!v) return;
    this.confirmationService.confirm({
      header: 'Supprimer le brouillon',
      message: `Supprimer définitivement ${v.number} ?`,
      icon: 'pi pi-trash',
      acceptLabel: 'Supprimer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => {
        this.voucherService.delete(v.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'Supprimé', detail: 'Brouillon supprimé.' });
            void this.router.navigate([this.listRoute]);
          },
          error: (err) => this.messageService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: this.errorHandler.extractErrorMessage(err)
          })
        });
      }
    });
  }

  duplicate(): void {
    const v = this.voucher();
    if (!v) return;
    const kind: StockVoucherKindName = isStockVoucherEntry(v.kind) ? 'Entry' : 'Issue';
    this.duplicating.set(true);
    this.voucherService.create({
      kind,
      voucherDate: formatLocalDate(new Date()),
      warehouseId: v.warehouseId,
      reason: movementReasonName(v.reason),
      externalReference: v.externalReference,
      notes: v.notes,
      lines: v.lines.map(l => ({
        productId: l.productId,
        quantity: l.quantity,
        unitCost: l.unitCost,
        notes: l.notes
      }))
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.duplicating.set(false);
        const id = res.data;
        this.messageService.add({ severity: 'success', summary: 'Dupliqué', detail: 'Un brouillon a été créé.' });
        if (id) void this.router.navigate([this.listRoute, id, 'edit']);
      },
      error: (err) => {
        this.duplicating.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  downloadPdf(): void {
    const v = this.voucher();
    if (!v) return;
    this.pdfLoading.set(true);
    this.voucherService.downloadPdf(v.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (blob) => {
        this.pdfLoading.set(false);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${v.number}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: (err) => {
        this.pdfLoading.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }
}
