/// <reference types="@angular/localize" />
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { Textarea } from 'primeng/textarea';
import { AutoCompleteModule, AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { CheckboxModule } from 'primeng/checkbox';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { PAYMENT_TERM_DAY_OPTIONS, SUPPLIER_PAYMENT_METHOD_OPTIONS } from '@shared/constants/coded-option-labels';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { WarehouseSelectorComponent } from '@shared/components/warehouse-selector/warehouse-selector.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { QuickCreateProductDialogComponent } from '@shared/components/quick-create-product-dialog/quick-create-product-dialog.component';
import { formatLocalDate } from '@core/utils/date.util';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { BarcodeScanFieldComponent } from '@shared/components/barcode-scan-field/barcode-scan-field.component';
import { BarcodeLookupService } from '@shared/services/barcode-lookup.service';
import { BarcodeFeedbackService } from '@shared/services/barcode-feedback.service';
import { environment } from '@environments/environment';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { SupplierService, SupplierListItem } from '@core/services/supplier.service';
import { ProductService, ProductListItem } from '@core/services/product.service';
import {
  CreateStandaloneSupplierInvoiceRequest,
  SupplierInvoiceService
} from '@core/services/supplier-invoice.service';
import { AccountingFeatureFlagsService } from '@features/accounting/shared/accounting-feature-flags.service';

interface InvoiceLineRow {
  product: ProductListItem | null;
  productId: string | null;
  quantity: number;
  unitPriceHT: number;
  discountPercent: number;
  vatRate: number;
  isFixedAsset: boolean;
  assetAccountNumber: string;
}

@Component({
  selector: 'app-supplier-invoice-form',
  standalone: true,
  imports: [
    BarcodeScanFieldComponent,
    CommonModule, RouterModule, FormsModule, CurrencyPipe, DatePipe,
    SelectModule, InputTextModule, InputNumberModule, DatePickerModule,
    Textarea, AutoCompleteModule, CheckboxModule,
    PageHeaderComponent, BreadcrumbComponent, FormSectionComponent,
    WarehouseSelectorComponent, ButtonComponent, QuickCreateProductDialogComponent
  ],
  templateUrl: './supplier-invoice-form.component.html',
  styleUrls: ['./supplier-invoice-form.component.scss']
})
export class SupplierInvoiceFormComponent implements OnInit, OnDestroy {
  protected loc_supprimer_la_ligne_i_48c1e3(p0: unknown): string {
    return $localize`:@@supplier-invoices.supplier-invoice-form.tpl.supprimer.la.ligne.i.48c1e3f2:Supprimer la ligne ${p0}:i:`;
  }


  private router = inject(Router);
  private service = inject(SupplierInvoiceService);
  private supplierService = inject(SupplierService);
  private productService = inject(ProductService);
  private toast = inject(ToastService);
  private errors = inject(ErrorHandlerService);
  private warehouseContext = inject(WarehouseContextService);
  private accountingFlags = inject(AccountingFeatureFlagsService);
  private readonly barcodeLookup = inject(BarcodeLookupService);
  private readonly barcodeFeedback = inject(BarcodeFeedbackService);
  readonly barcodeScanEnabled = environment.featureFlags?.barcodeScanOnDocuments === true;
  private readonly destroy$ = new Subject<void>();
  private readonly search$ = new Subject<string>();

  breadcrumbItems: BreadcrumbItem[] = [
    { label: $localize`:@@supplier-invoices.supplier-invoice-form.ts.accueil.a8ff8fd2:Accueil`, route: '/', icon: 'pi-home' },
    { label: $localize`:@@supplier-invoices.supplier-invoice-form.ts.achats.ee5b078c:Achats` },
    { label: $localize`:@@supplier-invoices.supplier-invoice-form.ts.factures.fournisseurs.1dcbc2ed:Factures fournisseurs`, route: '/supplier-invoices' },
    { label: $localize`:@@supplier-invoices.supplier-invoice-form.ts.nouvelle.facture.cdf7e09c:Nouvelle facture` }
  ];

  suppliers = signal<SupplierListItem[]>([]);
  productSuggestions = signal<ProductListItem[]>([]);
  submitting = signal(false);
  regenerating = signal(false);
  totalHT = signal(0);
  totalVat = signal(0);
  totalTTC = signal(0);

  selectedSupplierId: string | null = null;
  selectedWarehouseId: string | null = null;
  invoiceDate: Date = new Date();
  paymentTermDays = 30;
  invoiceNumber = '';
  invoiceNumberManuallyEdited = false;
  useSuggestedNumber = true;
  externalReference = '';
  paymentMethod: string | null = null;
  notes = '';
  lines: InvoiceLineRow[] = [];
  quickCreateVisible = false;

  paymentTermOptions = [...PAYMENT_TERM_DAY_OPTIONS];

  paymentMethodOptions = [...SUPPLIER_PAYMENT_METHOD_OPTIONS];

  fixedAssetsEnabled = computed(() => this.accountingFlags.isEnabled('fixedAssetsEnabled'));

  dueDate(): Date {
    const d = new Date(this.invoiceDate ?? new Date());
    d.setDate(d.getDate() + (this.paymentTermDays || 0));
    return d;
  }

  ngOnInit(): void {
    this.selectedWarehouseId = this.warehouseContext.selectedWarehouseId();
    this.addLine();
    this.loadSuppliers();
    this.generateInvoiceNumber();
    this.search$.pipe(debounceTime(250), distinctUntilChanged(), takeUntil(this.destroy$)).subscribe(q => this.runProductSearch(q));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  canSubmit(): boolean {
    return !!this.selectedSupplierId
      && this.lines.some(l => !!l.productId && l.quantity > 0)
      && (this.useSuggestedNumber || !!this.invoiceNumber.trim());
  }

  cancel(): void {
    void this.router.navigate(['/supplier-invoices']);
  }

  onSupplierChange(): void {
    const supplier = this.suppliers().find(s => s.id === this.selectedSupplierId);
    if (!supplier?.paymentTermDays) return;
    this.ensurePaymentTermOption(supplier.paymentTermDays);
    this.paymentTermDays = supplier.paymentTermDays;
  }

  onInvoiceDateChange(): void {
    if (this.useSuggestedNumber) {
      this.generateInvoiceNumber();
    }
  }

  onInvoiceNumberEdited(): void {
    this.invoiceNumberManuallyEdited = true;
    this.useSuggestedNumber = false;
  }

  onUseSuggestedChange(): void {
    if (this.useSuggestedNumber) {
      this.generateInvoiceNumber();
    }
  }

  generateInvoiceNumber(): void {
    this.regenerating.set(true);
    this.service.previewNumber(this.invoiceDate ?? new Date()).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.invoiceNumber = res.data;
          this.invoiceNumberManuallyEdited = false;
          this.useSuggestedNumber = true;
        }
        this.regenerating.set(false);
      },
      error: () => this.regenerating.set(false)
    });
  }

  addLine(): void {
    this.lines = [...this.lines, {
      product: null,
      productId: null,
      quantity: 1,
      unitPriceHT: 0,
      discountPercent: 0,
      vatRate: 19,
      isFixedAsset: false,
      assetAccountNumber: ''
    }];
  }

  removeLine(index: number): void {
    this.lines = this.lines.filter((_, i) => i !== index);
    if (this.lines.length === 0) this.addLine();
    this.recalculateTotals();
  }

  searchProducts(event: AutoCompleteCompleteEvent): void {
    this.search$.next(event.query ?? '');
  }

  onProductSelect(line: InvoiceLineRow, event: AutoCompleteSelectEvent): void {
    const product = event.value as ProductListItem;
    if (product.isStockManaged) {
      this.toast.add({
        severity: 'warn',
        summary: $localize`:@@supplier-invoice-form.component.summary.Stock:Stock`,
        detail: $localize`:@@supplier-invoice-form.component.detail.Cet_article_est_:Cet article est géré en stock. Utilisez un bon de réception.`
      });
      line.product = null;
      line.productId = null;
      return;
    }
    line.product = product;
    line.productId = product.id;
    line.unitPriceHT = product.purchasePrice ?? product.unitPrice ?? 0;
    line.vatRate = product.vatRate ?? 19;
    this.recalculateTotals();
  }

  onQuickProductCreated(product: ProductListItem): void {
    if (product.isStockManaged) {
      this.toast.add({
        severity: 'warn',
        summary: $localize`:@@supplier-invoice-form.component.summary.Stock:Stock`,
        detail: $localize`:@@supplier-invoice-form.component.detail.L_article_cr_e:L’article créé est géré en stock et ne peut pas figurer sur une facture directe.`
      });
      return;
    }
    const empty = this.lines.find(l => !l.productId) ?? this.addEmptyAndReturn();
    empty.product = product;
    empty.productId = product.id;
    empty.unitPriceHT = product.purchasePrice ?? product.unitPrice ?? 0;
    empty.vatRate = product.vatRate ?? 19;
    this.recalculateTotals();
  }

  lineTotalHT(line: InvoiceLineRow): number {
    const discount = (line.discountPercent ?? 0) / 100;
    return line.quantity * line.unitPriceHT * (1 - discount);
  }

  recalculateTotals(): void {
    let ht = 0;
    let vat = 0;
    for (const line of this.lines) {
      const lineHt = this.lineTotalHT(line);
      ht += lineHt;
      vat += lineHt * ((line.vatRate ?? 0) / 100);
    }
    this.totalHT.set(ht);
    this.totalVat.set(vat);
    this.totalTTC.set(ht + vat);
  }

  submit(): void {
    if (!this.canSubmit() || !this.selectedSupplierId || !this.invoiceDate) return;
    this.submitting.set(true);

    const payload: CreateStandaloneSupplierInvoiceRequest = {
      supplierId: this.selectedSupplierId,
      invoiceNumber: this.invoiceNumber.trim() || undefined,
      invoiceDate: formatLocalDate(this.invoiceDate),
      paymentTermDays: this.paymentTermDays,
      externalReference: this.externalReference.trim() || undefined,
      notes: this.notes.trim() || undefined,
      paymentMethod: this.paymentMethod || undefined,
      warehouseId: this.selectedWarehouseId || undefined,
      useSuggestedNumber: this.useSuggestedNumber,
      lines: this.lines
        .filter(l => !!l.productId && l.quantity > 0)
        .map(l => ({
          productId: l.productId!,
          quantity: l.quantity,
          unitPriceHt: l.unitPriceHT,
          discountPercent: l.discountPercent || undefined,
          isFixedAsset: l.isFixedAsset || undefined,
          assetAccountNumber: l.isFixedAsset && l.assetAccountNumber.trim()
            ? l.assetAccountNumber.trim()
            : undefined
        }))
    };

    this.service.create(payload).subscribe({
      next: res => {
        this.submitting.set(false);
        if (!res.success || !res.data) {
          this.toast.add({ severity: 'error', summary: $localize`:@@supplier-invoice-form.component.summary.Erreur:Erreur`, detail: $localize`:@@supplier-invoice-form.component.detail.Cr_ation_impossi:Création impossible.` });
          return;
        }
        this.toast.add({
          severity: 'success',
          summary: $localize`:@@supplier-invoice-form.component.summary.Facture créé:Facture créée`,
          detail: $localize`:@@supplier-invoices.supplier-invoice-form.ts.invoicenumber.joignez.le.scan.a.l.ecritu.7975bf55:${res.data.invoiceNumber}:invoiceNumber: — joignez le scan à l’écriture comptable d’achat.`
        });
        void this.router.navigate(['/supplier-invoices', res.data.id]);
      },
      error: err => {
        this.submitting.set(false);
        this.toast.add({
          severity: 'error',
          summary: $localize`:@@supplier-invoice-form.component.summary.Erreur:Erreur`,
          detail: this.errors.extractErrorMessage(err)
        });
      }
    });
  }

  private loadSuppliers(): void {
    this.supplierService.getActiveSuppliers().subscribe({
      next: res => {
        if (res.success && res.data) this.suppliers.set(res.data.items);
      }
    });
  }

  private runProductSearch(query: string): void {
    this.productService.getProducts({ search: query || undefined, isActive: true, page: 1, pageSize: 50 }).subscribe({
      next: res => {
        const items = res.success && res.data ? res.data.items.filter(p => !p.isStockManaged) : [];
        this.productSuggestions.set(items);
      },
      error: () => this.productSuggestions.set([])
    });
  }

  private addEmptyAndReturn(): InvoiceLineRow {
    this.addLine();
    return this.lines[this.lines.length - 1];
  }

  private ensurePaymentTermOption(days: number): void {
    if (this.paymentTermOptions.some(o => o.value === days)) return;
    this.paymentTermOptions = [
      ...this.paymentTermOptions,
      { label: $localize`:@@pay.term.days:${days}:days: jours`, value: days }
    ];
  }

  /**
   * Scan d'un code-barres sur une facture fournisseur directe.
   *
   * Cet écran REFUSE les articles gérés en stock — ils doivent passer par un bon de réception,
   * seul document qui mouvemente le stock. Le scan applique la même règle que la sélection
   * manuelle : sans cela, la douchette deviendrait un moyen de contourner un garde-fou
   * comptable.
   */
  onBarcodeScanned(code: string): void {
    this.barcodeLookup.resolve(code).subscribe(result => {
      if (result.status !== 'found' || !result.product) {
        this.barcodeFeedback.report(result);
        return;
      }

      const product = result.product;

      if (product.isStockManaged) {
        this.barcodeFeedback.failure(
          $localize`:@@supplier-invoices.supplier-invoice-form.ts.cet.article.est.gere.en.stock.utilisez.u.1b1f4b8a:Cet article est géré en stock. Utilisez un bon de réception.`,
          $localize`:@@supplier-invoices.supplier-invoice-form.ts.stock.bcecf456:Stock`
        );
        return;
      }

      const existing = this.lines.find(l => l.productId === product.id);
      if (existing) {
        existing.quantity = (existing.quantity || 0) + 1;
      } else {
        const empty = this.lines.find(l => !l.productId) ?? this.addEmptyAndReturn();
        empty.product = product;
        empty.productId = product.id;
        empty.unitPriceHT = product.purchasePrice ?? product.unitPrice ?? 0;
        empty.vatRate = product.vatRate ?? 19;
      }

      this.recalculateTotals();
      this.barcodeFeedback.success(product.name);
    });
  }
}
