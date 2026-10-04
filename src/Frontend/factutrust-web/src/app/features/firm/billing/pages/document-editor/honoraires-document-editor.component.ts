import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { TabsModule } from 'primeng/tabs';
import { DialogModule } from 'primeng/dialog';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TooltipModule } from 'primeng/tooltip';
import { BreadcrumbComponent } from '@shared/components/breadcrumb/breadcrumb.component';
import { formatLocalDate } from '@core/utils/date.util';
import { ToastService } from '@core/services/toast.service';
import { AuthService } from '@core/services/auth.service';
import { PERMISSIONS } from '@core/config/permission-keys';
import { FirmActivityCode, FirmGovernanceService } from '@core/services/firm-governance.service';
import { ActivityCodePickerComponent, ActivityCodeChangeEvent } from '../../../shared/activity-code-picker.component';
import { resolveDossier, toClientSnapshot } from '../../utils/honoraires-dossier.util';
import {
  isUnitPriceOverride,
  resolveCatalogUnitPrice,
  suggestUnitPriceFromCatalog
} from '../../utils/honoraires-activity-price.util';
import {
  canCreateHonorairesCreditNote,
  canRecordHonorairesPayment,
  HonorairesInvoiceStatus,
  HonorairesQuoteStatus,
  honorairesInvoiceStatusLabel,
  honorairesInvoiceStatusSeverity
} from '../../models/honoraires-invoice-status';
import { HonorairesRecordPaymentDialogComponent } from '../../components/honoraires-record-payment-dialog/honoraires-record-payment-dialog.component';
import { HonorairesPaymentsSectionComponent } from '../../components/honoraires-payments-section/honoraires-payments-section.component';
import {
  BillableDossier,
  HonorairesAttachmentItem,
  HonorairesInvoiceListItem,
  HonorairesLineWrite,
  HonorairesPayment,
  HonorairesQuoteListItem,
  HonorairesService
} from '../../services/honoraires.service';

interface LineRow {
  activityCode: string | null;
  designation: string;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  discountPercent?: number | null;
}

@Component({
  selector: 'app-honoraires-document-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ButtonModule,
    DatePickerModule,
    SelectModule,
    InputNumberModule,
    InputTextModule,
    Textarea,
    ToggleSwitchModule,
    TabsModule,
    DialogModule,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
    TooltipModule,
    BreadcrumbComponent,
    ActivityCodePickerComponent,
    HonorairesRecordPaymentDialogComponent,
    HonorairesPaymentsSectionComponent
  ],
  templateUrl: './honoraires-document-editor.component.html',
  styleUrl: './honoraires-document-editor.component.scss'
})
export class HonorairesDocumentEditorComponent implements OnInit {
  readonly quoteStatus = HonorairesQuoteStatus;
  private readonly api = inject(HonorairesService);
  private readonly governance = inject(FirmGovernanceService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  mode: 'invoice' | 'quote' = 'invoice';
  documentId: string | null = null;
  status = 0;
  statusDisplay = '';
  numberLabel = 'N° Provisoire';
  amountPaid = 0;
  amountDue = 0;
  payments: HonorairesPayment[] = [];
  isCreditNote = false;
  linkedInvoiceId: string | null = null;
  linkedInvoiceNumber: string | null = null;
  saving = signal(false);
  loading = signal(true);

  dossiers = signal<BillableDossier[]>([]);
  activityCodes = signal<FirmActivityCode[]>([]);
  /** Bound to p-select via optionValue="assignmentId". */
  selectedAssignmentId: string | null = null;
  /** Fallback when dossier is absent from active catalogue. */
  documentClientSnapshot: BillableDossier | null = null;

  issueDate: Date = new Date();
  dueDate: Date | null = null;
  currency = 'TND';
  reference = '';
  notes = '';
  paymentTerms = '';
  paymentMethod = 'Virement bancaire';
  bankAccountLabel = '';
  withholdingAmount = 0;
  isRecurring = false;
  recurrenceFrequency: number | null = null;
  contactName = '';
  contactEmail = '';
  contactPhone = '';
  sourceQuoteId: string | null = null;

  lines: LineRow[] = [this.emptyLine()];

  currencies = [
    { label: 'TND', value: 'TND' },
    { label: 'EUR', value: 'EUR' },
    { label: 'USD', value: 'USD' }
  ];
  vatOptions = [
    { label: '0%', value: 0 },
    { label: '7%', value: 7 },
    { label: '13%', value: 13 },
    { label: '19%', value: 19 }
  ];
  recurrenceOptions = [
    { label: 'Mensuel', value: 0 },
    { label: 'Trimestriel', value: 1 },
    { label: 'Annuel', value: 2 },
    { label: 'Ponctuel', value: 3 }
  ];
  paymentMethods = ['Virement bancaire', 'Chèque', 'Espèces', 'Carte'];

  showPaymentDialog = false;
  showQuoteDialog = false;
  history = signal<HonorairesInvoiceListItem[]>([]);
  attachments = signal<HonorairesAttachmentItem[]>([]);
  acceptedQuotes = signal<HonorairesQuoteListItem[]>([]);

  readonly subTotal = computed(() => this.calc().ht);
  readonly totalVat = computed(() => this.calc().vat);
  readonly totalTtc = computed(() => this.calc().ttc);
  readonly hasLegacyLines = computed(() => {
    this.lineVersion();
    return this.requiresActivityCode && this.lines.some(l => !l.activityCode && !!l.designation.trim());
  });

  private readonly lineVersion = signal(0);

  ngOnInit(): void {
    const dataMode = this.route.snapshot.data['mode'];
    this.mode = dataMode === 'quote' || this.router.url.includes('/quotes') ? 'quote' : 'invoice';
    this.documentId = this.route.snapshot.paramMap.get('id');

    forkJoin({
      dossiers: this.api.listDossiers().pipe(
        catchError(() => {
          this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Impossible de charger les dossiers' });
          return of([] as BillableDossier[]);
        })
      ),
      codes: this.governance.listActivityCodes(false, true).pipe(
        catchError(() => of({ success: true, data: [] as FirmActivityCode[] }))
      )
    }).subscribe(({ dossiers, codes }) => {
      this.dossiers.set(dossiers);
      this.activityCodes.set(codes.data ?? []);
      this.reconcileDossierSelection();

      if (this.documentId) {
        this.loadDocument(this.documentId);
      } else {
        this.loading.set(false);
        if (this.mode === 'invoice') {
          this.api.previewInvoiceNumber(0).subscribe({
            next: n => (this.numberLabel = `Provisoire → ${n}`),
            error: () => undefined
          });
        }
      }
    });
  }

  /** Resolved dossier: catalogue match preferred, then document snapshot. */
  get selectedDossier(): BillableDossier | null {
    return resolveDossier(this.dossiers(), this.selectedAssignmentId, this.documentClientSnapshot);
  }

  get pageTitle(): string {
    if (this.mode === 'quote') return this.documentId ? 'Devis honoraires' : 'Nouveau devis';
    if (this.isCreditNote) return this.documentId ? 'Avoir honoraires' : 'Nouvel avoir';
    return this.documentId ? 'Facture honoraires' : 'Nouvelle facture';
  }

  get billingListRoute(): string {
    if (this.mode === 'quote') return '/firm/billing/quotes';
    if (this.isCreditNote) return '/firm/billing/credit-notes';
    return '/firm/billing/invoices';
  }

  get finalizeActionLabel(): string {
    if (this.mode === 'quote') return 'Envoyer';
    return this.isCreditNote ? 'Finaliser l\'avoir' : 'Finaliser et envoyer';
  }

  get headerSubtitle(): string {
    const client = this.selectedDossier?.companyName;
    const base = client ? `${this.numberLabel} — ${client}` : this.numberLabel;
    if (this.isCreditNote && this.linkedInvoiceId) {
      const ref = this.linkedInvoiceNumber || 'facture source';
      return `${base} · Avoir sur ${ref}`;
    }
    return base;
  }

  get canEdit(): boolean {
    return this.status === HonorairesInvoiceStatus.Draft || !this.documentId;
  }

  get requiresActivityCode(): boolean {
    return this.activityCodes().length > 0;
  }

  get canFinalize(): boolean {
    return this.canEdit && !this.hasLegacyLines();
  }

  get canRecordPayment(): boolean {
    if (this.mode !== 'invoice' || this.isCreditNote) return false;
    if (!this.auth.hasPermission(PERMISSIONS.honorairesPayments.create)) return false;
    return canRecordHonorairesPayment(this.status, this.isCreditNote) && this.amountDue > 0;
  }

  get canShowCreateCreditNote(): boolean {
    if (!this.auth.hasPermission(PERMISSIONS.honorairesInvoices.create)) return false;
    return this.mode === 'invoice'
      && !!this.documentId
      && canCreateHonorairesCreditNote(this.status, this.isCreditNote);
  }

  get createCreditNoteTooltip(): string {
    if (this.isCreditNote) return '';
    if (this.status === HonorairesInvoiceStatus.Draft) {
      return 'Finalisez la facture avant de créer un avoir';
    }
    if (this.status === HonorairesInvoiceStatus.Cancelled) {
      return 'Impossible de créer un avoir sur une facture annulée';
    }
    return 'Créer un avoir sur cette facture';
  }

  get canShowDraftCreditNoteHint(): boolean {
    if (!this.auth.hasPermission(PERMISSIONS.honorairesInvoices.create)) return false;
    return this.mode === 'invoice'
      && !!this.documentId
      && !this.isCreditNote
      && this.status === HonorairesInvoiceStatus.Draft;
  }

  get paymentsClientWithholdingTotal(): number {
    return this.payments.reduce((sum, p) => sum + (p.clientWithholdingAmount || 0), 0);
  }

  get statusLabel(): string {
    if (!this.documentId) return 'Provisoire';
    if (this.mode === 'quote') {
      const q: Record<number, string> = {
        0: 'Brouillon',
        1: 'Envoyé',
        2: 'Accepté',
        3: 'Refusé',
        4: 'Converti'
      };
      return q[this.status] ?? '—';
    }
    return honorairesInvoiceStatusLabel(this.status, this.statusDisplay);
  }

  get statusSeverity(): 'info' | 'success' | 'warn' | 'danger' | 'secondary' {
    if (!this.documentId || this.status === HonorairesInvoiceStatus.Draft) return 'info';
    if (this.mode === 'quote') {
      if (this.status === 2 || this.status === 4) return 'success';
      if (this.status === 3) return 'danger';
      return 'secondary';
    }
    return honorairesInvoiceStatusSeverity(this.status);
  }

  onDossierChange(): void {
    const dossier = this.selectedDossier;
    if (!dossier) return;
    this.documentClientSnapshot = { ...dossier };
    this.contactEmail = dossier.contactEmail || '';
    this.contactPhone = dossier.contactPhone || '';
    const first = this.lines[0];
    // Dossier annual fee takes priority over catalog tariff for the initial TENUE line.
    if (dossier.suggestedLineDesignation && this.lines.length === 1 && !first.designation && !first.activityCode) {
      const fee = dossier.annualFeeAmount ?? 0;
      const freq = dossier.billingFrequency;
      let qty = 1;
      let unit = fee;
      if (freq === 0 && fee > 0) { qty = 1; unit = Math.round((fee / 12) * 1000) / 1000; }
      else if (freq === 1 && fee > 0) { qty = 1; unit = Math.round((fee / 4) * 1000) / 1000; }

      const tenue = this.activityCodes().find(c => c.code === 'TENUE');
      this.lines[0] = {
        activityCode: tenue?.code ?? null,
        designation: tenue?.label ?? dossier.suggestedLineDesignation,
        description: dossier.suggestedLineDesignation,
        quantity: qty,
        unitPrice: unit,
        vatRate: 19,
        discountPercent: null
      };
      this.touchLines();
    }
  }

  /**
   * Manual service change always suggests the catalog tariff (or 0 if unset).
   * Loaded documents keep persisted unit prices — this handler is not called on load.
   */
  onActivityCodeChange(index: number, event: ActivityCodeChangeEvent): void {
    const line = this.lines[index];
    line.activityCode = event.code;
    if (event.code) {
      line.designation = event.label;
      line.unitPrice = event.defaultUnitPrice != null && event.defaultUnitPrice > 0
        ? event.defaultUnitPrice
        : suggestUnitPriceFromCatalog(this.activityCodes(), event.code);
    } else if (this.requiresActivityCode) {
      line.designation = '';
      line.unitPrice = 0;
    }
    this.touchLines();
  }

  catalogUnitPrice(code: string | null): number | null {
    return resolveCatalogUnitPrice(this.activityCodes(), code);
  }

  showPriceOverrideHint(line: LineRow): boolean {
    this.lineVersion();
    return isUnitPriceOverride(this.activityCodes(), line.activityCode, line.unitPrice);
  }

  addLine(): void {
    this.lines.push(this.emptyLine());
    this.touchLines();
  }

  removeLine(index: number): void {
    if (this.lines.length <= 1) return;
    this.lines.splice(index, 1);
    this.touchLines();
  }

  touchLines(): void {
    this.lineVersion.update(v => v + 1);
  }

  private emptyLine(): LineRow {
    return { activityCode: null, designation: '', description: '', quantity: 1, unitPrice: 0, vatRate: 19, discountPercent: null };
  }

  private reconcileDossierSelection(): void {
    if (!this.selectedAssignmentId && this.documentClientSnapshot) {
      this.selectedAssignmentId = this.documentClientSnapshot.assignmentId;
    }
  }

  private applyClientFromDocument(params: {
    assignmentId: string;
    companyName: string;
    nif?: string | null;
    address?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
  }): void {
    this.selectedAssignmentId = params.assignmentId;
    this.documentClientSnapshot = toClientSnapshot(params);
    this.reconcileDossierSelection();
  }

  private calc(): { ht: number; vat: number; ttc: number } {
    this.lineVersion();
    let ht = 0;
    let vat = 0;
    for (const line of this.lines) {
      const gross = Math.round(line.quantity * line.unitPrice * 1000) / 1000;
      const discount = line.discountPercent ? Math.round(gross * line.discountPercent / 100 * 1000) / 1000 : 0;
      const net = Math.round((gross - discount) * 1000) / 1000;
      const lineVat = Math.round(net * (line.vatRate / 100) * 1000) / 1000;
      ht += net;
      vat += lineVat;
    }
    return { ht: Math.round(ht * 1000) / 1000, vat: Math.round(vat * 1000) / 1000, ttc: Math.round((ht + vat) * 1000) / 1000 };
  }

  lineTotal(line: LineRow): number {
    const gross = line.quantity * line.unitPrice;
    const discount = line.discountPercent ? gross * line.discountPercent / 100 : 0;
    return Math.round((gross - discount) * 1000) / 1000;
  }

  private mapLinesForSave(): HonorairesLineWrite[] | null {
    const meaningful = this.lines.filter(l =>
      this.requiresActivityCode ? !!l.activityCode : !!l.designation.trim()
    );

    if (meaningful.length === 0) {
      this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Ajoutez au moins une ligne' });
      return null;
    }

    if (this.requiresActivityCode && meaningful.some(l => !l.activityCode)) {
      this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Sélectionnez un type d’activité pour chaque ligne' });
      return null;
    }

    return meaningful.map(l => ({
      activityCode: l.activityCode || undefined,
      designation: l.designation || this.activityCodes().find(c => c.code === l.activityCode)?.label || '',
      description: l.description || undefined,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      discountPercent: l.discountPercent ?? undefined
    }));
  }

  save(finalize = false): void {
    const dossier = this.selectedDossier;
    if (!dossier) {
      this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Sélectionnez un dossier client' });
      return;
    }
    const lines = this.mapLinesForSave();
    if (!lines) return;

    this.saving.set(true);

    if (this.mode === 'quote') {
      const dto = {
        firmClientAssignmentId: dossier.assignmentId,
        clientName: dossier.companyName,
        clientNif: dossier.nif,
        clientAddress: dossier.address,
        contactName: this.contactName || undefined,
        contactEmail: this.contactEmail || undefined,
        contactPhone: this.contactPhone || undefined,
        issueDate: formatLocalDate(this.issueDate),
        validUntil: this.dueDate ? formatLocalDate(this.dueDate) : null,
        currency: this.currency,
        reference: this.reference || undefined,
        notes: this.notes || undefined,
        paymentTerms: this.paymentTerms || undefined,
        lines
      };
      const afterSave = (id: string) => {
        if (finalize) {
          this.api.sendQuote(id).subscribe({
            next: () => { this.toast.add({ severity: 'success', summary: 'OK', detail: 'Devis envoyé' }); this.router.navigate(['/firm/billing/quotes', id]); },
            error: () => { this.saving.set(false); this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Envoi impossible' }); }
          });
        } else {
          this.saving.set(false);
          this.toast.add({ severity: 'success', summary: 'OK', detail: 'Devis enregistré' });
          this.router.navigate(['/firm/billing/quotes', id]);
        }
      };
      if (this.documentId) {
        this.api.updateQuote(this.documentId, dto).subscribe({
          next: () => afterSave(this.documentId!),
          error: () => { this.saving.set(false); this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Enregistrement impossible' }); }
        });
      } else {
        this.api.createQuote(dto).subscribe({
          next: id => afterSave(id),
          error: () => { this.saving.set(false); this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Enregistrement impossible' }); }
        });
      }
      return;
    }

    const dto = {
      firmClientAssignmentId: dossier.assignmentId,
      clientName: dossier.companyName,
      clientNif: dossier.nif,
      clientAddress: dossier.address,
      contactName: this.contactName || undefined,
      contactEmail: this.contactEmail || undefined,
      contactPhone: this.contactPhone || undefined,
      issueDate: formatLocalDate(this.issueDate),
      dueDate: this.dueDate ? formatLocalDate(this.dueDate) : null,
      currency: this.currency,
      reference: this.reference || undefined,
      notes: this.notes || undefined,
      paymentTerms: this.paymentTerms || undefined,
      paymentMethod: this.paymentMethod || undefined,
      bankAccountLabel: this.bankAccountLabel || undefined,
      withholdingAmount: this.withholdingAmount || 0,
      isRecurring: this.isRecurring,
      recurrenceFrequency: this.isRecurring ? this.recurrenceFrequency : null,
      sourceQuoteId: this.sourceQuoteId,
      lines
    };

    const afterSave = (id: string) => {
      if (finalize) {
        this.api.validateInvoice(id).subscribe({
          next: () => {
            this.saving.set(false);
            const detail = this.isCreditNote ? 'Avoir finalisé' : 'Facture finalisée';
            this.toast.add({ severity: 'success', summary: 'OK', detail });
            const route = this.isCreditNote
              ? ['/firm/billing/credit-notes']
              : ['/firm/billing/invoices', id];
            this.router.navigate(route);
          },
          error: err => {
            this.saving.set(false);
            const detail = err?.error?.message || err?.error?.errors?.[0]
              || (this.isCreditNote ? 'Finalisation de l\'avoir impossible' : 'Finalisation impossible');
            this.toast.add({ severity: 'error', summary: 'Erreur', detail });
          }
        });
      } else {
        this.saving.set(false);
        const detail = this.isCreditNote ? 'Avoir enregistré' : 'Brouillon enregistré';
        this.toast.add({ severity: 'success', summary: 'OK', detail });
        this.router.navigate(['/firm/billing/invoices', id]);
      }
    };
    if (this.documentId) {
      this.api.updateInvoice(this.documentId, dto).subscribe({
        next: () => afterSave(this.documentId!),
        error: () => { this.saving.set(false); this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Enregistrement impossible' }); }
      });
    } else {
      this.api.createInvoice(dto).subscribe({
        next: id => afterSave(id),
        error: () => { this.saving.set(false); this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Enregistrement impossible' }); }
      });
    }
  }

  createCreditNote(): void {
    if (!this.documentId || !this.canShowCreateCreditNote) return;
    this.api.createCreditNote({
      linkedInvoiceId: this.documentId,
      issueDate: formatLocalDate(new Date())
    }).subscribe({
      next: id => {
        this.toast.add({ severity: 'success', summary: 'OK', detail: 'Avoir créé (brouillon)' });
        this.router.navigate(['/firm/billing/invoices', id]);
      },
      error: err => {
        const detail = err?.error?.message || err?.error?.errors?.[0] || 'Création de l’avoir impossible';
        this.toast.add({ severity: 'error', summary: 'Erreur', detail });
      }
    });
  }

  showDraftCreditNoteHint(): void {
    this.toast.add({
      severity: 'warn',
      summary: 'Facture brouillon',
      detail: 'Finalisez la facture avant de créer un avoir'
    });
  }

  previewPdf(): void {
    if (!this.documentId) {
      this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Enregistrez d’abord le document' });
      return;
    }
    const dl$ = this.mode === 'quote'
      ? this.api.downloadQuotePdf(this.documentId)
      : this.api.downloadInvoicePdf(this.documentId);
    dl$.subscribe({
      next: blob => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      },
      error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'PDF indisponible' })
    });
  }

  openPayment(): void {
    if (!this.canRecordPayment || !this.documentId) return;
    this.showPaymentDialog = true;
  }

  onPaymentRecorded(): void {
    if (this.documentId) this.loadDocument(this.documentId);
  }

  acceptQuote(): void {
    if (!this.documentId) return;
    this.api.acceptQuote(this.documentId).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'OK', detail: 'Devis accepté' });
        this.loadDocument(this.documentId!);
      },
      error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Acceptation impossible' })
    });
  }

  convertQuote(): void {
    if (!this.documentId) return;
    this.api.convertQuote(this.documentId).subscribe({
      next: invoiceId => {
        this.toast.add({ severity: 'success', summary: 'OK', detail: 'Facture créée depuis le devis' });
        this.router.navigate(['/firm/billing/invoices', invoiceId]);
      },
      error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Conversion impossible' })
    });
  }

  openFromQuote(): void {
    if (!this.selectedDossier) {
      this.toast.add({ severity: 'warn', summary: 'Dossier', detail: 'Sélectionnez d’abord un dossier client' });
      return;
    }
    this.api.listQuotes({
      assignmentId: this.selectedDossier.assignmentId,
      status: 2,
      page: 1,
      pageSize: 50
    }).subscribe({
      next: page => {
        this.acceptedQuotes.set(page.items);
        this.showQuoteDialog = true;
      },
      error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Impossible de charger les devis' })
    });
  }

  importQuote(quoteId: string): void {
    this.api.getQuote(quoteId).subscribe({
      next: q => {
        this.sourceQuoteId = q.id;
        this.currency = q.currency;
        this.reference = q.reference || '';
        this.notes = q.notes || '';
        this.paymentTerms = q.paymentTerms || '';
        this.contactName = q.contactName || '';
        this.contactEmail = q.contactEmail || '';
        this.contactPhone = q.contactPhone || '';
        this.applyClientFromDocument({
          assignmentId: q.firmClientAssignmentId,
          companyName: q.clientName,
          nif: q.clientNif,
          address: q.clientAddress,
          contactEmail: q.contactEmail,
          contactPhone: q.contactPhone
        });
        this.lines = q.lines.map(l => this.mapApiLine(l));
        this.touchLines();
        this.showQuoteDialog = false;
        this.toast.add({ severity: 'success', summary: 'OK', detail: 'Lignes importées depuis le devis' });
      },
      error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Devis introuvable' })
    });
  }

  loadHistory(): void {
    if (!this.selectedDossier) return;
    this.api.listInvoices({
      assignmentId: this.selectedDossier.assignmentId,
      page: 1,
      pageSize: 10
    }).subscribe({
      next: page => this.history.set(page.items),
      error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Historique indisponible' })
    });
  }

  toastNeedSave(): void {
    this.toast.add({ severity: 'warn', summary: 'Pièces jointes', detail: 'Enregistrez le document avant d’ajouter des fichiers' });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.documentId) return;
    if (file.size > 10 * 1024 * 1024) {
      this.toast.add({ severity: 'error', summary: 'Fichier', detail: 'Taille max 10 Mo' });
      return;
    }
    const kind = this.mode === 'quote' ? 1 : 0;
    this.api.uploadAttachment(kind, this.documentId, file).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'OK', detail: 'Pièce jointe ajoutée' });
        this.reloadAttachments();
      },
      error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Upload impossible' })
    });
  }

  removeAttachment(id: string): void {
    this.api.deleteAttachment(id).subscribe({
      next: () => {
        this.toast.add({ severity: 'success', summary: 'OK', detail: 'Pièce jointe supprimée' });
        this.reloadAttachments();
      },
      error: () => this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Suppression impossible' })
    });
  }

  private mapApiLine(l: { activityCode?: string | null; designation: string; description?: string; quantity: number; unitPrice: number; vatRate: number; discountPercent?: number | null }): LineRow {
    return {
      activityCode: l.activityCode ?? null,
      designation: l.designation,
      description: l.description || '',
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      discountPercent: l.discountPercent
    };
  }

  /**
   * For legacy drafts missing activity codes, suggest TENUE when the line
   * text looks like a permanent-file / tenue fee.
   */
  private maybeSuggestLegacyActivityCodes(): void {
    if (!this.requiresActivityCode || !this.canEdit) return;
    const tenue = this.activityCodes().find(c => c.code === 'TENUE');
    if (!tenue) return;

    let changed = false;
    for (const line of this.lines) {
      if (line.activityCode) continue;
      const text = `${line.designation} ${line.description}`.toLowerCase();
      if (
        text.includes('dossier permanent') ||
        text.includes('tenue') ||
        text.includes('honoraires')
      ) {
        line.activityCode = tenue.code;
        if (!line.designation.trim()) line.designation = tenue.label;
        changed = true;
      }
    }
    if (changed) this.touchLines();
  }

  private reloadAttachments(): void {
    if (!this.documentId) {
      this.attachments.set([]);
      return;
    }
    const kind = this.mode === 'quote' ? 1 : 0;
    this.api.listAttachments(kind, this.documentId).subscribe({
      next: items => this.attachments.set(items),
      error: () => this.attachments.set([])
    });
  }

  private loadDocument(id: string): void {
    if (this.mode === 'quote') {
      this.api.getQuote(id).subscribe({
        next: q => {
          this.status = q.status;
          this.statusDisplay = q.statusDisplay || '';
          this.numberLabel = q.number || 'N° Provisoire';
          this.issueDate = new Date(q.issueDate);
          this.dueDate = q.validUntil ? new Date(q.validUntil) : null;
          this.currency = q.currency;
          this.reference = q.reference || '';
          this.notes = q.notes || '';
          this.paymentTerms = q.paymentTerms || '';
          this.contactName = q.contactName || '';
          this.contactEmail = q.contactEmail || '';
          this.contactPhone = q.contactPhone || '';
          this.amountPaid = 0;
          this.amountDue = 0;
          this.payments = [];
          this.isCreditNote = false;
          this.applyClientFromDocument({
            assignmentId: q.firmClientAssignmentId,
            companyName: q.clientName,
            nif: q.clientNif,
            address: q.clientAddress,
            contactEmail: q.contactEmail,
            contactPhone: q.contactPhone
          });
          this.lines = q.lines.map(l => this.mapApiLine(l));
          this.touchLines();
          this.maybeSuggestLegacyActivityCodes();
          this.reloadAttachments();
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Devis introuvable' });
        }
      });
      return;
    }

    this.api.getInvoice(id).subscribe({
      next: inv => {
        this.status = inv.status;
        this.statusDisplay = inv.statusDisplay || '';
        this.numberLabel = inv.number || 'N° Provisoire';
        this.issueDate = new Date(inv.issueDate);
        this.dueDate = inv.dueDate ? new Date(inv.dueDate) : null;
        this.currency = inv.currency;
        this.reference = inv.reference || '';
        this.notes = inv.notes || '';
        this.paymentTerms = inv.paymentTerms || '';
        this.paymentMethod = inv.paymentMethod || 'Virement bancaire';
        this.bankAccountLabel = inv.bankAccountLabel || '';
        this.withholdingAmount = inv.withholdingAmount;
        this.isRecurring = inv.isRecurring;
        this.recurrenceFrequency = inv.recurrenceFrequency ?? null;
        this.contactName = inv.contactName || '';
        this.contactEmail = inv.contactEmail || '';
        this.contactPhone = inv.contactPhone || '';
        this.amountPaid = inv.amountPaid ?? 0;
        this.amountDue = inv.amountDue ?? 0;
        this.payments = inv.payments ?? [];
        this.isCreditNote = !!inv.isCreditNote;
        this.linkedInvoiceId = inv.linkedInvoiceId ?? null;
        this.linkedInvoiceNumber = inv.linkedInvoiceNumber ?? null;
        this.applyClientFromDocument({
          assignmentId: inv.firmClientAssignmentId,
          companyName: inv.clientName,
          nif: inv.clientNif,
          address: inv.clientAddress,
          contactEmail: inv.contactEmail,
          contactPhone: inv.contactPhone
        });
        this.lines = inv.lines.map(l => this.mapApiLine(l));
        this.touchLines();
        this.maybeSuggestLegacyActivityCodes();
        this.reloadAttachments();
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.add({ severity: 'error', summary: 'Erreur', detail: 'Facture introuvable' });
      }
    });
  }
}
