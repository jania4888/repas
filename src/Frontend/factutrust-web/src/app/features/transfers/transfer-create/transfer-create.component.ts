import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Subject, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, finalize, map, switchMap } from 'rxjs/operators';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { AutoCompleteModule, AutoCompleteCompleteEvent } from 'primeng/autocomplete';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { WarehouseSelectorComponent } from '@shared/components/warehouse-selector/warehouse-selector.component';
import { StockTransferService, CreateStockTransferRequest } from '@core/services/stock-transfer.service';
import { ProductService, ProductListItem } from '@core/services/product.service';
import { BarcodeScanFieldComponent } from '@shared/components/barcode-scan-field/barcode-scan-field.component';
import { BarcodeLookupService } from '@shared/services/barcode-lookup.service';
import { BarcodeFeedbackService } from '@shared/services/barcode-feedback.service';
import { environment } from '@environments/environment';
import { StockService } from '@core/services/stock.service';
import { MessageService, ConfirmationService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

interface TransferLine {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  requestedQuantity: number;
  notes: string;
}

@Component({
  selector: 'app-transfer-create',
  standalone: true,
  imports: [
    BarcodeScanFieldComponent,
    CommonModule,
    FormsModule,
    RouterModule,
    DatePickerModule,
    InputTextModule,
    Textarea,
    InputNumberModule,
    AutoCompleteModule,
    PageHeaderComponent,
    FormSectionComponent,
    ButtonComponent,
    WarehouseSelectorComponent,
    ToastModule,
    ConfirmDialogModule,
  ],
  providers: [MessageService, ConfirmationService],
  template: `
    <p-toast></p-toast>
    <p-confirmDialog></p-confirmDialog>
    <div class="page-container">
      <app-page-header
        title="Nouveau transfert"
        subtitle="Déplacez des articles d’un entrepôt vers un autre en quelques étapes.">
        <app-button variant="outline" icon="pi-times" iconPos="left" routerLink="/transfers">
          Annuler
        </app-button>
      </app-page-header>

      <app-form-section title="Entrepôts" icon="pi-building" [number]="1">
        <div class="warehouse-flow">
          <div class="warehouse-flow-item">
            <app-warehouse-selector
              inputId="transfer-wh-source"
              label="Entrepôt source"
              [required]="true"
              [activeOnly]="false"
              [value]="sourceWarehouseId"
              (valueChange)="onSourceWarehouseChange($event)">
            </app-warehouse-selector>
          </div>
          <div class="warehouse-flow-arrow" aria-hidden="true">
            <i class="pi pi-arrow-right"></i>
          </div>
          <div class="warehouse-flow-item">
            <app-warehouse-selector
              inputId="transfer-wh-destination"
              label="Entrepôt destination"
              [required]="true"
              [activeOnly]="false"
              [value]="destinationWarehouseId"
              (valueChange)="destinationWarehouseId = $event">
            </app-warehouse-selector>
          </div>
        </div>

        @if (sourceWarehouseId && destinationWarehouseId && sourceWarehouseId === destinationWarehouseId) {
          <div class="alert-banner alert-banner--warning" role="status">
            <i class="pi pi-exclamation-triangle alert-banner-icon" aria-hidden="true"></i>
            <div class="alert-banner-content">
              <div class="error-text">
                <p>
                  L’entrepôt source et l’entrepôt destination doivent être différents pour créer le transfert.
                </p>
              </div>
            </div>
          </div>
        }
      </app-form-section>

      <app-form-section title="Informations" icon="pi-info-circle" [number]="2">
        <div class="form-row">
          <div class="form-group">
            <label for="transfer-date">Date de transfert <span class="required">*</span></label>
            <p-datepicker
              inputId="transfer-date"
              [(ngModel)]="transferDate"
              dateFormat="dd/mm/yy"
              [showIcon]="true"
              styleClass="w-full">
            </p-datepicker>
          </div>
          <div class="form-group">
            <label for="transfer-reference">Référence</label>
            <input
              type="text"
              id="transfer-reference"
              pInputText
              [(ngModel)]="reference"
              placeholder="Référence optionnelle"
              class="w-full" />
          </div>
        </div>
        <div class="form-group">
          <label for="transfer-notes">Notes</label>
          <textarea
            id="transfer-notes"
            pTextarea
            [(ngModel)]="notes"
            [rows]="3"
            placeholder="Notes internes (optionnel)"
            class="w-full">
          </textarea>
        </div>
      </app-form-section>

      <app-form-section title="Produits à transférer" icon="pi-list" [number]="3">
        @if (sourceWarehouseId && stockLoading()) {
          <p class="stock-hint" role="status" aria-live="polite">Chargement des stocks de l'entrepôt source…</p>
        }

        <div class="line-add-panel">
          <div class="line-add">
            <div class="product-search-wrap form-group">
              <label for="transfer-product-search">Recherche produit</label>
              <p-autoComplete
                inputId="transfer-product-search"
                [(ngModel)]="selectedProduct"
                [suggestions]="productSuggestions()"
                (completeMethod)="onProductSearch($event)"
                field="name"
                [dropdown]="true"
                [forceSelection]="true"
                [minLength]="0"
                placeholder="Rechercher par nom ou code…"
                appendTo="body"
                [style]="{ width: '100%' }"
                [attr.aria-label]="'Rechercher un produit à ajouter au transfert'">
                <ng-template let-product pTemplate="item">
                  <div class="product-suggestion">
                    <div class="product-suggestion-main">
                      <span class="product-code">{{ product.code }}</span>
                      <span class="product-name">{{ product.name }}</span>
                    </div>
                    <div class="product-suggestion-meta">
                      <span class="product-unit">{{ product.unit || 'Unité' }}</span>
                      @if (!product.isStockManaged) {
                        <span class="badge-non-stock">Non géré en stock</span>
                      }
                      @if (sourceWarehouseId) {
                        <span class="product-dispo">Dispo source : {{ formatAvailability(product.id) }}</span>
                      }
                    </div>
                  </div>
                </ng-template>
                <ng-template pTemplate="empty">
                  <div class="product-empty">
                    @if (productsLoading()) {
                      <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
                      <span>Chargement des produits…</span>
                    } @else {
                      <span>Aucun produit ne correspond à votre recherche</span>
                    }
                  </div>
                </ng-template>
              </p-autoComplete>
            </div>
            <div class="qty-add form-group">
              <label for="transfer-qty-add">Quantité</label>
              <p-inputNumber
                inputId="transfer-qty-add"
                [(ngModel)]="selectedQuantity"
                [min]="0.001"
                [minFractionDigits]="0"
                [maxFractionDigits]="3"
                mode="decimal"
                placeholder="Qté"
                styleClass="qty-add-input"
                [style]="{ width: '120px' }">
              </p-inputNumber>
            </div>
            <div class="btn-add-wrap">
              <app-button
                type="button"
                variant="primary"
                icon="pi-plus"
                iconPos="left"
                (click)="addLine()"
                [disabled]="!selectedProduct || selectedQuantity <= 0"
                ariaLabel="Ajouter le produit sélectionné au transfert">
                Ajouter
              </app-button>
            </div>
          </div>

          @if (barcodeScanEnabled) {
            <div class="barcode-scan-row">
              <ft-barcode-scan-field
                placeholder="Scanner un code-barres pour ajouter une ligne"
                [autoFocus]="false"
                (scanned)="onBarcodeScanned($event)"></ft-barcode-scan-field>
            </div>
          }
        </div>

        @if (lines.length > 0) {
          <div class="lines-table-wrap">
            <table class="lines-table" [class.lines-table--with-dispo]="!!sourceWarehouseId">
              <colgroup>
                <col class="col-code" />
                <col class="col-product" />
                <col class="col-unit" />
                @if (sourceWarehouseId) {
                  <col class="col-dispo" />
                }
                <col class="col-qty" />
                <col class="col-notes" />
                <col class="col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th class="col-code">Code</th>
                  <th class="col-product">Produit</th>
                  <th class="col-unit">Unité</th>
                  @if (sourceWarehouseId) {
                    <th class="col-dispo">Dispo source</th>
                  }
                  <th class="col-qty">Quantité</th>
                  <th class="col-notes">Notes ligne</th>
                  <th class="col-actions"></th>
                </tr>
              </thead>
              <tbody>
                @for (line of lines; track line.productId; let i = $index) {
                  <tr>
                    <td class="col-code">{{ line.productCode }}</td>
                    <td class="col-product">{{ line.productName }}</td>
                    <td class="col-unit">{{ line.unit }}</td>
                    @if (sourceWarehouseId) {
                      <td class="col-dispo">{{ formatAvailability(line.productId) }}</td>
                    }
                    <td class="col-qty">
                      <div class="qty-cell">
                        <p-inputNumber
                          [(ngModel)]="line.requestedQuantity"
                          [ngModelOptions]="{ standalone: true }"
                          [min]="0.001"
                          [minFractionDigits]="0"
                          [maxFractionDigits]="3"
                          mode="decimal"
                          [style]="{ width: '100%', maxWidth: '120px' }"
                          [inputId]="'transfer-line-qty-' + i">
                        </p-inputNumber>
                        @if (qtyExceedsSource(line)) {
                          <span class="qty-warning" role="status">
                            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                            Dépasse la disponibilité
                          </span>
                        }
                      </div>
                    </td>
                    <td class="col-notes">
                      <input
                        type="text"
                        pInputText
                        [(ngModel)]="line.notes"
                        [ngModelOptions]="{ standalone: true }"
                        placeholder="Optionnel"
                        class="notes-input"
                        [attr.aria-label]="'Notes pour la ligne ' + line.productName" />
                    </td>
                    <td class="col-actions">
                      <app-button
                        type="button"
                        variant="danger"
                        size="sm"
                        icon="pi-trash"
                        [iconOnly]="true"
                        (click)="removeLine(i)"
                        [ariaLabel]="'Retirer ' + line.productName + ' du transfert'">
                      </app-button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <div class="empty-lines">
            <i class="pi pi-inbox" aria-hidden="true"></i>
            <p>Aucun produit ajouté. Recherchez un article, indiquez une quantité, puis cliquez sur « Ajouter ».</p>
          </div>
        }
      </app-form-section>

      <div class="form-actions">
        <app-button variant="outline" icon="pi-times" iconPos="left" (click)="cancel()">Annuler</app-button>
        <app-button
          variant="primary"
          [icon]="submitting() ? 'pi-spin pi-spinner' : 'pi-check'"
          iconPos="left"
          (click)="submit()"
          [disabled]="!canSubmit()">
          Créer le transfert
        </app-button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    :host ::ng-deep app-form-section {
      scroll-margin-top: var(--spacing-4, 1rem);
    }

    .page-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: var(--spacing-6, 1.5rem) 0;
    }

    .warehouse-flow {
      display: flex;
      align-items: flex-end;
      gap: var(--spacing-4, 1rem);
      flex-wrap: wrap;
      margin-bottom: var(--spacing-2, 0.5rem);
    }

    .warehouse-flow-item {
      flex: 1;
      min-width: min(100%, 220px);
    }

    .warehouse-flow-arrow {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      padding-bottom: var(--spacing-2, 0.5rem);
      color: var(--color-text-tertiary, #94a3b8);
      font-size: var(--font-size-xl, 1.25rem);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--spacing-4, 1rem);

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .stock-hint {
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--color-text-secondary, #64748b);
      margin: 0 0 var(--spacing-3, 0.75rem) 0;
    }

    .line-add-panel {
      padding: var(--spacing-4, 1rem);
      margin-bottom: var(--spacing-4, 1rem);
      background: var(--color-background-subtle, #f8fafc);
      border: 1px solid var(--color-border-subtle, #e2e8f0);
      border-radius: var(--radius-lg, 0.5rem);
    }

    .line-add {
      display: flex;
      gap: var(--spacing-3, 0.75rem);
      align-items: flex-end;
      flex-wrap: wrap;
      margin-bottom: 0;
    }

    .product-search-wrap {
      flex: 1;
      min-width: 200px;
      margin-bottom: 0;
    }

    .product-search-wrap.form-group {
      margin-bottom: 0;
    }

    .qty-add {
      flex-shrink: 0;
      margin-bottom: 0;
    }

    .qty-add.form-group {
      margin-bottom: 0;
    }

    .btn-add-wrap {
      flex-shrink: 0;
      padding-bottom: 2px;
    }

    .lines-table-wrap {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin-right: 0;
      padding-bottom: var(--spacing-1, 0.25rem);
    }

    .lines-table-wrap::-webkit-scrollbar {
      height: 6px;
    }

    .lines-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      min-width: 720px;
    }

    .lines-table col.col-code { width: 10%; }
    .lines-table col.col-product { width: 22%; }
    .lines-table col.col-unit { width: 8%; }
    .lines-table col.col-dispo { width: 10%; }
    .lines-table col.col-qty { width: 14%; }
    .lines-table col.col-notes { width: auto; }
    .lines-table col.col-actions { width: 48px; }

    .lines-table--with-dispo col.col-product { width: 20%; }
    .lines-table--with-dispo col.col-qty { width: 12%; }

    .lines-table th,
    .lines-table td {
      padding: var(--spacing-3, 0.75rem);
      text-align: left;
      border-bottom: 1px solid var(--color-border-subtle, #e2e8f0);
      vertical-align: middle;
      min-width: 0;
      overflow-wrap: break-word;
    }

    .lines-table th {
      font-size: var(--font-size-xs, 0.75rem);
      font-weight: var(--font-weight-semibold, 600);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--color-text-tertiary, #64748b);
      background: var(--color-background-subtle, #f8fafc);
    }

    .lines-table .col-notes {
      min-width: 0;
    }

    .lines-table .col-actions {
      width: 48px;
      text-align: center;
      padding-inline: var(--spacing-2, 0.5rem);
    }

    .lines-table .col-product {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .qty-cell {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-1, 0.25rem);
      min-height: 2.5rem;
      justify-content: center;
    }

    .notes-input {
      width: 100%;
      min-width: 0;
      max-width: none;
      box-sizing: border-box;
    }

    .qty-warning {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: var(--font-size-xs, 0.75rem);
      color: var(--color-warning-700, #b45309);
      line-height: 1.2;
      white-space: nowrap;
    }

    .qty-warning .pi {
      font-size: 0.7rem;
    }

    .empty-lines {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: var(--spacing-8, 2rem);
      color: var(--color-text-tertiary, #64748b);
      gap: var(--spacing-2, 0.5rem);
      text-align: center;
    }

    .empty-lines i {
      font-size: 2rem;
      opacity: 0.85;
    }

    .empty-lines p {
      margin: 0;
      font-size: var(--font-size-sm, 0.875rem);
      max-width: 28rem;
      line-height: 1.5;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-4, 1rem);
      margin-top: var(--spacing-8, 2rem);
      padding-top: var(--spacing-6, 1.5rem);
      border-top: 1px solid var(--color-border-subtle, #e2e8f0);
      flex-wrap: wrap;
    }

    .product-suggestion {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.125rem 0;
    }

    .product-suggestion-main {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      align-items: baseline;
    }

    .product-code {
      font-weight: 600;
      color: var(--color-text-primary, #0f172a);
    }

    .product-name {
      color: var(--color-text-secondary, #475569);
    }

    .product-suggestion-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      font-size: 0.75rem;
      color: var(--color-text-tertiary, #64748b);
    }

    .badge-non-stock {
      background: #fef3c7;
      color: #92400e;
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-weight: 500;
    }

    .product-dispo {
      font-weight: 500;
    }

    .product-empty {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      color: var(--color-text-tertiary, #64748b);
      font-size: 0.875rem;
    }

    // Les champs natifs du bandeau « Informations » ne sont PAS couverts par les
    // règles ::ng-deep ci-dessous : ils vivent dans ce template, pas dans un composant
    // enfant. Sans cette règle ils restent à leur largeur intrinsèque (~185 px) pendant
    // que les widgets PrimeNG voisins occupent toute la colonne — les « class="w-full" »
    // posées sur eux ne portent rien (Tailwind est préfixé « tw- », cf. tailwind.config.js).
    // Le sélecteur enfant direct laisse volontairement de côté « .notes-input » des
    // cellules de lignes, qui a sa propre largeur.
    .form-group > input[pInputText],
    .form-group > textarea[pTextarea] {
      width: 100%;
    }

    :host ::ng-deep .product-search-wrap .p-autocomplete {
      width: 100%;
    }

    :host ::ng-deep .qty-add .p-inputnumber,
    :host ::ng-deep .qty-add .p-inputnumber .p-inputtext {
      width: 120px;
    }

    :host ::ng-deep .lines-table p-inputnumber,
    :host ::ng-deep .lines-table p-inputnumber .p-inputnumber,
    :host ::ng-deep .lines-table p-inputnumber .p-inputtext {
      width: 100%;
      max-width: 120px;
    }

    :host ::ng-deep .lines-table .p-inputnumber-input {
      text-align: right;
    }

    :host ::ng-deep .p-datepicker {
      display: flex;
      width: 100%;
    }

    :host ::ng-deep .p-datepicker .p-inputtext {
      flex: 1;
      min-width: 0;
    }

    @media (max-width: 768px) {
      .page-container {
        padding: var(--spacing-4, 1rem) 0;
      }

      .warehouse-flow {
        flex-direction: column;
        align-items: stretch;
      }

      .warehouse-flow-arrow {
        transform: rotate(90deg);
        padding: var(--spacing-1, 0.25rem) 0;
      }

      .line-add {
        flex-direction: column;
        align-items: stretch;
      }

      .qty-add {
        width: 100%;
      }

      :host ::ng-deep .qty-add .p-inputnumber,
      :host ::ng-deep .qty-add .p-inputnumber .p-inputtext {
        width: 100%;
      }

      .btn-add-wrap {
        align-self: flex-start;
        padding-bottom: 0;
      }

      .lines-table {
        min-width: 560px;
      }

      .form-actions {
        justify-content: stretch;
      }

      .form-actions app-button {
        flex: 1;
      }
    }
  `],
})
export class TransferCreateComponent implements OnInit {
  private transferService = inject(StockTransferService);
  private productService = inject(ProductService);
  private stockService = inject(StockService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private readonly barcodeLookup = inject(BarcodeLookupService);
  private readonly barcodeFeedback = inject(BarcodeFeedbackService);
  readonly barcodeScanEnabled = environment.featureFlags?.barcodeScanOnDocuments === true;

  private readonly productSearch$ = new Subject<string>();
  private readonly stockPageSize = 1000;

  productSuggestions = signal<ProductListItem[]>([]);
  productsLoading = signal(false);
  submitting = signal(false);
  stockLoading = signal(false);
  /** quantityAvailable at source warehouse by productId */
  sourceStockByProductId = signal<Map<string, number>>(new Map());

  sourceWarehouseId: string | null = null;
  destinationWarehouseId: string | null = null;
  transferDate: Date = new Date();
  reference = '';
  notes = '';

  selectedProduct: ProductListItem | null = null;
  selectedQuantity = 1;
  lines: TransferLine[] = [];

  ngOnInit(): void {
    this.productSearch$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          this.productsLoading.set(true);
          return this.productService
            .getProducts({
              search: query.trim() || undefined,
              isActive: true,
              page: 1,
              pageSize: 50,
            })
            .pipe(
              catchError(() => {
                this.productsLoading.set(false);
                this.messageService.add({
                  severity: 'error',
                  summary: 'Produits',
                  detail: 'Impossible de charger les produits',
                });
                return of({ success: false as const, data: undefined });
              })
            );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((res) => {
        this.productsLoading.set(false);
        if (res.success && res.data?.items) {
          this.productSuggestions.set(res.data.items);
        } else {
          this.productSuggestions.set([]);
        }
      });
  }

  onSourceWarehouseChange(id: string | null): void {
    this.sourceWarehouseId = id;
    this.loadSourceStock();
  }

  onProductSearch(event: AutoCompleteCompleteEvent): void {
    this.productSearch$.next(event.query ?? '');
  }

  formatAvailability(productId: string): string {
    if (!this.sourceWarehouseId) {
      return '—';
    }
    if (this.stockLoading()) {
      return '…';
    }
    const q = this.sourceStockByProductId().get(productId);
    if (q === undefined) {
      return '—';
    }
    return Number.isInteger(q) ? String(q) : q.toLocaleString('fr-FR', { maximumFractionDigits: 3 });
  }

  qtyExceedsSource(line: TransferLine): boolean {
    if (!this.sourceWarehouseId || this.stockLoading()) {
      return false;
    }
    const avail = this.sourceStockByProductId().get(line.productId);
    if (avail === undefined) {
      return false;
    }
    return line.requestedQuantity > avail;
  }

  addLine(): void {
    const product = this.selectedProduct;
    if (!product || this.selectedQuantity <= 0) return;
    if (this.lines.some((l) => l.productId === product.id)) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Attention',
        detail: 'Ce produit est déjà dans la liste',
      });
      return;
    }

    this.lines.push({
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      unit: product.unit || 'Unité',
      requestedQuantity: this.selectedQuantity,
      notes: '',
    });
    this.selectedProduct = null;
    this.selectedQuantity = 1;
  }

  removeLine(index: number): void {
    const line = this.lines[index];
    if (!line) return;
    this.confirmationService.confirm({
      header: 'Retirer la ligne',
      message: `Retirer « ${line.productName} » de ce transfert ?`,
      icon: 'pi pi-trash',
      acceptLabel: 'Retirer',
      rejectLabel: 'Annuler',
      acceptButtonStyleClass: 'btn-danger',
      accept: () => this.lines.splice(index, 1),
    });
  }

  canSubmit(): boolean {
    const linesOk =
      this.lines.length > 0 &&
      this.lines.every((l) => l.requestedQuantity > 0);
    return (
      !!this.sourceWarehouseId &&
      !!this.destinationWarehouseId &&
      this.sourceWarehouseId !== this.destinationWarehouseId &&
      linesOk &&
      !this.submitting()
    );
  }

  submit(): void {
    if (!this.canSubmit()) return;

    const request: CreateStockTransferRequest = {
      sourceWarehouseId: this.sourceWarehouseId!,
      destinationWarehouseId: this.destinationWarehouseId!,
      transferDate: this.formatDate(this.transferDate),
      reference: this.reference || undefined,
      notes: this.notes || undefined,
      lines: this.lines.map((l) => ({
        productId: l.productId,
        requestedQuantity: l.requestedQuantity,
        notes: l.notes?.trim() || undefined,
      })),
    };

    this.submitting.set(true);
    this.transferService.createStockTransfer(request).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.messageService.add({ severity: 'success', summary: 'Succès', detail: 'Transfert créé avec succès' });
        this.router.navigate(['/transfers', res.data?.id || '']);
      },
      error: (err) => {
        this.submitting.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Erreur',
          detail: err.error?.error || 'Erreur lors de la création',
        });
      },
    });
  }

  cancel(): void {
    this.router.navigate(['/transfers']);
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private loadSourceStock(): void {
    const wid = this.sourceWarehouseId;
    if (!wid) {
      this.sourceStockByProductId.set(new Map());
      this.stockLoading.set(false);
      return;
    }

    this.stockLoading.set(true);
    this.stockService
      .getStockItems(wid, undefined, undefined, 1, this.stockPageSize)
      .pipe(
        switchMap((firstRes) => {
          if (!firstRes.success || !firstRes.data) {
            return of(new Map<string, number>());
          }
          const first = firstRes.data;
          const merged = new Map<string, number>();
          for (const it of first.items) {
            merged.set(it.productId, it.quantityAvailable);
          }
          const totalPages = Math.max(1, Math.ceil(first.totalCount / this.stockPageSize));
          if (totalPages <= 1) {
            return of(merged);
          }
          const pageRequests = [];
          for (let p = 2; p <= totalPages; p++) {
            pageRequests.push(this.stockService.getStockItems(wid, undefined, undefined, p, this.stockPageSize));
          }
          return forkJoin(pageRequests).pipe(
            map((results) => {
              for (const r of results) {
                if (r.success && r.data?.items) {
                  for (const it of r.data.items) {
                    merged.set(it.productId, it.quantityAvailable);
                  }
                }
              }
              return merged;
            }),
            catchError(() => of(merged))
          );
        }),
        catchError(() => {
          this.messageService.add({
            severity: 'warn',
            summary: 'Stock',
            detail: 'Impossible de charger les quantités de l’entrepôt source',
          });
          return of(new Map<string, number>());
        }),
        finalize(() => this.stockLoading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((map) => this.sourceStockByProductId.set(map));
  }

  /**
   * Scan d'un code-barres sur un transfert inter-dépôts.
   *
   * Seuls les articles gérés en stock sont recevables : on ne transfère pas un service. La
   * disponibilité est évaluée sur l'entrepôt SOURCE, celui d'où part la marchandise, et reste
   * un avertissement — l'écran affiche déjà « Supérieur au disponible » sans bloquer.
   */
  onBarcodeScanned(code: string): void {
    this.barcodeLookup
      .resolve(code, { requireStockManaged: true, warehouseId: this.sourceWarehouseId })
      .subscribe(result => {
        if (result.status !== 'found' || !result.product) {
          this.barcodeFeedback.report(result);
          return;
        }

        const product = result.product;
        const existing = this.lines.find(l => l.productId === product.id);

        if (existing) {
          existing.requestedQuantity = (existing.requestedQuantity || 0) + 1;
        } else {
          this.selectedProduct = product;
          this.selectedQuantity = 1;
          this.addLine();
        }

        this.barcodeFeedback.success(product.name);
      });
  }
}
