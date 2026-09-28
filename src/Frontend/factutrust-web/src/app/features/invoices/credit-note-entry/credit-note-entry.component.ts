import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import {
  RefundInvoiceIdDialogComponent,
  REFUND_INVOICE_DIALOG_OPTIONS
} from '@shared/components/refund-invoice-id-dialog/refund-invoice-id-dialog.component';
import { LinkedInvoiceRef } from '@core/services/invoice-reference-resolver.service';

/**
 * Point d'entrée simplifié de création d'avoir de vente.
 * Ouvre le dialogue de sélection de la facture d'origine, puis redirige
 * vers le wizard d'avoir pré-rempli (/invoices/:id/credit-note).
 */
@Component({
  selector: 'app-credit-note-entry',
  standalone: true,
  template: `
    <div class="credit-note-entry">
      <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
      <p i18n="@@invoices.credit-note-entry.selection.de.la.facture.d.origine.df630bab">Sélection de la facture d'origine…</p>
    </div>
  `,
  styles: [`
    .credit-note-entry {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-3, 0.75rem);
      min-height: 40vh;
      color: var(--color-text-secondary, #475569);
    }

    .credit-note-entry i {
      font-size: 1.5rem;
    }
  `]
})
export class CreditNoteEntryComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly ngbModal = inject(NgbModal);

  ngOnInit(): void {
    const ref = this.ngbModal.open(RefundInvoiceIdDialogComponent, REFUND_INVOICE_DIALOG_OPTIONS);
    ref.result.then(
      (linkedInvoice: LinkedInvoiceRef) => {
        if (linkedInvoice?.id) {
          this.router.navigate(['/invoices', linkedInvoice.id, 'credit-note']);
          return;
        }
        this.router.navigate(['/invoices/credit-notes']);
      },
      () => {
        this.router.navigate(['/invoices/credit-notes']);
      }
    ).catch(() => {
      this.router.navigate(['/invoices/credit-notes']);
    });
  }
}
