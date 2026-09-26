import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { Textarea } from 'primeng/textarea';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StockTransferService, StockTransferDetailDto } from '@core/services/stock-transfer.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';

@Component({
  selector: 'app-transfer-detail',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule, ConfirmDialogModule, ToastModule, Textarea, FormsModule, DialogModule, ProgressSpinnerModule],
  providers: [ConfirmationService, MessageService],
  template: `
    <p-toast></p-toast>
    <p-confirmDialog></p-confirmDialog>
    <div *ngIf="initialLoading()" class="loading-state" role="status" aria-busy="true" aria-live="polite">
      <p-progressSpinner strokeWidth="4" aria-label="Chargement du transfert en cours" i18n-aria-label="Chargement du transfert en cours"></p-progressSpinner>
    </div>
    <div class="page-container" *ngIf="!initialLoading() && transfer()">
      <div class="page-header">
        <div>
          <h1>Transfert {{ transfer()!.number }}</h1>
          <span class="status-badge" [ngClass]="transfer()!.statusCss">{{ transfer()!.statusDisplay }}</span>
        </div>
        <div class="actions">
          <button pButton type="button" label="Télécharger PDF" icon="pi pi-file-pdf" class="p-button-outlined"
                  (click)="downloadPdf()" [loading]="pdfLoading()" [disabled]="pdfLoading()"
                  aria-label="Télécharger le transfert au format PDF" i18n-aria-label="Télécharger le transfert au format PDF"></button>
          <button *ngIf="transfer()!.status === 'Draft' || transfer()!.status === '0'"
                  pButton label="Confirmer" icon="pi pi-check" (click)="confirm()" [loading]="processing()"
                  aria-label="Confirmer le transfert" i18n-aria-label="Confirmer le transfert"></button>
          <button *ngIf="isConfirmedNotInTransit()"
                  pButton type="button" label="Mettre en transit" icon="pi pi-send" class="p-button-secondary"
                  (click)="startTransit()" [loading]="processing()"
                  aria-label="Passer le transfert en statut en transit" i18n-aria-label="Passer le transfert en statut en transit"></button>
          <button *ngIf="transfer()!.status === 'Confirmed' || transfer()!.status === '1' || transfer()!.status === 'InTransit' || transfer()!.status === '2'"
                  pButton label="Terminer" icon="pi pi-check-circle" class="p-button-success" (click)="complete()" [loading]="processing()"
                  aria-label="Terminer le transfert et mettre à jour les stocks" i18n-aria-label="Terminer le transfert et mettre à jour les stocks"></button>
          <button *ngIf="transfer()!.status === 'Draft' || transfer()!.status === '0' || transfer()!.status === 'Confirmed' || transfer()!.status === '1'"
                  pButton label="Annuler" icon="pi pi-times" class="p-button-danger p-button-outlined" (click)="showCancelDialog = true"></button>
        </div>
      </div>

      <div class="info-grid">
        <div class="card">
          <h3 i18n="@@transfers.transfer-detail.entrepot.source.07ac9f4d">Entrepôt source</h3>
          <p class="warehouse-name">{{ transfer()!.sourceWarehouseName }}</p>
          <p class="warehouse-address" *ngIf="transfer()!.sourceWarehouseAddress">{{ transfer()!.sourceWarehouseAddress }}</p>
        </div>
        <div class="card">
          <h3 i18n="@@transfers.transfer-detail.entrepot.destination.edbd85df">Entrepôt destination</h3>
          <p class="warehouse-name">{{ transfer()!.destinationWarehouseName }}</p>
          <p class="warehouse-address" *ngIf="transfer()!.destinationWarehouseAddress">{{ transfer()!.destinationWarehouseAddress }}</p>
        </div>
        <div class="card">
          <h3 i18n="@@transfers.transfer-detail.informations.54937b3a">Informations</h3>
          <p><strong i18n="@@transfers.transfer-detail.date.2e4c6fc1">Date :</strong> {{ transfer()!.transferDate | date:'dd/MM/yyyy' }}</p>
          <p *ngIf="transfer()!.reference"><strong i18n="@@transfers.transfer-detail.reference.d3ebb895">Référence :</strong> {{ transfer()!.reference }}</p>
          <p *ngIf="transfer()!.notes"><strong i18n="@@transfers.transfer-detail.notes.4ef03540">Notes :</strong> {{ transfer()!.notes }}</p>
        </div>
      </div>

      <div class="card">
        <h3 i18n="@@transfers.transfer-detail.lignes.de.transfert.7b06ae07">Lignes de transfert</h3>
        <table class="lines-table">
          <thead>
            <tr>
              <th i18n="@@transfers.transfer-detail.text.d08f88df">#</th>
              <th i18n="@@transfers.transfer-detail.code.adac6937">Code</th>
              <th i18n="@@transfers.transfer-detail.produit.ff673dc2">Produit</th>
              <th i18n="@@transfers.transfer-detail.qte.demandee.88026dff">Qté demandée</th>
              <th i18n="@@transfers.transfer-detail.qte.transferee.178cc982">Qté transférée</th>
              <th i18n="@@transfers.transfer-detail.statut.659499f3">Statut</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let line of transfer()!.lines">
              <td>{{ line.lineNumber }}</td>
              <td>{{ line.productCode }}</td>
              <td>{{ line.productName }}</td>
              <td>{{ line.requestedQuantity }}</td>
              <td>{{ line.transferredQuantity }}</td>
              <td>
                <span *ngIf="line.isFullyTransferred" class="status-badge status-completed" i18n="@@transfers.transfer-detail.transfere.062a36d3">Transféré</span>
                <span *ngIf="!line.isFullyTransferred" class="status-badge status-draft" i18n="@@transfers.transfer-detail.en.attente.5231158f">En attente</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p-dialog header="Annuler le transfert" [(visible)]="showCancelDialog" [modal]="true" [style]="{width:'450px'}">
        <div class="field">
          <label class="field-label" i18n="@@transfers.transfer-detail.motif.d.annulation.f627914d">Motif d'annulation</label>
          <textarea pTextarea [(ngModel)]="cancelReason" rows="3" style="width:100%"></textarea>
        </div>
        <ng-template pTemplate="footer">
          <button pButton label="Annuler" class="p-button-text" (click)="showCancelDialog = false"></button>
          <button pButton label="Confirmer l'annulation" class="p-button-danger" (click)="cancelTransfer()" [disabled]="!cancelReason.trim()"></button>
        </ng-template>
      </p-dialog>
    </div>
  `,
  styles: [`
    .page-container { padding: 1.5rem; max-width: 1000px; margin: 0 auto; }
    .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; }
    .page-header h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.5rem 0; }
    .actions { display: flex; gap: 0.5rem; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
    .card { background: white; border-radius: 0.75rem; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .card h3 { font-size: 0.875rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; margin: 0 0 0.75rem 0; }
    .warehouse-name { font-size: 1.125rem; font-weight: 600; margin: 0; }
    .warehouse-address { color: var(--text-secondary); font-size: 0.875rem; margin: 0.25rem 0 0 0; }
    .lines-table { width: 100%; border-collapse: collapse; }
    .lines-table th, .lines-table td { padding: 0.625rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
    .lines-table th { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-secondary); }
    .status-badge { padding: 0.25rem 0.75rem; border-radius: 1rem; font-size: 0.75rem; font-weight: 500; }
    .status-draft { background: #f1f5f9; color: #475569; }
    .status-confirmed { background: #dbeafe; color: #1d4ed8; }
    .status-completed { background: #dcfce7; color: #166534; }
    .status-cancelled { background: #fee2e2; color: #991b1b; }
    .field { margin-bottom: 0.75rem; }
    .field-label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 0.375rem; }
    .loading-state { display: flex; justify-content: center; align-items: center; min-height: 240px; }
    @media (max-width: 768px) {
      .page-header { flex-direction: column; gap: 1rem; }
      .actions { flex-wrap: wrap; }
      .info-grid { grid-template-columns: 1fr; }
      .lines-table { display: block; overflow-x: auto; white-space: nowrap; }
    }
  `]
})
export class TransferDetailComponent implements OnInit {
  private transferService = inject(StockTransferService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private destroyRef = inject(DestroyRef);
  private errorHandler = inject(ErrorHandlerService);

  transfer = signal<StockTransferDetailDto | null>(null);
  initialLoading = signal(true);
  processing = signal(false);
  pdfLoading = signal(false);
  showCancelDialog = false;
  cancelReason = '';

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.loadTransfer(id);
    else {
      this.initialLoading.set(false);
      this.messageService.add({ severity: 'warn', summary: 'Transfert', detail: 'Identifiant manquant' });
      void this.router.navigate(['/transfers']);
    }
  }

  /** Backend sends StockTransferStatus as numeric enum (Confirmed = 1). */
  isConfirmedNotInTransit(): boolean {
    const s = this.transfer()?.status as string | number | undefined;
    return s === 1 || s === '1' || s === 'Confirmed';
  }

  loadTransfer(id: string) {
    const showFullSpinner = this.transfer() === null;
    if (showFullSpinner) this.initialLoading.set(true);
    this.transferService.getStockTransfer(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.transfer.set(res.data ?? null);
        if (showFullSpinner) this.initialLoading.set(false);
      },
      error: () => {
        if (showFullSpinner) this.initialLoading.set(false);
        this.messageService.add({ severity: 'error', summary: 'Erreur', detail: 'Impossible de charger le transfert' });
        void this.router.navigate(['/transfers']);
      }
    });
  }

  startTransit() {
    const t = this.transfer();
    if (!t) return;
    this.processing.set(true);
    this.transferService.startTransitStockTransfer(t.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.processing.set(false);
        this.messageService.add({ severity: 'success', summary: 'Succès', detail: 'Transfert marqué en transit' });
        this.loadTransfer(t.id);
      },
      error: (err) => {
        this.processing.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  confirm() {
    this.confirmationService.confirm({
      header: 'Confirmer le transfert',
      message: 'Confirmer ce transfert ? La disponibilité des stocks à la source sera contrôlée.',
      icon: 'pi pi-info-circle',
      acceptLabel: 'Confirmer',
      rejectLabel: 'Annuler',
      accept: () => this.runConfirm()
    });
  }

  private runConfirm() {
    const t = this.transfer();
    if (!t) return;
    this.processing.set(true);
    this.transferService.confirmStockTransfer(t.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.processing.set(false);
        this.messageService.add({ severity: 'success', summary: 'Succès', detail: 'Transfert confirmé' });
        this.loadTransfer(t.id);
      },
      error: (err) => {
        this.processing.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  complete() {
    this.confirmationService.confirm({
      header: 'Terminer le transfert',
      message: 'Cette action est irréversible : les stocks seront débités à la source et crédités à destination. Continuer ?',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Terminer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-success',
      accept: () => this.runComplete()
    });
  }

  private runComplete() {
    const t = this.transfer();
    if (!t) return;
    this.processing.set(true);
    this.transferService.completeStockTransfer(t.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.processing.set(false);
        this.messageService.add({ severity: 'success', summary: 'Succès', detail: 'Transfert terminé. Stock mis à jour.' });
        this.loadTransfer(t.id);
      },
      error: (err) => {
        this.processing.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }

  downloadPdf() {
    const t = this.transfer();
    if (!t) return;
    this.pdfLoading.set(true);
    this.transferService.downloadPdf(t.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (blob) => {
        this.pdfLoading.set(false);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Transfert_${t.number}.pdf`;
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

  cancelTransfer() {
    const t = this.transfer();
    if (!t || !this.cancelReason.trim()) return;
    this.transferService.cancelStockTransfer(t.id, this.cancelReason).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.showCancelDialog = false;
        this.messageService.add({ severity: 'info', summary: 'Annulé', detail: 'Transfert annulé' });
        this.loadTransfer(t.id);
      },
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: this.errorHandler.extractErrorMessage(err)
        });
      }
    });
  }
}
