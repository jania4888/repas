import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { DatePickerModule } from 'primeng/datepicker';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { PageHeaderComponent } from '@shared/components/page-header/page-header.component';
import { BreadcrumbComponent, BreadcrumbItem } from '@shared/components/breadcrumb/breadcrumb.component';
import { ButtonComponent } from '@shared/components/button/button.component';
import { FormSectionComponent } from '@shared/components/form-section/form-section.component';
import { SalesOrderService, CreateSalesOrderLineRequest } from '@core/services/sales-order.service';
import { PriceSource } from '@core/services/pricing.service';
import { DocumentLinePricingService, EMPTY_LINE_PROMOTION, LinePromotionPreview, lineTotalWithPromotion, mapResolvedPricePromotion } from '@shared/utils/document-line-pricing.helper';
import { ClientService } from '@core/services/client.service';
import { ProductService } from '@core/services/product.service';
import { BarcodeScanFieldComponent } from '@shared/components/barcode-scan-field/barcode-scan-field.component';
import { BarcodeLookupService } from '@shared/services/barcode-lookup.service';
import { BarcodeFeedbackService } from '@shared/services/barcode-feedback.service';
import { environment } from '@environments/environment';
import { ToastService } from '@core/services/toast.service';
import { ErrorHandlerService } from '@core/services/error-handler.service';
import { formatLocalDate } from '@core/utils/date.util';

interface ClientOption {
  id: string;
  label: string;
}

interface ProductOption {
  id: string;
  code: string;
  name: string;
  label: string;
  unitPrice: number;
}

interface DraftLine extends LinePromotionPreview {
  product: ProductOption;
  quantity: number;
  unitPrice: number;
  discountPercent: number | null;
  notes: string | null;
  priceSource: PriceSource | null;
  priceOverridden: boolean;
}

@Component({
  selector: 'app-sales-order-create',
  standalone: true,
  imports: [
    BarcodeScanFieldComponent,
    CommonModule,
    RouterModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    Textarea,
    InputNumberModule,
    AutoCompleteModule,
    DatePickerModule,
    TagModule,
    TooltipModule,
    PageHeaderComponent,
    BreadcrumbComponent,
    ButtonComponent,
    FormSectionComponent
  ],
  template: `
    <app-breadcrumb [items]="breadcrumbItems"></app-breadcrumb>

    <app-page-header
      title="Nouvelle commande client" i18n-title="Nouvelle commande client"
      subtitle="Les prix sont ceux que le serveur appliquera : prix négocié, grille du client, ou catalogue.">
      <app-button variant="secondary" routerLink="/sales-orders" i18n="@@sales-orders.sales-order-create.annuler.49ba3292">Annuler</app-button>
      <span
        class="create-btn-wrap"
        [pTooltip]="submitBlockersTooltip()"
        [tooltipDisabled]="canSubmit() || saving()"
        tooltipPosition="bottom">
        <app-button
          variant="primary"
          [disabled]="!canSubmit() || saving() || linePricing.resolving()"
          [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
          iconPos="left"
          (clicked)="submit()">
          {{ saving() ? 'Création…' : 'Créer la commande' }}
        </app-button>
      </span>
    </app-page-header>

    <div class="submit-readiness" role="status" aria-live="polite">
      <p class="submit-readiness__title" i18n="@@sales-orders.sales-order-create.etapes.pour.creer.la.commande.b75927d0">Étapes pour créer la commande</p>
      <ul class="submit-readiness__list">
        <li [class.submit-readiness__item--done]="hasClient()">
          <i class="pi" [class.pi-check-circle]="hasClient()" [class.pi-circle]="!hasClient()"></i>
          @if (hasClient()) {
            <span i18n="@@sales-orders.sales-order-create.client.selectionne.f00810aa">Client sélectionné</span>
          } @else {
            <span i18n="@@sales-orders.sales-order-create.selectionnez.un.client.fb1d3ea4">Sélectionnez un client</span>
          }
        </li>
        <li [class.submit-readiness__item--done]="hasOrderDate()">
          <i class="pi" [class.pi-check-circle]="hasOrderDate()" [class.pi-circle]="!hasOrderDate()"></i>
          @if (hasOrderDate()) {
            <span i18n="@@sales-orders.sales-order-create.date.de.commande.renseignee.55a133b3">Date de commande renseignée</span>
          } @else {
            <span i18n="@@sales-orders.sales-order-create.indiquez.la.date.de.commande.6f92819c">Indiquez la date de commande</span>
          }
        </li>
        <li [class.submit-readiness__item--done]="hasLines()">
          <i class="pi" [class.pi-check-circle]="hasLines()" [class.pi-circle]="!hasLines()"></i>
          @if (hasLines()) {
            <span>{{ lines().length }} ligne(s) produit ajoutée(s)</span>
          } @else {
            <button type="button" class="submit-readiness__link" (click)="scrollToLines()" i18n="@@sales-orders.sales-order-create.ajoutez.au.moins.une.ligne.produit.section.ligne.d5f1dfd9">Ajoutez au moins une ligne produit (section Lignes)</button>
          }
        </li>
      </ul>
    </div>

    <app-form-section title="Informations" i18n-title="Informations" icon="pi-user" [number]="1">
      <div class="ft-form-grid ft-form-grid--compact">
        <div class="ft-field ft-field--full">
          <label for="so-client">Client <span class="ft-required" i18n="@@sales-orders.sales-order-create.text.df58248c">*</span></label>
          <p-autoComplete
            inputId="so-client"
            [(ngModel)]="selectedClient"
            [suggestions]="clientSuggestions()"
            (completeMethod)="searchClients($event)"
            (onSelect)="onClientChange()"
            (onClear)="onClientChange()"
            field="label"
            [forceSelection]="true"
            [dropdown]="true"
            placeholder="Rechercher un client" i18n-placeholder="Rechercher un client"
            styleClass="w-full"
            appendTo="body"></p-autoComplete>
          <small class="ft-hint" i18n="@@sales-orders.sales-order-create.le.client.determine.la.grille.tarifaire.applique.bd668e74">Le client détermine la grille tarifaire appliquée aux lignes.</small>
        </div>

        <div class="ft-field">
          <label for="so-date">Date de commande <span class="ft-required" i18n="@@sales-orders.sales-order-create.text.df58248c">*</span></label>
          <p-datepicker
            inputId="so-date"
            [(ngModel)]="orderDateModel"
            (ngModelChange)="onDateChange()"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            styleClass="w-full"
            appendTo="body"></p-datepicker>
        </div>

        <div class="ft-field">
          <label for="so-delivery" i18n="@@sales-orders.sales-order-create.livraison.prevue.dc15f458">Livraison prévue</label>
          <p-datepicker
            inputId="so-delivery"
            [(ngModel)]="expectedDeliveryDateModel"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            [minDate]="orderDateModel"
            [showClear]="true"
            styleClass="w-full"
            appendTo="body"></p-datepicker>
        </div>

        <div class="ft-field">
          <label for="so-ref" i18n="@@sales-orders.sales-order-create.reference.f8130bb0">Référence</label>
          <input
            id="so-ref"
            pInputText
            [(ngModel)]="reference"
            maxlength="100"
            placeholder="Bon de commande du client" i18n-placeholder="Bon de commande du client" />
        </div>

        <div class="ft-field ft-field--half">
          <label for="so-terms" i18n="@@sales-orders.sales-order-create.conditions.de.reglement.84c9c451">Conditions de règlement</label>
          <input id="so-terms" pInputText [(ngModel)]="paymentTerms" maxlength="500" />
        </div>

        <div class="ft-field ft-field--half">
          <label for="so-notes" i18n="@@sales-orders.sales-order-create.notes.70440046">Notes</label>
          <textarea id="so-notes" pTextarea [(ngModel)]="notes" rows="2" maxlength="2000"></textarea>
        </div>
      </div>
    </app-form-section>

    <div
      id="section-lignes"
      class="lines-section-wrap"
      [class.lines-section-wrap--empty]="lines().length === 0">
      <app-form-section title="Lignes" i18n-title="Lignes" icon="pi-list" [number]="2">
        <div class="ft-form-grid ft-form-grid--inline">
          <div class="ft-field ft-field--grow">
            <label for="so-product" i18n="@@sales-orders.sales-order-create.produit.ff673dc2">Produit</label>
            <p-autoComplete
              inputId="so-product"
              [(ngModel)]="newProduct"
              [suggestions]="productSuggestions()"
              (completeMethod)="searchProducts($event)"
              field="label"
              [forceSelection]="true"
              [dropdown]="true"
              placeholder="Rechercher par code ou nom" i18n-placeholder="Rechercher par code ou nom"
              styleClass="w-full"
              appendTo="body"></p-autoComplete>
          </div>

          <div class="ft-field">
            <label for="so-qty" i18n="@@sales-orders.sales-order-create.quantite.09a38fda">Quantité</label>
            <p-inputNumber
              inputId="so-qty"
              [(ngModel)]="newQuantity"
              (onKeyDown)="onQuantityKeyDown($event)"
              mode="decimal"
              [minFractionDigits]="0"
              [maxFractionDigits]="4"
              [min]="0"></p-inputNumber>
          </div>

          <div class="ft-field ft-field--actions">
            <app-button
              variant="secondary"
              icon="pi-plus"
              iconPos="left"
              [disabled]="!newProduct || !newQuantity || newQuantity <= 0 || linePricing.resolving()"
              (clicked)="addLine()" i18n="@@sales-orders.sales-order-create.ajouter.87c57ed1">Ajouter</app-button>
          </div>
        </div>

        @if (barcodeScanEnabled) {
          <div class="barcode-scan-row">
            <ft-barcode-scan-field
              placeholder="Scanner un code-barres pour ajouter une ligne" i18n-placeholder="Scanner un code-barres pour ajouter une ligne"
              [autoFocus]="false"
              (scanned)="onBarcodeScanned($event)"></ft-barcode-scan-field>
          </div>
        }

        @if (lines().length === 0) {
          <div class="ft-empty-inline">
            <i class="pi pi-inbox"></i>
            <p i18n="@@sales-orders.sales-order-create.aucune.ligne.ajoutee.2b6077b4">Aucune ligne ajoutée.</p>
            <p class="ft-hint" i18n="@@sales-orders.sales-order-create.commencez.par.rechercher.un.produit.ci.dessus.sa.c29eae40">Commencez par rechercher un produit ci-dessus, saisissez une quantité puis cliquez
              sur « Ajouter » — au moins une ligne est requise pour créer la commande.</p>
          </div>
        } @else {
          <p-table [value]="lines()" styleClass="ft-table">
            <ng-template pTemplate="header">
              <tr>
                <th class="ft-row-number-col" i18n="@@sales-orders.sales-order-create.text.d08f88df">#</th>
                <th i18n="@@sales-orders.sales-order-create.produit.ff673dc2">Produit</th>
                <th class="ft-num" i18n="@@sales-orders.sales-order-create.quantite.09a38fda">Quantité</th>
                <th class="ft-num" i18n="@@sales-orders.sales-order-create.pu.ht.79388cae">PU HT</th>
                <th i18n="@@sales-orders.sales-order-create.origine.du.prix.3b61b8a6">Origine du prix</th>
                <th class="ft-num" i18n="@@sales-orders.sales-order-create.remise.a39386b5">Remise %</th>
                <th class="ft-num" i18n="@@sales-orders.sales-order-create.total.ht.2ca17ae6">Total HT</th>
                <th class="ft-actions-col"></th>
              </tr>
            </ng-template>

            <ng-template pTemplate="body" let-line let-i="rowIndex">
              <tr>
                <td class="ft-row-number">{{ i + 1 }}</td>
                <td>
                  <div class="line-product">
                    <span class="line-product-name">{{ line.product.name }}</span>
                    <span class="line-product-code">{{ line.product.code }}</span>
                  </div>
                </td>
                <td class="ft-num">
                  <p-inputNumber
                    [(ngModel)]="line.quantity"
                    (onBlur)="onQuantityChange(i)"
                    mode="decimal"
                    [minFractionDigits]="0"
                    [maxFractionDigits]="4"
                    [min]="0"
                    styleClass="ft-inline-input"></p-inputNumber>
                </td>
                <td class="ft-num">
                  <p-inputNumber
                    [(ngModel)]="line.unitPrice"
                    (onInput)="markOverridden(i)"
                    mode="decimal"
                    [minFractionDigits]="3"
                    [maxFractionDigits]="3"
                    [min]="0"
                    styleClass="ft-inline-input"></p-inputNumber>
                </td>
                <td>
                  @if (linePricing.resolving()) {
                    <i
                      class="pi pi-spin pi-spinner ft-resolving"
                      pTooltip="Résolution du prix en cours…"
                      tooltipPosition="top"></i>
                  }
                  @if (line.priceOverridden) {
                    <p-tag
                      severity="warning"
                      value="Saisi"
                      pTooltip="Prix imposé à la main : il remplace le prix résolu."></p-tag>
                  } @else if (line.priceSource === 'ClientPrice') {
                    <p-tag severity="success" value="Prix négocié"></p-tag>
                  } @else if (line.priceSource === 'PriceList') {
                    <p-tag severity="info" value="Grille"></p-tag>
                  } @else {
                    <span class="ft-muted" i18n="@@sales-orders.sales-order-create.catalogue.5a241023">Catalogue</span>
                  }
                  @if (line.promotionEligible && line.promotionName) {
                    <p-tag
                      severity="success"
                      [value]="'Promo : ' + line.promotionName + ' (-' + line.promotionDiscountPercent + ' %)'"
                      class="promo-tag"></p-tag>
                  } @else if (line.promotionMinQuantityRequired && line.promotionName) {
                    <small class="promo-hint">
                      {{ line.promotionName }} : qty min. {{ line.promotionMinQuantityRequired }}
                    </small>
                  }
                </td>
                <td class="ft-num">
                  <p-inputNumber
                    [(ngModel)]="line.discountPercent"
                    mode="decimal"
                    [minFractionDigits]="0"
                    [maxFractionDigits]="2"
                    [min]="0"
                    [max]="100"
                    styleClass="ft-inline-input"></p-inputNumber>
                </td>
                <td class="ft-num">{{ lineTotal(line) | number: '1.3-3' }}</td>
                <td class="ft-actions-col">
                  <button
                    pButton
                    type="button"
                    icon="pi pi-trash"
                    class="p-button-text p-button-sm p-button-danger"
                    pTooltip="Retirer"
                    aria-label="Retirer la ligne" i18n-aria-label="Retirer la ligne"
                    (click)="removeLine(i)"></button>
                </td>
              </tr>
            </ng-template>
          </p-table>

          <div class="ft-totals">
            <div class="ft-totals__row ft-totals__row--grand">
              <span i18n="@@sales-orders.sales-order-create.total.ht.2ca17ae6">Total HT</span><span>{{ totalHt() | number: '1.3-3' }} TND</span>
            </div>
            <small class="ft-hint" i18n="@@sales-orders.sales-order-create.tva.fodec.et.timbre.fiscal.sont.calcules.par.le..ae8f7227">TVA, FODEC et timbre fiscal sont calculés par le serveur à la création.</small>
          </div>
        }
      </app-form-section>
    </div>

    @if (lines().length > 0) {
      <div class="sticky-action-bar" role="region" aria-label="Actions de création" i18n-aria-label="Actions de création">
        <div class="sticky-action-bar__total">
          <span class="sticky-action-bar__label" i18n="@@sales-orders.sales-order-create.total.ht.2ca17ae6">Total HT</span>
          <span class="sticky-action-bar__amount">{{ totalHt() | number: '1.3-3' }} TND</span>
        </div>
        <div class="sticky-action-bar__actions">
          <app-button variant="secondary" routerLink="/sales-orders" i18n="@@sales-orders.sales-order-create.annuler.49ba3292">Annuler</app-button>
          <span
            [pTooltip]="submitBlockersTooltip()"
            [tooltipDisabled]="canSubmit() || saving()"
            tooltipPosition="top">
            <app-button
              variant="primary"
              [disabled]="!canSubmit() || saving() || linePricing.resolving()"
              [icon]="saving() ? 'pi-spin pi-spinner' : 'pi-check'"
              iconPos="left"
              (clicked)="submit()">
              {{ saving() ? 'Création…' : 'Créer la commande' }}
            </app-button>
          </span>
        </div>
      </div>
    }
  `,
  styleUrls: ['./sales-order-create.component.scss']
})
export class SalesOrderCreateComponent {
  private readonly router = inject(Router);
  private readonly salesOrderService = inject(SalesOrderService);
  readonly linePricing = inject(DocumentLinePricingService);
  private readonly barcodeLookup = inject(BarcodeLookupService);
  private readonly barcodeFeedback = inject(BarcodeFeedbackService);
  readonly barcodeScanEnabled = environment.featureFlags?.barcodeScanOnDocuments === true;
  private readonly clientService = inject(ClientService);
  private readonly productService = inject(ProductService);
  private readonly toastService = inject(ToastService);
  private readonly errorHandler = inject(ErrorHandlerService);

  readonly lines = signal<DraftLine[]>([]);
  readonly clientSuggestions = signal<ClientOption[]>([]);
  readonly productSuggestions = signal<ProductOption[]>([]);
  readonly saving = signal(false);

  selectedClient: ClientOption | null = null;
  orderDateModel: Date = new Date();
  expectedDeliveryDateModel: Date | null = null;
  reference = '';
  notes = '';
  paymentTerms = '';

  newProduct: ProductOption | null = null;
  newQuantity: number | null = 1;

  readonly breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Ventes' },
    { label: 'Commandes clients', route: '/sales-orders' },
    { label: 'Nouvelle' }
  ];

  readonly totalHt = computed(() =>
    this.lines().reduce((sum, l) => sum + this.lineTotal(l), 0)
  );

  canSubmit(): boolean {
    return (
      this.selectedClient !== null &&
      this.lines().length > 0 &&
      !!this.orderDateModel &&
      !this.linePricing.resolving()
    );
  }

  hasClient(): boolean {
    return this.selectedClient !== null;
  }

  hasOrderDate(): boolean {
    return !!this.orderDateModel;
  }

  hasLines(): boolean {
    return this.lines().length > 0;
  }

  submitBlockers(): string[] {
    const blockers: string[] = [];
    if (!this.hasClient()) blockers.push('Sélectionnez un client');
    if (!this.hasOrderDate()) blockers.push('Indiquez la date de commande');
    if (!this.hasLines()) blockers.push('Ajoutez au moins une ligne produit');
    if (this.linePricing.resolving()) blockers.push('Résolution des prix en cours');
    return blockers;
  }

  submitBlockersTooltip(): string {
    const blockers = this.submitBlockers();
    return blockers.length > 0 ? blockers.join(' · ') : '';
  }

  scrollToLines(): void {
    document.getElementById('section-lignes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  getOrderDateString(): string {
    return formatLocalDate(this.orderDateModel);
  }

  getExpectedDeliveryDateString(): string | null {
    return this.expectedDeliveryDateModel ? formatLocalDate(this.expectedDeliveryDateModel) : null;
  }

  lineTotal(line: DraftLine): number {
    return lineTotalWithPromotion(line.quantity, line.unitPrice, line.discountPercent, line);
  }

  searchClients(event: { query: string }): void {
    this.clientService.getClients({ search: event.query, pageSize: 20, isActive: true }).subscribe({
      next: res => {
        const items = res.data?.items ?? [];
        this.clientSuggestions.set(items.map(c => ({ id: c.id, label: `${c.name}` })));
      },
      error: () => this.clientSuggestions.set([])
    });
  }

  searchProducts(event: { query: string }): void {
    this.productService.getProducts({ search: event.query, pageSize: 20 }).subscribe({
      next: res => {
        const items = res.data?.items ?? [];
        this.productSuggestions.set(
          items.map(p => ({
            id: p.id,
            code: p.code,
            name: p.name,
            label: `${p.code} — ${p.name}`,
            unitPrice: p.unitPrice
          }))
        );
      },
      error: () => this.productSuggestions.set([])
    });
  }

  /**
   * Changer de client change la grille applicable : on retarife toutes les lignes dont le prix
   * n'a pas été imposé à la main. Les laisser au prix du client précédent afficherait un total
   * que le serveur ne confirmerait pas.
   */
  onClientChange(): void {
    this.reresolveAll();
  }

  onDateChange(): void {
    this.reresolveAll();
  }

  onQuantityKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.addLine();
    }
  }

  private reresolveAll(): void {
    const current = this.lines();
    if (current.length === 0) return;

    current.forEach((line, index) => {
      if (!line.priceOverridden) this.resolvePriceFor(index);
    });
  }

  addLine(): void {
    if (!this.newProduct || !this.newQuantity || this.newQuantity <= 0) return;

    const product = this.newProduct;
    const quantity = this.newQuantity;

    // Prix catalogue en attendant la réponse du serveur : la ligne ne reste jamais vide.
    this.lines.update(list => [
      ...list,
      {
        product,
        quantity,
        unitPrice: product.unitPrice,
        discountPercent: null,
        notes: null,
        priceSource: null,
        priceOverridden: false,
        ...EMPTY_LINE_PROMOTION
      }
    ]);

    this.newProduct = null;
    this.newQuantity = 1;

    this.resolvePriceFor(this.lines().length - 1);
  }

  onQuantityChange(index: number): void {
    // La quantité entrera dans la résolution avec les paliers (tranche 5B) ; on redemande
    // dès maintenant pour que l'écran suive le serveur sans changement ultérieur.
    const line = this.lines()[index];
    if (line && !line.priceOverridden) this.resolvePriceFor(index);
  }

  markOverridden(index: number): void {
    this.lines.update(list =>
      list.map((l, i) => (i === index ? { ...l, priceOverridden: true, priceSource: null } : l))
    );
  }

  private resolvePriceFor(index: number): void {
    const line = this.lines()[index];
    if (!line) return;

    this.linePricing
      .resolveLinePrice({
        productId: line.product.id,
        clientId: this.selectedClient?.id ?? null,
        quantity: line.quantity,
        documentDate: this.orderDateModel,
        priceOverridden: line.priceOverridden,
        isOverrideCheck: () => this.lines()[index]?.priceOverridden === true
      })
      .subscribe({
        next: resolved => {
          if (!resolved) return;
          this.lines.update(list =>
            list.map((l, i) =>
              i === index && !l.priceOverridden
                ? {
                    ...l,
                    unitPrice: resolved.unitPriceHT,
                    priceSource: resolved.source,
                    ...mapResolvedPricePromotion(resolved)
                  }
                : l
            )
          );
        },
        error: err => {
          this.errorHandler.logError('Price resolution failed', err);
        }
      });
  }

  removeLine(index: number): void {
    this.lines.update(list => list.filter((_, i) => i !== index));
  }

  submit(): void {
    if (!this.canSubmit() || !this.selectedClient) return;

    const orderDate = this.getOrderDateString();
    const expectedDeliveryDate = this.getExpectedDeliveryDateString();

    if (expectedDeliveryDate && expectedDeliveryDate < orderDate) {
      this.toastService.add({
        severity: 'warn',
        summary: 'Date invalide',
        detail: 'La date de livraison prévue ne peut pas être antérieure à la date de commande.'
      });
      return;
    }

    const lines: CreateSalesOrderLineRequest[] = this.lines().map(l => ({
      productId: l.product.id,
      quantity: l.quantity,
      unitPrice: l.priceOverridden ? l.unitPrice : 0,
      discountPercent: l.discountPercent,
      notes: l.notes
    }));

    this.saving.set(true);
    this.salesOrderService
      .createSalesOrder({
        clientId: this.selectedClient.id,
        orderDate,
        expectedDeliveryDate,
        reference: this.reference || null,
        notes: this.notes || null,
        paymentTerms: this.paymentTerms || null,
        lines
      })
      .subscribe({
        next: res => {
          this.toastService.add({
            severity: 'success',
            summary: 'Succès',
            detail: 'Commande créée en brouillon.'
          });
          this.saving.set(false);
          const id = res.data;
          this.router.navigate(['/sales-orders', id]);
        },
        error: err => {
          const msg = this.errorHandler.extractErrorMessage(err);
          this.toastService.add({
            severity: 'error',
            summary: 'Erreur',
            detail: msg || 'Création impossible'
          });
          this.errorHandler.logError('Create sales order failed', err);
          this.saving.set(false);
        }
      });
  }

  /**
   * Scan d'un code-barres sur une commande client.
   *
   * L'écran ajoute les lignes par un couple « article + quantité » plutôt que par une grille
   * modifiable : le scan emprunte donc le même chemin, en renseignant ce couple puis en
   * appelant addLine(). L'article déjà commandé voit simplement sa quantité augmenter.
   *
   * La disponibilité n'est pas bloquante ici — une commande peut légitimement porter sur du
   * stock à venir.
   */
  onBarcodeScanned(code: string): void {
    this.barcodeLookup.resolve(code).subscribe(result => {
      if (result.status !== 'found' || !result.product) {
        this.barcodeFeedback.report(result);
        return;
      }

      const product = result.product;
      const index = this.lines().findIndex(l => l.product?.id === product.id);

      if (index >= 0) {
        this.lines.update(list =>
          list.map((l, i) => (i === index ? { ...l, quantity: (l.quantity || 0) + 1 } : l))
        );
        this.onQuantityChange(index);
      } else {
        // La zone d'ajout attend un ProductOption (avec son libellé d'affichage), pas le DTO
        // de liste : on l'adapte comme le fait la recherche par autocomplétion.
        this.newProduct = {
          id: product.id,
          code: product.code,
          name: product.name,
          label: `${product.code} — ${product.name}`,
          unitPrice: product.unitPrice
        };
        this.newQuantity = 1;
        this.addLine();
      }

      this.barcodeFeedback.success(product.name);
    });
  }
}
