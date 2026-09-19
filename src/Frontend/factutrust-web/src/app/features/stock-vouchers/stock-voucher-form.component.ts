import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, finalize, map, switchMap } from 'rxjs/operators';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { AutoCompleteCompleteEvent, AutoCompleteModule } from 'primeng/autocomplete';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { WarehouseSelectorComponent } from '@shared/components/warehouse-selector/warehouse-selector.component';
import { StockAllocationEditorComponent } from '@shared/components/stock-allocation-editor/stock-allocation-editor.component';
import {
  AllocationRow,
  buildAllocationPayload,
  buildExitAllocationPayload,
  showLotSection,
  showSerialSection,
  createDefaultLotRow,
  createDefaultSerialRow,
  coercePickingPolicy,
  coerceTrackingMode,
  TRACKING_MODE_SERIAL
} from '@shared/utils/stock-traceability.utils';
import { StockFeatures } from '@core/services/stock.service';
import { ProductListItem, ProductService } from '@core/services/product.service';
import { BarcodeScanFieldComponent } from '@shared/components/barcode-scan-field/barcode-scan-field.component';
import { BarcodeLookupService } from '@shared/services/barcode-lookup.service';
import { BarcodeFeedbackService } from '@shared/services/barcode-feedback.service';
import { environment } from '@environments/environment';
import { StockService } from '@core/services/stock.service';
import { WarehouseContextService } from '@core/services/warehouse-context.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { formatLocalDate } from '@core/utils/date.util';
import {
  CreateStockVoucherRequest,
  StockVoucherKindName,
  StockVoucherLineAllocations,
  StockVoucherLineDto,
  StockVoucherService,
  UpdateStockVoucherRequest,
  isStockVoucherDraft,
  movementReasonName
} from '@core/services/stock-voucher.service';

interface ProductSearchRequest {
  query: string;
  warehouseId: string | null;
  seq: number;
}

interface VoucherLine {
  id: string | null;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitCost: number;
  notes: string;
  lotAllocations: AllocationRow[];
  trackingMode?: number;
  pickingPolicy?: number;
  hasExpiryTracking?: boolean;
}

@Component({
  selector: 'app-stock-voucher-form',
  standalone: true,
  imports: [
    BarcodeScanFieldComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    CurrencyPipe,
    DatePickerModule,
    InputTextModule,
    Textarea,
    InputNumberModule,
    SelectModule,
    AutoCompleteModule,
    ToastModule,
    TooltipModule,
    PageHeaderComponent,
    FormSectionComponent,
    ButtonComponent,
    BreadcrumbComponent,
    WarehouseSelectorComponent,
    StockAllocationEditorComponent
  ],
  providers: [MessageService],
  templateUrl: './stock-voucher-form.component.html',
  styleUrls: ['./stock-voucher-form.component.scss']
})
export class StockVoucherFormComponent implements OnInit {
  private voucherService = inject(StockVoucherService);
  private productService = inject(ProductService);
  private stockService = inject(StockService);
  private warehouseContext = inject(WarehouseContextService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private messageService = inject(MessageService);
  private errorHandler = inject(ErrorHandlerService);
  private destroyRef = inject(DestroyRef);
  private readonly barcodeLookup = inject(BarcodeLookupService);
  private readonly barcodeFeedback = inject(BarcodeFeedbackService);
  readonly barcodeScanEnabled = environment.featureFlags?.barcodeScanOnDocuments === true;
  private productSearchSeq = 0;
  private readonly productSearch$ = new Subject<ProductSearchRequest>();

  readonly isEntry = (this.route.snapshot.data['kind'] as StockVoucherKindName) !== 'Issue';
  readonly kind: StockVoucherKindName = this.isEntry ? 'Entry' : 'Issue';
  readonly listRoute = this.isEntry ? '/stock/entries' : '/stock/issues';
  readonly pageTitle = this.route.snapshot.paramMap.get('id')
    ? (this.isEntry ? 'Modifier le bon d’entrée' : 'Modifier le bon de sortie')
    : (this.isEntry ? 'Nouveau bon d’entrée' : 'Nouveau bon de sortie');
  readonly pageSubtitle = this.isEntry
    ? 'Le stock n’est mis à jour qu’à la validation.'
    : 'La sortie est refusée si la quantité dépasse le disponible.';

  breadcrumbItems: BreadcrumbItem[] = [];
  editId: string | null = null;
  warehouseId: string | null = null;
  voucherDate: Date = new Date();
  reason = this.isEntry ? 'InitialStock' : 'Damage';
  externalReference = '';
  notes = '';
  lines: VoucherLine[] = [];
  selectedProduct: ProductListItem | null = null;
  selectedQuantity = 1;
  selectedUnitCost = 0;
  submitting = signal(false);
  productsLoading = signal(false);
  productSuggestions = signal<ProductListItem[]>([]);
  stockByProductId = signal<Map<string, { qty: number; avgCost: number }>>(new Map());
  stockFeatures = signal<StockFeatures | null>(null);
  traceabilityByProduct = signal<Map<string, { trackingMode: number; pickingPolicy: number; hasExpiryTracking: boolean }>>(new Map());

  readonly reasonOptions = this.isEntry
    ? [
        { label: 'Stock initial', value: 'InitialStock' },
        { label: 'Retour client (hors BRT / avoir)', value: 'CustomerReturn' },
        { label: 'Achat hors réception', value: 'Purchase' },
        { label: 'Trouvé / autre', value: 'FoundOrOther' }
      ]
    : [
        { label: 'Dommage / perte', value: 'Damage' },
        { label: 'Retour fournisseur (hors flux achat)', value: 'SupplierReturn' },
        { label: 'Consommation interne', value: 'InternalUse' },
        { label: 'Don / échantillon', value: 'GiftOrSample' }
      ];

  get totalQuantity(): number {
    return this.lines.reduce((acc, l) => acc + (l.quantity || 0), 0);
  }

  get totalValue(): number {
    return this.lines.reduce((acc, l) => acc + (l.quantity || 0) * (l.unitCost || 0), 0);
  }

  ngOnInit(): void {
    this.editId = this.route.snapshot.paramMap.get('id');
    this.breadcrumbItems = [
      { label: 'Tableau de bord', route: '/dashboard', icon: 'pi-home' },
      { label: 'Stock', route: '/stock' },
      { label: this.isEntry ? "Bons d'entrée" : 'Bons de sortie', route: this.listRoute },
      { label: this.editId ? 'Modifier' : 'Nouveau' }
    ];

    this.stockService.getFeatures().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: res => {
        if (res.success && res.data) this.stockFeatures.set(res.data);
      }
    });

    this.productSearch$
      .pipe(
        debounceTime(300),
        switchMap(({ query, warehouseId }) => {
          this.productsLoading.set(true);
          return this.productService.getProducts({
            search: query.trim() || undefined,
            isActive: true,
            page: 1,
            pageSize: 50,
            warehouseId: warehouseId ?? undefined
          }).pipe(
            catchError(() => {
              this.messageService.add({
                severity: 'error',
                summary: 'Produits',
                detail: 'Impossible de charger les produits'
              });
              return of({ success: false as const, data: undefined });
            }),
            finalize(() => this.productsLoading.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((res) => {
        const items = res.success && res.data?.items ? res.data.items.filter(p => p.isStockManaged) : [];
        this.productSuggestions.set([...items]);
      });

    if (this.editId) {
      this.loadExisting(this.editId);
    } else {
      this.warehouseId = this.warehouseContext.selectedWarehouseId();
      if (this.warehouseId) this.loadStock();
    }
  }

  onWarehouseChange(id: string | null): void {
    this.warehouseId = id;
    this.productSuggestions.set([]);
    this.loadStock();
    this.loadTraceabilityContext();
  }

  showLineTraceability(line: VoucherLine): boolean {
    const f = this.stockFeatures();
    if (!f || !this.warehouseId) return false;
    const mode = line.trackingMode ?? 0;
    return showLotSection(mode, f) || showSerialSection(mode, f);
  }

  private loadTraceabilityContext(): void {
    if (!this.warehouseId || this.lines.length === 0) return;
    const productIds = this.lines.map(l => l.productId);
    this.stockService.getTraceabilityContext(productIds, this.warehouseId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => {
        if (!res.success || !res.data) return;
        const map = new Map(this.traceabilityByProduct());
        for (const ctx of res.data) {
          map.set(ctx.productId, {
            trackingMode: coerceTrackingMode(ctx.trackingMode),
            pickingPolicy: coercePickingPolicy(ctx.pickingPolicy),
            hasExpiryTracking: !!ctx.hasExpiryTracking
          });
        }
        this.traceabilityByProduct.set(map);
        for (const line of this.lines) {
          const ctx = map.get(line.productId);
          if (ctx) {
            line.trackingMode = ctx.trackingMode;
            line.pickingPolicy = ctx.pickingPolicy;
            line.hasExpiryTracking = ctx.hasExpiryTracking;
          }
        }
      });
  }

  private defaultAllocationsForLine(product: ProductListItem, quantity: number): AllocationRow[] {
    const mode = coerceTrackingMode(product.trackingMode);
    if (mode === TRACKING_MODE_SERIAL) {
      const count = Math.max(1, Math.round(quantity));
      return Array.from({ length: count }, () => createDefaultSerialRow());
    }
    return [createDefaultLotRow(quantity)];
  }

  onProductSearch(event: AutoCompleteCompleteEvent): void {
    this.productSearch$.next({
      query: event.query ?? '',
      warehouseId: this.warehouseId,
      seq: ++this.productSearchSeq
    });
  }

  addLine(): void {
    const product = this.selectedProduct;
    if (!product || this.selectedQuantity <= 0) return;
    if (!product.isStockManaged) {
      this.messageService.add({ severity: 'warn', summary: 'Produit', detail: 'Seuls les produits gérés en stock sont autorisés.' });
      return;
    }
    if (this.lines.some(l => l.productId === product.id)) {
      this.messageService.add({ severity: 'warn', summary: 'Attention', detail: 'Ce produit est déjà sur le bon.' });
      return;
    }
    const stock = this.stockByProductId().get(product.id);
    const unitCost = this.isEntry
      ? (this.selectedUnitCost || product.lastPurchasePrice || product.purchasePrice || product.weightedAverageCost || 0)
      : (stock?.avgCost ?? product.weightedAverageCost ?? product.lastPurchasePrice ?? 0);
    this.lines.push({
      id: null,
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      unit: product.unit || 'Unité',
      quantity: this.selectedQuantity,
      unitCost,
      notes: '',
      trackingMode: coerceTrackingMode(product.trackingMode),
      pickingPolicy: this.traceabilityByProduct().get(product.id)?.pickingPolicy ?? 0,
      hasExpiryTracking: this.traceabilityByProduct().get(product.id)?.hasExpiryTracking ?? false,
      lotAllocations: this.defaultAllocationsForLine(product, this.selectedQuantity)
    });
    this.loadTraceabilityContext();
    this.selectedProduct = null;
    this.selectedQuantity = 1;
    this.selectedUnitCost = 0;
  }

  removeLine(index: number): void {
    this.lines.splice(index, 1);
  }

  addLotAllocation(line: VoucherLine): void {
    line.lotAllocations.push({ lotNumber: '', expiryDate: null, quantity: 0 });
  }

  removeLotAllocation(lineIndex: number, allocIndex: number): void {
    const line = this.lines[lineIndex];
    if (!line || line.lotAllocations.length <= 1) return;
    line.lotAllocations.splice(allocIndex, 1);
  }

  private buildLotAllocations(serverLines: StockVoucherLineDto[]): StockVoucherLineAllocations[] | undefined {
    const payload: StockVoucherLineAllocations[] = [];
    this.lines.forEach((line, i) => {
      const lineId = line.id || serverLines[i]?.id;
      const allocations = this.isEntry
        ? buildAllocationPayload(line.lotAllocations ?? [])
        : buildExitAllocationPayload(line.lotAllocations ?? []);
      if (lineId && allocations.length > 0) {
        payload.push({ lineId, allocations });
      }
    });
    return payload.length > 0 ? payload : undefined;
  }

  private hasTrackedLines(): boolean {
    const f = this.stockFeatures();
    if (!f) return false;
    return this.lines.some(l => this.showLineTraceability(l));
  }

  formatAvailability(productId: string): string {
    const q = this.stockByProductId().get(productId)?.qty;
    return q == null ? '—' : q.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
  }

  formatAverageCost(productId: string): number {
    return this.stockByProductId().get(productId)?.avgCost ?? 0;
  }

  qtyExceedsAvailable(line: VoucherLine): boolean {
    const avail = this.stockByProductId().get(line.productId)?.qty;
    return avail != null && line.quantity > avail;
  }

  hasWarehouse(): boolean {
    return !!this.warehouseId;
  }

  hasDate(): boolean {
    return !!this.voucherDate;
  }

  hasReason(): boolean {
    return !!this.reason;
  }

  hasLines(): boolean {
    return this.lines.length > 0;
  }

  scrollToLines(): void {
    document.getElementById('section-lignes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  submitBlockers(): string[] {
    const blockers: string[] = [];
    if (!this.hasWarehouse()) blockers.push('Sélectionnez un dépôt');
    if (!this.hasDate()) blockers.push('Indiquez la date');
    if (!this.hasReason()) blockers.push('Sélectionnez un motif');
    if (!this.hasLines()) blockers.push('Ajoutez au moins une ligne produit');
    if (this.submitting()) blockers.push('Enregistrement en cours');
    return blockers;
  }

  submitBlockersTooltip(): string {
    const blockers = this.submitBlockers();
    return blockers.length > 0 ? blockers.join(' · ') : '';
  }

  canSubmit(): boolean {
    return !!this.warehouseId && !!this.reason && this.lines.length > 0
      && this.lines.every(l => l.quantity > 0 && l.unitCost >= 0) && !this.submitting();
  }

  cancel(): void {
    void this.router.navigate([this.listRoute]);
  }

  save(andValidate: boolean): void {
    if (!this.canSubmit() || !this.warehouseId) return;
    if (andValidate && !this.isEntry && this.lines.some(l => this.qtyExceedsAvailable(l))) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Stock insuffisant',
        detail: 'Une quantité dépasse le disponible. Ajustez les lignes avant validation.'
      });
      return;
    }

    const payloadLines = this.lines.map(l => ({
      productId: l.productId,
      quantity: l.quantity,
      unitCost: this.isEntry ? l.unitCost : l.unitCost,
      notes: l.notes?.trim() || undefined
    }));

    this.submitting.set(true);
    if (this.editId) {
      const request: UpdateStockVoucherRequest = {
        voucherDate: formatLocalDate(this.voucherDate),
        warehouseId: this.warehouseId,
        reason: this.reason,
        externalReference: this.externalReference || undefined,
        notes: this.notes || undefined,
        lines: payloadLines
      };
      this.voucherService.update(this.editId, request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => this.afterSave(this.editId!, andValidate),
        error: (err) => this.onSaveError(err)
      });
    } else {
      const request: CreateStockVoucherRequest = {
        kind: this.kind,
        voucherDate: formatLocalDate(this.voucherDate),
        warehouseId: this.warehouseId,
        reason: this.reason,
        externalReference: this.externalReference || undefined,
        notes: this.notes || undefined,
        lines: payloadLines
      };
      this.voucherService.create(request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (res) => {
          const id = res.data;
          if (!id) {
            this.submitting.set(false);
            return;
          }
          this.afterSave(id, andValidate);
        },
        error: (err) => this.onSaveError(err)
      });
    }
  }

  private afterSave(id: string, andValidate: boolean): void {
    if (!andValidate) {
      this.submitting.set(false);
      this.messageService.add({ severity: 'success', summary: 'Enregistré', detail: 'Brouillon enregistré.' });
      void this.router.navigate([this.listRoute, id]);
      return;
    }
    const validate$ = this.hasTrackedLines()
      ? this.voucherService.getStockVoucher(id).pipe(
          map(res => this.buildLotAllocations(res.data?.lines ?? [])),
          switchMap(alloc => this.voucherService.validate(id, alloc))
        )
      : this.voucherService.validate(id);
    validate$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.submitting.set(false);
        this.messageService.add({ severity: 'success', summary: 'Validé', detail: 'Le stock a été mis à jour.' });
        void this.router.navigate([this.listRoute, id]);
      },
      error: (err) => {
        this.submitting.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Enregistré, validation refusée',
          detail: this.errorHandler.extractErrorMessage(err)
        });
        void this.router.navigate([this.listRoute, id]);
      }
    });
  }

  private onSaveError(err: unknown): void {
    this.submitting.set(false);
    this.messageService.add({
      severity: 'error',
      summary: 'Erreur',
      detail: this.errorHandler.extractErrorMessage(err)
    });
  }

  private loadExisting(id: string): void {
    this.voucherService.getStockVoucher(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        const v = res.data;
        if (!v || !isStockVoucherDraft(v.status)) {
          this.messageService.add({ severity: 'warn', summary: 'Lecture seule', detail: 'Seuls les brouillons sont modifiables.' });
          void this.router.navigate([this.listRoute, id]);
          return;
        }
        this.warehouseId = v.warehouseId;
        this.voucherDate = new Date(v.voucherDate);
        this.reason = movementReasonName(v.reason);
        this.externalReference = v.externalReference ?? '';
        this.notes = v.notes ?? '';
        this.lines = v.lines.map(l => ({
          id: l.id,
          productId: l.productId,
          productCode: l.productCode,
          productName: l.productName,
          unit: l.unit || 'Unité',
          quantity: l.quantity,
          unitCost: l.unitCost,
          notes: l.notes ?? '',
          lotAllocations: [{ lotNumber: '', expiryDate: null, quantity: l.quantity }]
        }));
        this.loadStock();
        this.loadTraceabilityContext();
      },
      error: (err) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: this.errorHandler.extractErrorMessage(err)
        });
        void this.router.navigate([this.listRoute]);
      }
    });
  }

  private loadStock(): void {
    const wid = this.warehouseId;
    if (!wid) {
      this.stockByProductId.set(new Map());
      return;
    }
    this.stockService.getStockItems(wid, undefined, undefined, 1, 1000).pipe(
      switchMap((firstRes) => {
        const merged = new Map<string, { qty: number; avgCost: number }>();
        if (!firstRes.success || !firstRes.data) return of(merged);
        for (const it of firstRes.data.items) {
          merged.set(it.productId, { qty: it.quantityAvailable, avgCost: it.averageCost });
        }
        const totalPages = Math.max(1, Math.ceil(firstRes.data.totalCount / 1000));
        if (totalPages <= 1) return of(merged);
        const rest = [];
        for (let p = 2; p <= totalPages; p++) {
          rest.push(this.stockService.getStockItems(wid, undefined, undefined, p, 1000));
        }
        return forkJoin(rest).pipe(map((results) => {
          for (const r of results) {
            if (r.success && r.data?.items) {
              for (const it of r.data.items) {
                merged.set(it.productId, { qty: it.quantityAvailable, avgCost: it.averageCost });
              }
            }
          }
          return merged;
        }));
      }),
      catchError(() => of(new Map<string, { qty: number; avgCost: number }>())),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((mapValue) => this.stockByProductId.set(mapValue));
  }

  /**
   * Scan d'un code-barres sur un bon d'entrée ou de sortie.
   *
   * Un bon de stock ne peut porter que des articles GÉRÉS EN STOCK : un service scanné est
   * refusé, comme il l'est déjà à la sélection manuelle. La douchette ne doit jamais servir à
   * contourner ce garde-fou, sous peine d'un mouvement de stock sur un article qui n'en a pas.
   *
   * Un article déjà présent voit sa quantité augmenter — le même geste que modifier la
   * quantité à la main, ce que l'écran autorise déjà, allocations de lots comprises.
   */
  onBarcodeScanned(code: string): void {
    this.barcodeLookup
      .resolve(code, { requireStockManaged: true, warehouseId: this.warehouseId })
      .subscribe(result => {
        if (result.status !== 'found' || !result.product) {
          this.barcodeFeedback.report(result);
          return;
        }

        const product = result.product;
        const existing = this.lines.find(l => l.productId === product.id);

        if (existing) {
          existing.quantity = (existing.quantity || 0) + 1;
        } else {
          this.selectedProduct = product;
          this.selectedQuantity = 1;
          this.addLine();
        }

        this.barcodeFeedback.success(product.name);
      });
  }
}
