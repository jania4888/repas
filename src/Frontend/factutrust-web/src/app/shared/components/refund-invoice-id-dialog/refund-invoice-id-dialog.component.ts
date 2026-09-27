import {
  Component,
  ViewChild,
  ElementRef,
  AfterViewInit,
  signal,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgbActiveModal, NgbModalOptions } from '@ng-bootstrap/ng-bootstrap';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { OverlayOptions } from 'primeng/api';
import { InvoiceListItem } from '@core/services/invoice.service';
import {
  InvoiceReferenceResolverService,
  LinkedInvoiceRef
} from '@core/services/invoice-reference-resolver.service';

export const REFUND_INVOICE_DIALOG_OPTIONS: NgbModalOptions = {
  container: 'body',
  centered: true,
  backdrop: 'static',
  keyboard: true,
  windowClass: 'refund-invoice-id-dialog-window',
  modalDialogClass: 'refund-invoice-id-dialog',
};

@Component({
  selector: 'app-refund-invoice-id-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, AutoCompleteModule],
  template: `
    <div class="refund-dialog-header">
      <i class="pi pi-file-edit refund-dialog-icon" aria-hidden="true"></i>
      <h5 class="refund-dialog-title" id="refundDialogTitle" i18n="@@shared.components.refund-invoice-id-dialog.refund-invoice-id-dialog.creer.un.avoir.d6e9259a">Créer un avoir</h5>
      <button
        type="button"
        class="refund-dialog-close"
        (click)="modal.dismiss()"
        aria-label="Fermer" i18n-aria-label="Fermer"
        tabindex="0"><span aria-hidden="true" i18n="@@shared.components.refund-invoice-id-dialog.refund-invoice-id-dialog.times.77d7c977">&times;</span>
      </button>
    </div>
    <div class="refund-dialog-body">
      <p class="refund-dialog-message" i18n="@@shared.components.refund-invoice-id-dialog.refund-invoice-id-dialog.recherchez.la.facture.d.origine.par.numero.nom.d.c5cb585e"> Recherchez la facture d'origine par numéro, nom de client ou référence POS (POS-…). </p>
      <label for="refundInvoiceSearch" class="refund-dialog-label" i18n="@@shared.components.refund-invoice-id-dialog.refund-invoice-id-dialog.facture.a.rembourser.4bf45deb"> Facture à rembourser </label>
      <div
        class="refund-dialog-search"
        [class.refund-dialog-search--open]="suggestions.length > 0">
        <p-autoComplete
          #invoiceSearchInput
          inputId="refundInvoiceSearch"
          [(ngModel)]="searchText"
          [suggestions]="suggestions"
          (completeMethod)="onSearch($event)"
          (onSelect)="onInvoiceSelect($event)"
          field="number"
          [dropdown]="false"
          [minLength]="1"
          placeholder="Ex. FAC-2026-000042 ou POS-…" i18n-placeholder="Ex. FAC-2026-000042 ou POS-…"
          appendTo="body"
          panelStyleClass="refund-invoice-autocomplete-panel"
          scrollHeight="200px"
          [overlayOptions]="modalOverlayOptions"
          [baseZIndex]="modalPrimeBaseZIndex"
          [inputStyle]="{ width: '100%' }"
          [style]="{ width: '100%' }"
          aria-label="Rechercher une facture à rembourser" i18n-aria-label="Rechercher une facture à rembourser"
          aria-describedby="refundDialogTitle">
          <ng-template let-invoice pTemplate="item">
            <div class="invoice-suggestion">
              <span class="invoice-num">{{ invoice.number }}</span>
              <span class="invoice-client">{{ invoice.clientName }}</span>
              <span class="invoice-meta">
                <span class="invoice-status">{{ invoice.status }}</span>
                <span class="invoice-amount">{{ invoice.totalAmount | number:'1.3-3' }} {{ invoice.currency }}</span>
              </span>
            </div>
          </ng-template>
          <ng-template pTemplate="empty">
            <div class="invoice-empty">
              <span i18n="@@shared.components.refund-invoice-id-dialog.refund-invoice-id-dialog.aucune.facture.trouvee.9821dcce">Aucune facture trouvée</span>
            </div>
          </ng-template>
        </p-autoComplete>
      </div>
      @if (errorMessage()) {
        <p class="refund-dialog-error" role="alert">{{ errorMessage() }}</p>
      }
      @if (isResolving()) {
        <p class="refund-dialog-loading" i18n="@@shared.components.refund-invoice-id-dialog.refund-invoice-id-dialog.recherche.en.cours.a16747f0">Recherche en cours…</p>
      }
    </div>
    <div class="refund-dialog-footer">
      <button
        type="button"
        class="refund-dialog-btn reject"
        (click)="modal.dismiss()"
        aria-label="Annuler" i18n-aria-label="Annuler"
        tabindex="0" i18n="@@shared.components.refund-invoice-id-dialog.refund-invoice-id-dialog.annuler.49ba3292"> Annuler </button>
      <button
        type="button"
        class="refund-dialog-btn accept"
        [disabled]="!canSubmit()"
        (click)="onSubmit()"
        aria-label="Valider" i18n-aria-label="Valider" i18n="@@shared.components.refund-invoice-id-dialog.refund-invoice-id-dialog.valider.be4220f7"> Valider </button>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      pointer-events: auto !important;
    }

    .refund-dialog-header,
    .refund-dialog-body,
    .refund-dialog-footer {
      pointer-events: auto !important;
    }

    .refund-dialog-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-3, 0.75rem);
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
      padding: var(--spacing-4, 1rem) var(--spacing-5, 1.25rem);
    }

    .refund-dialog-icon {
      font-size: var(--font-size-2xl, 1.5rem);
      color: var(--color-warning-600, #d97706);
      flex-shrink: 0;
      font-family: 'primeicons';
    }

    .refund-dialog-title {
      flex: 1;
      margin: 0;
      font-size: var(--font-size-lg, 1.125rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--color-text-primary, #0f172a);
    }

    .refund-dialog-close {
      width: 32px;
      height: 32px;
      border: none;
      border-radius: var(--radius-md, 0.375rem);
      background: transparent;
      cursor: pointer;
      opacity: 0.6;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity var(--transition-fast, 150ms);
    }

    .refund-dialog-close span {
      font-size: 1.25rem;
      line-height: 1;
      color: var(--color-text-secondary, #475569);
    }

    .refund-dialog-close:hover,
    .refund-dialog-close:focus {
      opacity: 1;
    }

    .refund-dialog-body {
      padding: var(--spacing-5, 1.25rem);
    }

    .refund-dialog-message {
      margin: 0 0 var(--spacing-4, 1rem);
      font-size: var(--font-size-base, 1rem);
      line-height: var(--line-height-normal, 1.5);
      color: var(--color-text-secondary, #475569);
    }

    .refund-dialog-label {
      display: block;
      margin-bottom: var(--spacing-2, 0.5rem);
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      color: var(--color-text-primary, #0f172a);
    }

    .refund-dialog-search {
      position: relative;
      min-height: 2.75rem;
    }

    .refund-dialog-search--open {
      min-height: 13rem;
      margin-bottom: var(--spacing-2, 0.5rem);
    }

    .invoice-suggestion {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1, 0.25rem);
    }

    .invoice-num {
      font-weight: var(--font-weight-semibold, 600);
      font-family: 'JetBrains Mono', monospace;
    }

    .invoice-client {
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--color-text-secondary, #475569);
    }

    .invoice-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-2, 0.5rem);
      font-size: var(--font-size-sm, 0.875rem);
    }

    .invoice-status {
      color: var(--color-text-tertiary, #64748b);
    }

    .invoice-amount {
      font-weight: var(--font-weight-medium, 500);
      color: var(--color-text-primary, #0f172a);
      white-space: nowrap;
    }

    .invoice-empty {
      padding: var(--spacing-2, 0.5rem);
      color: var(--color-text-secondary, #475569);
      font-size: var(--font-size-sm, 0.875rem);
    }

    .refund-dialog-error {
      margin: var(--spacing-3, 0.75rem) 0 0;
      color: var(--color-danger-600, #dc2626);
      font-size: var(--font-size-sm, 0.875rem);
    }

    .refund-dialog-loading {
      margin: var(--spacing-2, 0.5rem) 0 0;
      color: var(--color-text-secondary, #475569);
      font-size: var(--font-size-sm, 0.875rem);
    }

    .refund-dialog-footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-3, 0.75rem);
      padding: var(--spacing-4, 1rem) var(--spacing-5, 1.25rem);
      border-top: 1px solid var(--color-border-subtle, #e2e8f0);
      background: var(--color-background-subtle, #f8fafc);
    }

    .refund-dialog-btn {
      pointer-events: auto !important;
      cursor: pointer !important;
      min-width: 100px;
      padding: var(--spacing-2, 0.5rem) var(--spacing-4, 1rem);
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      border-radius: var(--radius-md, 0.375rem);
      font-family: var(--font-family);
    }

    .refund-dialog-btn.reject {
      background: var(--color-white, #ffffff);
      border: 1px solid var(--color-border-default, #cbd5e1);
      color: var(--color-text-primary, #0f172a);
    }

    .refund-dialog-btn.accept {
      background: var(--color-primary-600, #2563eb);
      border: 1px solid var(--color-primary-600, #2563eb);
      color: white;
    }

    .refund-dialog-btn.accept:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `],
})
export class RefundInvoiceIdDialogComponent implements AfterViewInit {
  @ViewChild('invoiceSearchInput') inputRef!: ElementRef<HTMLElement>;

  private readonly resolver = inject(InvoiceReferenceResolverService);

  readonly modalOverlayOptions: OverlayOptions = { baseZIndex: 1300 };
  readonly modalPrimeBaseZIndex = 1300;

  searchText = '';
  suggestions: InvoiceListItem[] = [];
  selectedRef = signal<LinkedInvoiceRef | null>(null);
  errorMessage = signal<string | null>(null);
  isResolving = signal(false);

  canSubmit = computed(() => !!this.selectedRef()?.id && !this.isResolving());

  constructor(public modal: NgbActiveModal) {}

  ngAfterViewInit(): void {
    setTimeout(() => {
      const el = this.inputRef?.nativeElement?.querySelector('input');
      el?.focus();
    }, 0);
  }

  onSearch(event: { query: string }): void {
    this.errorMessage.set(null);
    this.selectedRef.set(null);
    this.resolver.searchInvoices(event.query ?? '').subscribe({
      next: items => { this.suggestions = items; },
      error: () => { this.suggestions = []; }
    });
  }

  onInvoiceSelect(event: { value: InvoiceListItem }): void {
    const invoice = event?.value;
    if (!invoice?.id) {
      return;
    }
    this.errorMessage.set(null);
    this.selectedRef.set(this.toRef(invoice));
    this.searchText = invoice.number;
  }

  onSubmit(): void {
    if (this.selectedRef()) {
      this.modal.close(this.selectedRef());
      return;
    }

    const query = this.searchText?.trim();
    if (!query) {
      this.errorMessage.set('Veuillez saisir ou sélectionner une facture.');
      return;
    }

    this.isResolving.set(true);
    this.errorMessage.set(null);
    this.resolver.resolveReference(query).subscribe({
      next: ref => {
        this.isResolving.set(false);
        this.modal.close(ref);
      },
      error: err => {
        this.isResolving.set(false);
        this.errorMessage.set(err?.message ?? $localize`:@@ui.tern.facture.introuvable.ab2a43:Facture introuvable.`);
      }
    });
  }

  private toRef(invoice: InvoiceListItem): LinkedInvoiceRef {
    return {
      id: invoice.id,
      number: invoice.number,
      clientName: invoice.clientName,
      status: invoice.status,
      totalTTC: Math.abs(invoice.totalAmount)
    };
  }
}
